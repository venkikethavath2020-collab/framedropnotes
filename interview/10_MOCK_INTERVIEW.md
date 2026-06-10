# Mock Interview — How to Use These Notes

---

## Instructions

Use this file to run a self-paced mock interview.

**Rules:**
1. Read the question. Close the notes. Answer out loud (or write it down).
2. Check your answer against the 4-level rubric.
3. Answer the follow-up questions the same way.
4. Score yourself honestly on the rubric below.

---

## Scoring Rubric

| Score | Level | What it looks like |
|---|---|---|
| 1 | Beginner | Can describe WHAT but not WHY. Vague on tradeoffs. |
| 2 | Mid-level | Can explain WHY. Knows the tradeoffs. Can't go deeper. |
| 3 | Senior | Explains tradeoffs, limitations, what they'd do differently. Owns the decision. |
| 4 | Architect | Connects the decision to system-wide consequences. Identifies scale cliffs. Proposes evolution path. |

**Target for Senior FE / Senior FS / Tech Lead: score 3 on every question, score 4 on at least 3.**

---

## Question Bank (ordered by difficulty)

### Warm-up (expect these first)

1. Walk me through what FrameDrops does and how you built it.
2. What's the technology stack and why did you choose each piece?
3. How is a photo uploaded in this system?
4. How does authentication work?

### Core Technical (most likely to be asked)

5. Why is `clients.is_paid` derived and not the source of truth?
6. How do you prevent a photographer from paying for the same albums twice?
7. Explain the trial system state machine. What triggers consumption?
8. Why did you use PostgreSQL advisory locks for workers instead of Redis?
9. How does the email queue work? Why not send emails inline?
10. How does the upload resume work after a page refresh?
11. What is the `asyncHandler` pattern and why do you use it?
12. Why does the admin role come from the DB on every request, not from the JWT?

### Hard follow-ups (expect these after any answer)

13. How would this scale to 1 million photographers?
14. What happens if R2 goes down?
15. What happens if the database crashes?
16. Why didn't you use Redis?
17. Why didn't you use an ORM?
18. What's the biggest security gap in this system right now?
19. There are no tests. How would you add them?
20. How would you prevent trial system abuse?

### Architect-level (Tech Lead interviews)

21. If you were to re-architect this from scratch with a larger team, what would you change?
22. How would you add real-time upload progress visible across devices?
23. How would you design the payment system to support international photographers?
24. How would you separate the admin analytics from the main OLTP database?

---

## Mock Interview Script

### Opening question (always starts here):

> **"Tell me about FrameDrops — what does it do, and give me a high-level technical overview."**

**What a 3/4 answer covers:**
- B2B2C SaaS for Indian photographers
- Vue 3 SPA + Express backend + PostgreSQL + Cloudflare R2
- Two payment flows (photographer → platform, client → photographer)
- Free trial for first client, billable after
- Presigned R2 uploads (browser bypasses backend)
- Durable email queue, background workers with advisory locks

---

### After your overview, expect this follow-up sequence:

**Interviewer:** "You mentioned presigned R2 uploads. Why not just have the backend handle the upload?"

_(See 03_QA_UPLOAD.md → Q1)_

---

**Interviewer:** "And after the browser uploads to R2, what happens if finalize fails?"

**Good answer:** R2 has the file but no DB row. The upload engine in IndexedDB marks the file as `finalizing`. On next app boot/resume, finalize retries but skips the R2 upload (already has `storage_key` cached). Orphaned R2 files are cleaned up weekly by `r2OrphanReaper`.

---

**Interviewer:** "Let's talk about payments. You have two payment flows — explain the difference and why they're separate."

_(See 05_QA_PAYMENTS.md → Q1)_

---

**Interviewer:** "How do you prevent double payment?"

_(See 05_QA_PAYMENTS.md → Q2)_

---

**Interviewer:** "What about the trial system — I see you have a `trial_status` column. Walk me through it."

_(See 05_QA_PAYMENTS.md → Q3)_

---

**Interviewer:** "What if someone creates a new account to get another free trial?"

_(See 09_QA_SCALING.md → Q4)_

---

**Interviewer:** "There are no tests in this codebase. How would you add them?"

**Good answer:**
> "The highest priority is integration tests for the payment verify flow and trial state machine — these are the revenue-critical paths. I'd use `pg-mem` or a real test DB (not mocks) because the billing invariants depend on specific PostgreSQL behavior like `FOR UPDATE` locks and partial unique indexes. Unit tests for the service layer (with mocked repos) would cover validation logic. Vitest is the natural choice — it works well with Vite's TypeScript setup on the frontend. For the backend I'd use Vitest or Jest with a test DB seeded from `full_schema_v2.sql`."

---

**Interviewer:** "How would this scale to 1 million photographers?"

_(See 09_QA_SCALING.md → Q1)_

---

## Red Flags to Avoid

| What not to say | Why it's a red flag |
|---|---|
| "I used JWT because it's standard" | No WHY — shows cargo-cult decision making |
| "I used PostgreSQL because it's the most popular" | Same issue — no reasoning |
| "The upload just goes to R2" | Missing the sign/upload/finalize security reasoning |
| "I don't know why clients.is_paid is derived" | This is a core billing invariant you must own |
| "I haven't thought about scaling yet" | Fine to say it's not urgent, but you need a plan |
| "Tests would be nice to add sometime" | Weak ownership — say WHAT tests, WHICH framework, WHICH paths first |
| "I just used what I knew" | Shows no architectural thinking |

---

## Phrases That Signal Seniority

- "The tradeoff I made was..." 
- "This would break at [X scale] because..."
- "I deliberately chose [A] over [B] because in our context..."
- "The critical invariant here is..."
- "We got burned by [bug] because we had [missing invariant], and here's what we changed..."
- "If I were doing this again with more time, I would..."
- "The gap here is [X], and the fix would be [Y]..."
