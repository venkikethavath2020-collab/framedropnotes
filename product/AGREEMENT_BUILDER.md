# Agreement Builder — Feature Reference

> Photography agreement (contract) builder: photographers compose a shoot
> agreement, send it to their client, the client signs via OTP, and a
> server-generated PDF is stored on R2. Multilingual (en/te/hi).
> **FE + BE both built (June 2026); migrations run + Noto fonts added —
> end-to-end functional, remaining work is polish only.**

---

## What it does (one minute)

1. Photographer opens the **Builder**, picks a shoot template (wedding,
   pre-wedding, event, etc.), selects services from a catalog, sets
   deliverables / timeline / payment milestones / clauses, picks a language.
2. **Sends** the agreement → client gets an email with a public link
   (`/agreement/:token`, opaque token, same pattern as `/gallery/:shareId`).
3. Client reviews, then **signs via OTP** (email OTP, mandatory). They can also
   **decline** with a reason.
4. A **server PDF** (pdfkit) is generated, stored on R2, and emailed. An audit
   trail records every step (Created → Sent → Viewed → OTP Sent → OTP Verified →
   Accepted → PDF Generated; or Rejected / Revoked).
5. Photographer sees status, audit timeline, and can resend / duplicate /
   new-version / **revoke** / **delete** from the dashboard.

**FrameDrops is NOT a party to the agreement** — it's the platform only. The
signature block reads "Issued by {studioName}"; a strong 6-point disclaimer is
auto-appended to every PDF.

---

## Single source of truth — content

**[`framedrops/src/data/agreementContent.ts`](../../framedrops/src/data/agreementContent.ts)** — change agreement content HERE, not in views.
It feeds the builder, the PDF, the customer view, and the dashboard. Mirror it
in the BE copy **[`framedropsbe/src/config/agreementContent.js`](../../framedropsbe/src/config/agreementContent.js)** — keep the two in sync.

Holds: service catalog (8 categories, ~88 services with per-category color/tint),
`PREDEFINED_CLAUSES` (toggleable, en/te/hi), `FRAMEDROPS_DISCLAIMER` (mandatory),
`DELIVERABLE_OPTIONS`, `DELIVERY_TIMELINE_OPTIONS`, `RETENTION_OPTIONS`,
`PAYMENT_PRESETS`, `AGREEMENT_TEMPLATES` (9 shoot types), `DOC_STRINGS`
(per-language PDF labels), `EVENT_TYPES`.

---

## Where everything lives

### Frontend
| Piece | File | Route |
|---|---|---|
| Builder | `views/agreements/AgreementBuilderView.vue` | `/agreements/new`, `/agreements/:id/edit` |
| Dashboard | `views/agreements/CustomerAgreementsView.vue` | `/agreements` |
| Public signing page | `views/agreements/CustomerAgreementView.vue` | `/agreement/:token` (public + noindex) |
| Shared PDF doc | `components/agreements/AgreementPdfDocument.vue` | used by preview / modal / print / drawer |
| Print util | `utils/printAgreement.ts` | **isolated iframe print, NOT `window.print()`** |
| Types / API / store | `types/agreement.ts`, `ENDPOINTS.AGREEMENTS` + `PUBLIC_AGREEMENT`, `api/services/agreement.service.ts` (`agreementService` + `publicAgreementService`), `stores/agreements.ts` | — |

Nav entry: SideNav + MobileMenu `workspaceItems`, key `nav.agreements`.

### Backend (`framedropsbe/`, layered routes → controller → service → repository)
- **Migrations:** `14_agreements.sql` (folded into `full_schema_v2.sql`) +
  `15_agreement_revoke.sql`. Tables: `agreements` (JSONB `content` + indexed cols,
  **amounts in PAISE**), `agreement_versions` (immutable snapshots),
  `agreement_events` (audit). `agreement_no` via `agreement_no_seq` →
  `FD-AGR-YYYY-NNNN`.
- **OTP reuse:** `otp_codes.context` column (default `'login'`); agreement codes
  use `context='agreement'` so they never clash with login OTPs.
