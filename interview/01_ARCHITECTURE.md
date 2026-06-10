# FrameDrops — Architecture Document

## What the Application Does

FrameDrops is a **B2B2C SaaS platform for Indian photographers**. It solves three problems:

1. **Sharing** — photographers upload event albums and share them with clients via opaque gallery links
2. **Monetization (Flow 1)** — photographers pay the platform to unlock completed albums for client download
3. **Monetization (Flow 2)** — photographers can charge their clients for gallery access; money flows to photographer wallet

Secondary features: agreement builder, event calendar, selection workflow (client picks favourite photos), wallet + withdrawals, admin portal.

---

## System Design Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                     BROWSER (Vue 3 SPA)                     │
│  Pinia Stores ──▶ API Services ──▶ fetchAdapter (client.ts) │
│  Web Worker (compression) ──▶ IndexedDB (upload resume)     │
└────────────┬────────────────────────────────────────────────┘
             │ HTTPS/JSON (REST)
             ▼
┌────────────────────────┐    ┌──────────────────────────┐
│   Express.js Backend   │───▶│   Cloudflare R2          │
│   Node.js ESM          │    │   Primary image storage  │
│   JWT + asyncHandler   │    │   Presigned URL upload   │
│   pg.Pool (raw SQL)    │    │   Weekly orphan reaper   │
│   Razorpay SDK         │    │   Reconciliation worker  │
│   nodemailer (Brevo)   │    └──────────────────────────┘
│   node-cron workers    │
└───────────┬────────────┘
            │
     ┌──────────────────┐
     │   PostgreSQL     │
     │   pg.Pool        │
     │   raw SQL        │
     │   Advisory locks │
     └──────────────────┘
```

---

## Data Flow

### Upload Flow
```
1. Browser selects files
2. Web Worker compresses each file (1048px max, JPEG 0.85)
3. POST /albums/:id/photos/sign  → backend generates R2 presigned PUT URL + storage_key
4. Browser PUT <presigned URL> directly to Cloudflare R2 (binary, no backend proxy)
5. POST /albums/:id/photos/finalize → backend validates storage_key prefix, inserts photos row
```

### Payment Flow (Photographer → Platform, "Flow 1")
```
1. Photographer completes album → album.is_locked = true
2. Frontend fetches locked albums via GET /billing/locked-albums?clientId=X
3. POST /payments/create-order → Razorpay order created, transactions row inserted (status=pending)
4. Frontend opens Razorpay modal
5. User pays in Razorpay UI
6. Frontend calls POST /payments/verify (orderId, paymentId, razorpay_signature)
7. Backend verifies HMAC signature
8. DB transaction: mark albums is_paid=true, recompute clients.is_paid, consume trial if applicable
9. Email queued (invoice, notification)
```

### Gallery Access Flow (Client → Photographer, "Flow 2")
```
1. Photographer shares link (opaque shareId, no email/phone in URL)
2. Client opens /gallery/:shareId
3. Optional: access code gate → POST /client-auth/verify-code
4. Optional: payment gate → POST /client-payments/create-order → Razorpay → verify
5. Client views/downloads photos
6. Photographer wallet credited (amount minus platform fee %)
```

---

## Frontend Architecture

| Concern | Implementation |
|---|---|
| Framework | Vue 3 Composition API + TypeScript |
| Build tool | Vite, SPA mode (no SSR) |
| UI library | Vuetify 3 with custom `framedropsTheme` |
| State | Pinia setup stores (one per domain) |
| HTTP | `api/client.ts` (fetchAdapter) — single place for all JSON calls |
| Routing | Vue Router, 24 routes, lazy-loaded, `beforeEach` JWT guard |
| Upload | `services/upload/engine.ts` — module singleton, IndexedDB-backed, Web Worker compression, presigned R2 PUT |
| i18n | vue-i18n, lazy-loaded, Telugu/Hindi/English |
| Error tracking | Sentry (scrubs tokens from breadcrumbs in `main.ts`) |

### Store Pattern (all stores follow this)
```ts
export const useXxxStore = defineStore('xxx', () => {
  const items = ref<X[]>([])
  const loading = ref(false)
  const error = ref<string | null>(null)

  async function fetchItems() {
    loading.value = true
    error.value = null
    try {
      const res = await xxxService.list()
      items.value = res.data ?? []
    } catch (err) {
      error.value = (err as { message?: string })?.message ?? 'Failed'
      throw err   // re-throw so views can show toasts
    } finally {
      loading.value = false
    }
  }

  return { items, loading, error, fetchItems }
})
```

---

## Backend Architecture

| Concern | Implementation |
|---|---|
| Framework | Express.js (Node ESM) |
| Pattern | `routes → controllers → services → repositories` |
| DB client | `pg.Pool`, raw SQL, `db.js` exports `query()`, `transaction()`, `getClient()` |
| Auth middleware | `auth.js` — JWT verify + 30s user cache + token_version check |
| Error handling | `asyncHandler` wrapper on every route handler; global error handler in `errorHandler.js` |
| Response shape | `R.success / R.error / R.created` (frozen object) — all endpoints use this |
| Workers | node-cron + PostgreSQL advisory locks (prevent duplicate runs across pods) |
| Email | Durable `email_jobs` table polled every 30s by `email.worker.js` |
| Admin | Isolated under `/v1/admin`, `requireAdmin` middleware, role from DB not token |

### 3-Layer Pattern
```
routes/album.routes.js
  └── controllers/album.controller.js   (thin, just calls service, uses R.*)
        └── services/album.service.js   (business logic, returns { data } or { error, status })
              └── repositories/album.repository.js  (raw SQL, returns row(s))
