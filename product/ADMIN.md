# ADMIN.md — Framedrops admin panel, dev notes

> Engineering reference for the `/admin/*` views. What each page does, where its
> data comes from, what state it owns, and gotchas worth knowing before you
> change anything.
>
> Last touched: 2026-05-10. Update the relevant section if you change a view.

---

## Shell

- **Layout:** [`src/layouts/AdminLayout.vue`](../src/layouts/AdminLayout.vue) —
  sticky left sidebar on desktop (260px, 72px rail mode), overlay drawer on
  mobile (<900px) triggered from a sticky top bar with hamburger + page title.
- **Mount point:** `/admin` in [`src/router/index.ts`](../src/router/index.ts),
  guarded by `requiresAuth: true, requiresAdmin: true`. Admin role is
  re-checked on every navigation via the existing JWT guard + `isAdminRole()`.
- **Mobile drawer auto-closes** on every route change (watch on
  `route.fullPath`). Same-route taps close explicitly via `onNavClick`.
- **Rail mode is desktop-only.** Mobile media query forces full-label view.

### Where new admin pages plug in

1. Add a route under `/admin/...` in `router/index.ts` (lazy-loaded, parent
   already provides `noindex` + `requiresAdmin`).
2. Add a `navGroups` entry in `AdminLayout.vue` (group label + item).
3. Page title in the mobile top bar comes from `currentPageTitle` which
   reads `navGroups`. If it's not in `navGroups`, the topbar falls back to
   "Admin".
4. Backend route lives under `/v1/admin/...` and goes through `adminLimiter`
   + `requireAdmin` (mounted in `framedropsbe/server.js`).

---

## Data layer

Three service files own admin-side fetches:

| File | Surface |
|---|---|
| [`api/services/admin.service.ts`](../src/api/services/admin.service.ts) | CRUD-style admin actions: users list/toggle, payment lists, audit log, capacity. Direct paths under `/admin/...`. |
| [`api/services/analytics.service.ts`](../src/api/services/analytics.service.ts) | Read-only analytics endpoints under `/admin/analytics/...`. Used by every dashboard / chart / KPI view. Heavy queries — backend caches them (60–300s TTLs in `framedropsbe/src/admin/services/analyticsCache.js`). |
| [`stores/admin.ts`](../src/stores/admin.ts) | Pinia store. Wraps the services with the standard `loading` / `error` / `throw` action shape. List views use this directly. |

> **Cache awareness.** Many analytics endpoints have a 60–300s server-side
> cache. Don't be surprised if a number doesn't move immediately after a
> data change — it's the cache, not a bug. Polling cadences below are
> tuned around this.

### Polling cadences

| View | Interval | Why |
|---|---|---|
| `AdminSystemHealthView` | 10 s | Operational signal — needs to catch a dying DB or email queue spike inside a tab-switch. |
| `AdminCapacityView` | 30 s | Pool / heap / active-user metrics. Cheap; safe to keep tight. |
| `AdminDashboardView` | 30 s | Top-line KPIs. Backend caches the heavy joins. |
| `AdminAnalyticsView` | 60 s | Pulls 5 series in parallel; slower cadence keeps cache hits high. |

`usePolling` in `src/composables/usePolling.ts` is visibility-aware (pauses
on hidden tab). Don't replace with raw `setInterval`.

---

## Per-view notes

> All views are at `src/views/admin/*View.vue`. Listed in `navGroups` order.

### Overview

#### `AdminDashboardView.vue` — `/admin`
- **Purpose:** Top-level KPIs + top-clients leaderboard. The first thing a
  super-admin sees.
- **Data:** `analyticsService.getDashboardKpis()`, `getTopClients()`.
- **State:** `useAdminStore` for shared admin context.
- **Polls every 30 s.**
- **Gotchas:**
  - `getTopClients` has a 5-minute backend cache (`ttlMs: 300_000`). A "new"
    top client may not appear in real time.
  - `dashboardStats` shape comes from the store — backend money fields are
    paise; render `/100` for INR display.

### Analytics (read-only)

#### `AdminAnalyticsView.vue` — `/admin/analytics`
- **Purpose:** 5 charts: revenue timeseries, user growth, upload volume,
  album trends, payment success.
