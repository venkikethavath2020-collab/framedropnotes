# Framedrops Technical Notes — Explained Like You're 10

> A friendly tour of how Framedrops works under the hood.
> Pretend you're a curious kid. We'll explain everything in plain English.

---

## 🎬 The Big Picture (one minute)

Imagine you're a wedding photographer. You took **1,500 photos**. The bride and groom need to pick the 200 they love most.

**The old way:**
1. You upload all 1,500 photos to Google Drive (slow!)
2. You share a Drive link on WhatsApp
3. The couple writes photo file names on a paper
4. They send you a WhatsApp message with the names
5. You spend hours hunting down those exact files

**The Framedrops way:**
1. You drag-drop photos into Framedrops (they get tiny automatically — like magic shrinking)
2. You share ONE branded link
3. The couple taps a heart ❤️ on their favorites
4. You instantly see the list of names
5. You copy the original photos from your computer to a "selected" folder — done

That's the whole product. The rest of this document explains how the computer code makes that happen.

---

## 🏠 The Two Houses

Framedrops is split into **two separate apps** that talk to each other:

```
┌─────────────────────────────┐         ┌─────────────────────────────┐
│   FRONTEND (FE)             │  talks  │   BACKEND (BE)              │
│   "the face you see"        │ ◄────► │   "the brain"                │
│                             │         │                             │
│   📁 framedrops/            │         │   📁 framedropsbe/          │
│                             │         │                             │
│   Lives in:                 │         │   Lives in:                 │
│   Your web browser          │         │   A server somewhere        │
│                             │         │                             │
│   Made of:                  │         │   Made of:                  │
│   • Vue 3 (like LEGO blocks)│         │   • Node.js + Express       │
│   • TypeScript              │         │   • PostgreSQL database     │
│   • Vuetify (pretty buttons)│         │   • Cloudflare R2 (storage) │
└─────────────────────────────┘         └─────────────────────────────┘
```

**Think of it like a restaurant:**
- The **frontend** is the menu, the table, the waiter — what the customer sees
- The **backend** is the kitchen — where the food is actually made
- They talk through a **window** (we call this an API)

**Rule #1:** The kitchen never directly touches the customer's table. They pass things through the window only. That's why we have **two folders, not one.**

---

## 🧠 Part 1 — The Frontend (FE)

### Where everything lives

```
framedrops/src/
│
├── views/         ← Pages (like the album page, login page)
├── components/    ← Reusable pieces (like buttons, cards)
├── stores/        ← Memory boxes that hold data
├── api/services/  ← Messengers that talk to the backend
├── config/        ← Settings (prices, contact info)
├── i18n/          ← Language translations (English, Telugu, Hindi)
└── workers/       ← Background helpers (photo shrinking)
```

### The Five Pillars (memorize these)

#### 1. **Views = Pages**
A view is a full page. Each page = one `.vue` file.
- `LandingPage.vue` = the homepage
- `AlbumDetailView.vue` = the page where you upload photos
- `ClientGalleryView.vue` = the page your client sees

**Rule:** Views don't think hard. They just ask the **store** for data.

#### 2. **Components = Building blocks**
A component is a small reusable thing. Like a LEGO block.
- `AlbumCard.vue` = one album tile in the grid
- `UpgradeModal.vue` = the pop-up that says "Pay ₹229 to unlock"

Components can be reused on many pages.

#### 3. **Stores = Memory boxes**
A store holds data the whole app needs to remember. We use **Pinia** for stores.

```
useAuthStore     → "Who is logged in?"
useAlbumStore    → "What albums does this photographer have?"
useBillingStore  → "How many free images are left?"
useUploadStore   → "What photos are uploading right now?"
useToast         → "What temporary popup message should I show?"
```

**Rule:** If two pages need the same data, it MUST live in a store. Never copy data between pages.

#### 4. **Services = Messengers**
A service is a polite messenger that walks to the kitchen (backend) and asks for stuff.

```
photoService.uploadPhoto()       → "Hey backend, save this photo"
albumService.getAlbums()         → "Hey backend, give me all albums"
billingService.fetchPricing()    → "Hey backend, what are the prices?"
```

**Rule:** Only services talk to the backend. Views and components never do.

