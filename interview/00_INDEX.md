# FrameDrops Interview Prep — Index

> Generated from full codebase analysis of `framedrops/` (frontend) and `framedropsbe/` (backend).
> These notes are for Senior Frontend / Senior Full Stack / Tech Lead interviews.

## Files

| File | Contents |
|---|---|
| [01_ARCHITECTURE.md](./01_ARCHITECTURE.md) | Complete system design, data flow, DB relationships, security arch |
| [02_WEAKNESSES.md](./02_WEAKNESSES.md) | Security gaps, perf bottlenecks, scalability issues, tech debt |
| [03_QA_UPLOAD.md](./03_QA_UPLOAD.md) | Upload flow questions — sign/upload/finalize, compression, resume |
| [04_QA_AUTH.md](./04_QA_AUTH.md) | JWT, token revocation, Google OAuth, OTP, admin auth |
| [05_QA_PAYMENTS.md](./05_QA_PAYMENTS.md) | Flow 1 & 2, trial system, idempotency, wallet, Razorpay |
| [06_QA_DATABASE.md](./06_QA_DATABASE.md) | Schema design, transactions, advisory locks, derived columns |
| [07_QA_FRONTEND.md](./07_QA_FRONTEND.md) | Vue 3, Pinia, Vuetify, state management, TypeScript patterns |
| [08_QA_BACKEND.md](./08_QA_BACKEND.md) | Express patterns, workers, email queue, error handling |
| [09_QA_SCALING.md](./09_QA_SCALING.md) | Scale to 1M users, Redis, CDN, read replicas, queue systems |
| [10_MOCK_INTERVIEW.md](./10_MOCK_INTERVIEW.md) | How to run mock interview, example scoring rubric |

## Quick Cheat Sheet

### Stack
- **Frontend:** Vue 3 + TypeScript + Pinia + Vuetify 3 (SPA, Vite)
- **Backend:** Express.js + PostgreSQL (raw SQL, pg.Pool) + Node.js ESM
- **Storage:** Cloudinary (direct browser upload) + Cloudflare R2 (cold/secondary)
- **Payments:** Razorpay (INR only)
- **Auth:** HS256 JWT + Google OAuth + Email OTP/Password
- **Email:** Brevo SMTP via nodemailer, durable `email_jobs` queue
- **Workers:** node-cron + PostgreSQL advisory locks

### The 3 Things Interviewers Will Hammer
1. **Upload flow** — why browser→Cloudinary, how sign/finalize security works
2. **Payment idempotency** — how double-payment is prevented at DB level
3. **Trial state machine** — `unused→active→consumed`, what consumes it, what it blocks
