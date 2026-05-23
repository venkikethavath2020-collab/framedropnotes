# Backup & Restore Runbook

How Framedrops backs up its Postgres database, and how to recover from a wipeout.

**Last updated:** 2026-05-23

---

## TL;DR

- A Node script (`framedropsbe/scripts/backup-db.js`) runs `pg_dump`, gzips the
  output, uploads it to Cloudflare R2 under `db-backups/`, and prunes anything
  older than 30 days.
- Backups live in the same R2 bucket as your photos but under a separate
  `db-backups/` prefix.
- Restore is a separate script (`restore-db.js`) that downloads a chosen
  backup and (optionally) replays it into a *target* DB — never your prod DB
  directly.
- Runs daily via launchd on your Mac (free) until you outgrow that.

---

## Why R2 (not Gmail / Google Drive / etc.)

| Concern | Gmail | R2 |
| --- | --- | --- |
| Attachment cap | 25 MB | 5 TB per object |
| Storage included free | 15 GB shared with mail | 10 GB |
| Egress cost | n/a | **0** (R2 has no egress fees) |
| Versioning | none | per-object timestamp |
| Risk if account banned | lose mail AND backups | only lose backups |
| Already in your stack | yes | yes |

Backups in R2 are stored as `db-backups/framedrops-YYYY-MM-DD.dump.gz`. They
are **not** publicly readable — they live behind your R2 credentials. Anyone
who steals your `R2_SECRET_ACCESS_KEY` can read them, but the same is true
of every other R2 object, including the photos.

---

## What's in a backup

`pg_dump` in custom format (`-Fc`) snapshots:

- Every table's schema (`CREATE TABLE …`)
- Every row in every table (users, clients, albums, photos, transactions,
  client_payments, wallets, withdrawals, notifications, email_queue, etc.)
- Indexes, constraints, triggers, functions
- Sequence current values (so auto-incrementing IDs continue from where they
  left off)

It does NOT include:

- Files in R2 (photos). Those are independent — see "photo backups" below.
- Supabase Auth users (you don't use Supabase Auth; auth lives in your
  `users` table, which IS backed up).
- Supabase project settings (env vars, API keys, edge functions). Those live
  in the Supabase dashboard and need to be reconfigured on a restore.

### Photo backups (separate concern)

R2 is durable storage (11 nines of durability) and doesn't need its own
backup. If you ever want belt-and-suspenders, set up an R2 → S3 lifecycle
replication. Out of scope for this runbook.

---

## Daily backup (the happy path)

### Setup (one-time)

#### 1. Verify env vars are set

The script reuses your existing env. Make sure these are in
`framedropsbe/.env`:

```env
DATABASE_URL=postgres://…           # your Supabase pooler URL
R2_ACCOUNT_ID=…
R2_ACCESS_KEY_ID=…
R2_SECRET_ACCESS_KEY=…
R2_BUCKET=…

# Optional — for daily status emails
BREVO_API_KEY=xkeysib-…             # already set if email works
BACKUP_NOTIFY_EMAIL=supportframedrops@gmail.com
BACKUP_RETENTION_DAYS=30            # default 30 if unset
```

#### 2. Test the backup manually

```bash
cd framedropsbe
npm run backup:db
```

Expected output:

```
[backup] starting — 2026-05-23
[backup] running pg_dump…
[backup] dump size: 47.3 KB
[backup] gzipping…
[backup] gzipped: 11.8 KB
[backup] uploading to r2://framedropstorage-prod/db-backups/framedrops-2026-05-23.dump.gz
[backup] pruning backups older than 30 days…
[backup] pruned 0 stale object(s)

Framedrops DB backup OK
Date:       2026-05-23
Object:     db-backups/framedrops-2026-05-23.dump.gz
Raw size:   47.3 KB
Gzip size:  11.8 KB
Pruned:     0 (older than 30 days)
Elapsed:    3.2s
```

If you see "DB OK" in the status email subject + body, you're done.

#### 3. Verify the object exists in R2

```bash
# From the Cloudflare dashboard: R2 → your bucket → db-backups/
# Or via the AWS CLI:
aws s3 ls s3://$R2_BUCKET/db-backups/ \
  --endpoint-url=https://$R2_ACCOUNT_ID.r2.cloudflarestorage.com
```

