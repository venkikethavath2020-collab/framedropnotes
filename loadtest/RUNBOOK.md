# Framedrops Load Testing — Runbook

> Honest, practical guide to load testing the backend from a single laptop.
> Last updated: 2026-05-21

---

## TL;DR — Run a smoke test in 30 seconds

```bash
cd framedropnotes/loadtest

# Smoke test — safe to run against production any time
BASE_URL=https://api.framedrops.in/v1 k6 run smoke.js

# Or against local backend
BASE_URL=http://localhost:3000/v1 k6 run smoke.js
```

✅ Pass criteria: p95 < 500ms, error rate < 1%, no 5xx responses.

---

## Two scripts, two purposes

### 1. `smoke.js` — sanity check (30 seconds)

- 10 virtual users (VUs) max
- Hits only **public read endpoints** (`/system/status`, `/public/stats`, `/public/testimonials`)
- Safe to run against production
- Tells you: "Is the API reachable and serving normal pages?"

**When to run:** every time you deploy, before launch, after env changes.

### 2. `launch_surge.js` — the real test (7 minutes)

- Ramps to 100 VUs simulating launch-day traffic
- Anonymous landing-page browse pattern (default)
- Optional authenticated dashboard traffic if you provide a `TEST_JWT`
- Tells you: "Will the API survive 100 photographers showing up at once?"

**When to run:** before any major announcement, or after big architecture changes.

---

## ⚠️ Important caveats — read this before running

### Caveat 1 — One laptop ≠ 100 distinct users

When k6 hits the API from your laptop, **every request comes from one IP**. The backend's rate limiters (configured in `framedropsbe/server.js`) think you're a single very-hyperactive user, not 100 separate users.

Active rate limits that will trip you up:

| Limiter | Default | Source |
|---|---|---|
| `apiLimiter` | **500 / 15 min / IP** | server.js:150 |
| `authLimiter` | **15 / 15 min / IP** | server.js:156 |
| `paymentLimiter` | **30 / 15 min / IP** | server.js:162 |
| `signupLimiter` | **5 / hour / IP** | auth.routes.js:76 |

**The launch-surge test only hits public endpoints by default — these are gated by `apiLimiter` (500/15min).** At 100 VUs × ~10 requests/min = 1,000 req/min, you'll hit the limit ~30 seconds in unless you raise it for the test.

### Caveat 2 — You cannot truly load-test the signup flow from a laptop

`POST /v1/auth/signup` is hard-capped at 5/hour per IP. This is deliberate (anti-fraud). To test signup at scale, you need either:
- Distributed runners from different IPs (k6 Cloud, Grafana k6 Cloud)
- A bypass token your backend honors only in test mode
- Manual testing with real devices

### Caveat 3 — Your laptop is also a bottleneck

A MacBook can comfortably push ~500-1000 req/sec from k6. Anything higher and you're measuring your laptop's network stack, not the backend.

---

## Pre-flight checklist (do these before running launch_surge.js)

### 1. Pick a target environment

| Environment | When to use | Risk |
|---|---|---|
| Local backend (`localhost:3000`) | Finding code bottlenecks, testing changes | None |
| Staging (if you have one) | Realistic dress rehearsal | None |
| Production | True confidence check | **Real traffic charges (R2 ops, DB pool, Brevo emails)** |

### 2. Bump rate limits for the test window

The easiest way: add temporary env vars to the backend before testing.

```bash
# In framedropsbe/.env (or your deployment env vars):
RATE_LIMIT_API_MAX=100000
RATE_LIMIT_AUTH_MAX=10000
RATE_LIMIT_PAYMENT_MAX=10000
# Restart backend
```

**REMEMBER TO REVERT AFTER THE TEST.** Tip: write a calendar reminder. I have seen people forget for weeks.

Alternative — set `RATE_LIMIT_ENABLED=false` to disable all limiters at once.

### 3. Decide if you want authed traffic in the test

If you want to test logged-in dashboard load (which is the real launch concern), you need a JWT. The quickest way:

```bash
# Manually log in once via curl
curl -X POST https://api.framedrops.in/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"test@framedrops.in","password":"yourpass"}'

# Grab the token from the response, then export:
export TEST_JWT=<the_token>
```

The token is good for hours. Use a dedicated test account, not your real one.

### 4. Warn yourself: real R2 / DB / email costs

