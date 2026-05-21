/**
 * k6 launch-surge test — Framedrops backend.
 *
 * Goal: simulate the load pattern of a launch announcement — 100
 * curious photographers landing on the site, browsing public pages, then
 * a subset logging in and hitting authenticated read paths (dashboard,
 * albums list, billing status).
 *
 * THIS IS NOT A SIGNUP TEST. The /v1/auth/signup endpoint is rate-limited
 * to 5/hour/IP by design. From one laptop you cannot truly simulate 100
 * distinct signups — it would all share your IP. Test that flow manually
 * or use cloud-distributed test runners.
 *
 * Stages (~7 minutes total):
 *   0:00 → 1:00   Ramp 0 → 100 anonymous browsers
 *   1:00 → 5:00   Hold 100 VUs (peak surge)
 *   5:00 → 6:00   Ramp 100 → 50 (cooldown)
 *   6:00 → 7:00   Ramp 50 → 0
 *
 * Run (read-only, anonymous):
 *   BASE_URL=https://api.framedrops.in/v1 k6 run launch_surge.js
 *
 * Run with authenticated test traffic (requires test JWT):
 *   BASE_URL=https://api.framedrops.in/v1 \
 *   TEST_JWT=<jwt_from_test_account> \
 *   k6 run launch_surge.js
 *
 * Pass criteria (per the thresholds below):
 *   - p95 latency < 800ms
 *   - p99 latency < 2000ms
 *   - error rate < 2%
 *   - zero 5xx responses
 *
 * If the test fails these thresholds, see RUNBOOK.md → "Interpreting results"
 * for the most common causes (DB pool exhaustion, R2 throttling, rate limits).
 */

import http from 'k6/http'
import { check, sleep, group } from 'k6'
import { Rate, Trend, Counter } from 'k6/metrics'

// ─── Config ───────────────────────────────────────────────────────────────
const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000/v1'
const TEST_JWT = __ENV.TEST_JWT || ''       // optional; enables authed paths
const TARGET_VUS = parseInt(__ENV.TARGET_VUS || '100', 10)

// ─── Custom metrics ───────────────────────────────────────────────────────
const errorRate = new Rate('errors')
const fiveHundredCounter = new Counter('five_hundreds')
const authedLatency = new Trend('authed_latency', true)
const publicLatency = new Trend('public_latency', true)

// ─── Stages ───────────────────────────────────────────────────────────────
export const options = {
  scenarios: {
    launch_surge: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '1m', target: TARGET_VUS },             // ramp up
        { duration: '4m', target: TARGET_VUS },             // hold at peak
        { duration: '1m', target: Math.floor(TARGET_VUS / 2) }, // half-step cooldown
        { duration: '1m', target: 0 },                      // ramp down
      ],
      gracefulRampDown: '30s',
    },
  },
  thresholds: {
    'http_req_failed':            ['rate<0.02'],
    'http_req_duration{kind:public}': ['p(95)<800', 'p(99)<2000'],
    'http_req_duration{kind:authed}': ['p(95)<1200', 'p(99)<3000'],
    'errors':                     ['rate<0.02'],
    'five_hundreds':              ['count<5'],     // < 5 5xx across entire test
  },
  // Don't abort on threshold breach — finish the run so we see the full picture.
  noVUConnectionReuse: false,
  // Useful tags for filtering in summary output.
  tags: {
    test: 'launch_surge',
    target: BASE_URL,
    authed: TEST_JWT ? 'true' : 'false',
  },
}

// ─── Endpoint mix ─────────────────────────────────────────────────────────
//
// Realistic launch traffic mix observed from public sites:
//   60% — anonymous: landing-page → /system/status, /public/stats, /public/testimonials
//   25% — authed dashboard: /albums?page=1, /clients?page=1, /billing/status
//   15% — gallery-link clicks: /albums/share/:id (would need a real shareId — we skip)
//
// If TEST_JWT is not provided, all 100% goes to anonymous traffic.

const PUBLIC_ENDPOINTS = [
  { path: '/system/status',       weight: 4 },   // hit often (every page mount)
  { path: '/public/stats',        weight: 3 },   // landing page footer
  { path: '/public/testimonials', weight: 3 },   // landing page section
]

const AUTHED_ENDPOINTS = [
  '/auth/me',
  '/albums?page=1&perPage=10',
  '/clients?page=1&perPage=10',
  '/billing/status',
  '/notifications?page=1&perPage=10',
]

function pickWeighted(items) {
  const totalWeight = items.reduce((s, x) => s + x.weight, 0)
  let r = Math.random() * totalWeight
  for (const item of items) {
    r -= item.weight
    if (r <= 0) return item.path
  }
  return items[items.length - 1].path
}

