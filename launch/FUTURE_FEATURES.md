# Framedrops — Future Features Roadmap

> **Self-prompt for Claude.** This is the live backlog of work that is NOT yet shipped. Anything done is removed. When the user says "what's next?" or "let's keep building", read this file first, then propose the next item.
>
> **Binding context (do not violate):**
> - Solo dev + marketer, **pre-revenue**. Don't push growth-stage features (paid acquisition, referrals with cash payouts, expensive infra) until LTV is known. See [user_stage memory](.claude/projects/-Users-apple-Desktop-PHOTOSHARE/memory/user_stage.md).
> - Stack rules in `photosharebe/CLAUDE.md` and `photoshare/CLAUDE.md` are binding.
> - Money: rupees in app, paise at Razorpay boundary. 10% platform fee on Flow 2 (`PLATFORM_FEE_PERCENT`).
> - Every i18n key lands in `en.json` + `te.json` + `hi.json` in the same change.
> - Every BE schema change updates `full_schema.sql` AND ships an incremental `.sql` migration.

---

## Tier 1 — Compliance & legal (do BEFORE first paid customer)

### 1. DPDP delete account — staged rollout
**Why:** India's DPDP Act (in force) requires honoring erasure requests. Apple/Google reject apps without delete-account if/when we ship mobile. At pre-revenue we don't need the full self-serve flow yet, but we need *some* path that exists.

**Stage A — manual path (~10 min, do now or with next sprint)**
- Add `delete_account` option to the `/support` category dropdown (FE: `SupportView.vue` + i18n)
- Add a "How to delete your account" paragraph to `PrivacyView.vue` pointing users to the support form with a 7-day SLA
- No backend changes. Deletions handled by hand via SQL until volume justifies automating

**Stage B — soft-delete button (~2-3 hours, trigger: >50 active users OR first compliance ask)**
- Confirmation dialog on ProfileView ("Type DELETE to confirm")
- `POST /v1/users/me/delete-account` → sets `users.is_disabled = true`, bumps `token_version` (kills sessions), enqueues confirmation email
- User immediately logged out. Data retained but inaccessible
- Migration: no new columns needed — reuses existing `is_disabled` + `token_version`

**Stage C — hard-delete cascade (~3 days, trigger: mobile app submission OR DPDP audit)**
- Cron worker: hard-deletes accounts where `is_disabled = true AND disabled_at < NOW() - INTERVAL '30 days'`
- New column needed: `users.disabled_at TIMESTAMPTZ` (migration + `full_schema.sql` update)
- Wipes user row + cascades clients/albums/photos/selections; deletes R2 prefix
- **Legal retention exception:** keep `transactions` and `client_payments` rows for 7 years (Indian tax law) — anonymize by nulling `user_id` and stamping `user_email_at_delete` for audit trail
- `POST /v1/users/me/export-data` ships alongside: queue job, ZIP user data + photo URLs + payments, R2 with 7-day signed URL, email link

**Order matters:** don't skip to C. Each stage covers the next ~10× user growth.

---

## Tier 2 — Retention loops (cheap, high-leverage)

### 3. Admin date-range filter wiring — half day
**Status (post pre-launch audit, 2026-05-18):** The big "admin is all mocks" item is **done**. Every admin view is wired to a real `/v1/admin/*` endpoint backed by raw SQL in `framedropsbe/src/admin/repositories/`. AdminWithdrawalsView is mounted. AdminAuditLogView queries the real `admin_audit_log` table. AdminCapacityView reads live pool/heap stats. No `Math.random()` survives anywhere in admin code.

**What remains:** date-range filtering on five chart endpoints isn't honored. The FE accepts `_filters?` and the BE controllers accept `?from=&to=` query params, but the service layer doesn't apply them. Affected methods:

- `analyticsService.getUserGrowth`
- `analyticsService.getImageUploads`
- `analyticsService.getAlbumTrends`
- `analyticsService.getPaymentSuccess`
- `analyticsService.getRevenueBreakdown`

**Approach when needed:** drop the underscore on `_filters?`, forward via `dateRangeParams(filters)`, and on the BE pass `parseDateParams(req)` into the matching service methods (mirror the pattern already used by `getDashboardKpis` / `getRevenueTimeSeries` / `getRevenueMetrics`). Until that ships, either keep the date-range pickers above these charts hidden, or accept that picker changes don't move the chart.

**Other admin polish items** (nice-to-have, no rush):
- Real-time refresh (today fetch-once-on-mount; OK for small user base).
- Force-unlock-album admin button (manual recovery for stuck payments — currently SQL).
- Manual wallet adjustment UI (currently SQL).