Even in read-only test mode:
- 100 VUs × 10 min × ~10 req/min = ~10,000 requests
- Each public endpoint hits Supabase Postgres (you're inside their free-tier limits, but check)
- Zero R2 cost (public endpoints don't read R2)
- Zero email cost (public endpoints don't send mail)

Authed mode adds:
- `/billing/status` reads transactions + albums tables
- `/notifications` reads the notifications table
- Still no R2, still no emails

Bottom line: a single launch_surge.js run costs you essentially nothing in infra. Don't run it 100 times in a loop.

---

## Run it

### Smoke test (recommended first time)

```bash
cd framedropnotes/loadtest
BASE_URL=https://api.framedrops.in/v1 k6 run smoke.js
```

You should see something like:
```
     ✓ status is 2xx
     ✓ response time < 1s
     ✓ has success: true

     checks.........................: 100.00%
     http_req_duration..............: avg=124ms p(95)=287ms
     http_req_failed................: 0.00%
```

If smoke fails, **stop** — fix the backend before trying launch_surge.

### Launch surge — anonymous only (default)

```bash
BASE_URL=https://api.framedrops.in/v1 k6 run launch_surge.js
```

7 minutes. You'll see a live ramping dashboard in your terminal, then a final summary table.

### Launch surge — with authed traffic

```bash
BASE_URL=https://api.framedrops.in/v1 \
TEST_JWT=eyJhbGc... \
k6 run launch_surge.js
```

### Custom VU count

```bash
# Quick 25-VU sanity surge before going full 100
BASE_URL=https://api.framedrops.in/v1 TARGET_VUS=25 k6 run launch_surge.js
```

---

## Interpreting results

The summary at the end shows:

```
╔══════════════════════════════════════════════════════════════╗
║              FRAMEDROPS LAUNCH-SURGE TEST                    ║
╠══════════════════════════════════════════════════════════════╣
║ Total requests    14,832                                     ║
║ Avg req/sec       33.85 req/s                                ║
║                                                              ║
║ ─── Latency (public endpoints) ─────────────────────────     ║
║ p50               142.50 ms                                  ║
║ p95               487.20 ms                                  ║
║ p99               1240.00 ms                                 ║
║                                                              ║
║ ─── Reliability ────────────────────────────────────────     ║
║ Error rate        0.45%                                      ║
║ Failed HTTP       0.32%                                      ║
║ 5xx count         2                                          ║
╚══════════════════════════════════════════════════════════════╝
```

### What "good" looks like

| Metric | Green | Yellow | Red |
|---|---|---|---|
| p50 latency | < 200ms | 200-500ms | > 500ms |
| p95 latency | < 800ms | 800ms-2s | > 2s |
| p99 latency | < 2s | 2-5s | > 5s |
| Error rate | < 0.5% | 0.5-2% | > 2% |
| 5xx count | 0 | 1-5 | > 5 |

### If 5xx errors appear

The most common causes, in order of likelihood:

1. **DB connection pool exhaustion**
   - Symptom: errors clustered in time, ramp-up phase fine, peak phase breaks
   - Check: Supabase dashboard → "Database" → connection count graph
   - Fix: increase `PG_POOL_MAX` env var (default 10 → try 20-30)
   - Read more: [framedropsbe/src/config/db.js](../framedropsbe/src/config/db.js)

2. **Rate limit hit (despite bumping)**
   - Symptom: 429 status codes (not 5xx but worth checking)
   - Check: response body says "Too many requests"
   - Fix: bump limits higher OR set `RATE_LIMIT_ENABLED=false`

3. **Render / hosting CPU throttling**
   - Symptom: latency creeps up over the hold phase, not catastrophic but ugly
   - Check: Render dashboard → CPU usage graph
   - Fix: upgrade to a bigger instance for launch; revert after

4. **Worker heartbeat timeouts**
   - Symptom: `worker_heartbeats` table has stale `last_tick_at`
   - Check: `SELECT * FROM worker_heartbeats;` in Supabase SQL editor
   - Fix: this only affects email/expiry workers, not the API path. Restart the BE.

5. **External dependency failure** (R2, Razorpay, Brevo)
   - Symptom: specific endpoints fail, not all of them
   - Check: backend logs for `[R2]`, `[Razorpay]`, `[Brevo]` errors
   - Fix: depends on the provider — usually transient

### If latency is high but no errors

The system is alive but slow. Look at:

1. **Slow DB queries** — enable `pg_stat_statements`, find queries with high `mean_exec_time`
2. **N+1 fetches** — check if a single API call triggers many SELECTs (use `EXPLAIN ANALYZE`)
3. **Missing indexes** — Supabase has an "advisor" tab that suggests these

### If smoke test fails but you haven't deployed anything

Something's already broken in production. Don't run launch_surge — go look at the backend logs first.

---

## Comparison: what k6 actually tells you vs what it doesn't

### k6 tells you ✅

- Throughput (req/sec) the backend can sustain
- Latency distribution (p50/p95/p99) under specific load
- Where errors start appearing
- Whether rate limits are configured correctly

### k6 does NOT tell you ❌

- How long photo uploads take (those bypass your API — they go direct to R2)
- Whether real wedding photographers' homes have good wifi
- Whether photographer onboarding flow is conversion-friendly
- Whether your DB will run out of disk in 30 days
- Whether Razorpay or Brevo will rate-limit YOU upstream

For all of those, you need different tests (manual UX testing, real-user monitoring like Sentry, infra dashboards).

---

## After the test — cleanup checklist

- [ ] Revert any `RATE_LIMIT_*` env var changes on the backend
- [ ] Revoke or delete the test JWT (`UPDATE users SET token_version = token_version + 1 WHERE email = 'test@...'`)
- [ ] If you bumped DB pool size, decide whether to keep it
- [ ] Save the `summary.json` somewhere (these accumulate value over time as you compare runs)

---

## Going beyond a laptop

When you have real traffic (50+ paying photographers), this single-laptop setup stops being enough. Upgrade path:

1. **k6 Cloud** ($25/month) — runs the same scripts from multiple AWS regions. No code changes needed. Real distributed load.
2. **Continuous load testing in CI** — run smoke.js on every deploy via GitHub Actions
3. **Real-user monitoring** — Sentry Performance or Honeycomb to see actual production latency from real photographers' devices
4. **Chaos engineering** — randomly kill workers, drop DB connections, see if the system recovers. Don't do this in production until you're ready.

---

## Files in this folder

| File | Purpose |
|---|---|
| `smoke.js` | 30-second public-endpoint sanity test |
| `launch_surge.js` | 7-minute 100-VU surge simulation |
| `RUNBOOK.md` | This file |
| `summary.json` | (created on each run) Full metrics JSON for diffing across runs |