#### 5. **Endpoints = Doors on the backend**
The backend has many doors (URLs). The frontend keeps a list of all the doors in `api/endpoints.ts`.

```
ENDPOINTS.ALBUMS.LIST       = "GET /v1/albums"
ENDPOINTS.PHOTOS.UPLOAD     = "POST /v1/albums/:id/photos"
ENDPOINTS.PAYMENTS.CREATE   = "POST /v1/payments/create"
```

**Rule:** Never write a URL by hand. Always use `ENDPOINTS.SOMETHING.SOMETHING`. If you change the URL in one place, every messenger fixes itself.

---

### 🪄 The Magic of Photo Compression

When a photographer drops 1,500 photos into Framedrops, here's what happens **inside their browser** (not on our server!):

```
ORIGINAL PHOTO              SHRINK IT IN BROWSER         UPLOAD TO CLOUD
   25 MB                  ─────────────────►                250 KB
   6000 × 4000 px         OffscreenCanvas worker           1048 × 700 px
   (huge!)                JPEG quality 0.85                (tiny!)
```

**Why shrink first?**
- 1,500 photos × 25 MB = 37.5 GB → would take HOURS to upload
- 1,500 photos × 250 KB = 375 MB → uploads in minutes
- Storage costs 100× less

**Where does this magic happen?**
- `src/workers/compression.worker.js` — a special background helper
- It runs in a **Web Worker** so it doesn't freeze the page
- Uses `OffscreenCanvas` — like a hidden drawing pad

**Important secret:** The original photo NEVER leaves the photographer's computer. We only have the small preview. When they need to deliver originals to the client, the **Transfer Selected Photos** button copies files **locally** from one folder to another using the File System Access API.

---

### 📦 The Upload Engine — Our Crown Jewel

This is the trickiest part of the whole app. Sit down, let me explain.

**Problem:** A photographer uploads 1,500 photos. Halfway through, their wifi dies. Or they accidentally close the tab. Or they navigate to another page. **What happens to the upload?**

**Bad answer:** Start over. (This is what every other gallery tool does.)
**Our answer:** Resume from where it stopped. Even after refresh. Even after closing the tab.

#### How it works (3 actors)

```
        ┌──────────────────────────────────────────────────┐
        │  1. THE ENGINE                                   │
        │  src/services/upload/engine.ts                   │
        │                                                  │
        │  • The boss. Knows what to upload next.          │
        │  • Lives as a "singleton" (only one of it)       │
        │  • Never dies until you close the browser tab    │
        └──────────────────────────────────────────────────┘
                            │
                            ▼
        ┌──────────────────────────────────────────────────┐
        │  2. THE WORKER POOL                              │
        │  src/services/upload/workerPool.ts               │
        │                                                  │
        │  • A team of 4 helpers (or however many cores    │
        │    your computer has)                            │
        │  • Each helper shrinks one photo at a time       │
        │  • All four work in parallel — fast!             │
        └──────────────────────────────────────────────────┘
                            │
                            ▼
        ┌──────────────────────────────────────────────────┐
        │  3. THE FILING CABINET (IndexedDB)               │
        │  src/services/upload/db.ts                       │
        │                                                  │
        │  • A drawer in your browser that survives        │
        │    refresh, tab close, even browser crash        │
        │  • Holds: job info, file info, shrunken blobs    │
        │  • Database name: "framedrops-uploads"           │
        └──────────────────────────────────────────────────┘
```

#### The Pipeline

For every batch of 100 photos:

```
   Step 1: SIGN      Ask backend: "I want to upload these 100 photos"
                     Backend gives back: 100 signed permission slips

   Step 2: UPLOAD    Send the photos directly to Cloudflare R2 (15 at a time)
                     R2 stores them and gives back URLs

   Step 3: FINALIZE  Tell backend: "Photos uploaded. Save them in DB."
                     Backend creates 100 rows in the photos table
```

**The trick:** while Step 2 is uploading batch N, Step 1 is already signing batch N+1, and Step 3 is finalizing batch N-1. Three things happening at once. We call this a **3-way pipeline**.

#### What happens when wifi dies?