- **Data:** Five parallel `analyticsService.*` calls in a single `Promise.all`.
- **Polls every 60 s.**
- **Gotchas:**
  - Endpoints accept `filters?.dateRange`. Some 12-month rollups ignore it —
    cheap to pass anyway.
  - This is the heaviest view in the panel: 5 cached queries every minute
    times N admin tabs. Don't lower the cadence.

#### `AdminRevenueView.vue` — `/admin/revenue`
- **Purpose:** Revenue breakdown by client / album, plus revenue metrics
  card.
- **Data:** `getRevenueBreakdown`, `getRevenueByClient`, `getRevenueByAlbum`,
  `getRevenueMetrics`.
- **No polling** — opened to investigate, not to monitor.
- **Gotchas:** Money fields are paise (see CLAUDE.md). Render with `/100` and
  Indian-locale grouping.

#### `AdminAlbumInsightsView.vue` — `/admin/album-insights`
- **Purpose:** Album-level analytics: insights per album + top-N albums by
  whatever metric.
- **Data:** `getAlbumInsights`, `getTopAlbums`.
- **No polling.**

#### `AdminUserIntelligenceView.vue` — `/admin/user-intelligence`
- **Purpose:** User cohort breakdown (segment counts + per-user
  intelligence).
- **Data:** `getUserSegmentCounts`, `getUserIntelligence`.
- **No polling.**

### Management

#### `AdminUsersView.vue` — `/admin/users`
- **Purpose:** Photographer list with search / status filter / role filter,
  plus per-user toggle and bulk enable/disable.
- **Data:** `useAdminStore.listUsers(...)`. Bulk action goes through
  `adminService.bulkSetUsersStatus(ids, isActive)`.
- **Gotchas:**
  - Bulk status flip is **server-transactional + audit-logged**. Skipped
    rows return reasons in `skippedIds`; surface them in the toast.
  - Toggling status bumps the user's `token_version` on the backend, which
    invalidates their JWT within the 30s user-cache window. Don't paper over
    this with an optimistic UI that pretends the change was instant.

#### `AdminAlbumsView.vue` — `/admin/albums`
- **Purpose:** Albums table with status filter + search + bulk delete.
- **Data:** `useAdminStore.listAlbums(...)`,
  `adminService.bulkDeleteAlbums(ids)`.
- **Gotchas:**
  - Bulk delete is **soft-delete server-side** (rows survive for analytics).
    The view should show "deleted" toast, not "permanently deleted".
  - The R2 cleanup happens via `r2OrphanReaper` cron, not synchronously.

### Finance

#### `AdminPaymentsView.vue` — `/admin/payments`
- **Purpose:** Both payment flows (photographer→platform "Flow 1" and
  client→photographer "Flow 2") in tabs.
- **Data:** `useAdminStore.listPlatformPayments()` + `listClientPayments()`.
- **Gotchas:** Two different ledger tables on the backend (`transactions`
  vs `client_payments`). Don't merge them client-side — the column shapes
  differ.

#### `AdminTransactionsView.vue` — `/admin/transactions`
- **Purpose:** Enhanced unified transaction explorer (search + filter
  across both flows).
- **Data:** `analyticsService.getEnhancedTransactions(filters)`.
- **No polling.**
- **Gotchas:** This is built on top of the analytics service for the
  filter/search ergonomics, not the management one. If you need to mutate
  a transaction, that's a different endpoint.

#### `AdminWalletsView.vue` — `/admin/wallets`
- **Purpose:** Photographer wallets list + per-photographer ledger drilldown.
- **Data:** `useAdminStore.listWallets(...)`,
  `getWalletTransactions(photographerId)`.
- **Gotchas:**
  - Wallet sources include `customer_payment`, `commission_deduction`,
    `withdrawal`, `top-up`, `platform_payment_combo`. Color-code or icon
    consistently — these are the canonical names.

#### `AdminWithdrawalsView.vue` — `/admin/withdrawals`
- **Purpose:** Pending withdrawal queue with admin approval workflow.
- **Data:** Withdrawal-specific endpoints (NOT in `adminService` yet — the
  view calls them directly via the withdrawals service).
- **Gotchas:**
  - **Approving a withdrawal is destructive in the financial sense** — it
    debits the photographer's wallet AND triggers a payout to their bank.
    Confirm dialogs are mandatory.
  - Don't add an "auto-approve" feature without a separate review.

