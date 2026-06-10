# Interview Q&A — Backend (Express, Workers, Email, Error Handling)

---

## Q1: Why did you use raw Express instead of NestJS or Fastify?

**Beginner answer:**
Express is simple and I know it well. It has a huge ecosystem and plenty of middleware available.

**Mid-level answer:**
Express was the right call for an MVP. It has zero setup overhead, the ecosystem is mature, and the 3-layer pattern (`routes → controllers → services → repositories`) is enforced by convention rather than framework. NestJS would add decorators, dependency injection, and module scaffolding — valuable at large team scale, but overkill for a two-person team shipping fast.

Fastify would give better performance (Pino logging, schema-based serialization), but Express was already familiar and the performance bottleneck for this app is the DB, not the HTTP layer.

**Senior answer:**
The key architectural choice that makes Express manageable at this scale is the strict 3-layer pattern. Without this discipline, Express apps become unmaintainable quickly. The `asyncHandler` wrapper on every route eliminates the need for try/catch in controllers — all thrown errors propagate to the global error handler. The `R.success/R.error/R.created` response envelope standardizes every JSON response shape, so the frontend can rely on consistent `{ success, data, message }` structure.

**"What would make you switch to Fastify?"**
> Two things: (1) structured logging — Fastify has Pino built in, which gives JSON logs with request IDs and log levels out of the box; (2) schema validation — Fastify's route-level JSON Schema validation auto-validates request bodies and auto-generates Swagger docs. We have manual validation currently. If I were starting fresh, Fastify would be a serious consideration.

---

## Q2: How does the `asyncHandler` error handling pattern work?

**Mid-level answer:**
Every route handler is wrapped in `asyncHandler()`. If the async function throws, `asyncHandler` catches it and passes it to `next(err)`. Express's global error handler then formats the error as a JSON response.

**Senior answer:**
```js
// middleware/errorHandler.js
export function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next)
  }
}

// Global error handler (registered last in server.js)
export function errorHandler(err, req, res, next) {
  const status = err.status || err.statusCode || 500
  const message = err.message || 'Internal server error'
  R.error(res, message, status)
}
```

The service layer returns `{ data }` or `{ error, status }` — it never throws (except for truly unexpected errors). The controller checks the return value and calls `R.error()` directly for expected errors. Unexpected errors (DB connection failures, null pointer exceptions) bubble up through `asyncHandler` to the global handler.

This two-path approach means:
- **Expected errors** (validation, not found, conflict) are explicit return values — easy to test, no try/catch noise in controllers
- **Unexpected errors** are caught globally — Sentry gets the full stack trace, user gets a clean 500 message

**"Why not just use try/catch in every controller?"**
> Repetitive and easy to forget. A single missed try/catch in an async route will crash Express's error handling (unhandled promise rejection in older Node). The `asyncHandler` pattern guarantees every async route is covered without cognitive overhead.

---

## Q3: How does the email worker and job queue work?

**Mid-level answer:**
Instead of sending email inline (which would slow down API responses), we insert a row into the `email_jobs` table. A background worker polls the table every 30 seconds, picks up pending jobs, renders the email template, and sends via nodemailer/Brevo.

**Senior answer:**
The `email_jobs` table acts as a durable queue. Key columns:
- `priority` — higher priority jobs are picked first (OTPs would be highest, but OTPs bypass the queue entirely via inline send)
- `next_attempt_at` — enables delayed/retried delivery
- `attempts` — incremented on each attempt; after max attempts, job is marked failed
- `status` — `pending → processing → sent / failed`

The worker (`email.worker.js`):
1. Polls `WHERE status='pending' AND next_attempt_at <= NOW() ORDER BY priority DESC, next_attempt_at ASC LIMIT 10`
2. Marks batch as `processing` (prevents other worker instances from picking the same jobs)
3. Renders Vue 3 SSR email templates via `@vue-email/render`
4. Sends via nodemailer
5. Marks `sent` or, on failure, increments `attempts` and sets `next_attempt_at = NOW() + exponential_backoff`

OTP and password reset emails bypass the queue entirely — they're sent inline because the user is actively waiting. These use `email.sender.js` (direct nodemailer call, no DB row).

**"Why use PostgreSQL as a queue instead of Redis or SQS?"**
> We already have PostgreSQL — adding Redis just for the email queue is infrastructure cost. PostgreSQL queues work well at our email volume (thousands per day, not millions). The risk is the poll interval (30s latency for non-OTP emails). We could improve this with `pg_notify`: the API inserts a job and calls `NOTIFY email_jobs`, the worker uses `LISTEN email_jobs` to wake up immediately. Zero latency, zero extra infrastructure.

**"What if the SMTP server (Brevo) is down?"**
> The job stays in `pending` with a backoff `next_attempt_at`. The worker will retry on the next poll. After max retries, the job is marked `failed` and shows in the admin's email jobs view for manual inspection. The durable queue means no emails are permanently lost due to transient SMTP failures.

---

## Q4: How are the background workers managed?

**Mid-level answer:**
Workers are started in `server.js` using `node-cron`. Each worker has its own cron expression. PostgreSQL advisory locks prevent two pods from running the same worker at the same time.

**Senior answer:**
Worker initialization flow in `server.js`:
1. Server starts listening
2. Workers are registered: `albumExpiry.worker.js`, `trialExpiry.worker.js`, `email.worker.js`, etc.
3. Each worker uses `workerHeartbeat.js` to acquire a `pg_try_advisory_lock` before running
4. If lock not acquired → skip run (another instance is handling it)
5. After work completes → release lock

Graceful shutdown (`SIGTERM` handler):
1. Stop accepting new HTTP connections
2. Wait for in-flight requests to complete
3. Stop all cron jobs
4. Close PostgreSQL pool

The advisory lock design means the system handles multiple pods correctly without a separate lock service. The trade-off: workers don't parallelize — only one instance runs per worker type at any given time. For the current workload (album expiry, email queue drain), sequential processing is fine.

**Workers and their schedules:**

| Worker | Cron | Purpose |
|---|---|---|
| `email` | Every 30s | Drain email_jobs queue |
| `albumExpiry` | Every 6h | Mark expired albums, clean R2 |
| `trialExpiry` | Hourly | Flip trial active → consumed on window expiry |
| `agreementExpiry` | Hourly | Flip agreements to expired, send reminders |
| `r2OrphanReaper` | Weekly Sun 04:00 UTC | Delete R2 objects not in photos table |
| `r2Reconciliation` | Weekly Sun 05:00 UTC | Sample-check R2 objects, alert on miss rate |
| `stalePending` | Daily | Clean stale pending transactions |
| `lifecycle` | Every 6h | Re-engagement emails (behind `LIFECYCLE_ENABLED` flag) |
| `calendar` | Every 1 min | Send event reminders 15 min before start_time |

**"What happens if a worker crashes mid-run?"**
> The advisory lock is session-scoped — PostgreSQL releases it automatically when the connection closes. The next scheduled run acquires the lock and starts fresh. Since workers are idempotent (they check `WHERE is_expired=false`, `WHERE status='pending'`), re-running them doesn't cause double-processing.