// ─── Helpers ──────────────────────────────────────────────────────────────
function getPublic(path) {
  const res = http.get(`${BASE_URL}${path}`, {
    tags: { kind: 'public', endpoint: path },
  })
  publicLatency.add(res.timings.duration)
  return checkResponse(res, path)
}

function getAuthed(path) {
  const res = http.get(`${BASE_URL}${path}`, {
    headers: { 'Authorization': `Bearer ${TEST_JWT}` },
    tags: { kind: 'authed', endpoint: path },
  })
  authedLatency.add(res.timings.duration)
  return checkResponse(res, path)
}

function checkResponse(res, path) {
  const ok = check(res, {
    'status not 5xx': (r) => r.status < 500,
    'has body': (r) => r.body && r.body.length > 0,
  })
  if (res.status >= 500) fiveHundredCounter.add(1)
  errorRate.add(!ok)
  // Optional: log first 5xx body for debug
  if (res.status >= 500 && __VU === 1 && __ITER < 3) {
    console.error(`5xx on ${path}: ${res.status} ${res.body?.substring(0, 200)}`)
  }
  return ok
}

// ─── Main VU loop ─────────────────────────────────────────────────────────
export default function () {
  // Decide what kind of user this iteration represents.
  // If we have a JWT, 25% of iterations hit authed paths.
  const rand = Math.random()
  const isAuthed = TEST_JWT && rand < 0.25

  if (isAuthed) {
    group('Authenticated dashboard load', () => {
      // Simulate page-load that fires multiple parallel requests
      const path1 = AUTHED_ENDPOINTS[Math.floor(Math.random() * AUTHED_ENDPOINTS.length)]
      const path2 = AUTHED_ENDPOINTS[Math.floor(Math.random() * AUTHED_ENDPOINTS.length)]
      getAuthed(path1)
      sleep(0.2)
      getAuthed(path2)
    })
  } else {
    group('Anonymous landing page load', () => {
      // A landing-page mount fires ~2-3 parallel public requests
      getPublic(pickWeighted(PUBLIC_ENDPOINTS))
      sleep(0.1)
      getPublic(pickWeighted(PUBLIC_ENDPOINTS))
    })
  }

  // Think time — real users don't refresh every 100ms
  sleep(1 + Math.random() * 3)  // 1-4 seconds between actions
}

// ─── Summary ──────────────────────────────────────────────────────────────
export function handleSummary(data) {
  return {
    'stdout': textSummary(data),
    'summary.json': JSON.stringify(data, null, 2),
  }
}

// Minimal text-summary helper (k6 ships one but it's verbose — keep this lean).
function textSummary(data) {
  const m = data.metrics
  const fmt = (n, unit = '') => n === undefined ? 'n/a' : `${n.toFixed(2)}${unit}`
  const pct = (n) => n === undefined ? 'n/a' : `${(n * 100).toFixed(2)}%`

  return `
╔══════════════════════════════════════════════════════════════╗
║              FRAMEDROPS LAUNCH-SURGE TEST                    ║
╠══════════════════════════════════════════════════════════════╣
║ Target            ${BASE_URL.padEnd(43)}║
║ Peak VUs          ${String(TARGET_VUS).padEnd(43)}║
║ Authed mode       ${(TEST_JWT ? 'YES' : 'NO').padEnd(43)}║
║                                                              ║
║ Total requests    ${String(m.http_reqs?.values?.count ?? 0).padEnd(43)}║
║ Avg req/sec       ${fmt(m.http_reqs?.values?.rate, ' req/s').padEnd(43)}║
║                                                              ║
║ ─── Latency (public endpoints) ─────────────────────────     ║
║ p50               ${fmt(m['public_latency']?.values?.med, ' ms').padEnd(43)}║
║ p95               ${fmt(m['public_latency']?.values?.['p(95)'], ' ms').padEnd(43)}║
║ p99               ${fmt(m['public_latency']?.values?.['p(99)'], ' ms').padEnd(43)}║
║                                                              ║
║ ─── Latency (authed endpoints) ─────────────────────────     ║
║ p50               ${fmt(m['authed_latency']?.values?.med, ' ms').padEnd(43)}║
║ p95               ${fmt(m['authed_latency']?.values?.['p(95)'], ' ms').padEnd(43)}║
║ p99               ${fmt(m['authed_latency']?.values?.['p(99)'], ' ms').padEnd(43)}║
║                                                              ║
║ ─── Reliability ────────────────────────────────────────     ║
║ Error rate        ${pct(m.errors?.values?.rate).padEnd(43)}║
║ Failed HTTP       ${pct(m.http_req_failed?.values?.rate).padEnd(43)}║
║ 5xx count         ${String(m.five_hundreds?.values?.count ?? 0).padEnd(43)}║
╚══════════════════════════════════════════════════════════════╝
`
}
