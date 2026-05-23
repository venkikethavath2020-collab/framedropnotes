# Framedrops Security Notes

Last audited: 2026-05-23 (1 day before launch).

This is the honest internal view of what the app does and doesn't protect — for
the founder to consult before a sales call, and for whoever inherits the code
to know what's load-bearing.

Two layers: **backend** (Node + Express + Postgres + R2 + Razorpay) and
**frontend** (Vue 3 SPA).

---

## TL;DR — What you can claim to a photographer

- Photos: originals never leave the customer's laptop; only compressed gallery
  copies live on Cloudflare R2.
- Database: TLS-encrypted with full CA verification against Supabase's root
  cert. Every query is scoped by `user_id`.
- Passwords: bcrypt cost 12. We can't read them; a leaked DB dump won't
  surrender any account.
- OTPs & reset tokens: stored as HMAC/SHA-256 hashes with a server pepper, 5-15
  min expiry, lockout after repeated failures.
- Payments: Razorpay handles money. We verify webhook signatures and compute
  amounts server-side — we never trust a client-submitted price.
- Sessions: revocable instantly via `token_version` bump on password change /
  ban.

## TL;DR — What you must NOT claim yet

- "Only people you share with can see photos." R2 URLs are unsigned. Security
  is "key is a 256-bit random UUID, infeasible to guess" — not access control.
- "SOC 2 / DPDP / ISO compliant." None of that is in scope.
- "Industry-standard session security." JWTs live in `localStorage`; an XSS bug
  = full account takeover. CSP mitigates but doesn't eliminate.
- "Tested DR plan." We rely on Supabase managed backups. Verify the plan tier
  has PITR before claiming it.

---

## Backend (framedropsbe)

### Data at rest

- **Database**: PostgreSQL on Supabase. TLS connection with full CA chain
  verification — the Supabase prod CA is bundled at
  [`src/config/supabase-ca.crt`](../../framedropsbe/src/config/supabase-ca.crt)
  and loaded by [`db.js`](../../framedropsbe/src/config/db.js). If Supabase
  ever rotates their CA you'll see `SELF_SIGNED_CERT_IN_CHAIN` — refresh from
  `https://supabase-downloads.s3.amazonaws.com/prod/ssl/prod-ca-2021.crt`.
- **Passwords**: bcrypt cost 12, 10-char min, 128-char cap
  ([`utils/password.js`](../../framedropsbe/src/utils/password.js)).
- **OTPs**: HMAC-SHA256 hashes with a JWT-secret-derived pepper. Never stored
  plaintext ([`utils/otp.js`](../../framedropsbe/src/utils/otp.js)).
- **Password reset tokens**: SHA-256 hashed in DB; raw token only in the email
  ([`password-auth.service.js`](../../framedropsbe/src/services/password-auth.service.js)).
- **Razorpay keys**: env-only, never logged, never sent to the client.
- **Photo storage (R2)**: bucket is *public-readable by URL*. Security model
  is unguessable keys (`framedrops/<albumUUID>/<photoUUID>.<ext>` ≈ 256 bits of
  randomness), not authorization. Anyone forwarded a URL can fetch the image
  indefinitely. This is intentional — gallery previews need to load fast in a
  browser without auth — but it's not "access controlled."

### Data in transit

- **HTTPS**: Helmet + CSP + HSTS + `upgrade-insecure-requests` enabled in
  production ([`server.js`](../../framedropsbe/server.js)). TLS termination is
  Render's responsibility.
- **CORS**: allowlist driven by `ALLOWED_ORIGINS` env. Unknown origins
  rejected. `credentials: true`.
- **Trust proxy**: set to `1` so `req.ip` reflects the real client behind
  Render's load balancer (needed for rate limiting to work right).

### Authentication

