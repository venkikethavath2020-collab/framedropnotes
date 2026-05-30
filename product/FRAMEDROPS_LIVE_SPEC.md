# Framedrops Live — Build Spec

**Status:** Validation-pending. Do NOT build until 10+ Indian wedding photographers have committed (verbally or pre-order) to paying ₹499+ per event.
**Drafted:** 2026-05-30
**Last revised:** 2026-05-30 (Agent + Web App architecture — see §3 and §17)
**Owner:** Solo dev (Prasanth)
**Estimated build effort:** 2–3 weeks MVP, 8–10 weeks production-grade
**Product positioning:** A *feature* inside main Framedrops, not a separate product. The web app (framedrops.in) gains a "Live Event" mode. A small background helper called **Framedrops Agent** runs on the photographer's laptop to do the work the browser cannot (watch folders, compress images, host the tunnel).

---

## 1. What this is, in one paragraph

A new "Live Event" mode inside the existing **Framedrops web app**. When activated, a lightweight background helper called **Framedrops Agent** (one-time install, ~30 MB) on the photographer's laptop watches a folder for new photos, generates web-friendly previews via `sharp`, and serves them through a Cloudflare Tunnel to guests over the public internet. The photographer **never leaves their browser** — they control everything from a new "Live Event" section in their Framedrops dashboard. Guests scan a QR code displayed on the photographer's screen and view the gallery in their mobile browser. **Requires internet on the photographer's laptop** (4G hotspot works). Activated via prepaid event credits via existing Razorpay billing.

---

## 2. Why this exists

Indian wedding photographers commonly need a way to share photos *live* during the event — wedding guests viewing photos within seconds of being shot, as a premium add-on couples pay ₹2,000–₹5,000 for (similar to drone coverage or same-day-edit reels). Existing cloud galleries (Framedrops main, Pixieset, Pic-Time) require uploading every photo to a remote server before it's viewable, which is too slow for the "scan QR, see photos from 30 seconds ago" experience. No Indian-market product fills this gap.

**Framedrops Live solves this** by treating the photographer's laptop as the origin server, with Cloudflare Tunnel publishing it to guests over the public internet. Photos are viewable seconds after being shot, with zero cloud-upload wait time.

---

## 3. Why Agent + Web App (not standalone desktop app)

Earlier drafts proposed a full standalone Electron desktop app (separate from main Framedrops). Rejected on **2026-05-30** in favor of **Agent + Web App** architecture. Reasons:

1. **The browser cannot be a server.** Browsers cannot open inbound sockets, spawn child processes (cloudflared), or watch filesystem folders. Some native code must exist on the laptop. The architectural question is only: how thin can it be? **Answer: ~30 MB Agent that does exactly the four things the browser can't do, and nothing else.**
2. **Code reuse.** A full Electron app would duplicate the entire Framedrops dashboard, billing, auth, settings, design system, i18n, support flows. Agent + Web App reuses all of it. **MVP drops from 4–6 weeks to 2–3 weeks.**
3. **Smaller install = less trust friction.** 30 MB vs 150 MB. Less surface area for antivirus to flag. Faster download.
4. **One brand, one product.** Photographer logs into framedrops.in (familiar), sees a new "Live Event" button. No second app to learn, no second app to find updates for, no "where do I change my password — desktop app or website" confusion.
5. **Updates are silent.** The Agent self-updates via a tiny update channel. The web app updates on every page load. No "please download v1.3" emails.
6. **Same architecture as Dropbox / Plex / GitHub Desktop.** A web/cloud control plane + a thin native helper for filesystem work. Well-understood UX pattern users already accept.

### Why tunnel-only (also locked)

Even within the Agent architecture, transport is **Cloudflare Tunnel only**. Reasons:
- **Offline / shared-WiFi modes carry catastrophic first-impression risk.** Consumer travel routers cap at ~30 concurrent clients. A 150-guest wedding overloads them, 100+ guests see "page won't load," photographer blames Framedrops in WhatsApp groups, launch dies. Tunnel-only puts capacity on Cloudflare's edge — eliminates this entire failure class.
- **Most Indian venues in 2026 have *some* internet.** Venue WiFi at hotels/banquet halls, or photographer's own 4G hotspot. Pure no-internet venues (~20% of events) are not served by v1.
- **Tunnel-only means every event has BE connectivity** — credit validation against BE truth on every event creation. Eliminates the offline credit-tampering problem entirely.

**Tradeoff accepted:** customers needing pure-offline operation are not served by v1. Marketing must be explicit: *"requires internet on your laptop."* If demand exists later, add offline mode as a separate paid tier with explicit capacity warnings — never as default.

---

## 4. Architecture: Agent + Web App + Tunnel

Three components, three roles:

```
┌─────────────────────────────────┐        ┌──────────────────────────────┐
│  PHOTOGRAPHER'S BROWSER         │        │  GUEST'S PHONE BROWSER       │
│  framedrops.in (web app)        │        │  event-xyz.framedrops.live   │
│  • Dashboard, billing, settings │        │  • Mobile gallery            │
│  • "Live Event" controls        │        │  • Favorites, downloads      │
│  • Live stats (guests, photos)  │        │                              │
└─────────────────────────────────┘        └──────────────────────────────┘
            │                                              ▲
            │ fetch('https://localhost:8765')              │ HTTPS
            ▼                                              │
┌─────────────────────────────────────────────────────────┴────────────────┐
│  FRAMEDROPS AGENT (on photographer's laptop, ~30 MB)                     │
│  ┌─────────────────────────────────────────────────────────────────────┐ │
│  │ Local HTTPS server (port 8765)                                      │ │
│  │  • /api/events/start, /api/folder/pick, /api/stats                  │ │
│  │  • Photo serving: /photo/:id/{thumb,preview,download}               │ │
│  └─────────────────────────────────────────────────────────────────────┘ │
│  ┌─────────────────────────────────────────────────────────────────────┐ │
│  │ Worker pool                                                         │ │
│  │  • chokidar (folder watching)                                       │ │
│  │  • sharp (3-size compression)                                       │ │
│  │  • better-sqlite3 (local state)                                     │ │
│  │  • cloudflared (child process — outbound tunnel to public URL)     │ │
│  └─────────────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────────┘
            │
            │ outbound HTTPS (single connection)
            ▼
┌──────────────────────────────────────────────────────────────────────────┐
│  CLOUDFLARE EDGE                                                         │
│  • Receives requests at event-xyz.framedrops.live                        │
│  • Forwards through the photographer's outbound tunnel to the Agent      │
│  • TLS terminated here — guests see valid HTTPS lock                     │
└──────────────────────────────────────────────────────────────────────────┘
            ▲
            │ HTTPS from any network (4G or venue WiFi)
            │
       (guests, anywhere with internet)
```