- **Services:** `agreement.service.js`, `agreement-otp.service.js` (public
  review/accept), `agreement-pdf.service.js` (pdfkit → R2 `uploadServerSide`),
  `studioInfo.service.js` (`getStudioInfo(userId)`).
- **Routes:** `/v1/agreements` (JWT) + `/v1/agreement/:token` (public,
  authLimiter). Hourly cron `agreementExpiry.worker.js`. 3 inline agreement
  emails in `email.service.js` (`agreementShell` responsive HTML).

---

## Key conventions / invariants (do not violate)

- **OTP is MANDATORY, locked on.** Builder switch is readonly with an
  "Always on" badge; FE forces `otpEnabled:true`; BE `toColumns()` forces
  `otp_enabled=true`. (No "demo OTP box" — long removed.)
- **Money: rupees in the UI, paise in the DB.** `buildPayload` / `applyToForm` /
  mappers convert. **Don't double-convert.**
- **PDF printing uses an isolated iframe**, never `window.print()` on the main
  window (two live PDF instances + Vuetify overlay double-rendered). Server PDF
  is the real artifact that reaches the client; iframe print is the fallback.
- **Multilingual PDF needs Noto fonts.** `framedropsbe/src/assets/fonts/` must
  hold the Noto Telugu/Devanagari `.ttf` files or te/hi PDFs box-out (Latin
  falls back to Helvetica). Path override: `AGREEMENT_FONT_DIR`. `application/pdf`
  is in R2 `ALLOWED_MIME`.
- **Telugu PDF crash fix:** fontkit GPOS null-anchor monkey-patch
  (`ensureFontkitPatched`) via pdfkit's CJS fontkit instance (`createRequire`) —
  an ESM `import 'fontkit'` is a different module/prototype and the patch won't
  apply. The ✓ tick is a vector path (`drawCheck`), not the U+2713 glyph.
- **PDF layout measures wrapped height** (`heightOfString`) and advances the
  cursor — no fixed offsets — to avoid overlap.
- **Storage = R2 only** (no Cloudinary — fully removed; both CLAUDE.md files are
  stale on this).

---

## Lifecycle states

`Created → Sent → Viewed → OTP Sent → OTP Verified → Accepted → PDF Generated`
plus `Rejected` (client declines w/ reason) and `Revoked`.

- **Revoke** (status→`revoked`): kills the public link, keeps row + audit. For
  "sent to the wrong customer."
- **Delete:** hard DELETE, cascades events + versions.
- **Both blocked once `accepted`** (signed = protected, returns 409).
- Public endpoints return **410 + "no longer valid"** on revoked; the public
  page shows a friendly revoked/expired/not-found state, not a generic 404.

---

## Closing / thank-you page (client-first — NOT a promo)

**Framing rule:** the signer is the photographer's CLIENT (bride / event host),
NOT a photographer. The PDF closing page and the post-sign screen must read as a
warm thank-you **from the studio**, never a Framedrops signup pitch. An earlier
version pitched "create your own agreements free" — that was wrong and was
removed. **Don't reintroduce a promo CTA / URL in the PDF.** Framedrops appears
only as a quiet trust signal ("Securely signed & stored via FrameDrops", plain
text, no link).

- Strings: `thankYouTitle/Headline/Body/Signed`, `securelySigned` in
  `DOC_STRINGS` (en/te/hi) in BOTH `agreementContent.ts` (FE) and
  `agreementContent.js` (BE).
- The standalone `/thank-you` SEO promo page (`ThankYouView.vue`) still exists as
  an organic-SEO asset, but is no longer linked from any PDF.

---

## Status & remaining work

End-to-end functional as of June 2026 (migrations 14 + 15 run, Noto fonts added).
Remaining items are **polish only — no blockers**. When extending:
follow the repo's feature order (types → endpoints → service → store → view), add
every i18n key to en + te + hi in the same change, and keep the FE/BE
`agreementContent` copies in sync.
