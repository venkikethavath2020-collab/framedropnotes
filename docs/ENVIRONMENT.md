# Environment

Related docs: [Deployment](./DEPLOYMENT.md), [Architecture](./ARCHITECTURE.md), [API Reference](./API_REFERENCE.md).

Frontend variables are public and must start with `VITE_`. Backend variables are server-only and read through `process.env`.

## Frontend Env (`framedrops`)

| Variable | Used in | Purpose / default |
|---|---|---|
| `VITE_API_BASE_URL` | `src/api/client.ts`, photo/profile upload callers | Backend API base, default `https://api.framedrops.in/v1`. |
| `VITE_TURNSTILE_SITE_KEY` | `src/config/turnstile.ts` | Cloudflare Turnstile site key. |
| `VITE_SOCIAL_INSTAGRAM` | `src/config/social.ts` | Public Instagram URL. |
| `VITE_SOCIAL_YOUTUBE` | `src/config/social.ts` | Public YouTube URL. |
| `VITE_SOCIAL_LINKEDIN` | `src/config/social.ts` | Public LinkedIn URL. |
| `VITE_SOCIAL_X` | `src/config/social.ts` | Public X/Twitter URL. |
| `VITE_GOOGLE_AUTH_ENABLED` | `src/composables/useGoogleAuth.ts` | Enables Google sign-in UI when true and client ID exists. |
| `VITE_GOOGLE_OAUTH_CLIENT_ID` | `src/composables/useGoogleAuth.ts` | Google Identity Services client ID. |
| `VITE_PRICING_TIERS` | `src/config/pricing.ts` | JSON/string pricing tiers override. |
| `VITE_BILLING_CURRENCY` | `src/config/pricing.ts` | Currency, default `INR`. |
| `VITE_LAUNCH_PRICING_ENABLED` | `src/config/pricing.ts` | Enables launch pricing display, default true. |
| `VITE_LAUNCH_STRIKE_PRICES` | `src/config/pricing.ts` | Strike-through launch price overrides. |
| `VITE_FREE_LIFETIME_IMAGE_LIMIT` | `src/config/pricing.ts` | Free lifetime image limit display, default 3000. |
| `VITE_TRIAL_IMAGE_LIMIT` | `src/config/pricing.ts` | Trial image limit display, default 3000. |
| `VITE_TRIAL_DURATION_DAYS` | `src/config/pricing.ts` | Trial duration display, default 15. |
| `VITE_SENTRY_DSN` | `src/config/sentry.ts` | Browser Sentry DSN. |
| `VITE_SUPPORT_WHATSAPP` | `src/config/contact.ts` | Support WhatsApp number/link. |
| `VITE_SUPPORT_EMAIL` | `src/config/contact.ts`, `MaintenanceView.vue` | Support email fallback. |
| `VITE_BILLING_EMAIL` | `src/config/contact.ts` | Billing contact email. |
| `VITE_LEGAL_EMAIL` | `src/config/contact.ts` | Legal contact email. |
| `VITE_PRIVACY_EMAIL` | `src/config/contact.ts` | Privacy contact email. |
| `VITE_COMPLIANCE_EMAIL` | `src/config/contact.ts` | Compliance contact email. |
| `VITE_GRIEVANCE_EMAIL` | `src/config/contact.ts` | Grievance contact email. |
| `VITE_MAX_PHOTOS_PER_ALBUM` | `UploadZone.vue`, `AlbumDetailView.vue` | Client-side album upload cap display/enforcement. |
| `VITE_AUTH_METHOD` | Documented in `CLAUDE.md`, via `src/utils/authMode.ts` | Auth UI mode, `otp` or `password`. |

## Backend Core Env (`framedropsbe`)

