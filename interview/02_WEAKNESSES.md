# FrameDrops — Known Weaknesses & Technical Debt

> Be honest about these in interviews. Showing you can identify weaknesses in your own code is a senior signal.

---

## Security Gaps

### 1. No Refresh Token
- JWTs are long-lived (configurable via `JWT_EXPIRES_IN`)
- If a token is stolen, token_version bumping helps only if the user actively logs out
- **Fix:** Short-lived access token (15 min) + httpOnly cookie refresh token

### 2. Token Revocation Has a 30-Second Window
- `auth.js` caches user record for 30 seconds
- A revoked token (bumped token_version) still works for up to 30s
- **Fix:** Reduce cache TTL or use Redis with pub/sub invalidation

### 3. Admin Allowlist in Environment Variables
- `ADMIN_EMAIL` / `ADMIN_PHONE` — rotating admin requires a redeploy
- **Fix:** Admin roles fully in DB with invite-based provisioning

### 4. R2 Storage Key Prefix Validation Is Prefix-Only
- Finalize checks `storage_key.startsWith(expectedPrefix)` — if the key scheme is guessable, someone could claim another photographer's uploaded file
- **Fix:** Include a UUIDv4 component in the storage key per upload session so keys are unguessable

### 5. No CSRF Tokens
- Not a vulnerability here because authentication is via `Authorization: Bearer` header (not cookies), so CSRF doesn't apply
- But if you ever switch to cookies for tokens, CSRF becomes critical

---

## Performance Bottlenecks

### 1. No Database Read Replicas
- Every read and write goes to the same PostgreSQL instance
- At scale, analytics queries (admin portal) will compete with write traffic
- **Fix:** Add a read replica; route analytics queries to it

### 2. In-Process User Cache (Not Shared)
- 30-second user cache lives in Node.js process memory
- With multiple pods, each pod has its own cache — redundant DB hits
- **Fix:** Redis for shared user cache with pub/sub invalidation on token_version bump

### 3. Email Worker Polls Every 30 Seconds
- Non-OTP emails (invoices, notifications) can be delayed up to 30s
- OTP bypasses the queue (inline send), so auth is fast
- **Fix:** Use pg_notify to wake the worker immediately on `email_jobs` INSERT

### 4. No Pagination Guards on Some List Endpoints
- Some photo list queries could return unbounded rows for large albums
- **Fix:** Enforce `LIMIT` + cursor-based pagination on all list endpoints

### 5. Compression on Low-End Phones
- 500-photo album compression via Web Worker can be slow on budget Android phones
- **Fix:** Adaptive quality based on `navigator.deviceMemory` / `navigator.hardwareConcurrency`

---

## Scalability Issues

### 1. Workers Are Single-Instance by Design
- Advisory locks prevent concurrent worker execution — good for correctness, but workers don't parallelize
- At high volume, album expiry processing a queue of thousands sequentially is slow
- **Fix:** Shard work by user_id modulo or move to a proper job queue (BullMQ + Redis)

### 2. `SELECT FOR UPDATE` Lock Contention
- `MAX_PHOTOS_PER_ALBUM` and `CLIENT_MAX_IMAGES` caps enforced via `SELECT FOR UPDATE`
- Correct for consistency, but creates contention when many photographers upload simultaneously
- **Fix:** Optimistic concurrency with retry, or counter columns updated via atomic `UPDATE ... RETURNING`

### 3. Single PostgreSQL Primary
- No read replicas, no PgBouncer connection pooling
- **Fix at scale:** PgBouncer in front, read replica for analytics, consider Citus for horizontal sharding

### 4. Razorpay is India-Only
- Limits expansion to Indian market
- **Fix:** Abstract payment provider behind an interface; add Stripe for international

### 5. No Event-Driven Architecture for Payment Side Effects
- `applySideEffects()` runs synchronously inside `POST /payments/verify`
- If DB is slow or email queue insert fails, the verify endpoint fails or partially succeeds
- **Fix:** Emit a `payment.succeeded` domain event; handle side effects (email, wallet credit) in separate listeners

---

## Maintainability Concerns

### 1. No Automated Tests
- Zero test files in either repo
- Any refactor to billing invariants or trial state machine carries high regression risk
- **What to say:** "This was a speed-vs-safety trade-off during MVP. The billing invariants are documented in CLAUDE.md and comments. Next priority is integration tests for the payment verify flow."

### 2. Manual Database Migrations
- 14 numbered `.sql` files applied by hand in production
- No migration runner (Flyway, Liquibase, `node-pg-migrate`)
- `full_schema_v2.sql` can drift from the incremental migrations
- **Fix:** Use `node-pg-migrate` or Flyway; add a migration state table

### 3. Two Upload Systems Coexist
- Legacy composables (`useBulkUploadManager`, `useUploadManager`, `useWorkerPool`) in `composables/`
- New persistent engine (`services/upload/engine.ts`) in `services/upload/`
- `AlbumDetailView` still uses the legacy composable
- **Fix:** Migrate `AlbumDetailView` to use the new engine; delete legacy composables

### 4. Pricing Config in Two Places
- `config/pricing.ts` (frontend) and `config/pricing.js` (backend) can drift
- `VITE_PRICING_TIERS` env var takes a JSON string — fragile, no schema validation
- **Fix:** Single pricing config in backend, served via `/v1/billing/pricing` endpoint (already exists — use it exclusively)

---

## Technical Debt

| Item | Location | Impact |
|---|---|---|
| Legacy upload composables | `src/composables/useBulkUploadManager.js` | Medium — two upload code paths to maintain |
| Phone OTP incomplete | `auth/providers/` | Low — feature not released |
| `billing.js` middleware labeled "Legacy" | `middleware/billing.js` | Low — unclear ownership |
| `dbBackup.worker.js` not active | `workers/dbBackup.worker.js` | Low — dead code |
| Sentry only, no structured logs | `instrument.js` | Medium — no log aggregation (no Datadog/Loki) |

---

## Missing Best Practices

| Missing | Impact | Quick Fix |
|---|---|---|
| No `/health` endpoint | Load balancer can't probe readiness | Add `GET /health → 200 { status: 'ok' }` |
| No structured logging | Can't query logs by userId/requestId | Replace `console.log` with `pino` |
| No correlation IDs | Can't trace a request across logs | Add `x-request-id` header middleware |
| No rate limit on `/photos/finalize` | DB write endpoint unguarded | Add rate limiter matching sign endpoint |
| No OpenTelemetry | Can't trace request spans | Add `@opentelemetry/auto-instrumentations-node` |
| No idempotency key header | Double-submit relies only on DB unique index | Add `Idempotency-Key` header support to payment endpoints |