1. Engine detects upload failure
2. Engine retries (up to 2 times, with a 0.5-second pause)
3. If all retries fail → mark the file as `failed` in IndexedDB
4. User sees a "Retry" button in the upload dock

#### What happens when you refresh the page?

1. Browser opens fresh
2. `bootUploadEngine()` runs (called from `main.ts`)
3. It reads from IndexedDB: "Oh, there was a job in progress!"
4. Files that were halfway through get reset to "ready to retry"
5. **Smart bit:** files that already finished uploading to R2 (we saved the storage key) **skip** the re-upload and just finalize again. No wasted upload.

---

### 🗂️ How Data Flows (every request)

```
USER CLICKS A BUTTON
   ↓
VIEW calls store.someAction()
   ↓
STORE sets loading = true
   ↓
STORE calls service.someMethod()
   ↓
SERVICE calls apiClient.get/post(ENDPOINTS.SOMETHING)
   ↓
apiClient adds the Bearer token to the request header
   ↓
HTTP request goes to backend
   ↓
Backend does work, sends back JSON
   ↓
apiClient parses it. If 401 (logged out), kick to login page.
   ↓
STORE receives the response, updates its data, sets loading = false
   ↓
VIEW automatically re-renders with the new data (Vue magic!)
```

**This shape is sacred.** Every async action follows it. If you break it, things will fall apart.

---

### 🌐 Languages (i18n)

Framedrops speaks **English, Telugu, and Hindi**.

How a button knows what to say:

```vue
<v-btn>{{ $t('common.save') }}</v-btn>
```

This `$t('common.save')` looks up the right word in the current language file:
- `i18n/locales/en.json` → "Save"
- `i18n/locales/te.json` → "సేవ్ చేయండి"
- `i18n/locales/hi.json` → "सेव करें"

**Rule:** Never write raw English in a template. Always use `$t('key')`. Add new keys to ALL THREE language files at the same time.

---

## 🍳 Part 2 — The Backend (BE)

### Where everything lives

```
framedropsbe/src/
│
├── routes/         ← The doors of the house
├── controllers/    ← Doormen — check who's coming in
├── services/       ← Cooks — do the real work
├── repositories/   ← Pantry staff — fetch raw ingredients (SQL)
├── middleware/     ← Security guards (auth, rate-limit)
├── config/         ← Settings (DB connection, pricing, etc.)
├── workers/        ← Janitors — clean up expired albums
└── database/       ← Floor plan (schema files)
```

### The Four Layers (super important pattern)

Every API request goes through 4 layers, like a relay race:

```
1. ROUTE        Defines the URL and which controller to call.
                src/routes/album.routes.js

      ↓ passes the baton to ↓

2. CONTROLLER   Reads what the user sent. Calls a service.
                Formats the response.
                src/controllers/album.controller.js

      ↓ passes the baton to ↓

3. SERVICE      The business logic. Decides what should happen.
                src/services/album.service.js

      ↓ passes the baton to ↓

4. REPOSITORY   Talks to the database. Runs SQL queries.
                src/repositories/album.repository.js
```

**Why split into 4?** Because each layer has one job. If something breaks, you know exactly where to look.

**Example:** "Show me an album"

```js
// 1. Route
router.get('/albums/:id', requireAuth, asyncHandler(getAlbum))

// 2. Controller
async function getAlbum(req, res) {
  const result = await albumService.getAlbumById(req.params.id, req.user.id)
  if (result.error) return R.error(res, result.error, result.status)
  return R.success(res, result.data, 'Album fetched')
}

// 3. Service
async function getAlbumById(albumId, userId) {
  const album = await albumRepo.findById(albumId)
  if (!album) return { error: 'Not found', status: 404 }
  if (album.user_id !== userId) return { error: 'Forbidden', status: 403 }
  return { data: album }
}

// 4. Repository
async function findById(albumId) {
  const { rows } = await query('SELECT * FROM albums WHERE id = $1', [albumId])
  return rows[0]
}
```

---

### 🔐 Authentication — How We Know Who You Are

When you log in, the backend gives you a **JWT token**. Think of it as a wristband at a theme park.

