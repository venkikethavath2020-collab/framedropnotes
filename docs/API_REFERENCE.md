# API Reference

Related docs: [Project Map](./PROJECT_MAP.md), [Database](./DATABASE.md), [Features](./FEATURES.md), [Environment](./ENVIRONMENT.md).

Base URL in the frontend is `VITE_API_BASE_URL`, defaulting to `https://api.framedrops.in/v1`. Most backend routes mount under `/v1`; legacy/profile upload is mounted at `/api/upload`.

## Response Shape

Most endpoints return:

```json
{
  "success": true,
  "data": {},
  "message": "Success",
  "meta": {}
}
```

Errors return `success: false`, `data: null`, and `message`. The frontend `apiClient` handles network errors, 401 redirects, 503 maintenance redirects, and 5xx toasts.

## Route Mounts

| Mount | Module | Auth |
|---|---|---|
| `/health` | DB/liveness probe | Public |
| `/gallery/:share_id` | Public gallery resolver | Public |
| `/v1/auth/admin` | Admin auth | Public with limiter |
| `/v1/auth` | Photographer auth | Mixed |
| `/v1/clients` | Client folders | Mostly photographer JWT |
| `/v1/albums` | Albums | Mixed public/share + photographer JWT |
| `/v1/albums/:albumId/photos*` | Photos | Mixed public/share + photographer JWT |
| `/v1/selections` | Client selections | Public share ID gated |
| `/api/upload` | Generic image upload | Photographer JWT |
| `/v1/billing` | Billing/trial/locked album data | Mixed |
| `/v1/notifications` | Photographer notifications | Photographer JWT |
| `/v1/calendar` | Events/notes | Photographer JWT |
| `/v1/agreements` | Photographer agreements | Photographer JWT |
| `/v1/agreement` | Public agreement signing | Opaque token + OTP |
| `/v1/client-auth` | Client gallery access codes | Public |
| `/v1/payments` | Photographer-to-platform payments | Mixed |
| `/v1/client-payments` | Customer-to-photographer payments | Public |
| `/v1/wallet`, `/v1/withdrawals`, `/v1/payout-methods` | Earnings and payout workflow | Photographer JWT |
| `/v1/admin` | Admin APIs | Admin JWT |
| `/v1/webhook` | Razorpay webhook dispatcher | Signature/IP checks |

## Endpoint Families

### Auth

| Method | Path | Purpose | Tables |
|---|---|---|---|
| `GET` | `/v1/auth/config` | Returns auth feature config such as Google client ID. | none/users indirectly |
| `POST` | `/v1/auth/send-otp` | Signup OTP. | `otp_codes`, rate-limit tables |
| `POST` | `/v1/auth/signup` | Password signup with OTP. | `users`, `otp_codes`, `email_jobs`, `notifications` |
| `POST` | `/v1/auth/login` | Password login. | `users` |
| `POST` | `/v1/auth/google` | Google ID-token login/signup/link. | `users` |
| `POST` | `/v1/auth/forgot-password` | Enqueue reset email without account enumeration. | `users`, `email_jobs` |
| `POST` | `/v1/auth/reset-password` | Consume hashed reset token and rotate sessions. | `users` |
| `GET/PUT` | `/v1/auth/me` | Load/update current user profile/branding. | `users` |
| `POST` | `/v1/auth/admin/send-code` | Admin code delivery. | `users`, `otp_codes` |
| `POST` | `/v1/auth/admin/verify-code` | Admin login. | `users` |

### Clients and Albums

| Method | Path | Purpose | Tables |
|---|---|---|---|
| `GET/POST` | `/v1/clients` | List/create clients. | `clients` |
| `GET/PUT/DELETE` | `/v1/clients/:id` | Detail/update/delete client. | `clients`, `albums` |
| `GET` | `/v1/clients/:id/stats` | Client usage/payment stats. | `clients`, `albums`, `photos`, `client_payments` |
| `POST/DELETE` | `/v1/clients/:id/share` | Enable/disable share link. | `clients` |
| `GET` | `/v1/clients/share/:shareId` | Public client folder by share ID. | `clients`, `albums` |
| `POST` | `/v1/clients/:id/access-code` | Create client access code. | `album_access_codes` |
| `POST` | `/v1/clients/:id/gallery-code` | Generate gallery code. | `album_access_codes` |
| `POST` | `/v1/clients/:id/share-email` | Email share link/code. | `email_jobs` |
| `GET/POST` | `/v1/albums` | List/create albums. | `albums`, `clients` |
| `GET/PUT/DELETE` | `/v1/albums/:id` | Detail/update/delete album. | `albums`, `photos` |
| `GET` | `/v1/albums/client/:clientId` | Albums for a client. | `albums` |
| `GET` | `/v1/albums/share/:shareId` | Public album payload. | `albums`, `clients` |
| `POST` | `/v1/albums/:id/access-code` | Generate album code. | `album_access_codes` |
| `GET` | `/v1/albums/:id/selection-export` | Export client selections. | `photos`, `selections` |
| `POST` | `/v1/albums/:id/transfer-status` | Record local transfer state. | `albums` |

### Photos and Uploads