### How the pieces talk

| From → To | Protocol | What's sent |
|---|---|---|
| Browser (web app) → Agent | `fetch('https://localhost:8765/api/...')` | Control commands (start event, pick folder, stop event), stats polling |
| Guest phone → Cloudflare edge | HTTPS to `event-xyz.framedrops.live` | Standard web requests for gallery |
| Cloudflare edge → Agent | Through the cloudflared tunnel (outbound long-lived connection) | Forwarded guest requests |
| Agent → Framedrops BE | HTTPS to `api.framedrops.in` | Credit consumption, license validation, analytics events |
| Web app → Framedrops BE | HTTPS to `api.framedrops.in` | Existing flows (billing, account, etc.) |

### Why localhost:8765 needs HTTPS (not HTTP)

The Framedrops web app is served over HTTPS (`framedrops.in`). When an HTTPS page tries to fetch from `http://localhost`, browsers block it as **mixed content**. Solutions:

1. **Agent serves HTTPS on localhost** using a self-signed cert (Agent generates on first run, installs to the OS trust store). Cleanest. Used by Spotify, Plex, Discord.
2. Use the **private network access exception** Chrome 94+ provides for localhost. Works today but is being tightened — Google may require explicit user permission in future versions.
3. **Both** — try HTTPS first, fall back to private-network HTTP. Belt-and-suspenders.

**Decision:** Agent generates a self-signed cert on first install and serves `https://127.0.0.1:8765`. Adds ~3 days to install flow but eliminates browser headaches across Chrome/Safari/Firefox/Edge.

### How tunneling works (the data path)

- On event start, Agent spawns `cloudflared tunnel run --url http://localhost:8765 framedrops-event-<id>`
- cloudflared establishes a long-lived outbound HTTPS connection to Cloudflare's edge
- Cloudflare assigns a URL (named tunnel like `event-xyz.framedrops.live` once you own a domain, or quick-tunnel like `random-words-1234.trycloudflare.com` for MVP)
- Web app retrieves the URL via `https://localhost:8765/api/event/url` and displays the QR code
- Guest scans → DNS resolves to Cloudflare edge → request forwarded through the tunnel → Agent serves
- TLS terminated at Cloudflare — guests always see a valid HTTPS lock icon

### Capacity

- **Tunnel layer:** effectively unlimited. Cloudflare's edge handles millions of req/s globally.
- **Agent layer (photographer's laptop):** realistic cap ~500 concurrent guests serving 80 KB thumbnails. CPU/disk become the limit beyond that. No Indian wedding has 500 simultaneous active viewers anyway.
- **No DHCP/router constraints** — guests are on their own networks.

### Latency

- Thumbnail loads in 200–500 ms from venue → Cloudflare → laptop → guest's phone
- Imperceptible for browsing
- Camera-to-guest end-to-end (shutter click → SD card write → chokidar detect → sharp compress → SQLite insert → guest gallery refresh): 30–90 seconds typical

### Internet requirements

| Where | What's needed | Without it |
|---|---|---|
| Photographer's laptop | Stable internet (venue WiFi, 4G hotspot, hardwired) | Event start fails: "Internet required to host event." |
| Guest's phone | Internet (their own 4G or venue WiFi guest network) | Can't view gallery — same as any website |

**Practical fallbacks for the photographer:**
- Hotels / good venues → venue WiFi
- Banquet halls → 50/50 — bring hotspot
- Outdoor / village weddings → 4G hotspot tethered to laptop (USB cable > WiFi tether for stability)
- Web app shows connection quality monitor — warns if upload < 5 Mbps

### Connection-loss handling

Tunnel can drop for many reasons (laptop sleeps, WiFi switches, cloudflared crashes). The Agent must:
- Auto-reconnect via cloudflared's built-in retry logic
- Web app dashboard shows "Reconnecting… (last seen 12s ago)" banner
- Photos processed during the outage are served once tunnel returns — guests see them on next gallery refresh
- After 5 min disconnected, web app prompts: *"Internet lost. Switch to phone hotspot? [How to do it]"*

---

## 5. Image pipeline (the load-bearing technical decision)

Generate **three sizes** per photo. Serve the right one based on guest action.

| Variant | Spec | When served | Why this size |
|---|---|---|---|
| **Thumb** | 400px wide, JPEG q75, ~80 KB | Grid scroll (many shown at once) | Fast lazy-load, looks fine at thumbnail size |
| **Preview** | 1600px wide, JPEG q85, ~300–800 KB | Default full-screen view when guest taps a photo | Looks rich and sharp on any phone screen |
| **Download** | 2048px wide, JPEG q90, ~2 MB | Guest taps "Download" / "Save" button | Premium share-quality without giving away print-quality |

### URL pattern (Express)
```
/photo/:photoId/thumb        → 80 KB
/photo/:photoId/preview      → 300–800 KB (default full-screen)
/photo/:photoId/download     → 2 MB (only fetched when guest hits download)
```

### Why three sizes, not one

- Grid view loads dozens of photos at once → must be small (80 KB)
- Full-screen view needs to look "rich and sharp" → 500 KB is the sweet spot for phone screens
- Download needs to feel premium without giving away the photographer's delivery upsell → 2 MB looks great on phones / social, looks pixelated at print sizes (correct: live previews aren't print files)