```
LOGIN
   ↓
Backend: "Email + password correct! Here's your wristband."
   ↓
Frontend saves wristband in browser localStorage as 'ps_auth_token'
   ↓
Every future request: "Bearer <wristband>" in the header
   ↓
Backend checks: "Is this wristband real? Not expired? Not revoked?"
   ↓
If yes → load the user, attach to req.user, continue
If no → kick them out (401), frontend redirects to login
```

**Trick:** The wristband doesn't say "you're an admin." Admin status is checked **from the database every time** so we can demote someone instantly.

**To force-logout everyone:** bump `users.token_version` in DB. All old wristbands become invalid.

---

### 💳 Payments — The Two Money Flows

This is where Framedrops gets interesting. We handle **TWO completely separate** money flows. Don't mix them up!

#### Flow 1 — Photographer pays Framedrops

```
Photographer uploads 1,500 photos
   ↓
First 300 are free (lifetime quota)
   ↓
The remaining 1,200 → tier price applies (₹229 for up to 2,000)
   ↓
Album is "locked" until photographer pays
   ↓
Photographer clicks "Pay" → Razorpay popup
   ↓
Payment success → backend marks albums as is_paid = true
   ↓
Photographer can now deliver photos to client
```

**Files involved:**
- `src/payments/payment.routes.js` — the doors
- `src/payments/payment.service.js` — the cook
- `src/payments/razorpay.service.js` — talks to Razorpay
- DB table: `transactions` (status: pending → success → applied)

#### Flow 2 — Client pays Photographer

```
Photographer creates a gallery for a client
   ↓
Photographer sets a price (e.g., ₹5,000)
   ↓
Client opens gallery → sees "Pay ₹5,000 to view"
   ↓
Client pays via Razorpay
   ↓
Money goes into the photographer's WALLET
   ↓
Framedrops takes a small commission (10%)
   ↓
Photographer can WITHDRAW the rest to their bank
```

**Files involved:**
- `src/clientPayments/` — entirely separate from Flow 1
- `src/wallet/` — earnings ledger
- `src/withdrawals/` — cash-out requests
- DB tables: `client_payments`, `wallets`, `wallet_transactions`, `withdrawals`

**🚨 CRITICAL:** Flow 1 and Flow 2 are NEVER allowed to mix. Different webhooks, different tables, different logic.

---

### 🪣 Storage — Where Photos Actually Live

**The truth:** We use **Cloudflare R2** (an S3-compatible cloud bucket). It's like Amazon S3 but with no egress fees (so viewing photos is free for us).

```
Photo journey:

USER'S COMPUTER          BROWSER (worker)          CLOUDFLARE R2
   ↓                          ↓                          ↓
   Photo.jpg                 Shrunk version            Stored forever
   25 MB                     250 KB                    until 30 days
   (stays here forever)      (sent up)                 (auto-deleted)
```

**The 30-day rule:** After 30 days, a cron job deletes the photos from R2. The photographer doesn't need them anymore — they're just compressed previews. The **originals are still on the photographer's local computer**.

**Why this is clever:**
- We're not a backup service. We're a selection tool.
- Storage costs stay low.
- If a client comes back 6 months later → photographer just re-uploads if needed.

---

### 🔄 The Background Workers (Janitors)

Some jobs need to happen automatically, in the background:

| Worker | What it does | How often |
|--------|--------------|-----------|
| `albumExpiry.worker.js` | Marks old albums as expired, deletes their photos from R2 | Every 6 hours |
| `email.worker.js` | Sends queued emails (OTP, payment receipts, lifecycle nudges) | Every minute |
| `calendar.worker.js` | Sends reminder emails for upcoming photo shoots | Every hour |

These run inside the same Node.js process as the API, using `node-cron`.

**Safety:** Only ONE worker pod can run a cron tick at a time. We use a PostgreSQL **advisory lock** (`pg_try_advisory_lock`) to prevent two servers from doing the same job twice.

---

### 📬 The Response Envelope (sacred shape)

Every API response from the backend has this exact shape. Never break it.

**Success:**
```json
{
  "success": true,
  "data": { ... },
  "message": "Album fetched",
  "meta": { "total": 100, "page": 1 }    // only on lists
}
```

**Error:**
```json
{
  "success": false,
  "data": null,
  "message": "Album not found"
}
```

