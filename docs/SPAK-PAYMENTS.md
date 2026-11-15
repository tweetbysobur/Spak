# SPak Payments

Status: one-time payments are built and tested. Recurring and scheduled payments, payment requests, invoices, payroll and bulk payouts are not built.

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

## Not built

Recurring and scheduled payments, payment requests, invoices, vendor payouts, payroll, creator payments, bulk distributions, saved payees and notifications.
