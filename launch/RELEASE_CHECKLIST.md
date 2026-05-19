# Framedrops — Official Release Checklist

> **Purpose:** Step-by-step gate between "works on my machine" and "first paying photographer signs up."
> **Scope:** Production launch on `framedrops.in` (June 2026 target). Solo-dev, pre-revenue context — calibrated accordingly: no SOC2 prep, no on-call rotation, but every load-bearing prod-vs-dev difference is called out by file and line.
>
> **How to use:** Work top-down. Each section gates the next. Don't skip — most of these have bitten projects at exactly this stage. Tick the box (`[x]`) as you go. If something doesn't apply, write `n/a — <reason>` next to it.

---

## 0. Pre-flight — Code freeze

- [ ] **Branch off `development` → create a `release/v1.0` branch.** All bug-fix-only commits land here. New features stop going to `development` 3 days before launch.
- [ ] **Tag the freeze commit:** `git tag pre-launch-freeze`. If something goes catastrophically wrong post-launch, this is the rollback target.
- [ ] **Both repos build cleanly from a fresh clone:**
  - `cd framedrops && npm ci && npm run type-check && npm run build`
  - `cd framedropsbe && npm ci && node --check server.js` and `PORT=3099 node server.js` boots cleanly with no `[ERROR]` lines.
- [ ] **No `console.log` in hot paths** — production build drops them, but verify with: `grep -rn "console\." framedrops/src/ --include='*.vue' --include='*.ts' | grep -v "console.error\|console.warn"`. Today: 3 occurrences — review each.
- [ ] **No `TODO` / `FIXME` markers blocking launch:** `grep -rn "TODO\|FIXME\|XXX\|HACK" framedrops/src/ framedropsbe/src/` — currently 0. Keep it that way.

---

## 1. Database — Single source of truth on production

> The repo has **no incremental migrations folder** today — only [`framedropsbe/src/database/full_schema_v2.sql`](framedropsbe/src/database/full_schema_v2.sql). That's intentional pre-launch, but it means the first prod deploy is a full DROP+CREATE. After launch, you can NEVER run that file again. Treat this section seriously.

- [ ] **Spin up a fresh production Postgres** (Supabase project for prod, not the `xmwddhgmnfgacuhirgpf` dev one currently in `.env`).
- [ ] **Apply `full_schema_v2.sql` once** against the fresh DB. Verify table count + indexes: `\dt` should show ~25 tables.
- [ ] **Seed the absolute minimum:**
  - One super-admin user (`role = 'super_admin'`) — yours.
  - Nothing else. No demo clients, no fake albums.
