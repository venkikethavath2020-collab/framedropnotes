# Interview Q&A — Scaling & System Design

> These are the hardest follow-up questions. Interviewers love asking "how would this scale to 1 million users?"
> Answer honestly: know the current limits, know the first things to fix, know the long-term path.

---

## Q1: How would you scale FrameDrops to 1 million photographers?

**Current bottlenecks (be honest about these):**
1. Single PostgreSQL primary — all reads and writes on one machine
2. In-process user cache — doesn't share across pods
3. Workers are single-instance per type
4. No read replicas
5. Razorpay is India-only

**Phase 1 — 10K photographers (current scale → early growth):**
- Add PgBouncer connection pooling in front of PostgreSQL (reduce connection overhead)
- Add a read replica — route analytics queries and admin dashboard reads to it
- Replace in-process user cache with Redis (pub/sub for token_version invalidation)
- Add `pg_notify` to wake email worker instantly instead of polling every 30s

**Phase 2 — 100K photographers:**
- Separate the worker process from the HTTP server process — workers on dedicated instances
- Move to BullMQ + Redis for job queues (email, album expiry) — proper retry, dead-letter queues, dashboards
- Add CDN for API responses that are cacheable (public gallery endpoints, pricing)
- R2 presigned URL generation is fast but add rate limiting on the sign endpoint

**Phase 3 — 1M photographers:**
- Shard PostgreSQL by `user_id` range or move to Citus (PostgreSQL horizontal scaling)
- Event-driven architecture: payment events → Kafka/SQS → independent consumers (wallet credit, email, analytics)
- Separate analytics DB (ClickHouse or Redshift) — OLAP queries off the main OLTP DB
- Introduce a CDN edge cache (Cloudflare) for gallery thumbnails with cache invalidation on album update

---

## Q2: What happens if Cloudflare R2 goes down?

**Current state:**
- R2 is the only storage — there's no fallback
- If R2 is unavailable, uploads fail and photo retrieval fails

**Short-term mitigation (no code change):**
- Cloudflare R2 has an SLA — check their status page
- Upload engine uses IndexedDB — pending uploads are queued locally and will retry when R2 comes back
- Existing photos have `thumbnail_url` and `storage_key` in DB — if R2 recovers, all URLs come back

**Proper resilience design:**
1. **Circuit breaker** — `lib/circuitBreaker.js` already exists in the codebase. Wire it around R2 operations. After N failures in a time window, the circuit opens and requests fail fast (instead of waiting for R2 timeout).
2. **Multi-region R2** — Cloudflare R2 stores data across multiple data centers automatically (it's the default).
3. **Fallback storage** — Mirror critical uploads to S3 as a secondary. The sign step picks which storage is healthy.
4. **Presigned URL caching** — Cache presigned download URLs in Redis with a TTL. If R2 is briefly down, cached URLs may still work.

---

## Q3: What happens if the PostgreSQL database crashes?

**Current behavior:**
- All API requests fail immediately (no DB, no responses)
- Workers stop (they need DB for advisory locks)
- Email queue is in DB — queued emails are not lost, but not sent until DB recovers

**Mitigation:**
- `pg.Pool` has connection retry built in — transient disconnects recover automatically
- Enable PostgreSQL streaming replication to a hot standby — automatic failover in ~30 seconds with Patroni or managed DB (RDS Multi-AZ, Supabase)
- Read replica takes over read traffic during primary failover window
- Email jobs are durable in DB — once primary recovers, the worker drains the backlog

**"What would you lose if the DB crashes with no replica?"**
> In-flight transactions only — PostgreSQL WAL ensures committed data is durable. The 30s user cache in Node.js memory would be lost (harmless — it's a read cache). In-flight API requests would fail with a 500. New uploads can't be finalized. Email queue jobs already committed to DB before the crash are safe.

---

## Q4: How would you prevent abuse on the trial system?

**Current gaps:**
- Nothing prevents creating multiple accounts to reset the trial
- Turnstile captcha and email domain validation are the only barriers

**Approaches:**
1. **Device fingerprinting** — use a browser fingerprint (FingerprintJS) at signup. If the same device has already consumed a trial, block or flag.
2. **Phone number verification** — require phone OTP at trial start (the infrastructure exists, just not enforced). A phone number is harder to create in bulk than an email.
3. **Payment method deduplication** — once a photographer adds a payment method, check for duplicate card/UPI across accounts.
4. **Velocity signals** — migration 13 adds `signup_abuse_signals` columns. Build a scoring model: multiple signups from same IP, same device, similar email patterns (user+1@gmail.com etc.).
5. **Trial delay** — don't grant the trial instantly on signup; grant it after the first verified upload and a 24h account age check.

---

## Q5: How would you optimize slow database queries?

**For the admin analytics dashboard specifically:**

Current pain: admin queries aggregate across all users, all time — full table scans on `transactions`, `photos`, `albums`.

**Approach 1 — Materialized views:**
```sql
CREATE MATERIALIZED VIEW daily_revenue AS
  SELECT DATE(created_at) as day, SUM(amount) as revenue
  FROM transactions WHERE status='success'
  GROUP BY day;

REFRESH MATERIALIZED VIEW CONCURRENTLY daily_revenue;
-- Refresh via a cron worker
```

**Approach 2 — Pre-aggregated analytics table:**
A daily job writes summary rows to an `analytics_snapshots` table. Dashboard reads snapshots instead of aggregating live data.

**Approach 3 — Read replica:**
Route all admin analytics queries to the read replica. OLAP queries don't compete with OLTP writes.

**For the photo listing query:**
- Ensure `photos` has an index on `(album_id, upload_status)` for the common filter
- Use cursor-based pagination instead of `OFFSET/LIMIT` for large albums

**"How do you identify which queries are slow?"**
> Enable `pg_stat_statements` extension — it records execution time, call count, and avg cost per query. `EXPLAIN ANALYZE` on the slowest queries. In production, set `log_min_duration_statement=1000` to log queries taking over 1 second.

---

## Q6: Why didn't you use Redis?

**What it does for you:**
- Shared user cache (currently in-process memory)
- Pub/sub for token_version cache invalidation
- BullMQ job queues (replace PostgreSQL-backed email queue)
- Session storage (not needed — we use JWT)
- Rate limiting counters (currently in-process or DB-backed)

**Why we didn't add it yet:**
- Infrastructure cost — another service to run, monitor, back up
- Operational complexity — Redis is single-threaded; AOF persistence adds latency; Redis Cluster adds complexity
- With one server and low traffic, in-process memory cache is sufficient
- PostgreSQL advisory locks already handle the distributed lock use case

**When we'd add Redis:**
- Multiple backend pods (in-process cache becomes inconsistent)
- Email queue volume exceeds what polling handles efficiently
- Need for real-time pub/sub (live upload progress across devices)

**"Is there a middle ground before Redis?"**
> `pg_notify` + `LISTEN/NOTIFY` gives a lightweight pub/sub within PostgreSQL — no extra service. We could use it for: cache invalidation signals between pods, waking the email worker instantly, broadcasting to admin dashboard via SSE. It's not a replacement for Redis at scale, but it extends PostgreSQL's useful range.