### Originals
Never served. Stay on the photographer's hard drive. The "Transfer Selected" flow in main Framedrops handles original delivery via local folder-to-folder copy.

### Storage layout on the photographer's disk
```
~/FramedropsLive/events/<event-id>/
  originals/      (untouched copies for backup; NEVER served)
  thumbs/         (~80 KB each)
  previews/       (~500 KB each)
  downloads/      (~2 MB each)
```

For a typical 400-photo wedding: ~5 GB total disk per event (4 GB originals + 1 GB derived).

### Compression timing
Using `sharp` (libvips), 3 sizes per photo:
- 2020 MacBook Air M1: ~350 ms per photo, parallelized
- 400-photo dump processes in ~30 seconds
- 2018 i5 Windows laptop: ~90 seconds for the same dump

**Acceptable.** Photographer drops SD card → within 1–2 minutes the gallery is fully populated.

---

## 6. Tech stack

### Framedrops Agent (the new piece — lives on photographer's laptop)

| Layer | Tech | Why |
|---|---|---|
| Runtime | Node.js 20 LTS | Bundled into the Agent binary — photographer doesn't install Node separately |
| HTTP server | `express` | Boring + reliable; matches BE |
| Local TLS | Self-signed cert via `node-forge` or built-in `crypto` | Lets the HTTPS web app call `https://localhost:8765` without mixed-content errors |
| Local DB | `better-sqlite3` | Synchronous, fast, zero-config |
| Photo compression | `sharp` | Industry standard, fastest Node image lib |
| Folder watching | `chokidar` | Best-in-class FS watcher |
| QR generation | `qrcode` | Trivial, well-maintained |
| Tunnel client | `cloudflared` (bundled binary, ~50 MB downloaded on first run, not in installer) | Cloudflare's official tunnel daemon |
| Background process management | OS-native (LaunchAgent on Mac, Windows Service on Win) | Auto-start on boot, restart on crash |
| Packaging | `pkg` or `nexe` (Node → single binary) + `electron-builder`-style installers (NSIS for Win, pkg/dmg for Mac) | Small installer (~30 MB without cloudflared), no Electron overhead |
| Auto-update | `node-update-runtime` or custom Express endpoint on Framedrops BE | Silent updates while photographer isn't running an event |
| License signing (server) | Node `crypto` (RSA-SHA256) | Built-in, no deps |

### Framedrops Web App additions (in existing `framedrops/` Vue codebase)

| Surface | What gets built |
|---|---|
| New route: `/dashboard/live` | "Live Event" landing page. Shows agent-installed/not-installed state, recent events, credits, "Start Event" CTA. |
| New route: `/dashboard/live/:eventId` | Active event dashboard — QR display, live stats, photo count, end-event button. Iframes or embeds the local gallery preview from `https://localhost:8765/preview` |
| New Pinia store: `useLiveAgentStore` | Detects agent presence via `fetch('https://localhost:8765/api/health')`, polls stats, sends control commands |
| New install-prompt view | When agent not detected, shows download link + install instructions per OS |
| Reuse: billing, auth, settings, design system, i18n | Zero additional UI work |
| Service Worker for offline dashboard cache (v2) | Lets dashboard load even when laptop internet is briefly down |

### Guest Gallery (mobile web app served by Agent)

| Layer | Tech | Why |
|---|---|---|
| Frontend | Vue 3 + Vite + TypeScript | Matches main Framedrops; can reuse `gallery/` components |
| Bundle | Pre-built into the Agent binary, served from `/` | Guest doesn't install anything |
| Real-time updates | Long-poll every 5s (`/api/photos?since=<ts>`) | Simpler than WebSockets, sufficient for this scale |
| Touch gestures | `@vueuse/gesture` or native pointer events | Pinch-zoom, swipe-between-photos |

**Notable absences:**
- **No Electron.** The Agent is pure Node — no Chromium runtime, no main/renderer split. Smaller install, faster startup.
- No mDNS / `framedrops.local` — fragile on Android, tunnel gives us a clean HTTPS URL anyway
- No WebSockets — long-polling is fine
- No Redis — SQLite handles all state
- No ORM — raw SQL, matches BE convention

---

## 7. SQLite schema (local, on photographer's laptop)

```sql
-- License + credits (signed payload imported from .fdl file)
CREATE TABLE license (
  license_id          TEXT PRIMARY KEY,
  photographer_email  TEXT NOT NULL,
  credits_total       INTEGER NOT NULL,
  credits_used        INTEGER NOT NULL DEFAULT 0,
  issued_at           TEXT NOT NULL,
  expires_at          TEXT NOT NULL,
  signature           TEXT NOT NULL,         -- RSA signature of all fields above
  last_validated_at   TEXT,                  -- when we last phoned home to validate
  imported_at         TEXT NOT NULL DEFAULT (datetime('now'))
);

-- One row per event the photographer creates
CREATE TABLE events (
  id              TEXT PRIMARY KEY,          -- UUID
  name            TEXT NOT NULL,             -- e.g. "Rohit & Priya Wedding"
  watch_folder    TEXT NOT NULL,             -- absolute path the photographer picked
  tunnel_url      TEXT,                      -- e.g. https://event-xyz.framedrops.live
  status          TEXT NOT NULL DEFAULT 'active',  -- active | paused | ended
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  ended_at        TEXT,
  credit_consumed INTEGER NOT NULL DEFAULT 1
);

-- Every photo discovered by chokidar
CREATE TABLE photos (
  id                TEXT PRIMARY KEY,        -- UUID
  event_id          TEXT NOT NULL REFERENCES events(id),
  original_path     TEXT NOT NULL,
  original_filename TEXT NOT NULL,
  thumb_path        TEXT,                    -- null until thumb generated
  preview_path      TEXT,
  download_path     TEXT,
  width             INTEGER,
  height            INTEGER,
  bytes             INTEGER,
  taken_at          TEXT,                    -- from EXIF, fall back to mtime
  processed_at      TEXT,                    -- null while still processing
  created_at        TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_photos_event ON photos(event_id, created_at DESC);

-- Guest favorites (per-device, not per-account; we don't make guests sign in)
CREATE TABLE favorites (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  photo_id    TEXT NOT NULL REFERENCES photos(id),
  device_id   TEXT NOT NULL,                 -- cookie or localStorage UUID
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(photo_id, device_id)
);
CREATE INDEX idx_favorites_photo ON favorites(photo_id);

-- Simple audit log (for the photographer's "what happened during the event" view)
CREATE TABLE event_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id    TEXT NOT NULL,
  type        TEXT NOT NULL,                 -- guest_joined | photo_viewed | photo_downloaded | favorited
  metadata    TEXT,                          -- JSON blob
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
```