### 4. Selections feedback loop (1-2 days)
**Why:** Closes the photographer ↔ client loop, drives repeat usage.

- "Selections" tab on `AlbumDetailView` showing favourited photos with comments inline
- Client-side "Submit final selection" button on gallery view — emails photographer, marks album status as `selection_submitted`
- Photographer sees `selection_submitted` chip in album list

### 5. Calendar v2 (deferred from earlier sprint)
See [calendar v2 deferred memory](.claude/projects/-Users-apple-Desktop-PHOTOSHARE/memory/project_calendar_v2_deferred.md).
- Reminder worker (data model already shipped)
- Recurring events
- Google Calendar sync (later — needs OAuth scope review)

---

## Tier 3 — Revenue (only after Tier 1 done + first 10 paying users)

### 6. WhatsApp transactional messaging (3-4 days, **needs business setup first**)
**Why deferred:** Requires Meta Business verification, which needs verified business address + Govt ID + ideally GST registration. Solo / pre-revenue can't justify the 1-2 weeks of paperwork yet. Revisit once 5+ paying photographers are asking for GST invoices (which is also when GST registration becomes worth doing for input-tax-credit reasons).

**Prerequisites (do these first, in order):**
1. GST registration (~₹500–2,000 one-time + ~₹500/mo CA fees)
2. Meta Business Manager verification (1–2 weeks, needs GST cert + address proof + business website — framedrops.in already qualifies)
3. Pick a BSP: MSG91, Gupshup, AiSensy, or Interakt. MSG91 is cheapest for OTP+notifications combo (~₹0.15/msg).
4. Get a dedicated number (cannot be on personal WhatsApp)
5. Submit message templates for Meta approval (24–48h each)

**What to build (after prerequisites):**
- `notification.service.js` adapter: `sendViaWhatsApp(userId, templateKey, vars)` — falls back to email if WhatsApp not configured or template not approved
- Three high-leverage transactional templates first (NOT signup OTP — see below):
  | Trigger | Recipient | Template |
  |---|---|---|
  | Album marked ready | Client | "Your gallery is ready: [link]" |
  | Selection submitted | Photographer | "[Client name] submitted their selection on [album]" |
  | Payment received | Photographer | "₹[amount] credited to your wallet from [client]" |
- `users.whatsapp_notifications_enabled BOOLEAN` for opt-out (DPDP requires explicit consent for marketing, but transactional is OK)
- Admin view: template status + delivery rates

**Why NOT signup OTP first:** SMS OTP works fine in India (~99% delivery via MSG91), saving ~₹0.03/OTP isn't worth the integration. Transactional notifications drive engagement (gallery opens, return visits) — that's where WhatsApp earns its keep.

**Cost ballpark at 1,000 active photographers:** ~3 messages/photographer/week × ₹0.15 ≈ ₹1,800/month. Negligible vs revenue at that scale.

### 7. Pro subscription tier (1 week)
**Why deferred:** User wants revenue analysis on Flow-2 commission first before deciding subscription pricing.

- Razorpay Subscriptions API (separate from one-shot Orders)
- Plans: Pro Monthly ₹499, Pro Yearly ₹4,999, Studio Yearly ₹14,999 (TBD by user)
- Schema sketch:
  ```sql
  CREATE TABLE subscriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) NOT NULL,
    razorpay_subscription_id VARCHAR(64) UNIQUE,
    plan_id VARCHAR(40) NOT NULL,
    status VARCHAR(20) NOT NULL,
    current_period_start TIMESTAMPTZ,
    current_period_end TIMESTAMPTZ,
    cancel_at_period_end BOOLEAN DEFAULT FALSE,
    metadata JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  ALTER TABLE users ADD COLUMN active_plan VARCHAR(40) DEFAULT 'free';
  ALTER TABLE users ADD COLUMN plan_expires_at TIMESTAMPTZ;
  ```
- Behaviour: when `users.active_plan != 'free'` AND `plan_expires_at > NOW()`, `recalculateAlbumPricing` short-circuits (`chargeable_images = 0`, `price = 0`). Do NOT touch Flow 1 invariants — `albums.is_paid` is still set true via `applySideEffects`; just skip the Razorpay charge.
- Webhooks: `subscription.activated`, `subscription.charged`, `subscription.cancelled`, `subscription.halted`
- New view `/billing/upgrade`, refactor `UpgradeModal` to add "Switch to Pro" CTA
- Billing dashboard widget showing current plan + renewal date

---

## Tier 4 — Acquisition / SEO (only when there's something worth promoting)