#### `AdminCouponsView.vue` — `/admin/coupons`
- **Purpose:** Coupon CRUD: list / create / edit / delete.
- **Data:** `ENDPOINTS.ADMIN.COUPONS.{LIST,DETAIL,CREATE,UPDATE,DELETE}`,
  hit directly via `apiClient`.
- **Gotchas:**
  - Two coupon-route trees on the backend: `coupon.routes.js` (photographer
    validate-on-checkout) and `admin/routes/coupons.routes.js` (admin CRUD).
    They look duplicate but aren't — different services, different concerns.

### System

#### `AdminSystemHealthView.vue` — `/admin/system-health`
- **Purpose:** Operational dashboard: uptime, API/DB latency, storage %,
  failed payments, worker tick freshness.
- **Data:** `analyticsService.getSystemHealth()`.
- **Polls every 10 s.**
- **Gotchas:**
  - Storage % comes from `STORAGE_TOTAL_GB` env var on the backend (default
    500). Not a real provider quota — informational.
  - "Down" / "degraded" thresholds are inside the backend service, not
    here. Don't add client-side thresholding.

#### `AdminCapacityView.vue` — `/admin/capacity`
- **Purpose:** Live capacity & scaling-threshold snapshot. Pairs with
  `framedropsbe/docs/SCALING.md`.
- **Data:** `adminService.getCapacity()`.
- **Polls every 30 s.**
- **Gotchas:**
  - The `heapStatus` field grades **memory pressure (RSS / V8 hard limit)**,
    not `heapUsed/heapTotal`. The latter is shown as informational only —
    a healthy small process can sit at 96% of `heapTotal` because V8 grows
    it lazily.
  - Thresholds in the backend (`THRESHOLDS` const in
    `framedropsbe/src/admin/services/capacity.service.js`) must stay in
    sync with the prose in `framedropsbe/docs/SCALING.md`.

#### `AdminAuditLogView.vue` — `/admin/audit-log`
- **Purpose:** Append-only feed of admin mutations (who flipped what when).
- **Data:** `adminService.listAuditLog({ page, perPage, action, targetType, targetUserId, search })`.
- **No polling** — historical record.
- **Gotchas:**
  - Audit entries are **never updated or deleted server-side**. If you see
    a UI that suggests editing one, that's a bug.
  - `targetUserName` / `targetUserEmail` are populated only when
    `targetType === 'user'`. Other target types leave them null.

---

## Cross-cutting conventions

- **Toasts only for transient feedback.** All `<v-snackbar>` blocks have
  been migrated to `useToast()` (see `stores/toast.ts`). Never reintroduce
  per-view snackbar refs in admin views.
- **Field-level errors stay inline** (vee-validate / `:rules` on
  `v-text-field`). Toasts are for submit results / API failures only.
- **Admin requests are NOT counted toward the general `apiLimiter`** —
  they only hit `adminLimiter` (1500/15min in production, disabled in dev).
  See `server.js` for the full env-var override surface.
- **Money:** rupees in app code, paise on the wire (Razorpay boundary).
  See `framedropsbe/CLAUDE.md` for the exact split.

## Anti-patterns to refuse

- ❌ Adding a polling interval shorter than 5 s to any admin view (caches
  invalidate, real users see no benefit, server CPU climbs).
- ❌ Inlining admin URL strings — go through `ENDPOINTS.ADMIN.*`.
- ❌ Reading `clients.is_paid` for any payment-authority decision in any
  admin view (this is the ₹0 bug from the backend's CLAUDE.md). Per-album
  `albums.is_paid` is the only truth source.
- ❌ Mutating audit log rows.
- ❌ Hiding admin-only data behind client-side `v-if user.role === 'admin'`
  checks. The route guard already does that, and the data shouldn't be in
  the bundle in the first place. (Currently the route is guarded; just
  don't paint over it.)

## Open follow-ups

- The 15 child views still need a UI pass for mobile responsiveness
  (multi-column KPI grids, table overflow, filter bars). The shell rebuild
  on 2026-05-10 made them readable on phone but not yet polished.
- `AdminWithdrawalsView` doesn't go through the shared `adminService`. Worth
  consolidating once the withdrawals API stabilizes.
- Audit-log search (`search` param) is full-text but unindexed on the
  backend. Will get slow at >100k rows. Plan: add a partial GIN index when
  we cross 50k.
