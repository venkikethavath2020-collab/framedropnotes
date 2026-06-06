# Album Preview (Flipbook) — Feature Reference

> Frontend-only "wedding album" flipbook preview generated from a client's
> selected photos. Shipped June 2026. **No backend, no DB, no PDF, no payment.**
> Everything is computed and rendered in the browser at view time.

---

## What it does (one minute)

A client opens their gallery, hearts some photos, then taps **"Preview album"**.
Instantly an elegant book opens — a cover with the couple's name, a sequence of
professionally-arranged spreads (single hero shots, two-photo spreads, collages,
grids), and a closing thank-you page. They flip through it like a real album:
page-turn animation, swipe on mobile, fullscreen, page numbers.

It's a **preview/marketing delight**, not a deliverable. Nothing is saved or
exported — it regenerates each time from whatever photos are passed in.

---

## Where everything lives

| Piece | File | Role |
|---|---|---|
| Component | [`src/components/gallery/AlbumPreview.vue`](../../framedrops/src/components/gallery/AlbumPreview.vue) | The reusable flipbook. Props + lifecycle + styling. |
| Layout planner | [`src/utils/albumLayout.ts`](../../framedrops/src/utils/albumLayout.ts) | **Pure, framework-free.** Decides which photos land on which page and the template each page uses. Reuse this if a server/PDF path is ever built. |
| Type shim | [`src/types/page-flip.d.ts`](../../framedrops/src/types/page-flip.d.ts) | Minimal `.d.ts` for the `page-flip` lib (it ships none). |
| Wiring | [`src/views/client/ClientGalleryView.vue`](../../framedrops/src/views/client/ClientGalleryView.vue) | Mounts the component; "Preview album" button sits in the selection bar. |
| Library | `page-flip` (StPageFlip) ~v2.0.7 | In `dependencies`. Imported via the ESM build path `page-flip/dist/js/page-flip.module.js`. |
| i18n | `albumPreview.*` key block in `en/te/hi.json` | All UI strings. |

---

## Props (the public contract)

```ts
{
  modelValue: boolean   // v-model open/close (matches PreviewModal convention)
  photos: string[]      // selected photo URLs, in album order
  coupleName: string    // cover + closing headline
  eventName: string     // cover subtitle / event label
}
```

In the gallery, `photos` = the client's **selected** picks when any are chosen,
otherwise the **whole album** (so the button is never a dead end). `coupleName`
comes from the album's `clientName` (→ `name` fallback); `eventName` from `name`
(→ `eventType`).

---

## How the album is generated

`planAlbumPages(photos)` walks a fixed **rhythm** of layouts so no two facing
pages feel the same, like a real album:

```
single → duo → hero → duo → trio → quad → single  (repeats)
```

Layout kinds and capacities:

| Kind | Photos | Arrangement |
|---|---|---|
| `single` | 1 | Full-bleed hero |
| `duo` | 2 | Two stacked frames |
| `trio` | 3 | One tall feature + two stacked |
| `quad` | 4 | Even 2×2 grid |
| `hero` | 5 | Large feature on top + four supporting |

**Key rule:** the planner never *starts* a layout it can't fill. When the pool
runs low it downgrades to an exact-fit layout, so the **last page is always
complete** (no half-empty grid). Cover + closing are static template pages
appended by the component, NOT produced by the planner.

---

## Flipbook behaviour & the gotchas worth remembering

These were real bugs fixed during the build — don't reintroduce them.

1. **Two-page spread vs single page.** Desktop/laptop (stage ≥ 800px wide) shows
   a real left+right spread; tablet/phone shows one large page. Controlled by
   `usePortrait: !spread`. **`usePortrait: true` forces single-page always** —
   that was the original "why only one page?" bug.

2. **Don't rebuild on every resize.** PageFlip fires its *own* internal resize
   during flips/stretch. The first version caught every resize and did a full
   `destroy()` + `loadFromHTML()` rebuild — which **blanked the pages and
   flickered on each flip**, sometimes leaving it empty until you reopened.
   Fix: a lightweight `refitBook()` resizes a **bounded host box** and calls
   `flip.update()`; it only does a real rebuild when the layout crosses the
   spread↔single breakpoint.

3. **Bounded host box, not stretch-to-viewport.** The book host gets an explicit
   computed pixel size (fitted to the stage, capped ~720px tall). PageFlip's
   `stretch` fills *that box*, never the whole viewport. Stretching to full
   viewport height made pages tall+narrow and `object-fit: cover` cropped photos
   hard — that was the "images are cropping" complaint.

4. **`overflow: hidden` on `.ap-stage` and `.album-preview`.** The page-turn
   lifts a corner that briefly overflows; without clipping it spawns a transient
   scrollbar = flicker.

5. **Off-DOM page source.** Pages are rendered as hidden children of `.ap-pages`,
   then handed to PageFlip via `loadFromHTML(leaves)`. PageFlip lifts them into
   the book. Don't style them assuming they stay in `.ap-pages`.

6. **Lifecycle cleanup.** `destroyFlip()` on close + unmount; fullscreen and
   resize listeners removed; `resizeRaf` cancelled. Fullscreen uses the real
   `requestFullscreen` API with a CSS-class (`--fs`) fallback when blocked.

---

## Styling / brand

- Warm-white "paper" pages on a soft room-gradient background (not pure #fff).
- Serif display type (Cormorant Garamond / Playfair fallback) for the couple
  name; hairline gold/taupe frame on cover + closing.
- Uses the repo's `--ps-*` design tokens for radii/shadows/durations.
- Thumbnails go through `rawR2Url` + `onThumbError` (Cloudflare-9422 fallback,
  same as the rest of the gallery).

---

## Marketing copy alignment

The landing-page `features.selection.description` (en/te/hi) was updated to
mention this feature: *"…preview their picks as a flipbook wedding album…"*.
The claim is accurate to current behaviour — the preview button only appears
**after** a client selects ≥1 photo (it lives in the selection bar). If we ever
let clients preview the whole album *before* picking, add a second entry point
(e.g. in the gallery info bar) and the copy still holds.

---

## If a backend/PDF path is ever wanted (NOT built, not planned)

The product is deliberately frontend-only. If a server-rendered or downloadable
album is ever requested:
- `albumLayout.ts` is pure and reusable — the page plan can be computed
  server-side identically.
- Reuse the R2 + pdfkit pattern from the Agreement Builder (see
  [`AGREEMENT_BUILDER.md`](AGREEMENT_BUILDER.md)) — but note the **no-image-
  download product invariant**: Framedrops never serves photo bytes for
  download. A PDF album would cross that line and needs an explicit product
  decision first.