The frontend's `apiClient` reads this exact shape. If you add a field outside the envelope, the frontend will ignore it.

---

## 🛡️ Part 3 — Security Basics

### Rules we never break

1. **Never put secrets in frontend env vars.** Anything that starts with `VITE_` is **public**. Visible to anyone who opens DevTools. So no API secrets, no DB passwords, no Razorpay key_secret. Only public keys go there.

2. **Never trust the user.** Even if the frontend says "user is admin," the backend re-checks from the database every time.

3. **JWT secret stays on the server.** Tokens are signed with it; we verify them locally. If the secret leaks, every user has to log in again.

4. **Cloudflare R2 uploads are signed.** The browser can't upload to R2 directly — it has to ask the backend for a permission slip first. The signing secret never leaves the server.

5. **Razorpay payments are verified server-side.** Even if a hacker fakes a "payment success" message in the browser, the backend re-checks with Razorpay before unlocking anything.

6. **Gallery URLs use opaque share IDs.** Never put an email or user ID in a URL. Always use a random `shareId` so URLs can't be guessed.

7. **All private pages are `noindex`.** Auth, dashboard, gallery, admin — Google should never find them. We set `<meta name="robots" content="noindex,nofollow">` automatically.

---

## 🧩 Part 4 — How to Add a New Feature (the right way)

Let's say you want to add a "Wishlist" feature where photographers save favorite clients.

### Backend first (always)

```
1. Add columns to src/database/full_schema.sql
   → ALTER TABLE clients ADD COLUMN is_wishlisted BOOLEAN DEFAULT false

2. Write a migration file: src/migrations/NN_add_wishlist.sql

3. Add repo function: src/repositories/wishlist.repository.js
   → exports findWishlistedByUser(), markWishlisted()

4. Add service: src/services/wishlist.service.js
   → returns { data } or { error, status }

5. Add controller: src/controllers/wishlist.controller.js
   → calls R.success / R.error

6. Add route: src/routes/wishlist.routes.js
   → router.get('/', requireAuth, asyncHandler(getWishlist))

7. Mount in server.js: app.use('/v1/wishlist', wishlistRoutes)
```

### Then frontend

```
1. Add types: src/types/wishlist.ts

2. Add endpoint constants: src/api/endpoints.ts
   → WISHLIST: { LIST: '/wishlist', TOGGLE: (id) => `/wishlist/${id}` }

3. Add service: src/api/services/wishlist.service.ts
   → wraps each endpoint in safeCall()

4. Add Pinia store: src/stores/wishlist.ts
   → loading/error/throw pattern

5. Build the view + components last
```

**Why backend first?** Because the frontend can't talk to a door that doesn't exist. Build the doors, then the people.

---

## 🐛 Part 5 — Debugging Like a Detective

### When something breaks, ask these questions in order:

#### 1. Where did it break?

```
Browser console errors?         → Frontend issue
Network tab shows 4xx/5xx?      → Backend issue
Network tab shows pending?      → Network issue (CORS, timeout)
Database is slow?               → Query issue
```

#### 2. Check the Network tab

Open browser DevTools → Network tab. Find the failing request.

- **401 Unauthorized** → JWT token expired or invalid. Try logging out and in.
- **403 Forbidden** → User is authenticated but not allowed.
- **404 Not Found** → URL doesn't exist. Check `ENDPOINTS` constants.
- **409 Conflict** → Something already exists (e.g., duplicate transaction).
- **500 Internal Server Error** → Backend crashed. Check server logs.

#### 3. Check the backend logs

```
- Look at server console output
- Search for the route path: '/v1/albums'
- Find the error stack trace
- Usually it's a SQL error, a null pointer, or a missing env var
```

#### 4. Check the database

```
- Connect to Supabase / Postgres
- Query the relevant table:
    SELECT * FROM albums WHERE id = '...'
- Is the row there? Is is_paid wrong? Is expires_at in the past?
```

### Common gotchas (real bugs we've hit)

**Gotcha 1: "₹0 second album" bug**
- A photographer paid for Album A
- Then uploaded Album B
- Album B was free (₹0) → BUG
- **Why:** code was checking `clients.is_paid` which stays true forever
- **Fix:** always check `albums.is_paid` PER album, never the client flag
- **Rule:** `clients.is_paid` is DERIVED. Never use it for access control.