| Variable | Used in | Purpose / default |
|---|---|---|
| `NODE_ENV` | `server.js`, DB config, Razorpay | Production safety behavior. |
| `PORT` | `server.js`, Swagger config | API port, default `3000`. |
| `DATABASE_URL` | `src/config/db.js`, backup/restore | PostgreSQL connection string. |
| `PG_POOL_MAX` | `src/config/db.js` | Pool max, default 50. |
| `ALLOWED_ORIGINS` | `server.js`, URL fallbacks | Comma-separated CORS origins, default local Vite. |
| `APP_BASE_URL` | emails, clients, agreements, workers | Public frontend/app URL. |
| `PUBLIC_APP_URL` | admin email preview | Preview app base, default `https://app.framedrops.in`. |
| `PUBLIC_API_URL` | Swagger | Public API URL for docs. |
| `BRAND_NAME` | server logs, emails, PDFs | Brand label, default `Framedrops`. |
| `BRAND_TAGLINE` | email layout | Default `Galleries for photographers`. |
| `SUPPORT_EMAIL` | emails/payments/backups | Support email fallback. |
| `SUPPORT_INBOX_EMAIL` | support email service | Destination for support requests. |
| `DEFAULT_PHONE_COUNTRY_CODE` | email/phone validation | Phone normalization default, `91`. |
| `MAINTENANCE_MODE` | system settings service | Env-level maintenance gate. |
| `SWAGGER_ENABLED` | Swagger config/server guard | API docs on/off; forced false in production. |
| `SENTRY_DSN` | `instrument.js` | Backend Sentry DSN. |

## Auth and Security Env

| Variable | Used in | Purpose / default |
|---|---|---|
| `JWT_SECRET` | auth services/middleware, OTP HMAC | Required for JWTs; production minimum 32 chars. |
| `JWT_EXPIRES_IN` | auth services | JWT expiry, default `7d`. |
| `JWT_ISSUER` | auth/admin/client middleware | JWT issuer, default `framedrops`. |
| `JWT_AUDIENCE` | auth/admin services/middleware | JWT audience, default `framedrops-api`. |
| `OTP_PROVIDER` | server production guard | Must not be `mock` in production. |
| `MOCK_OTP_CODE` | server production guard | Forbidden in production. |
| `OTP_EXPIRES_MINUTES` | OTP utils/agreement OTP | OTP lifetime, default 5. |
| `OTP_MAX_ATTEMPTS` | OTP utils/agreement OTP | Attempts per OTP, default 5. |
| `LOGIN_LOCK_AFTER` | password auth | Failed attempts before lock, default 10. |
| `LOGIN_LOCK_FOR_MINUTES` | password auth | Lock duration, default 60. |
| `TURNSTILE_SECRET` | Turnstile middleware | Server-side Turnstile secret. |
| `ADMIN_EMAIL` | admin auth service | Allowed admin email. |
| `ADMIN_PHONE` | admin auth service | Allowed admin phone. |
| `GOOGLE_AUTH_ENABLED` | Google provider/service | Enables Google auth. |
| `GOOGLE_OAUTH_CLIENT_ID` | Google provider/controller | Google OAuth audience/client ID. |

## Rate Limit Env

| Variable | Used in | Purpose / default |
|---|---|---|
| `RATE_LIMIT_ENABLED` | `server.js` | Override global rate limiting. |
| `RATE_LIMIT_API_MAX` | `server.js` | General API limit, default 500/15 min. |
| `RATE_LIMIT_ADMIN_MAX` | `server.js` | Admin limit, default 3000/15 min. |
| `RATE_LIMIT_AUTH_MAX` | `server.js` | Auth limit, default 15/15 min. |
| `RATE_LIMIT_PAYMENT_MAX` | `server.js` | Payment limit, default 30/15 min. |
| `RAZORPAY_WEBHOOK_ALLOWLIST` | webhook routes | Optional webhook IP allowlist. |
| `ADMIN_NOTIFICATION_RATE_LIMIT_PER_MIN` | notification service | Admin notification rate, default 120/min. |
| `NOTIFICATION_RATE_LIMIT_PER_MIN` | notification service | User notification rate, default 60/min. |
| `EMAIL_OTP_RATE_LIMIT_PER_EMAIL` | email service | Email OTP rate cap, default 5. |
| `EMAIL_OTP_RATE_LIMIT_WINDOW_MIN` | email service | Email OTP window, default 10. |
| `SUPPORT_RATE_LIMIT_PER_USER` | email service | Support request cap, default 10. |
| `SUPPORT_RATE_LIMIT_WINDOW_MIN` | email service | Support request window, default 60. |