```

---

## Database Relationships

```
users
├── clients (1:M via user_id)
│   ├── albums (1:M via client_id)
│   │   └── photos (1:M via album_id)
│   └── client_payments (1:M)
├── transactions (Flow 1, user_id FK)
│   └── album_ids JSONB (snapshot of paid album IDs)
├── wallets (1:1)
│   └── wallet_transactions (1:M)
├── withdrawals (1:M)
├── notifications (1:M)
├── email_jobs (1:M)
├── otp_codes (1:M)
└── agreements (1:M)
```

### Key Design Decisions

| Decision | Why |
|---|---|
| `albums.is_paid` is sole truth source | Prevents split-brain — one flag to query for access |
| `clients.is_paid` is derived | Recomputed after every payment as `NOT EXISTS(unpaid completed album for client)` |
| `transactions.album_ids JSONB` | Snapshot at payment time — albums can be modified later without losing payment record |
| Raw SQL (no ORM) | Full control over query plans, no ORM abstraction surprises, easier `FOR UPDATE` locks |
| Advisory locks for workers | Workers run inside same PostgreSQL — no Redis needed for distributed lock |

---

## Deployment Architecture

```
[Vite SPA build] ──▶ Static hosting / CDN
[Express backend] ──▶ Node.js server (single process or N pods)
[PostgreSQL]       ──▶ Managed DB (no read replicas currently)
[Cloudflare R2]    ──▶ Primary image/file storage (presigned PUTs from browser)
[Brevo SMTP]       ──▶ External email relay
[Sentry]           ──▶ Error tracking
[Razorpay]         ──▶ Payment gateway (India-only)
```

**Worker startup:** All cron workers start inside the same Node.js process as the HTTP server (`server.js`). Advisory locks ensure only one instance runs a given worker at a time across pods.

**Graceful shutdown:** `server.js` handles `SIGTERM` — stops accepting new connections, waits for in-flight requests, closes DB pool.

---

## Security Architecture

| Layer | Mechanism | Where in code |
|---|---|---|
| Authentication | HS256 JWT, `Authorization: Bearer` header | `middleware/auth.js` |
| Token revocation | `token_version` column, bump + cache invalidate | `auth.service.js` |
| Admin role | Re-checked from DB on every admin request (not in token) | `middleware/adminAuth.js` |
| CORS | `ALLOWED_ORIGINS` env allowlist | `server.js` |
| Upload security | R2 presigned URL generated server-side; `storage_key` prefix validated on finalize | `photo.service.js` |
| Payment security | Razorpay HMAC signature verified server-side on every verify call | `razorpay.service.js` |
| Captcha | Cloudflare Turnstile on auth/signup routes | `middleware/turnstile.js` |
| Rate limiting | Per-endpoint Express rate limiters | `server.js` + route-level |
| OTP | Bcrypt-hashed, 5 per email per 10 min, expires after use | `otp.js`, `auth.service.js` |
| Email validation | Disposable/placeholder domain blocklist | `lib/emailValidation.js` |
| Secrets | Never in API responses, never in frontend bundle | `.env.example` pattern |
| Share links | Opaque `shareId` — no email/phone/predictable IDs in URLs | `clients` table |