#### 4. Schedule it (launchd on macOS)

Save this as `~/Library/LaunchAgents/com.framedrops.backup.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.framedrops.backup</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>-lc</string>
    <string>cd /Users/apple/Desktop/PHOTOSHARE/framedropsbe && /usr/local/bin/npm run backup:db &gt;&gt; /tmp/framedrops-backup.log 2&gt;&amp;1</string>
  </array>
  <key>StartCalendarInterval</key>
  <dict>
    <key>Hour</key><integer>2</integer>
    <key>Minute</key><integer>30</integer>
  </dict>
  <key>StandardOutPath</key><string>/tmp/framedrops-backup.log</string>
  <key>StandardErrorPath</key><string>/tmp/framedrops-backup.log</string>
</dict>
</plist>
```

Load it:

```bash
launchctl load ~/Library/LaunchAgents/com.framedrops.backup.plist
# To unload later:
# launchctl unload ~/Library/LaunchAgents/com.framedrops.backup.plist
```

This runs every day at 2:30 AM IST (when your Mac is on / not asleep).

> **Caveat:** if your Mac is closed at 2:30 AM, the job is skipped — launchd
> doesn't queue missed runs. The cleanest fix is GitHub Actions (see "next
> steps"). For now, just check that the daily status email arrives — if it
> doesn't, run `npm run backup:db` by hand.

#### 5. Confirm the schedule

```bash
launchctl list | grep framedrops
# Should print:  -    0    com.framedrops.backup
```

The middle column is the exit code of the last run (0 = success, blank =
never run).

---

## Restore (the unhappy path)

> **NEVER restore directly into your production DB.** Always restore into a
> separate Postgres instance, verify the data, then promote it. The script
> refuses to restore into your prod URL — don't try to work around it.

### Scenario A: "I deleted a few rows and need to look them up"

You don't need a full restore. Restore into a *local* Postgres, read what you
need, copy back manually.

```bash
# 1. Start a local Postgres (Docker is easiest)
docker run -d --name fd-restore -e POSTGRES_PASSWORD=test -p 5433:5432 postgres:15

# 2. List available backups
cd framedropsbe
npm run restore:db -- --list

# 3. Download a backup (no restore yet — safe)
npm run restore:db -- --date 2026-05-22

# 4. Apply it to the local DB
TARGET_DATABASE_URL=postgres://postgres:test@localhost:5433/postgres \
  npm run restore:db -- --date 2026-05-22 --apply

# 5. Query the restored DB
psql "postgres://postgres:test@localhost:5433/postgres" \
  -c "SELECT id, name, email FROM clients WHERE id IN (…);"

# 6. Manually re-insert the lost rows into prod via your normal admin tools

# 7. Tear down
docker rm -f fd-restore
```

### Scenario B: "Production DB is corrupted / wiped — full restore"

This is the big one. Walk through it carefully.

```bash
# 1. Stop writes — put the app in maintenance mode
#    On Render: pause the web service so no new traffic hits the DB.

# 2. Create a NEW Supabase project (don't reuse the broken one yet).
#    Note the new DATABASE_URL.

# 3. List backups, pick the most recent good one
cd framedropsbe
npm run restore:db -- --list

# 4. Restore into the new project
TARGET_DATABASE_URL='postgres://postgres.NEW_PROJECT:PWD@…supabase.co:5432/postgres' \
  npm run restore:db -- --date 2026-05-23 --apply

# 5. Smoke-test the restored DB
psql "$TARGET_DATABASE_URL" -c "
  SELECT
    (SELECT COUNT(*) FROM users)         AS users,
    (SELECT COUNT(*) FROM clients)       AS clients,
    (SELECT COUNT(*) FROM albums)        AS albums,
    (SELECT COUNT(*) FROM photos)        AS photos,
    (SELECT COUNT(*) FROM transactions)  AS transactions;
"

# 6. Compare those counts to what you remember / the latest backup output.
#    If wildly off, STOP and grab an older backup.

# 7. Update Render env: DATABASE_URL → new project's URL.
#    Redeploy. App should come back up.

# 8. Verify end-to-end: log in to the live site, click around, place a
#    test payment, etc. Don't unpause the service for real users until
#    you've verified.

# 9. Decide what to do with the old broken project (export logs, then
#    delete it from Supabase to stop the bill).
```

