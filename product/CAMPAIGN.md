# CAMPAIGN.md — Photography Day 2027 campaign + leaderboard

> Engineering + product reference for the "International Photography Day 2027"
> recognition campaign: what's shipped, how scoring works, and the deferred
> "announce winners / awards" phase.
>
> Last touched: 2026-06-15. Update the relevant section if you change a view,
> endpoint, or the scoring config.

---

## What this is

A year-long recognition campaign. Event date: **19 August 2027**. The idea:
reward photographers for *using the platform well* — managing real clients,
delivering albums, buying agreements/plans, staying active — not for doing
anything special or gimmicky. On the day, the most committed photographers are
recognized (badges / certificates / possible gear). The whole thing is framed as
a **mission + community + recognition program**, deliberately not a giveaway.

Tagline: **"Build today. Be recognized tomorrow."**

**Status:** built and live **up to the leaderboard stage**. The announce/awards
phase is **deferred** — see [Deferred phase](#deferred--announce-winners--awards-phase) below and
`launch/FUTURE_FEATURES.md`.

---

## Scoring — single balanced composite

Photographers are ranked on ONE composite score (0–100), computed **live** from
existing source tables over the campaign window. No popularity, no lucky draw.

Weights are published in [`framedropsbe/src/config/campaign.js`](../../framedropsbe/src/config/campaign.js)
(`CAMPAIGN_WEIGHTS`, must sum to 1.0). A per-campaign override can be stored in
`campaigns.weights` (JSONB, same keys):

| Factor | Weight | Source |
|---|---|---|
| Clients created | 0.20 | `clients` in window |
| Uploads (0.5·albums + 0.5·images) | 0.20 | `albums` + `image_count`, `is_deleted=false` |
| Payments (money to platform) | 0.25 | `transactions.amount` where `status='success'` (paise) |
| Agreements accepted | 0.20 | `agreements` accepted in window |
| Activity / consistency | 0.15 | distinct active weeks (albums/photos/txns/agreements) |

- Aggregation + filtering (disabled users, excluded users) happens in **SQL**;
  normalization (min-max vs candidate-set max) + weighting happens in **JS** in
  `buildLeaderboard()` so the maths is transparent and testable.
- Money is **paise** on the wire; FE renders `/100`.
- Client→photographer payments (Flow 2 `client_payments`) are **excluded** — the
  campaign rewards contribution to the *platform*, not the photographer's own
  customer revenue.

---

## Backend (`framedropsbe`)

- **Tables:** `campaigns` + `campaign_exclusions` — migration `src/migrations/15_campaigns.sql`,
  mirrored into `src/database/full_schema_v2.sql`. Uses the shared
  `update_updated_at_column()` trigger.
- **Layering** (mirrors the analytics admin pattern): `src/admin/{routes,controllers,services,repositories}/campaign*`.
- **Admin endpoints** under `/v1/admin/campaigns` (behind `requireAdmin`):
  list / create / get / update; `GET /:id/leaderboard` (live composite + per-factor
  breakdown); `GET /:id/winners` (top-N, `TOP_N_WINNERS=10`); exclude / re-include.
- **Disqualification:** an admin can exclude a user found gaming the system
  (reason required). Exclude/include both write the append-only `admin_audit_log`
  in the same transaction. Re-include = delete the exclusion row.
- **Public endpoint:** `GET /v1/public/campaigns/:slug` returns **landing copy only**
  (`name`, `description`, dates) — never standings.

---

## Frontend (`framedrops`)

- Types: [`src/types/campaign.ts`](../../framedrops/src/types/campaign.ts) —
  `Campaign`, `LeaderboardRow`, `CampaignLeaderboard`, `PublicCampaign`.
- Service / store: `src/api/services/campaign.service.ts`, `src/stores/campaigns.ts`.
- **Admin views:** `AdminCampaignsView.vue` (CRUD list + dialog),
  `AdminCampaignLeaderboardView.vue` (KPI header + ranked table with per-factor
  columns + exclude/re-include + "show winners" toggle). Nav item lives in the
  Analytics group of `AdminLayout.vue`.
- **Public landing page:** [`src/views/CampaignLandingView.vue`](../../framedrops/src/views/CampaignLandingView.vue)
  at route `/campaign/:slug`. 11 sections: hero, countdown, mission, "What Matters
  Most", how recognition works, fair play, founding photographers (live count-up
  from `/public/stats`), what awaits, timeline, message, final CTA.
- **Dashboard hook:** a campaign CTA was added to the dashboard greeting row
  (`DashboardView.vue`) linking to the landing page.

### Public landing — visual identity

The landing page is an **editorial / bold-contrast sub-brand**, deliberately more
striking than the rest of the app. All styling is **page-scoped CSS vars** — it
does NOT touch the global `--ps-*` tokens.

- Palette: purple `#5B2E91` + gold `#F5A623` + magenta `#E0249A` + cream `#FBF1DD` + ink `#160a26`.
- Full-bleed alternating colour bands (`data-band` / `.camp-band--{ink,purple,gold,cream,light}`),
  oversized uppercase type, hard borders + offset shadows, striped band edges.
- "What Matters Most" cards use MDI `v-icon` (not emoji).
- Mascot "Framey" (`src/components/campaign/FrameyWave.vue`) appears in Mission +
  Message sections. The hero illustration (`FrameyRoad.vue`) was **removed** — hero
  is now a single centered column. `FrameyRoad.vue` still exists on disk but is
  unreferenced.

---

## Public CTA wiring (no code change)

The existing announcement banner drives traffic to the campaign: an admin creates
an announcement with `ctaUrl: /campaign/photography-day-2027`. `AnnouncementBanner.vue`
renders internal paths as same-tab router links — no banner code touched.

---

## Deferred — announce winners / awards phase

Intentionally **not built yet**. Decision (2026-06-15): let photographers use the
platform and accumulate real data first; revisit and implement **~October 2026**.
A live leaderboard against an empty dataset isn't meaningful.

**Decisions already locked (carry these into the resume plan — do not re-ask):**
- **Snapshot + publish.** An admin "Publish results" action freezes final standings
  into a NEW `campaign_results` table on the day. Public/dashboard/profile surfaces
  read from that snapshot, NOT the live `getWinners` query (which keeps changing).
  This is the key architectural point.
- **Generated in-app** badges + certificates: SVG/CSS badges + a printable HTML
  certificate page (browser print-to-PDF). Honors the R2-only / no-extra-storage
  constraint. (Alternative if a real PDF is later wanted: reuse the
  `agreement-pdf.service.js` pdfkit+R2 pattern.)
- **Four surfaces:** (1) public **Hall of Fame** (landing page flips countdown→winners
  after publish), (2) **winner's dashboard badge** card, (3) **public profile badge**
  (slot into the "About Photographer" achievements dialog in `ClientGalleryView.vue`),
  (4) **admin awards manager** (assign award type + rank/tier + optional prize note, then publish).
- **Scope when resumed:** build end-to-end.

**Awards model sketch:** an award has a *type* (Featured Photographer / Achievement
Badge / Early Adopter Honor / Community Spotlight — matches the "What Awaits in 2027"
landing cards), a *rank/tier* (1st/2nd/3rd or Top-10), and an optional prize note
(tripod, lens, certificate). New tables: `campaign_results` (frozen snapshot rows)
+ `campaign_awards` (type/rank/prize per winner).

**Tamper-proofing** (cryptographic sealing of standings) is explicitly out of scope —
for now an admin disqualifies gamers manually. Revisit separately if ever needed.