### 8. Public photographer profiles (4 days)
- Public route `/p/:slug` (e.g. `/p/sarah-wedding-photography`)
- Schema: `users.public_slug VARCHAR(64) UNIQUE`, `users.is_profile_public BOOLEAN DEFAULT FALSE`
- Photographer marks albums as showcase: `albums.is_showcase BOOLEAN`
- Studio bio + sample showcase galleries (read-only, watermarked) + contact form
- JSON-LD `Photographer` schema, full OG/Twitter tags
- Sitemap entry generated dynamically
- Settings page: enable public profile, pick slug, choose showcase albums

### 9. Landing-page social proof (1 day, after first 50 users)
- Testimonials section (5 quotes — needs real ones from real users)
- "Trusted by N photographers" counter (live from DB)
- 3-4 anonymised public sample galleries linked from CTA
- Update SEO title tags to include the count

---

## Tier 5 — Growth experiments (only after revenue is positive)

### 10. Referrals — DEFERRED
**Why deferred:** Per-referral cost (~₹121/successful referral on the originally proposed model) is a burden at pre-revenue. Revisit once LTV is known. See [user_stage memory](.claude/projects/-Users-apple-Desktop-PHOTOSHARE/memory/user_stage.md).

If/when revisited, the model:
- Referrer: ₹100 wallet credit on referred user's **first successful payment** (not on signup — fights fake referrals)
- Referred: ₹50 off first payment OR 50 bonus free images
- Cap: referrer earns max ₹2000/month
- Schema sketch already drafted in earlier sprint plan — keep on ice.

### 11. PostHog analytics — SKIPPED for now
**Why skipped:** Overkill at pre-revenue. The existing `src/lib/analytics.ts` `registerAnalyticsSink` interface is in place. Wire to PostHog or alternative when there's enough traffic to justify the cognitive cost.

---

## Cross-cutting reminders

- **Verify each PR:** FE `vue-tsc --noEmit` clean, BE smoke boots cleanly (`PORT=3099 node server.js`).
- **No `console.log` in hot paths** — use `trackEvent` for analytics, repo/service-boundary logs only.
- **Use `transaction()` for any multi-row mutation**; pass the client through every repo call.
- **Don't reuse advisory lock keys** (`728_491_001` is taken by album-expiry).
- **Don't break Flow 1 invariants** in `photosharebe/CLAUDE.md` — `albums.is_paid` is sole truth source for unlock; `clients.is_paid` is derived; never filter `getLockedAlbums` on `clients.is_paid`.

## How to use this file

1. When user asks "what's next?", read this top-down. Recommend the highest tier with open work.
2. Plan agent first → present approach → wait for 👍 → implement.
3. When an item ships, **delete it from this file** in the same commit. This file should shrink, not grow stale.
4. New ideas from conversation: add them at the bottom under a "Captured ideas" section, not in the tiers, until the user decides priority.

## Captured ideas (unsorted, decide priority later)

### Editor handoff — Phase 2 (HD delivery to remote editors)

**Status:** PARKED. Do NOT build until Phase 1 (current preview + selection + Transfer Selected flow) is released and validated with real photographer usage data. Decision gate: review after analytics show whether photographers actually want this.

**Problem being solved:**
Today, after a client selects photos and the photographer runs Transfer Selected (local FS copy via browser File System API), the photographer still has to manually send the matching HD files to their remote editor — typically via Google Drive or WeTransfer (~₹600/mo) or pendrive. The "find the matching HDs and ship them" step is the remaining manual friction in the workflow.

**Architecture (decided):**
- **Keep the existing invariant** for client-facing flow: previews on R2, HD/RAW stays local. Client never downloads bytes from servers; Transfer Selected = local FS copy. See [no image downloads memory](.claude/projects/-Users-apple-Desktop-PHOTOSHARE/memory/project_no_image_downloads.md).
- Phase 2 deliberately breaks the invariant **only for the editor handoff path**: selected HDs upload to R2, editor downloads from a signed link. Client side stays preview-only.
- Two access tiers: client = preview only (no download button, ever). Editor = signed-link HD download.

**Why NOT "upload everything HD upfront":**
Considered and rejected. At 30 Mbps realistic Indian upload (~2.5 MB/s), a medium wedding (8,000 × 15 MB = 120 GB) is a 13-hour upload, large weddings 30+ hours. Plus ~90% of bytes wasted (only ~10% of photos get selected). Storage cost on R2 also spikes 15× for zero client-side benefit.