**Gotcha 2: vue-i18n @ symbol**
- Writing `support@framedrops.com` in a translation file breaks the page
- **Why:** vue-i18n thinks `@` is a "linked message" reference
- **Fix:** Use `support{'@'}framedrops.com` instead

**Gotcha 3: Duplicate JSON keys**
- Two `"upload"` keys in the same level of `en.json`
- **Why:** JSON silently picks the last one. Earlier definition lost.
- **Fix:** Grep for `"<key>"` before adding new keys.

**Gotcha 4: Worker pool double-mount**
- AlbumDetailView creates 2 upload managers
- Each used to create its own worker pool → 8 workers fighting for 4 CPU cores → slow
- **Fix:** Worker pool is now a **module-singleton**. Only one ever exists.

**Gotcha 5: Personal phone number in env**
- Photographer's launch had `VITE_SUPPORT_WHATSAPP=+91 9640082321` (founder's personal number)
- Anyone visiting the site could see and message the founder
- **Fix:** Gate WhatsApp UI with `v-if="WHATSAPP_ENABLED"` derived from env

---

## 🔮 Part 6 — Future-Ready (things to think about)

### When we have more users, these need attention:

#### 1. **Storage cost**
- Today: 50 photographers × 7.5 GB each = 375 GB on R2 ≈ ₹500/month
- At 1,000 photographers = 7.5 TB ≈ ₹9,500/month
- **Plan:** Add per-photographer storage caps. Force expired-album cleanup more aggressively.

#### 2. **Database scale**
- Today: 1 Supabase Postgres instance handles everything
- At 10k photographers, queries will slow down
- **Plan:** Add indexes on `albums(user_id, created_at)`, `transactions(user_id, status)`. Consider read replicas at 50k+ photographers.

#### 3. **Email volume**
- Today: Brevo free tier (300/day)
- At 1,000 photographers doing 3 shoots/month = ~3k transactional emails/day
- **Plan:** Move to Brevo paid tier. Cache OTP rate-limits per phone in Redis.

#### 4. **Background jobs**
- Today: cron inside the API server
- At scale, this couples API uptime with worker uptime
- **Plan:** Move workers to a separate Render service / queue (BullMQ + Redis).

#### 5. **Pricing changes**
- Today: env-driven tiers (`PRICE_TIER_1`, `PRICE_TIER_2`, ...)
- Changing prices = restart server
- **Plan:** Add a `pricing_versions` table. Photographers get "grandfathered" pricing snapshots saved on signup. New users see new prices.

#### 6. **Multi-region**
- Today: 1 server in Mumbai
- For US/Europe photographers, latency would hurt
- **Plan:** Use Cloudflare Workers for static + cached responses. Backend stays in Mumbai for now.

#### 7. **Mobile app**
- Today: Web only
- Photographers want a native app eventually
- **Plan:** The current React → Vue separation means we could build React Native with same API. Don't refactor for it until needed.

---

## 🎓 Part 7 — Glossary (the technical words you'll see)

| Word | What it means in plain English |
|------|--------------------------------|
| **API** | A list of doors the backend exposes. The frontend knocks on these doors. |
| **JWT** | A wristband proving you're logged in. Has a hidden signature. |
| **CRUD** | Create, Read, Update, Delete — the 4 things every feature does |
| **SPA** | Single Page Application — the whole frontend loads once, then changes pages without reloading |
| **REST** | A style of API design where each URL = one resource (album, photo, user) |
| **Pinia** | The library we use to store data shared across pages |
| **Vuetify** | A pre-made set of pretty buttons, inputs, dialogs |
| **OOXML** | The XML inside .pptx files (we use this for our marketing decks) |
| **Cron** | A scheduler that runs jobs on a schedule (every 6 hours, every minute) |
| **R2** | Cloudflare's storage service (like Amazon S3 but cheaper for us) |
| **Razorpay** | Indian payment gateway (UPI, cards, netbanking) |
| **Brevo** | Email sending service (used to be called Sendinblue) |
| **Supabase** | Hosted PostgreSQL database + a few extras |
| **IndexedDB** | A database INSIDE the browser. Where upload progress is saved. |
| **Web Worker** | A background helper inside the browser that doesn't freeze the page |
| **OffscreenCanvas** | A drawing pad that runs in a Web Worker (for image compression) |
| **i18n** | "internationalization" — making the app support multiple languages |
| **DPDP** | India's data protection law (like GDPR for Europe) |