## Storage Env

| Variable | Used in | Purpose / default |
|---|---|---|
| `R2_ACCOUNT_ID` | R2 config, backup/restore | Cloudflare account ID; required unless `R2_ENDPOINT`. |
| `R2_ENDPOINT` | R2 config, backup/restore | Explicit S3 endpoint override. |
| `R2_ACCESS_KEY_ID` | R2 config | R2 access key. |
| `R2_SECRET_ACCESS_KEY` | R2 config | R2 secret key. |
| `R2_BUCKET` | R2 config, backup/restore | Bucket name. |
| `R2_PUBLIC_HOST` | R2 config | Public CDN/custom hostname. |
| `R2_IMAGE_RESIZE` | R2 URL builder | Enables transformed image URLs when `on`. |
| `MAX_FILE_SIZE_MB` | R2 config, upload/photo routes | Max upload size, default 25 MB. |
| `STORAGE_TOTAL_GB` | admin analytics | Capacity display, default 500. |

## Pricing, Billing, Wallet Env

| Variable | Used in | Purpose / default |
|---|---|---|
| `FREE_LIFETIME_IMAGE_LIMIT` | backend pricing | Free lifetime uploads, default 300. |
| `TRIAL_IMAGE_LIMIT` | pricing/admin analytics | Trial limit, default 3000. |
| `TRIAL_DURATION_DAYS` | pricing | Trial days, default 15. |
| `CLIENT_MAX_IMAGES` | pricing/photo service | Per-client image cap, default 3000. |
| `MAX_PHOTOS_PER_ALBUM` | pricing/photo service | Per-album cap, default 500. |
| `BILLING_CURRENCY` | pricing/agreement pricing | Currency, default `INR`. |
| `LAUNCH_PRICING_ENABLED` | pricing | Launch price toggle, default true. |
| `PRICE_TIER_1..n`, `PRICE_TIER_1_MAX..n` | pricing | Price tier overrides. |
| `LAUNCH_STRIKE_PRICE_1..n` | pricing | Launch strike price overrides. |
| `ALBUM_EXTENSION_DAYS` | extension/lifecycle | Extension length, default 30. |
| `ALBUM_EXTENSION_PRICE_RUPEES` | extension/lifecycle | Extension price, default 49. |
| `PLATFORM_FEE_PERCENT` | wallet service | Platform cut, default 10. |
| `MIN_WITHDRAWAL_PAISE`, `MIN_WITHDRAWAL_RUPEES` | withdrawal service | Min withdrawal threshold. |
| `MAX_WITHDRAWAL_PAISE`, `MAX_WITHDRAWAL_RUPEES` | withdrawal service | Max withdrawal threshold. |

## Razorpay Env

| Variable | Used in | Purpose |
|---|---|---|
| `RAZORPAY_KEY_ID` | Razorpay/payment services | Public key ID returned to frontend. |
| `RAZORPAY_KEY_SECRET` | Razorpay service | Secret for orders/signatures. |
| `RAZORPAY_WEBHOOK_SECRET` | Razorpay service/webhooks | Webhook signature verification. |

## Email Env

| Variable | Used in | Purpose / default |
|---|---|---|
| `SMTP_ENABLED` | email transporter | Enables SMTP/Brevo sending. |
| `BREVO_API_KEY` | backup/email scripts and transporter | Brevo API key. |
| `BREVO_SENDER_EMAIL` | email transporter/backups | Sender email, default `noreply@framedrops.in`. |
| `BREVO_SENDER_NAME` | email transporter | Sender name, default `Framedrops`. |
| `EMAIL_WORKER_CRON` | email worker | Schedule, default every 5 seconds. |
| `EMAIL_WORKER_BATCH` | email worker | Batch size, default 25. |
| `EMAIL_WORKER_DISABLED` | email worker | Disable email worker when true. |
| `BACKUP_NOTIFY_EMAIL` | backup worker/scripts | Backup report recipient. |