- [ ] **Test DB connection pool from prod backend** (`PG_POOL_MAX=12` is fine for Render free tier; Supabase pooler limit is the harder ceiling — verify it's ≥ 15).
- [ ] **Backup automation:** Supabase has daily snapshots on paid tiers — confirm it's enabled. If you're on free tier, schedule a manual `pg_dump` weekly until you upgrade.
- [ ] **Adopt a migration discipline going forward.** From the first prod-only schema change onward, every change is `src/migrations/<NN>_<name>.sql` AND updates `full_schema_v2.sql`. See [`framedropsbe/CLAUDE.md`](framedropsbe/CLAUDE.md) — this is already documented but not yet practiced.

---

## 2. Environment variables — Replace EVERY dev value

> Today's `.env` files have `rzp_test_*`, localhost, dev R2 bucket, dev DB, mock OTP code, and a JWT secret that's been checked into git. Every single one of these needs to swap before launch.

### 2a. Backend ([`framedropsbe/.env`](framedropsbe/.env))

- [ ] **`NODE_ENV=production`** (line 3 — currently `development`). This unlocks the production-default rate limits in `server.js`.
- [ ] **`ALLOWED_ORIGINS`** — strip `http://localhost:5173`. Keep only the public framedrops.in hosts.
- [ ] **`DATABASE_URL`** — point to the **production** Supabase project, NOT `xmwddhgmnfgacuhirgpf` (that's dev). Get the pooler URL (port 6543, not 5432) for serverless-friendly connections.
- [ ] **`JWT_SECRET`** — **rotate immediately.** The current value is in your repo's `.env` and may have leaked through git history. Generate new: `node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"`. This invalidates every dev session — that's fine, nobody's using prod yet.
- [ ] **`BREVO_API_KEY`** — current key is from your dev account. Verify it's the production key with a verified sender on `framedrops.in`. Test deliverability: send yourself an OTP from prod.
- [ ] **`MOCK_OTP_CODE=123456`** — **DELETE this line entirely** if `OTP_PROVIDER=msg91`. Leaving it sets a dev fallback that could let an attacker bypass OTP if anything ever falls back to mock mode. The line should not exist on prod.
- [ ] **`MSG91_AUTH_KEY` / `MSG91_TEMPLATE_ID`** — confirm these are your real (paid) MSG91 production credentials, not a dev/sandbox key.
- [ ] **`RAZORPAY_KEY_ID`** — change `rzp_test_SbKnnOhbj8S30g` → `rzp_live_…`. The "TEST mode" comment on line 122 is the ⚠️ marker — replace the comment with `# Razorpay (LIVE mode)`.
- [ ] **`RAZORPAY_KEY_SECRET`** — matching live secret. Never share, never commit. Verify by hitting `/api/orders` on Razorpay dashboard with the live key.
- [ ] **`RAZORPAY_WEBHOOK_SECRET`** — generate a fresh secret in Razorpay live dashboard → Settings → Webhooks. Set the webhook URL to `https://api.framedrops.in/v1/webhook/razorpay`. The current value (`this_is_my_razorpay_pay_webhook_secret_key_@1469`) is a placeholder and **must not ship**.
- [ ] **`TURNSTILE_SECRET`** — verify it pairs with the prod `VITE_TURNSTILE_SITE_KEY` from the FE `.env`. Both come from Cloudflare → Turnstile → "framedrops.in" site (not localhost).
- [ ] **`R2_BUCKET=framedropstorage-dev`** → `framedropstorage` (or whatever your production bucket is). The dev bucket has whatever test photos you've uploaded — production must start clean.
- [ ] **`R2_PUBLIC_HOST=cdn-dev.framedrops.in`** → `cdn.framedrops.in` (or whatever the prod CNAME is). Verify the Cloudflare DNS record exists and serves R2 objects.
- [ ] **`R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY`** — rotate. Create a fresh R2 API token scoped to the production bucket only, with read+write but not bucket-delete.
- [ ] **`R2_DOWNLOAD_JWT_SECRET`** — rotate. Same generation method as `JWT_SECRET`.
- [ ] **`SENTRY_DSN`** — currently empty. Decide: enable Sentry for prod error tracking ($26/mo for the team plan, free tier is also viable for low volume), OR leave empty and rely on Render logs. Recommend enabling — cheap insurance for solo-dev.
- [ ] **`APP_BASE_URL=http://localhost:5173`** → `https://framedrops.in`. This is the link prefix for outbound email CTAs (gallery share emails, password resets). Wrong value = every email link 404s.
- [ ] **`SUPPORT_INBOX_EMAIL` / `SUPPORT_EMAIL`** — currently both `supportframedrops@gmail.com`. Fine for launch per the [[project-contact-emails-env]] decision. Revisit when you move to Zoho/Workspace.
- [ ] **`LIFECYCLE_ENABLED=false`** — turn this `true` only after you've actually written copy for the lifecycle emails (welcome / quota-80% / inactive-30d / etc.) and reviewed each variant template. Bad copy goes to every new signup — irreversible.
- [ ] **Rate limit knobs** — review the defaults in `server.js`. `RATE_LIMIT_AUTH_MAX=15/15min` is anti-brute-force; do not loosen. The others auto-tighten when `NODE_ENV=production`.

### 2b. Frontend ([`framedrops/.env`](framedrops/.env))

- [ ] **`VITE_API_BASE_URL=http://localhost:3000/v1`** → `https://api.framedrops.in/v1`. Line 2/3 — uncomment the prod line, delete the localhost line.
- [ ] **`VITE_TURNSTILE_SITE_KEY`** — must be the **production** site key from Cloudflare (paired with the prod `TURNSTILE_SECRET` on the BE). The current value (`0x4AAAAAADJoGoi0r0jZY-bZ`) may be a dev site key.
- [ ] **`VITE_GOOGLE_OAUTH_CLIENT_ID`** — same client ID is fine across envs, BUT in Google Cloud Console → Credentials → that OAuth client, the "Authorized JavaScript origins" must include `https://framedrops.in` and `https://www.framedrops.in` (not just localhost).
- [ ] **`VITE_SENTRY_DSN`** — set to the FE Sentry DSN if you're enabling Sentry. Different DSN from the BE one.
- [ ] **`VITE_PRICING_TIERS`** — match the backend `PRICE_TIER_*` values. Currently consistent. **Do not change pricing during launch week** — the gate keys off these.
- [ ] **`VITE_RAZORPAY_KEY_ID`** — change to the live key ID (the public part). Pairs with the BE secret.
- [ ] **`VITE_SUPPORT_EMAIL` / `VITE_SUPPORT_WHATSAPP`** — confirm both point at the real inbox/number that someone will actually read.
- [ ] **Run `npm run build` and search the `dist/`** for any leftover `localhost`, `test_`, or `rzp_test_` strings: `grep -r "localhost\|test_\|rzp_test_" framedrops/dist/`. Should return zero hits (other than maybe SourceMappingURL comments, which are stripped in prod build anyway).

### 2c. Secret hygiene

- [ ] **Confirm `.env` is in `.gitignore`** for both repos. `git check-ignore framedrops/.env framedropsbe/.env` — should print both paths.
- [ ] **Audit git history** for accidentally-committed secrets: `git log -p --all -S "rzp_test_" -- '*.env' '*.env.*'` (and same for `BREVO_API_KEY`, `JWT_SECRET`, etc.). If any secret was ever committed, **rotate that secret** — even if the commit was later removed, the value is in git history forever.
- [ ] **`.env.example` files are committed and clean** — they should have placeholder values like `your-key-here`, never real ones. Currently OK for both repos.

---

## 3. Razorpay live mode — High-risk section, slow down

> Test mode → live mode is the single most common launch-day disaster across SaaS. ~25% of "we launched but payments don't work" stories are someone forgetting one of these.

- [ ] **Razorpay account is fully KYC-verified.** Live keys won't issue until KYC is green. Allow 2–5 business days lead time.
- [ ] **Bank account linked** in Razorpay dashboard for payout settlement. Without this, money comes in but can't get out.
- [ ] **Both Flow 1 and Flow 2 tested with a real ₹1 payment.** Flow 1: photographer pays platform for an album unlock. Flow 2: customer pays photographer for a gallery. Refund both ₹1s through Razorpay dashboard afterward to verify the refund webhook also fires.
- [ ] **Webhook URL configured** in Razorpay dashboard → Settings → Webhooks → `https://api.framedrops.in/v1/webhook/razorpay`. Subscribe to: `payment.captured`, `payment.failed`, `order.paid`, `refund.processed`. The unified handler in `webhook.routes.js` dispatches to both flow handlers.
- [ ] **Webhook signature verification is verified end-to-end** by triggering a test event from Razorpay dashboard and watching the backend logs for `[Webhook] verified` (or whatever the log line is). A failing signature is silent — easy to miss.
- [ ] **PLATFORM_FEE_PERCENT=10** is correct and matches what you've promised photographers. Verify with a Flow 2 test: ₹100 paid by customer → photographer wallet credited ₹90, platform takes ₹10.
- [ ] **Refund policy is documented** publicly — Razorpay requires this for live mode. Update [TermsView.vue](framedrops/src/views/legal/TermsView.vue) and link from the footer.
- [ ] **GST registration status** — if you've got it, configure GSTIN in Razorpay so invoices reflect it. If you don't (pre-revenue), Razorpay still works; revisit once monthly revenue justifies the ₹500/mo CA fee per [FUTURE_FEATURES Tier 3 item 6](FUTURE_FEATURES.md).

---

## 4. Email + transactional comms

- [ ] **Brevo sender domain verified** — `noreply@framedrops.in` (per `BREVO_SENDER_EMAIL`) must show as "verified" in Brevo dashboard with DKIM + SPF + DMARC records published on the Cloudflare DNS for `framedrops.in`. Without this, Gmail will junk every OTP.
- [ ] **Inline emails work** (OTP, password-reset) — send yourself a real OTP from the prod login flow, confirm <2s delivery.
- [ ] **Queued emails work** (gallery shared, selection submitted, payment received, calendar reminders) — fire one of each from a real test flow, confirm delivery within 30s.
- [ ] **Brevo sending quota** — confirm your plan covers expected launch volume. Free tier is 300/day; if you onboard 50 photographers in week one, each sending 3 gallery-shared emails, you'll exceed it. Pre-buy a Brevo paid tier (~$25/mo) if needed.
- [ ] **Reply-to on support emails works** — submit a test message from `/support` → confirm Gmail "Reply" goes back to the photographer's email, not `noreply@`.
- [ ] **Calendar reminder worker actually fires for a real event** — create a real calendar event with a 15-min reminder for an event 10 minutes away. Confirm email arrives within ~5 minutes. (We shipped this 2026-05-14; one production smoke test is cheap insurance.)
- [ ] **Lifecycle worker stays OFF** until copy review (`LIFECYCLE_ENABLED=false`).

---

## 5. Infrastructure — Hosting + CDN + DNS

- [ ] **Frontend deployed** to Cloudflare Pages (or wherever). Custom domain `framedrops.in` + `www.framedrops.in` both serve the SPA. SPA fallback rule configured (every route → `/index.html`) so `framedrops.in/dashboard` loads without 404.
- [ ] **Backend deployed** to Render (or wherever). Custom domain `api.framedrops.in`. Render free tier sleeps after 15min idle — **upgrade to the $7/mo Starter** at minimum so users don't hit a 30s cold-start on the first request of the morning.
- [ ] **TLS** — both domains have valid certs (Cloudflare auto-provisions, Render auto-provisions). Force HTTPS on both. Verify with `curl -I https://framedrops.in` and `curl -I https://api.framedrops.in/health` — both 200, both `Strict-Transport-Security` header present.
- [ ] **CORS** — production backend `ALLOWED_ORIGINS` does NOT include `http://localhost:5173`. CORS preflight passes for both `framedrops.in` and `www.framedrops.in`.
- [ ] **R2 bucket** — production bucket exists, CDN host (`cdn.framedrops.in`) CNAME'd to it. Upload one test photo, fetch via the CDN, verify <500ms TTFB.
- [ ] **R2 public access policy** is set correctly — anonymous GET on the public CDN host, but no PUT/DELETE without signed URL. The frontend never sees R2 secrets.
- [ ] **DNS health** — check `dig framedrops.in`, `dig api.framedrops.in`, `dig cdn.framedrops.in` — all resolve, all point to the right hosts. No leftover dev CNAMEs.
- [ ] **Status page** (optional but recommended) — even a free uptimerobot.com monitor on `https://api.framedrops.in/health` so you know within 5 minutes if the BE goes down.

---

## 6. Legal + compliance

- [ ] **Terms of Service** ([TermsView.vue](framedrops/src/views/legal/TermsView.vue)) — review for company name, founder name, GST status, jurisdiction (currently India / Hyderabad). Date the document.
- [ ] **Privacy Policy** ([PrivacyView.vue](framedrops/src/views/legal/PrivacyView.vue)) — review DPDP-specific clauses, grievance officer details, data retention windows.
- [ ] **DPDP delete-account path exists** — even Stage A (manual via `/support`) per [FUTURE_FEATURES Tier 1 item 1](FUTURE_FEATURES.md). Add the line to PrivacyView pointing users to the support form. Required by Indian DPDP Act.
- [ ] **Cookie banner** — verify what cookies the app actually sets (`ps_auth_token` localStorage + Razorpay session cookies on `checkout.razorpay.com`). If only `ps_auth_token` (functional), Indian DPDP doesn't require a banner. If you add analytics later (PostHog, GA), revisit.
- [ ] **Razorpay merchant info** — your business name and contact details on the Razorpay checkout screen match what's on framedrops.in. Mismatch = lower payment success rate (customers trust less, abandon more).
- [ ] **Refund policy** linked from footer + visible during checkout. Razorpay requirement.

---

## 7. Security — Final pass

- [ ] **Admin role assignment** — exactly ONE super-admin (you) on prod DB. Verify: `SELECT id, email, role FROM users WHERE role IN ('admin', 'super_admin');` should return 1 row.
- [ ] **No admin password equals dev admin password.** Set a real one via signup + manual SQL role flip.
- [ ] **Rate limits active** — `NODE_ENV=production` enables them automatically. Hit `/v1/auth/login` 20 times rapidly with curl — should 429 after 15 attempts.
- [ ] **Turnstile captcha** renders on signup/login/forgot-password forms. Submit each form, verify the BE rejects requests without a valid token.
- [ ] **Webhook endpoints unauthenticated by design** — confirm they're not behind `requireAuth`. They verify signatures internally. Test this by hitting `/v1/webhook/razorpay` without a signature header → should 400, not 401.
- [ ] **No `console.log` leaks tokens** — the global error handler in `framedrops/src/main.ts` already scrubs `Bearer `, `Authorization:`, and `ps_auth_token=` from error.message strings. Verify it's still wired by intentionally throwing in dev with one of those strings — should be redacted.
- [ ] **Database superuser is not the app user** — the connection string in `DATABASE_URL` should use a role with table-level perms only, not Supabase service-role/superuser. Defense-in-depth against SQL injection.
- [ ] **R2 keys are scoped to the bucket** — verify in Cloudflare R2 → API tokens that the production key cannot list/delete other buckets.
- [ ] **JWT expiry** — `JWT_EXPIRES_IN=7d` is fine for photographer sessions (they re-auth weekly). Shorter for high-risk surfaces if needed later.
- [ ] **No `v-html` in templates** — `grep -rn 'v-html' framedrops/src/` should return zero hits in user-content surfaces.
- [ ] **noindex meta on private surfaces** — open `/dashboard`, `/admin`, `/gallery/abc` in incognito and view source; each should have `<meta name="robots" content="noindex, nofollow">`.

---

## 8. Performance + UX smoke

- [ ] **Lighthouse mobile score ≥ 80** on `/` (landing), `/pricing`, `/login`. Run from a private window. Mobile is the gate because >50% of Indian web traffic is mobile.
- [ ] **Upload one real album** end-to-end on prod — 30 photos, 200MB total. Confirm: compression runs, R2 upload completes, `finalize` updates DB, gallery link works, share email arrives.
- [ ] **Client gallery flow on a phone** — open the share link on a real mobile browser (not desktop devtools mobile mode). Test pinch-zoom, double-tap, swipe navigation in the upgraded preview modal. Test the access-code gate and payment gate on the same phone.
- [ ] **i18n smoke** — switch language to Telugu and Hindi via the language switcher. Walk through signup → dashboard → upload → share. Any English leftover, write down the file/line for the medium-priority audit (still ~10 surfaces uncovered).
- [ ] **Payment modal end-to-end on prod** — create a real client + album in production, hit ₹29 minimum tier, pay via Razorpay live mode. Then verify the wallet payment path with a second album.
- [ ] **Calendar reminder fires** on prod — see section 4.
- [ ] **Background upload survives navigation** — start a 100-photo upload via the engine, navigate to `/dashboard`, navigate back, refresh the tab. Upload resumes from IndexedDB (per the persistent upload subsystem in `framedrops/CLAUDE.md`).
- [ ] **The "no image downloads" invariant holds** — try Save Image As, drag-to-desktop, right-click on a client gallery photo. All blocked or watermarked. Per [[project-no-image-downloads]] memory.

---

## 9. Documentation + ops

- [ ] **README** is publicly accurate (if the repo will be public). If private, skip.
- [ ] **Operational runbook** in a Notion / Google Doc — short list of "what to do when X breaks":
  - Backend won't boot → check Render logs, check DB connection
  - Emails not sending → check Brevo dashboard quota, check API key
  - Razorpay webhooks silent → check webhook signature in Razorpay dashboard
  - Database getting slow → check Supabase metrics dashboard
- [ ] **Support contact escalation** — `supportframedrops@gmail.com` is monitored. Add a phone forwarding rule for the WhatsApp number so messages don't pile up.
- [ ] **Admin access** — only you. Document the steps to add a second admin if/when you hire help: SQL update `users.role = 'admin'` + bump `token_version` (per backend CLAUDE.md security section).

---

## 10. Launch day

- [ ] **Soft launch** — invite 3–5 photographer friends/early-feedback users first. Watch what breaks before broadcasting. 24-hour soak time minimum.
- [ ] **Monitor Sentry / Render logs every 30 minutes** for the first 4 hours.
- [ ] **Watch payment success rate in Razorpay dashboard** — if first 10 transactions show <80% success, pause and investigate before scaling acquisition.
- [ ] **Don't ship new code on launch day.** Any bug discovered: hotfix only if user-blocking; otherwise queue for tomorrow.
- [ ] **Tag the release:** `git tag v1.0.0 && git push --tags` once you're satisfied with the soft launch.

---

## 11. Day-1 post-launch (within 24h)

- [ ] **Verify yesterday's signups landed in DB** with the right `role`, `is_verified`, `phone_number`.
- [ ] **Check yesterday's emails sent in Brevo** — bounce rate <5%, no spam complaints.
- [ ] **Confirm at least one customer-facing payment succeeded** end-to-end (Flow 2). The dashboard should reflect the wallet credit.
- [ ] **Backup runs successfully** — pull yesterday's Supabase snapshot, confirm it's there.
- [ ] **Calendar reminder worker logged at least one tick** — `grep CalendarReminderWorker` in Render logs.
- [ ] **No `[ERROR]` log spam** in Render logs. Investigate any pattern that fires more than once.

---

## 12. Things deliberately NOT in this checklist (and why)

- **Load testing.** Pre-revenue, 5-50 users, doesn't matter. Revisit at 500 active photographers.
- **A/B testing infrastructure.** Same reason.
- **Multi-region failover.** Single-region (India / ap-south-1) is fine until revenue justifies.
- **WhatsApp Business API.** [FUTURE_FEATURES Tier 3 item 6](FUTURE_FEATURES.md) — deferred until 5+ paying photographers.
- **Full DPDP self-serve delete.** [FUTURE_FEATURES Tier 1 item 1](FUTURE_FEATURES.md) Stage A (manual via /support) is what ships at launch. B and C come with scale.
- **Status page hosted publicly.** Internal uptimerobot is enough at launch.
- **Mobile app.** No timeline yet. When/if it ships, redo this checklist top-to-bottom — App Store / Play Store have their own gauntlet.

---

## Append: incidents log

> When something goes wrong post-launch, add it here with date + root cause + fix. Future-you reviews this before the next big change.

- _(empty)_
