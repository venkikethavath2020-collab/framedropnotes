# Interview Q&A — Authentication & Authorization

---

## Q1: Explain the JWT authentication flow end to end.

**Beginner answer:**
The user logs in with email + password or OTP. The backend creates a JWT with their user ID and sends it back. The frontend stores it and sends it as a `Bearer` token on every API request. When the user logs out, the token is deleted from storage.

**Mid-level answer:**
JWT is HS256-signed with `JWT_SECRET`. The payload is `{ sub: userId, tv: token_version, iss, aud }`. The `auth.js` middleware:
1. Extracts `Authorization: Bearer <token>`
2. Calls `jwt.verify()` — throws if expired or bad signature
3. Checks the `tv` claim against `users.token_version` in the DB
4. Returns 401 if versions don't match (revoked token)
5. Caches the user record in memory for 30 seconds to avoid a DB hit on every request

**Senior answer:**
The `token_version` field solves the stateless JWT revocation problem. Standard JWTs can't be invalidated before expiry — you'd need a blocklist. Instead, every JWT carries `tv: token_version` from the DB at mint time. When you bump `token_version` (on logout, password change, or forced revocation), all existing tokens fail the version check within 30 seconds (the cache TTL). This avoids a Redis blocklist while still providing near-instant revocation.

The 30-second cache is a deliberate trade-off: we avoid a DB round-trip on every request (which would be 100+ DB queries per second at moderate load), at the cost of a 30-second revocation window. For most security threats (leaked token, suspicious activity), 30 seconds is acceptable.

The frontend scrubs tokens from Sentry breadcrumbs in `main.ts` to prevent token leakage in error reports.

**Architect answer:**
The biggest gap in this design is the lack of a refresh token. With a single long-lived access token:
- If the token is stolen, the attacker has access until expiry (potentially hours)
- Token rotation on every request isn't possible

The production-grade pattern is: short-lived access token (15 min) + long-lived httpOnly cookie refresh token. The refresh token is opaque (stored in DB), rotated on every use, and allows true revocation without a cache. The access token is stateless for performance; the refresh token is stateful for security.

---

### Interviewer follow-ups

**"Why HS256 instead of RS256?"**
> HS256 uses a shared secret — simpler, faster, no key pair management. RS256 (asymmetric) is useful when multiple services need to verify tokens without sharing the secret, e.g., a microservices architecture where the auth service signs and other services verify. We have a monolithic backend so HS256 is appropriate. If we split into microservices, we'd migrate to RS256.

**"What's in the JWT payload — why not put the user's role there?"**
> The admin role is deliberately NOT in the token. Roles are re-fetched from the DB on every admin request. This means role changes take effect instantly without requiring the user to log out and back in. Putting the role in the token would mean a role change only takes effect when the token expires.

**"What happens if JWT_SECRET is compromised?"**
> Every token ever issued is compromised. All users need to be forced to log out. We'd rotate the secret and bump all `token_version` values in the DB. The bump ensures even valid-signature tokens from the old secret fail the version check.

**"How does the 30-second cache work — is it per server instance?"**
> Yes, it's in-process memory per Node.js instance. With multiple pods, each pod has its own cache. This means after a token_version bump, a revoked token could still be valid on pods that haven't gotten a DB miss yet. In practice, pod count is low so this window is acceptable. At scale, we'd use Redis with pub/sub: bump token_version → publish invalidation event → all pods clear that user from their cache instantly.

---

## Q2: How does Email OTP login work?

**Mid-level answer:**
1. User enters email → `POST /v1/auth/send-otp`
2. Backend generates a 6-digit OTP, bcrypt-hashes it, stores in `otp_codes` table with 10-minute expiry
3. OTP is sent inline (not queued) via nodemailer — user is waiting, so we can't add 30s queue delay
4. User submits OTP → `POST /v1/auth/login` with `{ email, otp }`
5. Backend fetches un-used, un-expired OTP for that email, bcrypt-compares, marks used
6. Issues JWT on success

**Senior answer:**
Rate limiting on OTP is layered:
- Application level: 5 OTPs per email per 10 minutes (tracked in DB, not just in-memory so it survives restarts)
- Route level: Express rate limiter on the auth endpoints
- Cloudflare Turnstile captcha on the signup/login form (verified server-side in `middleware/turnstile.js`)

The `otp_codes` table has a `context` discriminator: `'login'` or `'agreement'`. The same OTP mechanism is used for both auth and agreement signing — but they can't be cross-used because the context is validated server-side.

OTPs are bcrypt-hashed in the DB. This means if the database is dumped, an attacker can't replay OTPs (bcrypt is slow to brute-force, and OTPs expire in 10 minutes).

**"Why bcrypt for a 6-digit OTP — isn't that overkill?"**
> The alternative is storing OTPs in plaintext or with a fast hash. A 6-digit OTP has only 1,000,000 possible values. If stored with a fast hash like MD5 or SHA-256, a compromised DB dump could be brute-forced in seconds. Bcrypt makes offline brute-force computationally expensive. The 10-minute expiry and 5-attempt rate limit further reduce the attack surface.

---

## Q3: How is the admin authentication different from photographer authentication?

**Mid-level answer:**
Admins use a separate login flow: `POST /v1/auth/admin/send-code` + `POST /v1/auth/admin/verify-code`. The email must match `ADMIN_EMAIL` env var and phone must match `ADMIN_PHONE`. On success, a JWT is issued — same format as photographer tokens. But every admin route is protected by `requireAdmin` middleware that re-fetches the user's role from the DB and checks it's `admin` or `super_admin`.

**Senior answer:**
The key security property is: **the JWT does not carry the admin role**. Even if a photographer somehow got an admin JWT, it would fail the `requireAdmin` check because their DB role is `photographer`. Role changes in the DB take effect on the next request without any token invalidation needed.

There's a hierarchy: `requireAdmin` allows both `admin` and `super_admin` (case-insensitive check). `requireSuperAdmin` allows only `super_admin`. Sensitive operations (e.g., deleting users, approving large withdrawals) are behind `requireSuperAdmin`.

The admin allowlist in env vars (`ADMIN_EMAIL`, `ADMIN_PHONE`) is a bootstrapping mechanism — it prevents any random user from requesting an admin OTP. The weakness is that rotating admin access requires a redeploy. A better pattern is invite-based admin provisioning with the role stored in DB only.

---

## Q4: How are gallery share links secured? (Client/public access)

**Mid-level answer:**
Each client record has an opaque `share_id` (a random UUID or token, not the numeric client ID). The gallery URL is `/gallery/:shareId`. There's no JWT involved — the shareId itself is the access credential. Optionally, the photographer can set an access code on the album; clients must enter it before viewing.

**Senior answer:**
The design deliberately avoids putting any PII in the gallery URL. If the URL is in browser history, server logs, or shared accidentally, it doesn't reveal the client's email, phone, or name — only the opaque shareId.

For albums with a price, there's a payment gate (`albumPaymentGate` middleware) — the client must pay via Razorpay before downloading. The gate checks `client_payments` for a successful payment.

The access code is stored in the DB (hashed or plain — worth checking the implementation). It adds a second factor to the shareId, useful when photographers share links in public event groups (e.g., a WhatsApp group for a wedding) but want to restrict access to the actual couple.

**"What if a shareId is guessed or brute-forced?"**
> The shareId should be at minimum 128 bits of entropy (UUID v4 is 122 bits). With 122 bits, brute-forcing is computationally infeasible. We should also add rate limiting on the gallery endpoint to prevent automated scanning. Currently there's no rate limit on the public gallery route — that's a gap.