---

## 8. License + credit system

### What gets generated (server-side, on Framedrops BE)

When the photographer buys a credit pack on the main Framedrops website, the BE generates a `.fdl` file:

```
license.fdl  (signed JSON payload)

{
  "licenseId": "lic_8a3f2c91d4...",
  "photographerEmail": "prasanth@example.com",
  "creditsTotal": 5,
  "issuedAt": "2026-05-30T10:00:00Z",
  "expiresAt": "2027-05-30T10:00:00Z",
  "signature": "<base64 RSA-SHA256 signature of the canonical JSON above>"
}
```

The BE signs with a **private RSA key** (kept server-side, never shipped). The desktop app ships a hardcoded **public key** to verify.

### What gets verified (client-side, in the desktop app)

On license import:
1. Parse the JSON
2. Verify the signature against the bundled public key
3. Check `expiresAt > now`
4. Store in local SQLite

On every internet-available boot:
1. POST `licenseId` to `framedrops.in/api/license/validate`
2. BE returns: `{ valid: true, creditsRemaining: 3, status: 'active' }`
3. App updates local SQLite to match BE truth
4. **If local credits ≠ BE credits, BE wins** (catches tampering)

On fully-offline boot:
1. Trust the local SQLite copy
2. Display a "last validated X days ago" warning if > 30 days

### The honest security limitation

A photographer who:
1. Backs up `license.fdl` immediately after import
2. Creates 5 events offline (uses all credits)
3. Deletes the app's SQLite file
4. Re-imports the original `.fdl` to "refill" credits

…will get free credits. **This works because offline RSA signing can prove "Framedrops issued this file" but cannot prove "credits haven't been consumed yet."**

**Mitigations:**
- BE tracks credits consumed per `licenseId` server-side. Any online check-in reconciles and demands re-purchase of "phantom" credits.
- App refuses to create events if `last_validated_at` is more than 30 days ago — forces an online check-in monthly.
- Hardware-bind license to first machine ID seen — second machine using the same `.fdl` triggers a soft block requiring a "transfer license" web flow.

**Honest framing:** this is good-enough DRM for 95% of users. Determined attackers will defeat it. Don't over-engineer — phone-home + machine-binding + UX friction is enough deterrence at this stage.

---

## 9. Agent API surface (two distinct APIs on the same Express server)

The Agent runs ONE Express server on `https://127.0.0.1:8765` that serves two unrelated audiences:

1. **Guest gallery** — guests hit it through Cloudflare's tunnel, paths under `/g/*`
2. **Web app control plane** — Framedrops dashboard (`framedrops.in`) hits it directly via `fetch('https://localhost:8765/api/agent/*')`

Both are isolated by URL prefix, CORS rules, and auth tokens.

### 9A. Guest gallery API (served through tunnel)

Paths the tunnel exposes. Cloudflare routes `https://event-xyz.framedrops.live/*` → `https://127.0.0.1:8765/g/*`.

```
GET  /g/                                  → guest gallery HTML (Vue SPA)
GET  /g/assets/*                          → SPA bundle (JS, CSS, fonts)

GET  /g/api/event                         → { id, name, photoCount, startedAt }
GET  /g/api/photos?since=<ts>&limit=50    → paginated + long-poll for new photos
GET  /g/photo/:id/thumb                   → 80 KB JPEG
GET  /g/photo/:id/preview                 → ~500 KB JPEG (default full-screen)
GET  /g/photo/:id/download                → 2 MB JPEG, Content-Disposition: attachment
POST /g/api/favorite                      → { photoId } → toggles favorite for this device cookie
GET  /g/api/favorites                     → array of photoIds this device has favorited

GET  /g/healthz                           → "ok" — used by tunnel health checks
```

**Notes:**
- **No guest auth.** Device identity is a UUID cookie set on first visit. Favorites scoped to that cookie.
- No write operations from guests beyond favorites.
- Rate limited per device-cookie (trivial in-memory limiter).
- Pagination: cursor-based on `photos.created_at DESC`. Default 50/page.
- Long-polling: `?since=<ts>` blocks up to 25s waiting for new photos. Guest gallery polls every 5–25s.

### 9B. Web-app control plane API (served directly to localhost)

Paths Framedrops dashboard hits via `fetch('https://localhost:8765/api/agent/*')`. Cloudflare tunnel does NOT forward these — they're only reachable from the local browser.

```
GET  /api/agent/health                    → { version, status, eventActive: bool }
POST /api/agent/event/start               → { name, watchFolder } → { eventId, tunnelUrl, qrPng }
POST /api/agent/event/stop                → ends current event, kills tunnel
GET  /api/agent/event/stats               → { photosProcessed, guestsConnected, favorites, uploadMbps }
POST /api/agent/folder/pick               → opens native file picker, returns selected path
GET  /api/agent/license                   → { creditsRemaining, expiresAt, validatedAt }
POST /api/agent/license/import            → { fdlContent } → validates & stores
GET  /api/agent/connection                → { isOnline, uploadMbps, lastTunnelHeartbeat }

POST /api/agent/preview                   → returns one-time URL like /g/preview/<token> so
                                            the dashboard can iframe the live gallery without
                                            authenticating as a guest
```

### Securing the control plane

Critical: a malicious site (`evil.com`) loaded in another tab MUST NOT be able to call `https://localhost:8765/api/agent/*` and start consuming credits. Two layers:

