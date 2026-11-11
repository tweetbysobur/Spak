# SPak Refund Resolution (Phase 5.3)

Outcome: **Option C, provider limitation.** No official NEAR Intents capability and no defensible source-chain mechanism ties a refund transaction to a specific 1Click execution. Automatic refund completion stays off (`SPAK_REFUND_EVIDENCE_CAPABILITY=UNCONFIRMED`). Reconciliation was strengthened instead.

Labels used below: **[Documented]** is in official docs, spec or SDK. **[Observed]** was seen in a real response. **[Assumption]** is unverified.

## Original limitation

NEAR Intents reports that a refund happened (`status: REFUNDED`) and an amount (`refundedAmount`). It does not say which origin-chain transaction carried the refund. Without that, any transfer to the user's refund address could be passed off as the refund.

## Official capabilities investigated (2026-11-11)

| Capability | Refund tx reference? | Notes |
|---|---|---|
| `GET /v0/status` (1Click) | No | [Documented] `originChainTxHashes` is "all transactions on the origin chain", with no role per hash. [Observed] Empty before a deposit |
| `POST /v0/deposit/submit` | No | Deposit hash in, status out. Same shape as status |
| `GET /v0/account/history` (SDK `AccountService.getHistory`, needs a user session) | No | [Documented] `HistoryItem` has `quoteTransactions[{sender, txHash}]` (deposit transactions), `refundTo`, `refundType`, `refundReason`, `refundedAmountFormatted`, `refundedAmountUsd`, `refundFee`, `refundFeeFormatted`. No refund hash |
| `GET /v0/any-input/withdrawals` | No | ANY_INPUT swaps only. The docs say those have no refunds |
| Orders API (`/v0/orders*`) | No | Limit orders, not 1Click swaps |
| Explorer API `GET https://explorer.near-intents.org/api/v0/transactions` (partner JWT, 1 request per 5 s) | No | [Documented] Fields include `senders`, `refundTo`, `refundReason`, `refundFee`, `refundType`, `originChainTxHashes`, `destinationChainTxHashes`, `nearTxHashes`, `intentHashes`. No `refundedAmount`, no refund hash, and the hash arrays have no description |
| Webhooks | None | No webhook or callback documented. Polling only |
| Official SDK `@defuse-protocol/one-click-sdk-typescript` 0.1.26 | No | Types match the spec. No refund transaction field |
| Refund execution docs | None for 1Click | The only refund-execution page is for BTC Omni bridge refunds (`btc-connector.bridge.near`), not 1Click |

Sources: docs.near-intents.org (llms.txt index, 1Click quickstart, status and submit-deposit references, Explorer introduction and get-transactions, fees, swap-types, BTC refund page), `1click.chaindefuser.com/docs/v0/openapi.yaml`, `explorer.near-intents.org/api/v0/openapi.yaml`, the SDK package types.

None of these answers "which transaction is the refund". The Explorer API adds `senders` (deposit senders), which says nothing about refunds.

## Source-chain investigation

| Network | What the chain shows | Execution-specific link? |
|---|---|---|
| EVM (Base, Arbitrum and others) | Transfer logs: token contract, from, to, amount. Tx sender and calldata | No. [Assumption, not documented] Refunds come from shared bridge or solver wallets that serve many users. There is no memo or reference field in a plain ERC-20 transfer. Sender, recipient, amount and time do not identify the swap |
| Solana | Token balance changes, instructions, optional memo | No. The docs define no refund memo or reference. A shared payer is not specific |
| NEAR | Receipts, `ft_transfer` / `ft_transfer_call` args, NEP-245 events with optional memo | No. No documented refund memo or event links a refund to a deposit address or quote |

No defensible relationship exists on any supported chain, so SPak implements no source-chain association method. Matching sender, recipient, amount, token or time is explicitly rejected as proof.

## What NEAR Intents would need to expose

Any one of these would enable automatic refunds (CONFIRMED):

