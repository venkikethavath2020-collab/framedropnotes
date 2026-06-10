# Interview Q&A — Database Design

---

## Q1: Why did you choose raw SQL over an ORM like Prisma or Sequelize?

**Beginner answer:**
I wanted full control over my queries. ORMs sometimes generate inefficient SQL that's hard to debug.

**Mid-level answer:**
Three reasons:
1. **Query control** — Complex billing queries (e.g., `NOT EXISTS(unpaid albums)` for `clients.is_paid`) and locking patterns (`SELECT FOR UPDATE`) are cleaner in raw SQL than ORM DSLs.
2. **No magic** — With `pg.Pool` and raw SQL, I know exactly what query is running. No N+1 surprise from lazy loading.
3. **Transactions** — `db.transaction(async (client) => { ... })` gives explicit control over transaction boundaries, which is critical for payment side effects.

**Senior answer:**
The repository layer (`repositories/*.js`) wraps all SQL. Every repository function accepts an optional `client` parameter — if provided, the query runs inside the caller's transaction; if not, it runs independently. This is a common pattern with `pg` that Prisma makes harder to do explicitly.

The billing invariants (e.g., `albums.is_paid` as sole truth source, derived `clients.is_paid`) require very specific query shapes. An ORM would tempt you to query via relationships and accidentally include the derived column — raw SQL makes the intent explicit.

**"What would you use if you had to pick an ORM?"**
> Drizzle ORM — it's TypeScript-first, generates raw SQL you can inspect, supports `FOR UPDATE` locks, and has a thin abstraction layer. It's the closest to "type-safe raw SQL" without the magic of Prisma.

---

## Q2: Why is `clients.is_paid` a derived column and not the source of truth?

**Mid-level answer:**
`clients.is_paid` is recomputed after every payment as "does this client have any unpaid completed albums?" The album-level `is_paid` flag is the real truth — a client is considered paid only if ALL their albums are paid.

**Senior answer:**
This was the fix for a critical billing bug. The original code filtered locked albums using `clients.is_paid`. The problem: if a photographer had 3 albums for a client, paid for 2, and uploaded a 3rd later, the client showed as `is_paid=true` even though the new album was locked. The client couldn't download it, and the photographer couldn't see it as locked because the filter was on the client flag.

The correct invariants:
- `albums.is_paid` = "this specific album has been paid for" — sole truth
- `clients.is_paid` = derived shortcut, recomputed as `NOT EXISTS(SELECT 1 FROM albums WHERE client_id=X AND is_paid=false AND status='completed')`
- `getLockedAlbums()` queries `albums.is_paid` directly, never `clients.is_paid`
- `checkDownloadAccess()` queries `albums.is_paid` directly

The `markClientPaid()` function doesn't set `clients.is_paid=true` directly — it marks the specified albums paid, then recomputes the client flag. This means adding a new album after payment automatically resets the flag.

**"How would you add an index to optimize `getLockedAlbums`?"**
> The query filters on `(user_id, client_id, is_paid=false, status='completed')`. A composite index on `(user_id, client_id, is_paid, status)` would cover this. Alternatively a partial index: `CREATE INDEX idx_locked_albums ON albums(user_id, client_id) WHERE is_paid=false AND status='completed'` — this index only stores locked completed albums, making it small and fast.

---

## Q3: How do database transactions work in the backend?

**Mid-level answer:**
`db.js` exports a `transaction()` helper. You pass an async callback that receives a `pg.PoolClient`. All queries inside the callback use that client — they're part of the same transaction. If an error is thrown, the transaction rolls back automatically.

**Senior answer:**
```js
// db.js pattern
export async function transaction(callback) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const result = await callback(client)
    await client.query('COMMIT')
    return result
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}
```

Repository functions accept an optional `client` parameter for this:
```js
// repository
export async function findById(id, userId, client) {
  const executor = client ?? pool
  const { rows } = await executor.query('SELECT * FROM albums WHERE id=$1 AND user_id=$2', [id, userId])
  return rows[0]
}
```

The payment verify flow is the most critical transaction:
1. `BEGIN`
2. Fetch transaction row with `FOR UPDATE` (locks the row)
3. Check `status = 'pending'` — if already success, return early
4. Mark albums `is_paid=true`
5. Recompute `clients.is_paid`
6. Consume trial if applicable
7. Mark transaction `status='success'`
8. `COMMIT`

If any step fails (DB error, constraint violation), the whole thing rolls back — no partial payment state.

**"What is `SELECT FOR UPDATE` and why do you use it here?"**
> `SELECT FOR UPDATE` locks the selected rows for the duration of the transaction. Without it, two concurrent verify requests for the same transaction could both see `status='pending'`, both run side effects, and both commit — resulting in albums being "paid" twice, wallet credits doubled, etc. The `FOR UPDATE` lock serializes concurrent verifies — the second one waits until the first commits, then sees `status='success'` and exits early.

---

## Q4: How do PostgreSQL advisory locks work for your workers?

**Mid-level answer:**
Each worker acquires a named advisory lock before running. If the lock is already held (by another instance), the worker skips its run. This prevents two pods from running the same cron job simultaneously.

**Senior answer:**
`pg_try_advisory_lock(key)` takes a 64-bit integer key. It returns `true` if the lock was acquired (not held by anyone else), `false` if already locked. The lock is automatically released when the DB connection closes.

```js
// workerHeartbeat.js pattern
const LOCK_KEY = hashToInt64('albumExpiry')
const client = await pool.connect()
try {
  const { rows } = await client.query('SELECT pg_try_advisory_lock($1)', [LOCK_KEY])
  if (!rows[0].pg_try_advisory_lock) return  // another instance is running
  await runAlbumExpiry()
} finally {
  await client.query('SELECT pg_advisory_unlock($1)', [LOCK_KEY])
  client.release()
}
```

Advisory locks are session-scoped — if the process crashes, PostgreSQL automatically releases all its locks. This prevents a deadlock where a crashed pod holds the lock indefinitely.

**"Why not use a Redis distributed lock (Redlock)?"**
> We already have PostgreSQL and the workers use it anyway. Adding Redis just for locking is an infrastructure cost without a clear benefit at current scale. If we move workers to a separate process or a job queue (BullMQ), Redis becomes the natural choice. Advisory locks are a simple, zero-dependency solution that works well for single-DB deployments.

**"What if the DB connection drops while the worker is running?"**
> The advisory lock is session-scoped and gets released automatically. The worker will fail with a connection error. The next scheduled run (node-cron) will start fresh and acquire the lock again. The idempotency of each worker (checking `WHERE is_expired=false`, `WHERE status='pending'`) means re-running is safe — no double-processing.
