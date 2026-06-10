# Interview Q&A — Payments, Trial System & Wallet

---

## Q1: Explain the two payment flows in FrameDrops.

**Mid-level answer:**
There are two independent payment flows:
- **Flow 1:** Photographer pays the platform to unlock albums for client download. Albums are locked after upload; payment unlocks them.
- **Flow 2:** Client (the photographer's customer) pays the photographer for gallery access. Money goes to the photographer's wallet minus a platform fee.

**Senior answer:**
The two flows are structurally mirrored but serve opposite directions of money:

**Flow 1 — Photographer → Platform:**
- Tables: `transactions`, `albums.is_paid`
- Purpose: platform monetization. Photographer must pay per client (tiered by image count)
- Albums become downloadable for the client only after photographer pays
- Trial system gives the first client for free

**Flow 2 — Client → Photographer:**
- Tables: `client_payments`, `client_deliveries`, `wallets`, `wallet_transactions`
- Purpose: photographer charges their end-customer for gallery access
- Platform takes a `PLATFORM_FEE_PERCENT` cut before crediting photographer's wallet
- Photographer can then withdraw from wallet via bank/UPI

The flows are independent — a photographer can use Flow 1 only, Flow 2 only, or both on the same client.

**Architect answer:**
The separation into two tables (`transactions` vs `client_payments`) avoids mixing platform revenue with photographer revenue in one ledger. Each has its own Razorpay integration (same keys, but separate order creation/verification flows). The wallet sits between Flow 2 and withdrawals — it's a running balance ledger with immutable `wallet_transactions` rows, never updated in place.

---

## Q2: How do you prevent double payment (paying for the same albums twice)?

**Mid-level answer:**
There's a unique partial index on transactions:
```sql
UNIQUE (user_id, client_id) WHERE status = 'pending'
```
This means only one pending transaction per (photographer, client) pair can exist at a time. A second `create-order` request gets a 409 Conflict from the DB.

**Senior answer:**
Two layers of idempotency:

**Layer 1 — Order creation:**
The partial unique index `(user_id, client_id) WHERE status = 'pending'` prevents creating two simultaneous orders for the same photographer-client pair. If the frontend retries create-order (e.g., network timeout), the second request hits the constraint and returns 409. The frontend handles 409 by re-fetching the existing pending order instead of creating a new one.

**Layer 2 — Verify idempotency:**
In `payment.service.js`, the verify flow fetches the transaction with `status = 'pending'`. If it finds `status = 'success'` (already verified), it returns the existing result instead of re-running side effects. This prevents `applySideEffects()` from running twice if Razorpay's callback fires more than once.

**Architect answer:**
A gap: there's no explicit `Idempotency-Key` header on payment endpoints. The protection is entirely DB-constraint-driven. A more robust pattern is accepting a client-generated idempotency key, storing it in the `transactions` table, and returning the cached response for duplicate keys — this is what Stripe does. The DB index approach works but has a race condition: two requests arriving simultaneously within the same millisecond could both pass the constraint check before either commits.

**"What happens if Razorpay webhook fires but verify endpoint also fires?"**
> They're both covered by the verify idempotency: whichever runs second will find `status = 'success'` and return early. The `applySideEffects()` transaction is wrapped in a DB transaction — concurrent executions serialize at the DB level. Worth noting: webhook routes are unauthenticated (they verify the Razorpay HMAC signature from the request body itself, not JWT).

---

## Q3: Explain the trial system state machine.

**Mid-level answer:**
New photographers get a free trial for their first client — up to 3,000 images, valid for 30 days. The trial has three states: `unused`, `active`, `consumed`. Once consumed, all future clients are billable.

**Senior answer:**
The state machine lives in `users.trial_status`:

```
unused ──[first photo upload]──▶ active ──[cap hit / expiry / payment / client delete]──▶ consumed
```

**State transitions:**
- `unused → active`: triggered when the first photo is finalized for any client. The trial binds to that specific `trial_client_id`.
- `active → consumed` (4 triggers):
  1. **Cap hit**: `trial_image_limit` (3,000) images uploaded to the trial client
  2. **30-day expiry**: `trialExpiry.worker.js` runs hourly, flips `active → consumed` when `trial_expires_at` has passed
  3. **Any payment**: paying for any client (even a non-trial one) marks the photographer as a paying customer and consumes the trial
  4. **Trial client deleted**: deleting the bound client consumes the trial

**Why these triggers?**
- Cap and expiry are resource limits — prevent unlimited free usage
- Payment consumption: once a photographer pays anything, they're a paying customer; no more free tier
- Client deletion: prevents abuse (delete trial client, create new one to reset trial)

**Architect answer:**
The `consumed` state is terminal — no code path resets it. This is an immutability guarantee. The trial is also bound AFTER the first photo INSERT, not before — this prevents a client with zero photos from consuming the trial slot. The `trial_image_limit` is snapshotted on the client record at the time of binding, so changing the platform-wide limit doesn't retroactively affect active trials.

**"How would I test this state machine?"**
> This is the highest-priority area for integration tests. The state machine has 4 transition paths, each with multiple conditions. I'd write tests that seed a fresh DB, create a photographer, upload N photos, and assert the correct state. End-to-end tests covering the payment-consumption path are critical since that's the revenue path.

**"What prevents a photographer from creating a new account to get another free trial?"**
> Nothing currently — signup abuse protection is limited to email domain validation and Turnstile captcha. Migration 13 (`13_signup_abuse_signals.sql`) adds abuse signal columns, but a dedicated enforcement mechanism isn't implemented yet. A device fingerprint or payment method verification on trial start would help.

---

## Q4: How does the wallet system work?

**Mid-level answer:**
When a client pays the photographer (Flow 2), the net amount (after platform fee) is credited to the photographer's wallet. The wallet balance is the sum of `wallet_transactions` rows. Photographers can withdraw from the wallet to their bank/UPI payout method.

**Senior answer:**
The wallet is an immutable ledger. Every credit and debit is a separate `wallet_transactions` row — the balance is always `SUM(amount)`. This is the correct accounting pattern — you never update amounts in place, only append new entries.

The wallet has a secondary use: photographers can use their wallet balance to pre-pay Flow 1 albums (`/v1/payments/wallet/apply-partial`). This lets them offset platform fees against earnings from Flow 2.

Withdrawals go through an admin approval workflow:
1. Photographer requests withdrawal (must exceed `MIN_WITHDRAWAL_RUPEES`)
2. Admin approves → creates a payout via bank/UPI
3. Admin marks withdrawal as processed
4. Wallet is debited

The payout method details are snapshotted at withdrawal time — if the photographer changes their bank account later, historical withdrawals show the correct account.

**"Why not pay out automatically?"**
> Manual admin approval allows fraud review before money leaves the platform. At scale this would be replaced by automated payouts with fraud scoring, but for an early-stage platform the manual approval adds a human checkpoint that's worth the operational cost.

**"What happens if the platform fee changes after a client payment?"**
> `PLATFORM_FEE_PERCENT` is read at payment time and the fee amount is recorded in the `wallet_transactions` row. Changing the env var doesn't retroactively alter past transactions. Historical records are accurate.
