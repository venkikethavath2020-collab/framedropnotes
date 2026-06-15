# framedropnotes

Non-code project notes for Framedrops — keeps the code repos
([`framedrops`](https://github.com/...), [`framedropsbe`](https://github.com/...))
focused on code while still having one place for runbooks, launch
checklists, decks, and product docs.

## Layout

```
.
├── launch/                 — pre-launch checklists, future-features backlog
│   ├── RELEASE_CHECKLIST.md
│   └── FUTURE_FEATURES.md
│
├── runbooks/               — operational guides for production incidents
│   ├── SCALING.md          — capacity thresholds, when to upgrade
│   ├── r2-storage-runbook.md — Cloudflare R2 operational guide
│   └── EMAIL_PREVIEW.md    — how to render email templates locally
│
├── product/                — product / feature documentation
│   ├── ADMIN.md            — admin portal capabilities + flows
│   ├── ALBUM_PREVIEW.md    — client flipbook album preview (frontend-only)
│   ├── AGREEMENT_BUILDER.md — contract builder + OTP signing + server PDF
│   └── CAMPAIGN.md         — Photography Day 2027 campaign + leaderboard (awards phase deferred)
│
└── decks/                  — investor / sales presentations
    ├── FrameDrops_Investor_Deck.pptx
    └── FrameDrops_Sales_Deck.pptx
```

## What lives where

| Type | Location | Why |
|---|---|---|
| Application code | `framedrops/`, `framedropsbe/` | Code repos |
| `CLAUDE.md` / `README.md` | Code repos | Load-bearing — read by AI tooling and GitHub |
| `robots.txt`, manifest, etc. | Code repos (`public/`) | Deployed assets |
| Load test scripts + their README | `framedropsbe/load-tests/` | Tightly coupled to scripts |
| Migration `.sql` files | `framedropsbe/src/database/`, `src/migrations/` | Source of truth for schema |
| Everything else (runbooks, plans, design docs) | **This repo** | Non-code project context |

## Cross-references from code

A few code comments in `framedropsbe/` point at the SCALING runbook in
this repo (e.g. `src/admin/services/capacity.service.js`,
`src/admin/routes/capacity.routes.js`). Keep those references in sync
when you rename files here.

## Editing flow

This repo is just markdown + HTML + PPTX. No build, no CI. Push to
`main` and you're done.