| Method | Path | Purpose | Tables |
|---|---|---|---|
| `GET` | `/v1/albums/:albumId/photos` | Owner photo listing. | `photos`, `albums` |
| `GET` | `/v1/albums/share/:shareId/photos` | Public gallery photo listing. | `photos`, `albums` |
| `GET` | `/v1/albums/share/:shareId/photos/selected` | Public selected photo listing. | `photos`, `albums` |
| `POST` | `/v1/albums/:albumId/photos` | Server-mediated multipart upload. | `photos`, `albums`, R2 |
| `POST` | `/v1/albums/:albumId/photos/sign` | Sign one direct R2 upload. | `albums`, R2 |
| `POST` | `/v1/albums/:albumId/photos/finalize` | Finalize one direct upload. | `photos`, `albums`, R2 |
| `POST` | `/v1/albums/:albumId/photos/bulk-sign` | Sign batch upload. | `albums`, R2 |
| `POST` | `/v1/albums/:albumId/photos/bulk-finalize` | Finalize batch upload. | `photos`, `albums`, R2 |
| `DELETE` | `/v1/photos/:id` | Delete photo. | `photos`, `albums`, R2 |
| `POST` | `/v1/photos/bulk-delete` | Bulk delete photos. | `photos`, `albums`, R2 |
| `GET` | `/v1/albums/:albumId/photos/selected/download` | Text file of selected original names. | `photos` |
| `POST` | `/api/upload` | Generic image upload for profile/branding. | R2 |

### Selections, Billing, Payments

| Method | Path | Purpose | Tables |
|---|---|---|---|
| `GET` | `/v1/selections/:shareId` | Load selection state. | `selections`, `photos`, `albums` |
| `POST` | `/v1/selections/:shareId/toggle` | Toggle selected photo. | `selections`, `photos` |
| `POST` | `/v1/selections/:shareId/submit` | Submit final selection. | `selections`, `albums`, `notifications`, `email_jobs` |
| `GET` | `/v1/billing/status` | User billing summary. | `users`, `albums`, `transactions` |
| `GET` | `/v1/billing/pricing` | Pricing config. | config |
| `GET` | `/v1/billing/locked-albums` | Locked album summary. | `albums`, `platform_dues` |
| `GET` | `/v1/billing/platform-dues` | Dues owed. | `platform_dues` |
| `GET` | `/v1/billing/dashboard-stats` | Dashboard counters. | `clients`, `albums`, `photos`, `payments` |
| `GET` | `/v1/billing/album-tracking` | Album lifecycle table. | `albums`, `clients`, `platform_dues` |
| `GET` | `/v1/billing/trial-status` | Trial state. | `users`, `clients` |
| `GET` | `/v1/payments/key` | Razorpay key ID. | env |
| `POST` | `/v1/payments/create-order` | Platform payment order. | `transactions` |
| `POST` | `/v1/payments/verify` | Verify platform payment. | `transactions`, `platform_dues`, `wallet_transactions` |
| `GET` | `/v1/payments/transactions` | Photographer payment history. | `transactions` |
| `POST` | `/v1/client-payments/create-order` | Client payment order. | `client_payments` |
| `POST` | `/v1/client-payments/verify` | Verify client payment. | `client_payments`, `wallets`, `wallet_transactions` |

### Admin

Admin routes are mounted under `/v1/admin` and protected by `requireAdmin`.

| Area | Paths | Tables |
|---|---|---|
| Dashboard/search/users | `/dashboard`, `/search`, `/users*` | `users`, plus aggregate tables |
| Payments/revenue/analytics | `/payments/*`, `/analytics/*`, `/transactions` | `transactions`, `client_payments`, `wallet_transactions`, `albums`, `photos` |
| Albums/agreements | `/albums*`, `/agreements*` | `albums`, `photos`, `agreements`, `agreement_versions`, `agreement_events` |
| Wallets/withdrawals/platform dues | `/wallets*`, `/withdrawals*`, `/platform-dues*` | `wallets`, `wallet_transactions`, `withdrawals`, `platform_dues` |
| Coupons/campaigns | `/coupons*`, `/campaigns*` | `coupons`, `coupon_redemptions`, `campaigns`, `campaign_exclusions` |
| System/ops | `/system/*`, `/capacity`, `/jobs*`, `/email/jobs`, `/audit-log` | `system_settings`, `worker_heartbeats`, `email_jobs`, `admin_audit_log` |
| Moderation/comms | `/feedback*`, `/announcements*`, `/notifications*`, `/feature-interests*` | `feedbacks`, `announcements`, `notifications`, `feature_interests` |

## Page to API Map

| Frontend page | Primary APIs |
|---|---|
| `/dashboard` | `/billing/dashboard-stats`, `/billing/status`, `/notifications/*`, `/announcements/active` |
| `/clients` | `/clients`, `/clients/:id`, `/clients/:id/share`, `/clients/:id/share-email` |
| `/clients/:id` | `/clients/:id`, `/albums/client/:clientId`, `/clients/:id/stats` |
| `/albums` | `/albums`, `/billing/status`, `/billing/locked-albums` |
| `/albums/:id` | `/albums/:id`, `/albums/:id/photos*`, `/selections`, `/payments/*`, `/albums/:id/selection-export` |
| `/albums/tracking` | `/billing/album-tracking`, `/billing/platform-dues` |
| `/gallery/:shareId` | `/albums/share/:shareId`, `/albums/share/:shareId/photos`, `/selections/:shareId/*`, `/client-auth/verify-code`, `/client-payments/*` |
| `/gallery/client/:shareId` | `/clients/share/:shareId`, album/photo share endpoints |
| `/calendar` | `/calendar/events`, `/calendar/notes` |
| `/wallet` | `/wallet`, `/wallet/transactions`, `/withdrawals/*`, `/payout-methods/*` |
| `/agreements*` | `/agreements/*`, `/agreements/credits*` |
| `/agreement/:token` | `/agreement/:token`, `/agreement/:token/send-otp`, `/accept`, `/reject`, `/pdf` |
| `/settings/profile`, `/settings/branding` | `/auth/me`, `/api/upload`, payout methods in profile |
| `/support` | `/support`, `/feedback` |
| `/admin/*` | `/admin/*` endpoints matching each admin page |