- **JWT**: HS256, issuer + audience checked, 30s in-memory user cache.
  Production boot refuses to start if `JWT_SECRET` is missing or shorter than
  32 chars ([`server.js:85-88`](../../framedropsbe/server.js#L85-L88)).
- **Token revocation**: `users.token_version` is checked on every request. Bump
  it + call `invalidateUserCache(userId)` after password change, ban, or
  "logout everywhere".
- **Role authority**: role is NOT in the JWT — every admin endpoint re-loads
  the user row. Demoting an admin takes effect within 30s, no forced logout.

### Authorization

- Every album / client / photo query in the repository layer is scoped by
  `user_id`. Spot-checked — no horizontal access bugs found.
  ([`repositories/album.repository.js`](../../framedropsbe/src/repositories/album.repository.js))
- **`albums.is_paid` is the ONLY truth source** for whether an album is
  unlocked. Do NOT add a code path that grants access based on
  `clients.is_paid` alone (that was a real ₹0-bypass bug we already fixed).

### Rate limiting

- **Global API**: 500 / 15 min / IP.
- **Auth** (`/v1/auth/*`): 15 / 15 min / IP.
- **Payments** (`/v1/payments/*`, `/v1/client-payments/*`): 30 / 15 min / IP.
- **Webhook**: 120 / min (bursty by design).
- **Account-level lockout**: 10 failed login attempts → 60 min lock per
  account (in addition to IP-based limiter).
- **DO NOT** mount `paymentLimiter` at `/v1` blanket — there was a real bug
  where it blocked unrelated routes. Mount it only on the specific
  payment-route groups.

### SQL injection

- All queries are parameterized (`$1, $2…`). The only template-literal
  interpolations are for whitelisted `ORDER BY`/`LIMIT` builders — no raw user
  input touches SQL. Don't break this pattern.
- **Never** quote SQL identifiers with backticks inside template literals — JS
  treats `` ` `` as a string terminator, producing cryptic `missing )` errors.

### Payments

- **Webhook signature**: HMAC-SHA256 with constant-time compare, verified
  BEFORE any DB write
  ([`razorpay.service.js`](../../framedropsbe/src/payments/razorpay.service.js)).
- **Optional IP allowlist** on the webhook (config-driven).
- **Event dedupe**: by `razorpay_payment_id`, so a replayed webhook is a no-op.
- **Server-side amounts**: payment.controller.js explicitly does NOT read
  `amount` from `req.body`. Recomputed from album rows + tier pricing.
- Two flows are independent:
  - Flow 1: photographer → platform → `transactions` table
  - Flow 2: customer → photographer → `client_payments` table
  - Mixing them in a query = wrong revenue numbers. Platform revenue is
    *always* the `transactions` table.

### Operational

- `.env` is gitignored. `.env.example` has placeholders only.
- Production errors return `'Internal server error'` for all 5xx — no stack
  traces leak. 4xx messages pass through.
- No passwords, tokens, OTPs, or JWTs are logged anywhere.
- Health endpoint truncates DB error messages to 120 chars.
- DB query logger runs only in non-prod and truncates SQL to 80 chars.

### Backups & disaster recovery

- Free-tier Supabase has **no managed backups**. We run our own daily
  `pg_dump` → R2 via [`framedropsbe/scripts/backup-db.js`](../../framedropsbe/scripts/backup-db.js).
  Full procedure + restore drill in [BACKUP_RESTORE.md](./BACKUP_RESTORE.md).
- Until a test restore has actually succeeded, don't claim "tested DR plan."
- Account password was the founder's phone number until 2026-05-22 — rotated
  to a generated secret. Don't reuse personal data as DB passwords ever.

---

## Frontend (framedrops)

### Auth token storage

- JWT lives in `localStorage` under `ps_auth_token`
  ([`stores/auth.ts`](../../framedrops/src/stores/auth.ts)).
- **This is the biggest security weakness.** Any XSS bug = full account
  takeover. Mitigated by:
  - Strict CSP from the backend's Helmet config (`script-src 'self'` +
    Razorpay only).
  - No `v-html` from user-controlled data anywhere I've spotted.
- A more secure design is httpOnly cookies, but they require CSRF tokens and
  same-site config. Not blocking launch.

### Direct upload pattern

- Browser uploads images directly to R2 / Cloudinary using a server-signed
  URL. The backend never touches photo bytes.
- **Server is the only one allowed to choose `folder` and `publicId`** — never
  let the client supply these. Finalize endpoint validates the `publicId`
  prefix to prevent a malicious client from claiming someone else's upload.

### Local file handling

- "Transfer Selected Photos" is a **browser-side file copy via the File System
  Access API** — not a server download. We never serve photo bytes for
  download.
- If you find code that mints download tokens, fetches R2 bytes, or gates a
  `/secure/*` path, it's dead code from an abandoned design. Verify by
  grepping `src/` for callers before extending it.

### Contact / personal info

- All photographer-facing email addresses come from
  [`src/config/contact.ts`](../../framedrops/src/config/contact.ts)
  (`VITE_*_EMAIL` env vars). Never hardcode `@framedrops.in`.
- Founder's personal WhatsApp number is hidden behind a `WHATSAPP_ENABLED`
  feature flag — don't ship the raw number in the UI without it.

### Payment flow

- Razorpay checkout opens in their hosted iframe; we never see card details.
- Frontend just hands order_id + amount (from server) to Razorpay's JS SDK
  and posts the signed response back to our `verify-payment` endpoint.

---

## Two-minute checks before a launch claim

| Claim you want to make | Quick check |
| --- | --- |
| "Database is encrypted in transit." | `grep -n 'ssl' framedropsbe/src/config/db.js` — must show CA + `rejectUnauthorized: true`. |
| "Passwords are hashed." | `grep -n 'bcrypt' framedropsbe/src/utils/password.js`. |
| "Sessions are revocable." | `grep -n 'token_version' framedropsbe/src/middleware/auth.js`. |
| "We rate limit auth." | `grep -n 'authLimiter' framedropsbe/server.js`. |
| "Payments use Razorpay signature verification." | `grep -n 'verifyWebhookSignature' framedropsbe/src/payments/razorpay.service.js`. |

If any of these greps don't return results, the claim is false. Don't say it.

---

## Things to fix post-launch (not blockers)

1. **R2 signed URLs for galleries.** Replace public-readable links with short
   TTL signed URLs so a leaked URL eventually stops working. Adds CDN cache
   complexity — wait until a customer asks.
2. **Move JWT from localStorage to httpOnly cookie + CSRF token.** Eliminates
   XSS-token-theft risk. Bigger refactor — wait until 100+ customers.
3. **Password breach check (HIBP API).** Reject passwords found in known
   breaches at signup. ~50 lines of code.
4. **Backup verification runbook.** Document a quarterly "restore to a fresh
   project and run a smoke query" drill. Don't say "we have backups" until
   you've actually restored from one.
5. **Signup endpoint enumeration.** `password-auth.service.js` returns "An
   account with this email already exists" on duplicate signup. A determined
   attacker can map your customer list. Low priority — fix when you have
   bandwidth.
6. **Cert rotation alerting.** When Supabase rotates `prod-ca-2021`, the DB
   will stop connecting. Set up an UptimeRobot ping on `/health` so you find
   out within minutes, not from a customer.

---

## If something goes wrong

| Symptom | Likely cause | First thing to do |
| --- | --- | --- |
| All DB queries fail with `SELF_SIGNED_CERT_IN_CHAIN`. | Supabase rotated their CA. | Re-download cert from the URL in `db.js` comment, redeploy. |
| Mass `401 Session revoked` after deploy. | Someone bumped `token_version` for many users. | Check audit log; if accidental, revert. |
| Webhook starts 401-ing. | Razorpay rotated webhook secret OR our env is wrong. | Compare `RAZORPAY_WEBHOOK_SECRET` env to Razorpay dashboard. |
| `paymentLimiter` blocking unrelated routes. | Someone re-introduced the `app.use('/v1', paymentLimiter, …)` bug. | Check `server.js` — limiter must mount on payment routes only. |
| Unknown DB password works. | Old leaked password still valid because rotation didn't actually apply in Render env. | Rotate again, confirm Render env is updated, redeploy. |

---

*This doc is meant to be read in 10 minutes by a founder before a customer
call, or by a new engineer on day 1. Keep it short and honest. If something
changes in `framedropsbe/src/config/db.js` or `framedrops/src/stores/auth.ts`,
update the relevant section here.*
