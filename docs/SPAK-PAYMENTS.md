# SPak Payments

Status: one-time payments, recurring payments and payment requests. Invoices, payroll, bulk payouts and saved payees are not built.

## What a payment is

A payment is a transfer to someone else's address. It runs through the same path as every SPak transfer: SPak-in reads it, SPak Guard checks it, SPak Execution gets a signed NEAR Intents 1Click quote, your wallet signs the deposit, and SPak verifies delivery on the recipient's chain. There is no separate payment engine or settlement system.

## Creating a payment

- In words: "Pay 50 USDC from Base to 0x… on Arbitrum", "Send 20 USDC on Base to alice.near on NEAR".
- Or the Manual form in Execute, with the Recipient field filled in.
- If you leave out the network for a NEAR or Solana address, SPak asks and offers the one network that fits (it never picks a network silently). An EVM address with no network named is paid on the network your funds are on, and SPak states that assumption.
- Same-chain payments (Base USDC to a Base address) and cross-chain payments both quote through 1Click (dry quotes checked live, 2026-11-15).

## Review and confirm

The review for a payment leads with the payee address and network, then what you send and the minimum the recipient receives, every fee, the refund address and the deadline. "Confirm and pay" gets a firm quote (stopping if its minimum is lower than shown), records your approval bound to the plan hash, runs any token approval and asks your wallet to sign the deposit.

## Tracking and receipt

- The transfer page tracks the deposit and delivery. Completed means SPak found the payout on the recipient's chain, to the recipient, from a trusted sender, at or above the approved minimum.
- The receipt appears only then. `GET /api/executions/:id/receipt` returns it (owner only, `409 RECEIPT_NOT_AVAILABLE` before verification). The page offers it as a JSON download.
- Receipt fields: kind (PAYMENT or TRANSFER), execution id, provider, completion time, source network, token, amount and deposit transactions, destination network, token, recipient, amount received, minimum approved and payout transactions with explorer links, fees, refund address, who approved (you, or your Agent with its permission version), and how delivery was verified.
- Activity has a Type filter: payments to others or transfers to your wallets.

## Controls

| Control | Where |
|---|---|
| Recipient address valid for the destination network | SPak-in, before any quote |
| Approved-recipients-only mode and limits | SPak Guard, before the quote and again before the deposit |
| Quote signature and firm minimum | SPak Execution |
| Duplicate payment within minutes held until confirmed again; idempotency keys | SPak Execution |
| Approval bound to the exact plan; stale approvals refused | SPak Execution |
| Agent may approve only payees in its signed permission; the wallet still signs | SPak Agent permissions |
| Delivery counted only to the recipient, from a trusted sender, above the minimum | Destination verification |
| Expired, refunded or unverified payments have no receipt | Receipt builder |
| A schedule only prepares; every scheduled payment needs your review and wallet signature | Payment schedules |

## Recurring payments

A recurring payment pays the same amount of the same token to the same address on a schedule. It **prepares** each payment. It never signs, and it is never a permission to sign: your wallet signs every deposit.

### Creating one

Open **Payments**, choose **New recurring payment** and fill in: name, source network and token, amount, the recipient's network, token and address, how often, the first date, and when it ends (when you cancel, on a date, or after a number of payments). SPak shows a summary with the first dates before anything is created.

| Frequency | Rule |
|---|---|
| Every day, week, two weeks | The start date plus 1, 7 or 14 days per payment |
| Every N days | 1 to 365 days |
| Every month | The start date's day of the month. Months without that day (29th, 30th, 31st) use their last day, and the next month returns to the original day (31 Jan, 28 Feb, 31 Mar) |

Limits: first date from today to a year ahead; end date within five years; at most 520 payments; up to 20 active or paused schedules.

The server validates every field again, plans one payment through SPak-in as a check (recipient valid for the network, supported token, Guard), and refuses a payment to your own wallet.

### Dates and time

Dates are calendar dates in your timezone, taken from your browser when you create the schedule and shown with it. A payment is due from the start of its date in that timezone.

### When a payment is due

1. The schedule and its status are read again (paused or cancelled schedules prepare nothing).
2. SPak-in plans the payment again: recipient, networks, token and amount.
3. SPak Guard checks it with your current settings.
4. SPak Execution gets a fresh NEAR Intents quote. Each payment has its own execution, quote, approval, deposit, tracking and receipt. Nothing is reused from an earlier payment.
5. If the schedule names your Agent, the Agent may approve the quote, only within its own signed permission.
6. The payment waits in **Payments** as "Ready: review and sign". **Review and sign** gets another fresh quote and opens the normal payment review. Your wallet signs the deposit.