1. **CORS allowlist:** `Access-Control-Allow-Origin` only accepts `https://framedrops.in` and `http://localhost:5173` (dev). All other origins blocked.
2. **Bearer token:** On first install, Agent generates a random 256-bit token, stores it locally, and exposes it via a deep-linked custom URL scheme (`framedrops-agent://pair?token=<random>`). The Framedrops web app reads this token from a paired-token API and includes it as `Authorization: Bearer <token>` on every `/api/agent/*` call. **Without the token, the agent returns 401.**

This is the same pattern used by Plex, Spotify, GitHub Desktop for browser ↔ local-helper authentication.

### Pairing flow (one-time, on first install)

```
1. User downloads + installs Agent
2. Agent first-run wizard: "Open Framedrops in your browser to pair"
3. Agent opens default browser → https://framedrops.in/dashboard/live?pair=<random_token>
4. Web app captures the token, sends to BE (stored against user account)
5. Web app then calls https://localhost:8765/api/agent/pair with the token
6. Agent stores the token, returns success
7. From now on, all /api/agent/* calls include Authorization: Bearer <token>
```

If pairing breaks (token mismatch, agent reinstalled): web app shows a "re-pair" button that runs the flow again.

---

## 10. UI surfaces

Three distinct UIs in this product:
- **A.** Framedrops web-app dashboard (the photographer's main control surface — new pages in the existing Vue app)
- **B.** Agent first-run installer wizard (native OS dialogs + pairing)
- **C.** Guest mobile gallery (served by Agent through tunnel)

### A. Web-app dashboard (new routes in `framedrops/`)

#### A1 — `/dashboard/live` — Live Event hub

```
┌─────────────────────────────────────────────────────┐
│  Framedrops > Live Event                            │
│                                                      │
│  Status:   ✓ Agent connected (v1.2.0)               │
│            Credits: 4 events remaining               │
│                                                      │
│  ┌────────────────────────────────────┐             │
│  │  + Start New Event                 │             │
│  └────────────────────────────────────┘             │
│                                                      │
│  Recent events                                       │
│  • Rohit & Priya Wedding — 2 days ago — 247 photos │
│  • Patel Engagement — last week — 89 photos         │
│  • Test Event — 1 month ago — 12 photos             │
│                                                      │
│  Buy more credits  →                                 │
└─────────────────────────────────────────────────────┘
```

When Agent NOT detected:

```
┌─────────────────────────────────────────────────────┐
│  Framedrops > Live Event                            │
│                                                      │
│  ⚠ Framedrops Agent not detected                    │
│                                                      │
│  To run live events you need to install the         │
│  Framedrops Agent on this laptop. Takes 2 minutes.  │
│                                                      │
│  [ Download for Mac ]  [ Download for Windows ]     │
│                                                      │
│  Already installed? [ Re-pair Agent ]               │
└─────────────────────────────────────────────────────┘
```

#### A2 — Event creation modal

```
┌─────────────────────────────────────────────────────┐
│  Start Live Event                                    │
│                                                      │
│  Event name                                          │
│  ┌─────────────────────────────────────────┐        │
│  │ Rohit & Priya Wedding                    │        │
│  └─────────────────────────────────────────┘        │
│                                                      │
│  Watch folder on your laptop                         │
│  ┌─────────────────────────────────────────┐        │
│  │ /Volumes/SDCARD/DCIM/100CANON  [Pick…]  │        │
│  └─────────────────────────────────────────┘        │
│  ↑ Web app calls /api/agent/folder/pick which       │
│    opens the native OS file picker on the laptop    │
│                                                      │
│  Connection check                                    │
│  ✓ Agent online                                      │
│  ✓ Internet (12 Mbps up)                            │
│  ✓ Tunnel ready                                      │
│                                                      │
│  This will use 1 of 4 event credits.                │
│                                                      │
│  [ Cancel ]              [ Start Event → ]          │
└─────────────────────────────────────────────────────┘
```

#### A3 — Active event dashboard (the page photographer keeps open during the wedding)

```
┌──────────────────────────────────────────────────────────┐
│  Rohit & Priya Wedding  •  Live for 2h 14m              │
│  ─────────────────────────────────────────────────────── │
│                                                           │
│  ┌──────────────┐   ┌────────────────────────────────┐  │
│  │              │   │ Scan to view photos             │  │
│  │   ▓▓▓▓▓▓▓   │   │                                 │  │
│  │   ▓ QR  ▓   │   │ event-rohit-priya-2026          │  │
│  │   ▓▓▓▓▓▓▓   │   │ .framedrops.live                │  │
│  │              │   │                                 │  │
│  └──────────────┘   │ Tunnel: ✓ Healthy               │  │
│  [Full-screen QR]   │ Guests viewing now: 47           │  │
│                     └────────────────────────────────┘  │
│                                                           │
│  📷 Photos: 247    ❤ Favorites: 18    👁 Views: 1,243   │
│                                                           │
│  Live preview (what guests see)                          │
│  ┌────────────────────────────────────────────────────┐ │
│  │  [iframe of https://localhost:8765/g/preview]      │ │
│  │                                                     │ │
│  │  [grid of thumbnails, scrolling live as new        │ │
│  │   photos come in]                                   │ │
│  └────────────────────────────────────────────────────┘ │
│                                                           │
│  [⏸ Pause photo intake]    [⏹ End event]               │
└──────────────────────────────────────────────────────────┘
```

The Full-screen QR button opens a new browser tab with just the QR (so the photographer can drag it to a second monitor / projector).

### B. Agent installer + pairing wizard

Native OS dialogs only — no Electron windows. The Agent has no real UI of its own. Lives in the menu bar / system tray:

```
Mac menu bar:    🎞 Framedrops Agent  (click → dropdown)
                  ├── Status: Connected ✓
                  ├── Event: Rohit & Priya — Live
                  ├── Open Dashboard in Browser
                  ├── ─────────────
                  ├── About
                  └── Quit
```

First-run flow:
1. User downloads + opens installer → standard OS installer dialogs
2. Installer prompts: *"Allow Framedrops Agent to run in the background?"* (LaunchAgent on Mac, Service on Win)
3. Agent starts, opens default browser to `https://framedrops.in/dashboard/live?pair=<token>`
4. Web app receives token, calls `/api/agent/pair`, marks as paired
5. Web app shows: *"✓ Agent connected! Ready to start your first event."*

### C. Guest mobile gallery

Served by Agent at `https://event-xyz.framedrops.live/g/`. Mobile-first Vue SPA. Three views:

**Grid view (landing)**
- Masonry layout of 80 KB thumbs
- Lazy-load via IntersectionObserver
- Infinite scroll, 50/page
- Top bar: event name, ❤ favorites count, "📷 +12 new" badge when polling finds new photos
- Tap any photo → full-screen view

**Full-screen view**
- 500 KB preview, fits to screen
- Swipe left/right between photos
- Pinch to zoom (within the 500 KB — no extra fetch)
- Bottom bar: ❤ favorite, ⬇ Download HD (fetches 2 MB), ✕ close

**Favorites view**
- All photos this device has ❤'d
- Same grid layout
- Persists via localStorage UUID (no login)

---

## 11. Folder watching (the hardest piece)

Naive `chokidar.watch(folder)` will explode in real-world use. Memory cards trigger **50–500 file events** during a copy. Files appear in the filesystem **before they're fully written**. Cards get unplugged mid-copy. Photographers point the watch folder at a directory and then accidentally drag a movie file in.

### Required handling

```javascript
// Pseudo-code — this needs ~3 days of careful engineering, not 30 minutes

const watcher = chokidar.watch(folder, {
  ignored: /(^|[/\\])\../,           // dotfiles
  persistent: true,
  ignoreInitial: false,
  awaitWriteFinish: {                // critical: wait until file is fully written
    stabilityThreshold: 2000,        // file size hasn't changed for 2s
    pollInterval: 100,
  },
  alwaysStat: true,
})

watcher.on('add', async (path, stats) => {
  // 1. Validate it's an image we can handle
  if (!/\.(jpe?g|png|heic)$/i.test(path)) return
  if (stats.size > 50_000_000) return  // > 50 MB = probably a video, skip

  // 2. Debounce — coalesce burst arrivals (200 photos = 200 'add' events in <1s)
  enqueueForProcessing(path, stats)
})

// Separate processing queue with concurrency cap
const queue = new PQueue({ concurrency: os.cpus().length - 1 })

async function processPhoto(path) {
  try {
    // 1. Read EXIF (taken date, orientation, dimensions)
    const meta = await sharp(path).metadata()

    // 2. Generate three sizes in parallel
    await Promise.all([
      generateThumb(path),
      generatePreview(path),
      generateDownload(path),
    ])

    // 3. Insert SQLite row with processed_at = now
    db.prepare('INSERT INTO photos (...) VALUES (...)').run(...)

    // 4. Notify any long-polling guest connections (in-memory pub/sub)
    emit('photo-added', photoId)
  } catch (err) {
    // Common: HEIC files, corrupted JPEGs, files copied half-way then aborted
    // Log to event_log with type='process_failed', skip silently
  }
}
```

### Real-world failure modes to handle

- **HEIC files from iPhones:** sharp needs `libheif` plug-in. Bundle or accept HEIC isn't supported.
- **Files appearing but being renamed seconds later** (camera writes `.IMG_4521.tmp` then renames to `.JPG`): `awaitWriteFinish` handles this.
- **Memory card unplugged mid-copy:** files vanish from disk between event and processing. Catch `ENOENT`, log, move on.
- **Photographer points at a network drive** (slow NAS): I/O times explode. Detect and warn during folder picker.
- **Photo modified after first processing** (Lightroom export overwrites a file): chokidar fires `change`, re-process or skip per user preference.

---

## 12. Build pipeline / packaging

Two artifacts to ship per release:

```bash
# 1. Agent installer (the actual downloadable file)
pkg src/agent.js --targets node20-macos-x64,node20-macos-arm64,node20-win-x64
# wrap each with an OS-native installer:
#   Mac: pkgbuild → FramedropsAgent-1.0.0.pkg + DMG
#   Windows: NSIS → FramedropsAgent-Setup-1.0.0.exe

# 2. Guest gallery bundle (Vue SPA, baked into the Agent binary at build time)
cd guest-gallery && vite build
cp -r dist/ ../src/agent/public/
# Agent serves these static files from /g/*
```

### Code signing (stage-gated — NOT required from day one)

The right answer depends on how many strangers are downloading the app. Build cheap first, add signing as paid sales justify it.

| Stage | Customer count | Signing strategy | Cost |
|---|---|---|---|
| **Pilot (§15 wizard-of-oz + first 5 paid)** | < 5 strangers | **Unsigned.** Hand-hold each install over WhatsApp. Send a 30-sec video showing how to bypass Gatekeeper / SmartScreen. | ₹0 |
| **Early launch (5–20 customers)** | 5–20 | **Mac signing only** (Apple Developer ID). Mac users handle right-click→Open well. Document Windows SmartScreen as a known one-time click-through. | ~₹8,000/year |
| **Sustained sales (20+ customers/quarter)** | 20+ | **Mac + Windows EV signing.** EV cert gives instant SmartScreen reputation — zero warnings from day one. Pays for itself at ~8 sales. | ~₹23,000/year combined |

### What "unsigned" actually looks like for users

**Mac (first install):**
1. User double-clicks `.dmg` → opens → drags app to Applications
2. Launches app → macOS shows: *"FramedropsLive cannot be opened because the developer cannot be verified"*
3. User right-clicks app → Open → Open Anyway → enters Mac password
4. App opens. Future launches work normally with no warning.

**Windows (first install):**
1. User downloads `.exe` → Chrome may warn "not commonly downloaded"
2. Run it → SmartScreen blue screen: *"Windows protected your PC"*
3. User clicks "More info" → "Run anyway"
4. Installer runs. Some antivirus (Norton, Quick Heal) may still quarantine — needs whitelisting

**The honest cost of skipping signing:** ~15 min of support per Mac user, ~25 min per Windows user, on first install only. At ₹500/hr value-of-time that's ~₹200 per customer in support. Worth it until you're past 50 customers.

### When to commit to signing

- **Get Mac signing** when: you're listing on a public download page (no longer hand-holding), OR you've fielded 5+ "is this safe?" support tickets in a month.
- **Get Windows EV signing** when: you have sustained Windows sales (~10+ paying Windows customers active), OR a Windows antivirus has globally flagged a release.
- **Apple Developer Program** has a 1–2 week onboarding (verification, D-U-N-S number for company accounts). **DigiCert EV cert** for Windows has a 1-week hardware-token delivery. Plan ahead.

### Why your previous Electron app "just worked"

If you shipped an Electron app before without signing and never hit issues, it's because:
1. You ran it on **your own machine** (macOS trusts apps you built locally)
2. You shared it with **people who knew you** (they pushed past the Gatekeeper warning without questioning it)
3. It was **free** (people are forgiving of warnings on free software)

The moment a stranger pays ₹1,999 and sees "developer cannot be verified," they assume scam. Different psychology entirely.

### Bundled binaries

- `sharp` native (per-OS-per-arch) → bundled into the pkg/nexe output
- `better-sqlite3` native → bundled
- `cloudflared` → **NOT bundled** in installer. Agent downloads on first run from Cloudflare's CDN (saves ~50 MB in download size). Cached locally; reused across events.

**Final installer size: ~30 MB** (Node + sharp + sqlite, no Chromium overhead). Compare to a full Electron app at ~150 MB.

### Auto-update

Agent polls Framedrops BE for available updates on a background timer (every 6 hours when idle). When a new version is available, downloads in background, applies on next Agent restart (or immediately if no event is active). Photographers without internet won't update — fine, the version they have keeps working.

The **web app** updates on every page load (standard Vue/Vite hot deploy). Decouples the two release cadences — you can ship dashboard tweaks daily without touching the Agent.

---

## 13. Pricing (locked from analysis 2026-05-30)

| Pack | Price | Per-event | Notes |
|---|---|---|---|
| Test event | **₹99** | ₹99 | 10 photos cap, 1 hour, for trial |
| Single event | **₹499** | ₹499 | First real purchase |
| 5-event pack | **₹1,999** | ₹400 | Honeymoon photographer (1 wedding/mo) |
| 20-event pack | **₹5,999** | ₹300 | Full-time pro (2+ weddings/mo) |

- Credits valid **12 months** from purchase
- Razorpay checkout
- Unit economics: ~₹65 cost per event (₹5 Cloudflare + ₹60 amortized support). 84%+ gross margin at all tiers.
- **Do not undercut to ₹149** — covered in length in the 2026-05-30 analysis. Below ₹200 you lose money after support load.

---

## 14. MVP scope (what to build first, in order)

**Total: 2–3 weeks for a working MVP.** Build in sequence. Don't skip ahead.

### Phase 1 — Agent core (week 1)
- [ ] Node project scaffold, pkg/nexe build pipeline (Mac + Win targets)
- [ ] SQLite schema migration runner
- [ ] Express server on `https://127.0.0.1:8765` with self-signed cert
- [ ] CORS allowlist + bearer-token auth for `/api/agent/*` routes
- [ ] License import + RSA verification (test license generator on Framedrops BE)
- [ ] OS service install (LaunchAgent / Windows Service) so Agent auto-starts on boot
- [ ] Menu-bar / system-tray UI for Agent status

### Phase 2 — Image pipeline (week 1–2, overlaps with Phase 1)
- [ ] chokidar folder watching with all failure modes (see §11)
- [ ] sharp 3-size compression queue (thumb / preview / download)
- [ ] SQLite photo row insert
- [ ] Express routes for `/g/photo/:id/{thumb,preview,download}`

### Phase 3 — Tunnel + pairing (week 2)
- [ ] Download + spawn `cloudflared` as child process
- [ ] Quick-tunnel URL retrieval (skip named tunnels until v2)
- [ ] Pairing flow: Agent first-run opens browser → web app captures token → POST back to Agent
- [ ] Reconnect handling + connection-quality monitor

### Phase 4 — Framedrops web-app additions (week 2)
- [ ] New routes: `/dashboard/live`, `/dashboard/live/:eventId`
- [ ] `useLiveAgentStore` — health-check polling, control commands, stats polling
- [ ] Install-prompt UI when agent not detected
- [ ] Event creation modal that calls `/api/agent/folder/pick` + `/api/agent/event/start`
- [ ] Active event dashboard (QR display, live stats, iframe preview of guest gallery)
- [ ] Razorpay checkout for live credits (reuse existing billing flow — new pack SKUs only)

### Phase 5 — Guest mobile gallery (week 3)
- [ ] Vue SPA bundled into Agent: grid view, full-screen view, favorites
- [ ] Lazy loading + infinite scroll
- [ ] Touch gestures (swipe between photos, pinch zoom)
- [ ] Long-polling for live updates (`/g/api/photos?since=<ts>`)

### Phase 6 — Polish (week 3, parallel)
- [ ] Live stats counters on the dashboard
- [ ] Pause / end event flow
- [ ] License BE phone-home on every event start
- [ ] **Unsigned installers** for pilot — no code signing in MVP (see §12)
- [ ] Smoke-test on real wedding (with a paid pilot customer per §15)

### Cut from MVP — defer to v2 (or never)
- Direct-LAN mode (rejected — first-impression risk)
- Offline-router mode (rejected — capacity caps)
- Search inside gallery
- Categories / albums within an event
- Print QR
- Multi-language gallery (English only v1; add hi/te in v2 reusing main app's i18n)
- Mobile-responsive photographer dashboard (desktop-only for v1 — photographer is at a laptop)
- Windows ARM builds
- Named tunnel subdomains (use Cloudflare quick-tunnels until paid customers justify the $20/mo plan)
- Service Worker dashboard offline cache (add when 1+ photographer reports it as needed)
- Mac/Windows code signing (add per §12 stage gates)

---

## 15. Validation plan (BEFORE writing any code)

This is the non-negotiable gate. If this doesn't pass, do not build.

### Step 1 — Demand validation (2 weeks)

Post in 3+ Indian wedding-photographer Facebook/WhatsApp groups:

> "I'm building a tool that lets wedding guests scan a QR code and see photos *live* during the event — works at any venue, with or without internet. Photographer pays per event (~₹500/event, sold in packs).
>
> Would you pay for this? If yes, would you commit to buying when it launches in 2–3 months? Reply with 'YES' or 'WHY NOT' so I know whether to build it."

**Pass criteria:** ≥10 "YES" responses including pre-launch interest. ≥3 photographers willing to pay for a test run.

If you get "interesting, maybe" or silence → kill the project. The market doesn't want it badly enough to justify 6 months of solo work.

### Step 2 — Wizard-of-Oz test (1 weekend)

Before writing a line of Electron code, fake the entire product manually:

- Use Framedrops main + a Cloudflare quick-tunnel to your laptop
- Pick 2 photographers from Step 1 who said "YES"
- At their next wedding, manually run the flow:
  - Tunnel their laptop to a temporary URL
  - Watch their dump folder with a Node script you write in a day
  - Hand-build a basic gallery view
- Charge them ₹500 each. Real money changing hands is the only signal that matters.

If you can't get two photographers to pay ₹500 for a manually-orchestrated test, the product doesn't have legs. **Better to learn this in a weekend than after 6 months of building.**

### Step 3 — Pre-order (4 weeks)

If steps 1–2 pass, take pre-orders for the 5-event pack at ₹999 (50% discount) for the first 25 customers. Build the app while they wait. Refund anyone who can't wait. This validates the price + funds the build.

---

## 16. What this is NOT, and what to be honest about

- **Not a replacement for the main Framedrops cloud product.** Different use case (live event vs. polished delivery). Same company, different SKU.
- **Not an offline product.** v1 requires internet on the photographer's laptop. If they're shooting a no-signal village wedding with no hotspot signal either, this is not the product for them. Marketing copy must say this on the FIRST screen of the buy flow — not in fine print. Filtering hard at the top of the funnel prevents refund hell.
- **Not infinitely scalable per laptop.** Realistic upper limits: 1,000 photos per event, ~500 concurrent guests. Laptop CPU + outbound bandwidth become the constraint above that.
- **Not free of support burden.** Desktop apps have 2–3× the support tickets of web apps. Add tunnel-disconnect tickets on top. Budget time accordingly.
- **Not a substitute for original-photo delivery.** The "delivery" upsell remains the photographer's main revenue moment. This product is the *moment-during-the-event* sizzle that helps them sell the wedding in the first place.
- **Not blame-shielded against the photographer's bad internet.** If their laptop has flaky WiFi or weak hotspot signal, the gallery will be slow or interrupted. Tunnel-only puts that responsibility on the photographer (they chose the venue, they chose the connection). This is good for you — it shifts blame off the product onto solvable user-side issues.

---

## 17. Key prior decisions (commit log)

- **2026-05-30:** Original "offline-only" spec rejected. Tunnel-first multi-mode architecture committed.
- **2026-05-30:** Image sizes locked: 80 KB / 300–800 KB / 2 MB (thumb/preview/download).
- **2026-05-30:** Pricing locked at ₹499/₹1,999/₹5,999 (not ₹149 from original spec — would have been loss-making).
- **2026-05-30:** Cloudflare Tunnel chosen over alternatives (ngrok, Tailscale Funnel) — Cloudflare's free tier is generous and they have Indian PoPs for low latency.
- **2026-05-30:** Validation gate added — no build before 10 photographers commit + 2 paid pilot weddings.
- **2026-05-30 (revision):** Multi-mode architecture collapsed to **tunnel-only**. Direct-LAN and offline-router modes removed from v1. Reason: first-impression risk at 150+ person weddings on consumer routers would tank the launch via WhatsApp group word-of-mouth. Tunnel-only shifts the failure surface from "Framedrops broke our router" to "photographer's internet was bad" — much better blame attribution. Build effort drops from 6–8 weeks to 4–6 weeks. Trade-off: ~20% of events (genuine no-internet venues) are not served by v1. If offline mode is added in v2, ship it as a separate paid tier with explicit "max 30 guests" warnings — never as default.
- **2026-05-30 (revision):** Code signing **stage-gated** — pilot ships unsigned, Mac signing added at ~5 customers, Windows EV signing only at ~20 customers. Reason: unsigned worked fine for the founder's previous Electron app because all users were friends/self. Selling to strangers at ₹1,999 changes the trust calculus, but only meaningfully past ~5 paying customers. Don't burn ₹23k/year on certs before there's revenue to justify them.
- **2026-05-30 (revision):** Standalone Electron app replaced by **Agent + Web App** architecture. Reasoning: browsers can't be servers (need *some* native code on the laptop), but a full Electron app would duplicate the entire main Framedrops dashboard, billing, auth, settings, i18n, support — wasteful. Agent is a ~30 MB Node binary that does only what the browser can't (watch folder, compress images, host tunnel). Photographer uses main Framedrops web app in their browser to control it. Build effort drops from 4–6 weeks to 2–3 weeks. One brand, one product, smaller install, easier updates. Same architectural pattern as Dropbox / Plex / GitHub Desktop. Trade-off: browsers blocking `http://localhost` from HTTPS pages requires self-signed TLS cert on Agent (handled cleanly, ~3 days of integration). The Agent talks to the web app via authenticated `https://127.0.0.1:8765` with bearer-token auth + CORS allowlist — secure against malicious sites trying to consume credits.

---

## 18. Reading list / dependencies a future builder needs

- `electron-vite` template: https://electron-vite.org/
- Sharp docs: https://sharp.pixelplumbing.com/
- Cloudflare Tunnel guide: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/
- electron-builder code signing: https://www.electron.build/code-signing
- chokidar production gotchas: https://github.com/paulmillr/chokidar#troubleshooting

---

**End of spec.** When you come back to this in 3–6 months, start at section 15 (validation), not section 14 (build). The hardest decision is whether to build it at all, not how.