### What you lose in a restore

- All writes between the last backup and the crash. With daily backups at
  2:30 AM IST, the worst-case loss is ~24 hours of data.
- You can reduce this by running backups every 6 hours (just add more
  `StartCalendarInterval` blocks to the plist) or moving to Supabase Pro +
  PITR (paid).

---

## Operational checks

### Daily

- Status email arrives in your inbox. Subject starts with "[Framedrops] DB
  backup OK". If you see "DB backup FAILED" — see "if it breaks" below.

### Weekly

- Run `npm run restore:db -- --list` and confirm you have a backup from
  ≤24 hours ago.
- Spot-check `/tmp/framedrops-backup.log` for any warnings.

### Monthly

- **Do a test restore into a throwaway Postgres** and run the smoke-test
  queries from "Scenario B" step 5. Until you've restored from a backup,
  you don't have backups — you have hope.

### Quarterly

- Refresh the Supabase CA cert if needed (see SECURITY.md).
- Review `BACKUP_RETENTION_DAYS` — if your data is growing, you may want
  to extend or shorten retention.

---

## If it breaks

| Symptom | First thing to check |
| --- | --- |
| Status email = "DB backup FAILED" | Read the body — full error stack is included. Most common cause: DB went down briefly. Run `npm run backup:db` manually to retry. |
| No status email at all | launchd may not have fired. Run `launchctl list \| grep framedrops` and check the exit code. Check `/tmp/framedrops-backup.log`. |
| `pg_dump: error: server version mismatch` | Your local `pg_dump` is older than Supabase's Postgres. `brew upgrade postgresql` or install matching version. |
| `pg_dump: error: connection to server …: SSL` | Same CA-cert issue as the app. The script uses `DATABASE_URL` as-is — if connection works for the app, it works here. If not, set `?sslmode=require` on the URL. |
| Upload fails with `SignatureDoesNotMatch` | `R2_SECRET_ACCESS_KEY` has expired or was rotated. Regenerate in Cloudflare dashboard and update `.env`. |
| Backup uploads succeed but file is suspiciously small (e.g. <1 KB) | The dump probably failed silently. Open the .dump.gz, gunzip it, run `pg_restore --list` on it — if it shows no tables, the DB connection is broken. |

---

## Cost & sizing

- A fresh DB is ~50 KB compressed. 30 daily backups = ~1.5 MB.
- At 10k users / 100k albums / 5M photos, expect ~500 MB compressed per
  dump → 30 × 500 MB = 15 GB. You'd outgrow R2's free tier (10 GB)
  around the 20-day mark. At that scale, move to a tiered retention
  (daily for 7 days, weekly for 30 days) — costs are still pennies
  ($0.015 / GB / month on R2).

---

## Next steps (post-launch)

1. **Move from laptop launchd to GitHub Actions.** Free for private repos
   up to 2000 minutes/month — this job uses ~5 minutes a month. Survives
   your Mac being closed.
2. **Add automatic restore verification.** Have the cron job spin up a
   throwaway Postgres container, restore the latest backup, run `SELECT
   COUNT(*) FROM albums`, and fail loudly if the count drops by >10%
   from yesterday.
3. **Upgrade Supabase to Pro ($25/mo)** for 7-day managed backups as a
   backstop. Then this script becomes secondary defense rather than
   primary.
4. **Add PITR ($100/mo, Pro plan)** once you have customers depending on
   the data and the cost of a 24h data-loss window outweighs $100/mo.

---

## Files

| Path | Purpose |
| --- | --- |
| [`framedropsbe/scripts/backup-db.js`](../../framedropsbe/scripts/backup-db.js) | Dump + gzip + upload + prune |
| [`framedropsbe/scripts/restore-db.js`](../../framedropsbe/scripts/restore-db.js) | List + download + (optional) restore |
| [`framedropsbe/package.json`](../../framedropsbe/package.json) | `npm run backup:db` / `npm run restore:db` |
| `~/Library/LaunchAgents/com.framedrops.backup.plist` | macOS schedule (created above) |
| `/tmp/framedrops-backup.log` | Daily backup logs |