Preparation runs in the existing monitoring job (`/api/internal/monitor`, daily on Vercel Cron, or more often from an external scheduler with `SPAK_MONITOR_SECRET`) and also when you open Payments, for your own schedules.

### Missed payments

If several dates pass before SPak runs (for example the job did not run for a while), only the latest is prepared. Earlier dates are recorded as **Missed**, never prepared together. For a missed or failed payment you choose **Prepare now** or **Skip**. A payment whose attempt expired unsigned, was cancelled or was refunded can be prepared again; the earlier attempt is kept in its history. Only one attempt can be live at a time.

### Pause, resume, cancel

- Pause: nothing new is prepared.
- Resume: the same configuration continues from the next date on or after today. Dates that passed while paused are not created.
- Cancel: final. No more payments are prepared, missed or failed dates are closed, and payments already prepared stay as they are for you to finish or cancel.

### Concurrency and records

- Due schedules are claimed with `FOR UPDATE SKIP LOCKED`; each date is unique per schedule (`(schedule_id, seq)`), so concurrent or repeated runs create one payment per date.
- Preparation holds a two-minute lease and uses the idempotency key `sched:<occurrence>:<attempt>`, so a crashed run resumes into the same execution instead of a second one.
- Every occurrence is a database row with its date, status, attempt history, failure reason and execution.

### API

| Method | Path | |
|---|---|---|
| GET | `/api/payments/schedules` | Your schedules with their payments; prepares your due payments first |
| POST | `/api/payments/schedules` | Create |
| POST | `/api/payments/schedules/:id/pause` · `/resume` · `/cancel` | Lifecycle |
| POST | `/api/payments/occurrences/:id/retry` · `/skip` | Missed or failed payments |

All owner-only, same-origin and rate-limited. Database: migration `0020_payment_schedules.sql` adds `spak_payment_schedules` and `spak_payment_occurrences`.

### Limitations

- The daily Vercel Cron prepares payments once a day (04:17 UTC); a payment can appear up to a day after its date unless you open Payments or an external scheduler runs the job more often.
- No notifications outside SPak yet: a payment waiting for your signature is shown in Payments.
- A schedule cannot be edited; cancel it and create a new one.
- No real recurring payment has settled on mainnet yet. The flow is tested with simulated chains and a simulated NEAR Intents, and in the browser with a real NEAR Intents quote and a simulated wallet.

## Payment requests

Ask someone to pay you. Open **Payments**, choose **New request** and set the amount you want to receive, the token and network, the wallet that receives it (one of your own verified wallets on that network), an optional note, and how long the link works (1 to 90 days). Share the link (`/app?pay=<token>`, 32 random characters).

Paying one is a normal payment:

1. The payer opens the link. Signed out, they see the amount, network, receiving address, note and status, never who made it.
2. They sign in and choose what to pay with. SPak asks NEAR Intents how much of that token delivers the requested amount (a dry EXACT_OUTPUT quote, used only for sizing), adds headroom for slippage, and plans a PAYMENT with the requested amount as its **minimum output**.
3. The payer's SPak Guard checks it. The quote is a normal signature-checked EXACT_INPUT quote; SPak rejects it if its worst case delivers less than requested.
4. The payer reviews it and their wallet signs the deposit.
5. The request turns **Paid** only when SPak has verified on the destination chain that at least the requested amount reached the payee's wallet.

The payer may send slightly more than the requested amount; any surplus reaches the payee.

No double payment: preparing takes a short claim on the request under a row lock, and no new payment is prepared while an earlier one is in progress. An attempt left unapproved for 30 minutes is cancelled before someone else can pay. A request cannot be paid by the person who made it, or after it is paid, cancelled or expired.

API: `GET`/`POST /api/payments/requests` (payee), `POST /api/payments/requests/:id/cancel` (payee), `GET /api/payments/requests/link/:token` (public), `POST /api/payments/requests/link/:token/pay` (signed-in payer; returns the review). Migration `0021_payment_requests.sql` adds `spak_payment_requests` and `spak_payment_request_attempts`.

Same token on the same network to someone else (for example Base USDC to a Base address) is a payment SPak routes through NEAR Intents. To your own wallet it is refused, because it does nothing.

## Not built

Invoices, vendor payouts, payroll, creator payments, bulk distributions, saved payees, notifications and unattended signing.