**The flow (locked in):**
1. Client submits selection (existing)
2. Photographer clicks "Send to Editor" in album view
3. Modal: *"Editor handoff: 487 selected photos, ~7.3 GB. Cost: ₹199. 30-day retention."*
4. Size calculated client-side via File System Access API (we already have the folder handle from Transfer Selected) — exact price shown before any upload starts
5. Photographer pays via Razorpay (UPI)
6. Payment success → resumable HD upload to R2 begins → editor link auto-generated when upload completes
7. Editor receives link by email + photographer gets shareable URL
8. Editor downloads (no account required — signed link only)
9. Auto-delete at day 30

**Pricing (pay-as-you-go, no subscription):**
- ₹199 per editor handoff up to 15 GB
- +₹49 per additional 10 GB
- One free re-send within 30-day window if editor download fails
- Decision pending: first handoff free for new accounts as conversion lever (decide before launch — hard to add later without looking like a price drop)

**Why pay-as-you-go (not subscription):**
User explicitly chose this. Aligns cost-to-value perfectly, no metering friction, no tier management to build, every photographer can use it regardless of volume.

**Cost economics:**
- True cost per handoff: ~₹10 (R2 storage @ $0.015/GB/mo × 7.5 GB × 30 days). R2 egress is free.
- Replaces ~₹150-200 of proportional WeTransfer/Drive cost + ~1 hr manual file matching per wedding
- Comfortable margin at ₹199

**Implementation scope (when greenlit):**
4-6 weeks of solo dev work. Real engineering surface:
- Resumable upload (tus or R2 multipart with resume) — must be bulletproof; first-upload failure kills trust and spreads on WhatsApp groups
- Razorpay one-shot Orders integration (separate from existing flows; rupees in app, paise at boundary)
- Pre-upload size calculator using existing File System Access API folder handle (reuse Transfer Selected primitive)
- R2 prefix for editor packages with hard 30-day retention enforcement (cron worker)
- Editor download page (signed link, no auth, browse + zip download)
- Email notification via Brevo (reuse existing transport; queue not inline since not OTP-class)
- Two access tiers on storage permissions
- Failed-download re-send within retention window (one free per handoff)

**Open questions for when work resumes:**
- Hard cap on package size? A 100 GB wedding at ₹199 + 9×₹49 = ₹640 might surprise. Consider "contact us" above some threshold.
- Editor download UX: single zip vs browse + multi-select. V1 = zip.
- Multiple editors on same handoff: one payment, multiple email recipients on same link.
- Re-upload after retention expires (day 45 ask): fresh ₹199.
- GST on ₹199: inclusive (photographers will assume so).
- First-handoff-free for new accounts: yes/no decision before launch.

**Validation gate before building:**
- Are photographers asking unprompted "how do I send these to my editor"?
- What % of active photographers? Threshold: ~60% asking within 2-3 months → build. ~10% → don't.
- Cheap signal collector: add a "Send to Editor — coming soon, drop your email" placeholder button on post-selection screen during Phase 1. Costs 1 hour, gives months of demand data.

### Photography Day 2027 — announce winners / awards phase — DEFERRED

**Status:** the campaign + leaderboard is **shipped** (see `product/CAMPAIGN.md`). The *announce-winners* half is **not built**. Decision (2026-06-15): let photographers use the platform and accumulate real data first; **revisit ~October 2026**. A live leaderboard against an empty dataset isn't meaningful.

**Trigger to resume:** ~Oct 2026, OR when the leaderboard has a meaningful spread of active photographers with real clients/albums/payments.

**Decisions already locked (do NOT re-ask when work resumes):**
- **Snapshot + publish** — admin "Publish results" freezes final standings into a new `campaign_results` table on the day; public/dashboard/profile read from that snapshot, NOT the live `getWinners` query.
- **Generated in-app** badges (SVG/CSS) + printable HTML certificate (browser print-to-PDF) — honors R2-only / no extra storage. Fallback if a real PDF is wanted: reuse `agreement-pdf.service.js` (pdfkit + R2).
- **Four surfaces:** public Hall of Fame (landing flips countdown→winners), winner dashboard badge, public profile badge (slot into "About Photographer" dialog in `ClientGalleryView.vue`), admin awards manager.
- **Build end-to-end** when resumed.

**New tables:** `campaign_results` (frozen snapshot rows) + `campaign_awards` (award type / rank-tier / optional prize note per winner). Award types match the "What Awaits in 2027" landing cards (Featured Photographer / Achievement Badge / Early Adopter Honor / Community Spotlight). Tamper-proofing (crypto sealing) is out of scope — admins disqualify gamers manually.