1. A documented refund transaction field in the status response, for example per-hash roles in `originChainTxHashes` (deposit or refund), or `refundTxHashes`.
2. A documented statement that every refund transaction appears in `originChainTxHashes`, plus a way to tell it apart from the deposit, such as the sender.
3. A signed refund receipt or webhook that names the deposit address, the quote signature and the refund transaction hash.
4. A documented on-chain reference (memo or event field) carrying the deposit address or quote hash on refund transfers.

A real refund observed under `docs/REFUND-LIVE-TEST.md` can support (2) for one route. It cannot prove it for every route or chain.

## Fee semantics

| Field | Documented meaning | Observed | SPak use |
|---|---|---|---|
| `swapDetails.refundedAmount` | "Amount of `originAsset` transferred to `refundTo`" | `"0"` before any refund | Provider figure. Positive values count only when the status is REFUNDED. Compared exactly with the associated sum |
| `quote.refundFee` | "Fee charged for refunding assets to the refund address", in origin smallest units | `"2400"` (5 USDC Base quote) | Shown as quoted. Never subtracted |
| `swapDetails.refundFee` | Not in the status schema | `"2400"` in status | Not used (undocumented in that place) |
| `withdrawFee` | Destination-side fee, "already accounted for in the final amountOut" | `"5300"` | Not refund-related |

Whether `refundedAmount` is gross or net of `refundFee` is **not documented** and has not been observed for a real refund. SPak calculates no fee. Deposit minus refunded amount is shown as a difference, without a breakdown.

## Implemented in this phase

1. **Post-completion reconciliation** (`RefundVerifier.reconcileCompleted`, monitor `watchCompletedRefund`):
   - At completion SPak stores `completion_snapshot`: provider amount, associated amount, counted transactions, provider origin hashes, capability. This snapshot is never rewritten.
   - For 30 days (`watch_until`) the monitor reads provider status read-only every 6 hours and compares.
   - A discrepancy is a status other than REFUNDED, a different positive `refundedAmount`, or new non-deposit origin hashes.
   - On a discrepancy: `reconciliation=DISCREPANCY`, one `REFUND_RECONCILIATION_DISCREPANCY` event per distinct set of problems, and a review.
   - COMPLETED, REFUNDED, the counted transactions and the snapshot are never changed. A discrepancy stays until a person handles it.
   - Provider outages during the watch are retries, not discrepancies.
2. **Read-only provider observation** (`ExecutionService.observeProvider`). It checks the quote signature and makes no state change.
3. **Quoted refund fee** stored on the refund (`quoted_refund_fee`) for display only.
4. **Classification** `REFUND_RECONCILIATION_DISCREPANCY`: "verified, then provider data changed; under review". Never presented as a plain success.
5. **Recovery panel**: automatic verification availability, with the reason when unavailable; the post-refund check status; the quoted refund fee, labelled as not subtracted.

## Database

Migration `0008_refund_reconciliation.sql`, additive, on `spak_refunds`: `completion_snapshot`, `watch_until`, `reconciliation`, `reconciliation_checked_at`, `quoted_refund_fee`.

## Reviewer workflow

Unchanged rules: individual credentials, append-only notes, no manual verification or association. Review evidence now also includes the completion snapshot, reconciliation status and quoted refund fee. Reviewers close discrepancy cases with a documented resolution. They cannot reverse or rewrite a completed refund.

## Remaining limitations

- Automatic REFUNDED is off. Every real refund needs manual review. This is deliberate under Option C.
- Gross vs net `refundedAmount` is unknown.
- Whether refunds can be split across several transactions is unknown in practice. SPak supports it.
- Refunds via internal EVM calls (native coin) cannot be verified without trace RPC.
- The post-completion watch lasts 30 days, a SPak choice.
- There is no admin web screen.

## Requirements for production automatic refunds

1. NEAR Intents provides one of the evidence mechanisms listed above, in its documentation or a support statement.
2. A real refund observed under `docs/REFUND-LIVE-TEST.md` matches that mechanism on each source chain SPak enables.
3. Set `SPAK_REFUND_EVIDENCE_CAPABILITY=CONFIRMED` and record the evidence in `docs/NEAR-INTENTS-REFUND-EVIDENCE.md`.
4. Until then, keep UNCONFIRMED.