---

## 🧭 Part 8 — Where to Find Things (cheat sheet)

| If you want to... | Look in... |
|-------------------|-----------|
| Change the pricing | `framedrops/.env` + `framedrops/src/config/pricing.ts` + `framedropsbe/.env` |
| Add a new page | `framedrops/src/views/` + `framedrops/src/router/index.ts` |
| Add a new API endpoint | `framedropsbe/src/routes/` + `framedrops/src/api/endpoints.ts` |
| Change colors | `framedrops/src/plugins/vuetify.ts` |
| Add a new translation | `framedrops/src/i18n/locales/{en,te,hi}.json` |
| Change upload behavior | `framedrops/src/services/upload/engine.ts` |
| Change a database table | `framedropsbe/src/database/full_schema.sql` + new migration |
| See logs of background workers | Server console (Render dashboard) |
| Add a new admin screen | `framedrops/src/views/admin/` + `framedropsbe/src/admin/` |

---

## 🪜 Part 9 — A Day in the Life of a Photo

To tie everything together, here's one photo's journey from camera to client favorite:

```
1. PHOTOGRAPHER SHOOTS A WEDDING
   → 25 MB JPEG sits on their laptop

2. PHOTOGRAPHER OPENS FRAMEDROPS, DROPS PHOTOS
   → Browser receives the File object
   → useBulkUploadManager picks it up

3. WEB WORKER SHRINKS THE PHOTO
   → 25 MB → 250 KB
   → Saved as compressed Blob

4. FRONTEND ASKS BACKEND TO SIGN AN UPLOAD
   → POST /v1/albums/:id/photos/bulk-sign
   → Backend returns signed R2 URL + credentials

5. BROWSER UPLOADS DIRECTLY TO CLOUDFLARE R2
   → 250 KB bytes never touch our backend
   → R2 stores it, returns a public URL

6. FRONTEND TELLS BACKEND "UPLOAD DONE"
   → POST /v1/albums/:id/photos/bulk-finalize
   → Backend creates a row in `photos` table

7. PRICING RECALCULATES
   → If photographer's free quota is exceeded, album.price updates
   → Album goes into "locked" state

8. PHOTOGRAPHER PAYS (Razorpay)
   → Backend verifies signature
   → Album.is_paid = true

9. PHOTOGRAPHER SHARES GALLERY LINK ON WHATSAPP
   → URL: framedrops.in/gallery/AbC123xYz

10. CLIENT OPENS GALLERY
    → Sees the 250 KB compressed previews
    → Cannot screenshot easily (anti-screenshot UI)

11. CLIENT TAPS HEART ON FAVORITES
    → POST /v1/selections/:photoId/toggle
    → DB updates `photos.is_selected = true`

12. PHOTOGRAPHER SEES SELECTED LIST
    → Clicks "Transfer Selected Photos"
    → File System Access API picks two folders
    → Browser COPIES original 25 MB files locally
    → Source: photographer's hard drive
    → Destination: "Selected Photos" folder
    → ZERO bytes uploaded or downloaded

13. PHOTOGRAPHER DELIVERS THE ORIGINALS
    → Via Pen drive, WeTransfer, anything they want
    → Framedrops job is done

14. 30 DAYS LATER
    → Album expires
    → Background worker deletes 250 KB previews from R2
    → Originals stay on photographer's computer forever
```

That's it. That's the whole product.

---

## 💛 Closing Thoughts

Framedrops is **deliberately simple**. We don't:
- Store original photos
- Offer unlimited cloud backup
- Run a marketplace
- Charge subscriptions

We do **one thing**: turn photo selection from chaos into clarity. Every line of code in this repo should serve that one goal.

If you're ever tempted to add something complex, ask yourself: **"Does this help photographers get selections faster?"** If the answer is no, don't add it.

The best feature is the one you don't have to build.

— *Framedrops engineering*
