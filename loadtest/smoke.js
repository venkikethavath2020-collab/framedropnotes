/**
 * k6 smoke test — Framedrops backend.
 *
 * Goal: 30-second sanity check that the API is up and serving public
 * endpoints under modest load. Safe to run against production. Hits only
 * cacheable read paths.
 *
 * Run:
 *   BASE_URL=https://api.framedrops.in/v1 k6 run smoke.js
 *   BASE_URL=http://localhost:3000/v1     k6 run smoke.js
 *
 * Pass criteria: p95 < 500ms, error rate < 1%, no 5xx.
 */

import http from 'k6/http'
import { check, sleep } from 'k6'
import { Rate } from 'k6/metrics'

const errorRate = new Rate('errors')

export const options = {
  stages: [
    { duration: '10s', target: 5  },   // ramp to 5 VUs
    { duration: '20s', target: 10 },   // hold at 10 VUs
    { duration: '5s',  target: 0  },   // ramp down
  ],
  thresholds: {
    'http_req_failed': ['rate<0.01'],        // < 1% failed requests
    'http_req_duration': ['p(95)<500'],      // 95% under 500ms
    'errors': ['rate<0.01'],
  },
  // Tag the test run for filtering in Grafana / k6 cloud later.
  tags: { test: 'smoke', target: __ENV.BASE_URL || 'unset' },
}

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000/v1'

const PUBLIC_ENDPOINTS = [
  '/system/status',
  '/public/stats',
  '/public/testimonials',
]

export default function () {
  // Pick a random public endpoint
  const path = PUBLIC_ENDPOINTS[Math.floor(Math.random() * PUBLIC_ENDPOINTS.length)]
  const res = http.get(`${BASE_URL}${path}`, {
    tags: { endpoint: path },
  })

  const ok = check(res, {
    'status is 2xx': (r) => r.status >= 200 && r.status < 300,
    'response time < 1s': (r) => r.timings.duration < 1000,
    'has success: true': (r) => {
      try { return r.json('success') === true } catch { return false }
    },
  })
  errorRate.add(!ok)

  // Think time so we're not a tight loop
  sleep(1 + Math.random())
}