## Worker Env

| Variable | Used in | Default |
|---|---|---|
| `ALBUM_EXPIRY_CRON` | album expiry worker | `0 */6 * * *` |
| `ALBUM_EXPIRY_BATCH` | album expiry worker | 200 |
| `ALBUM_CLEANUP_BATCH` | album expiry worker | 50 |
| `ALBUM_CLEANUP_MAX_ATTEMPTS` | album expiry worker | 5 |
| `ALBUM_EXPIRY_WORKER_DISABLED` | album expiry worker | false |
| `R2_REAPER_CRON` | R2 reaper | `0 4 * * 0` |
| `R2_REAPER_ALBUM_BATCH` | R2 reaper | 50 |
| `R2_REAPER_ALBUM_MIN_AGE_DAYS` | R2 reaper | 7 |
| `R2_REAPER_RECLEAN_AGE_DAYS` | R2 reaper | 30 |
| `R2_REAPER_DISABLED` | R2 reaper | false |
| `R2_RECON_CRON` | R2 reconciliation | `0 5 * * 0` |
| `R2_RECON_SAMPLE_PCT` | R2 reconciliation | 1 |
| `R2_RECON_MAX_ROWS` | R2 reconciliation | 5000 |
| `R2_RECON_DISABLED` | R2 reconciliation | false |
| `CALENDAR_REMINDER_CRON` | calendar worker | every minute |
| `CALENDAR_REMINDER_BATCH` | calendar worker | 50 |
| `CALENDAR_REMINDER_WORKER_DISABLED` | calendar worker | false |
| `TRIAL_EXPIRY_CRON` | trial worker | hourly |
| `TRIAL_EXPIRY_WORKER_DISABLED` | trial worker | false |
| `AGREEMENT_EXPIRY_CRON` | agreement worker | hourly |
| `AGREEMENT_EXPIRY_WORKER_DISABLED` | agreement worker | false |
| `STALE_PENDING_CRON` | stale pending worker | every 5 minutes |
| `STALE_PENDING_MINUTES` | stale pending worker | 15 |
| `STALE_PENDING_DISABLED` | stale pending worker | false |
| `LIFECYCLE_CRON` | lifecycle worker | every 6 hours |
| `LIFECYCLE_PER_EVENT_CAP` | lifecycle worker | 100 |
| `ALBUM_EXPIRY_REMINDER_DAYS` | lifecycle worker | 7 |
| `LIFECYCLE_ENABLED` | lifecycle worker | must be `true` to run |
| `BACKUP_RETENTION_DAYS` | backup worker/scripts | 30 |

## Agreement Env

| Variable | Used in | Purpose / default |
|---|---|---|
| `AGREEMENT_FONT_DIR` | agreement PDF service | Font asset directory. |
| `AGREEMENT_FREE_LIMIT` | agreement pricing | Free agreement allowance, default 25. |
| `AGREEMENT_BILLING_ENFORCE` | agreement pricing | Enforce credit billing, default true. |
| `AGREEMENT_PACK_1_CREDITS..n` | agreement pricing | Credit pack sizes. |
| `AGREEMENT_PACK_1_PRICE..n` | agreement pricing | Credit pack prices. |
| `FRAMEDROPS_PROMO_URL` | agreement content | Promo URL, default `https://framedrops.in`. |

## Backup/Restore Env

| Variable | Used in | Purpose |
|---|---|---|
| `TARGET_DATABASE_URL` | restore script | Destination DB for restore. Must differ from `DATABASE_URL`. |
| `BACKUP_RETENTION_DAYS` | backup scripts/worker | R2 backup retention. |
| `BACKUP_NOTIFY_EMAIL` | backup scripts/worker | Notification recipient. |
