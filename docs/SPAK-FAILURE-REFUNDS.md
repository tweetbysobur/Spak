# SPak Failure Handling and Refunds

Phase 5. Extends SPak Execution, deposits and tracking. No second engine. Nothing here resends a deposit, creates an execution, or sets COMPLETED or REFUNDED by hand.

## Behaviour before this phase

- Provider REFUNDED became execution REFUNDED with no chain check.
- Provider FAILED was final. A confirmed deposit could end in FAILED with nothing tracking its refund.
- Cancel in AWAITING_DEPOSIT was allowed even with a deposit in flight.
- Delivery problems went to UNKNOWN with NEEDS_RECONCILIATION. There was no review case and no notes.
- There was no failure classification. UNKNOWN covered timeouts and real problems alike.

## NEAR Intents refund behaviour (from the 1Click docs and OpenAPI spec)

- Refunds are automatic. There is no refund endpoint and nothing for the user to sign.
- SPak quotes with `refundType: ORIGIN_CHAIN` and `refundTo` set to the user's verified source wallet. Refunds go there.
- Status values: PENDING_DEPOSIT, KNOWN_DEPOSIT_TX, INCOMPLETE_DEPOSIT, PROCESSING, SUCCESS, REFUNDED, FAILED.
- Refund facts in `swapDetails`: `refundedAmount` (smallest units of the origin asset), `refundReason` (free text, for example PARTIAL_DEPOSIT), `depositedAmount`. The quote carries `refundFee`.
- There is no refund transaction hash field. `originChainTxHashes` lists origin-chain transactions. SPak treats any of them that is not the deposit as a candidate refund.
- Partial refunds are possible: incomplete deposits are refunded, and EXACT_INPUT excess goes to refundTo. SPak never assumes the full deposit comes back.
- The docs do not cover refund timing, the refund fee formula, or what happens after the deposit address expires.

## Execution states

New: REFUNDING. Changed: FAILED is no longer final. It is monitored and can move to REFUNDING.

| From | To |
|---|---|
| AWAITING_DEPOSIT, PROCESSING, VERIFYING_DESTINATION, FAILED, UNKNOWN | REFUNDING (provider reports REFUNDED) |
| REFUNDING | REFUNDED (only after SPak's chain verification), UNKNOWN |
| FAILED | REFUNDING, UNKNOWN |
| COMPLETED, REFUNDED, EXPIRED, CANCELLED | none |

Rules:

- REFUNDED needs both the provider reporting REFUNDED and the source chain showing at least the provider's `refundedAmount` arriving at the refund address, in the exact source asset, at final commitment.
- COMPLETED still needs SPak's destination verification (Phase 4).
- A COMPLETED execution never moves to REFUNDED.
- Timeouts, rate limits and outages never change the state to FAILED.
- An execution with a submitted or confirmed deposit cannot be cancelled.
- All transitions are compare-and-set with an event row. Invalid transitions throw.

Manual review is a case record, not an execution state. A flagged execution keeps its real state, and the UI shows "Manual review required".

## Refund lifecycle (spak_refunds.state)

| State | Meaning |
|---|---|
| PENDING_PROVIDER | Swap failed after a confirmed deposit. Waiting for NEAR Intents to refund |
| INITIATED | Provider reports REFUNDED. No refund transaction found yet |
| TX_DETECTED | A candidate refund transaction exists, not yet readable or final |
| VERIFICATION_PENDING | Candidates read, but not final, or the verified amount is below the provider's figure |
| COMPLETED | Verified. `verifiedAmount` set. Flagged partial if below the deposit |
| FAILED | All candidates final and none returned the asset to the refund address. Review opened |
| DELAYED | No refund transaction 6 hours after the refund record opened. Review after 72 hours |
| UNKNOWN | Reserved for unreadable situations |

"Refund available" and user-initiated refunds do not exist with NEAR Intents. The API reports `initiation: AUTOMATIC`.

## Failure classification (src/failures/classify.ts)

Pure function. It returns a category, code, a temporary flag, where the funds are (WALLET, IN_TRANSIT, DESTINATION, REFUND_ADDRESS or UNKNOWN), a plain message, and recovery actions.

- PRE_DEPOSIT: QUOTE_EXPIRED, QUOTE_REJECTED, UNSUPPORTED_ASSET, UNSUPPORTED_NETWORK, INVALID_DEPOSIT_INSTRUCTIONS, USER_CANCELLED, INSUFFICIENT_BALANCE, WALLET_REJECTED.
- DEPOSIT: DEPOSIT_TX_FAILED, DEPOSIT_EXPIRED, WRONG_DEPOSIT_AMOUNT, WRONG_DEPOSIT_ASSET, WRONG_DEPOSIT_ADDRESS, DUPLICATE_DEPOSIT, DEPOSIT_MISMATCH, DEPOSIT_VERIFICATION_UNAVAILABLE (temporary), INCOMPLETE_DEPOSIT.
- EXECUTION: PROVIDER_REJECTED, INSUFFICIENT_LIQUIDITY, ROUTE_UNAVAILABLE, SLIPPAGE (from refundReason text), PROVIDER_TIMEOUT and PROVIDER_INTERRUPTION (temporary), UNKNOWN_OUTCOME (temporary), MANUAL_REVIEW_REQUIRED.
- DESTINATION: DESTINATION_TX_FAILED, WRONG_RECIPIENT, WRONG_ASSET, BELOW_MINIMUM, DESTINATION_UNVERIFIABLE, DESTINATION_VERIFICATION_UNAVAILABLE (temporary), DESTINATION_DELAYED (temporary), DESTINATION_REFERENCE_CONFLICT.
- REFUND: REFUND_EXPECTED, REFUND_INITIATED, REFUND_VERIFICATION_PENDING, REFUND_COMPLETED, REFUND_COMPLETED_PARTIAL, REFUND_DELAYED, REFUND_FAILED, REFUND_STATUS_UNKNOWN.

Recovery actions: WAIT, CHECK_AGAIN, SUBMIT_REFUND_TX, VERIFY_REFUND, START_NEW_TRANSFER (the user does it), CONTACT_SUPPORT, MANUAL_REVIEW. There is no resend action.

The latest classification is stored on `spak_executions.failure`. Changes are logged to `spak_failure_events`.

## Refund verification (src/failures/refunds.ts)

- Candidates come from three places: provider origin-chain hashes that are not deposit transactions, hashes the user submits, and hashes a reviewer attaches.
- A deposit transaction is refused as a refund. A hash linked to another execution is refused (unique network and tx_hash).
- Each candidate is checked with the Phase 4 chain verifiers on the source network:
  - EVM: receipt status, Transfer logs of the exact token to the refund address (or a direct native transfer), confirmations.
  - Solana: the refund owner's balance change for the exact mint, or lamports for SOL, at finalized.
  - NEAR: receipts, at FINAL.
- Amounts are summed across verified candidates and compared with the provider's `refundedAmount`.

## Background worker

FAILED and REFUNDING are now monitored states. Each attempt runs the deposit check, the provider check, destination verification, refund verification, and classification. The Phase 4 leases, backoff, attempt and run history, and crash recovery are unchanged. Refund records and refund tx rows are idempotent (insert on conflict, compare-and-set), so interrupted or concurrent runs cannot duplicate them. Give-up and NEEDS_RECONCILIATION now open a review case.

## Manual reconciliation

- `spak_reviews`: at most one open case per execution. `spak_review_notes` is append-only, with an author and evidence JSON.
- Opened by SPak: give-up, NEEDS_RECONCILIATION, failed refund verification, refund missing after 72 hours, a refund reference that belongs to another execution.
- Reviewers can read all evidence, add notes, attach a refund transaction (which SPak verifies), and resolve with NO_ACTION_NEEDED, USER_CONTACTED, REFERRED_TO_PROVIDER or RESOLVED_BY_VERIFICATION. The last is allowed only when SPak already verified COMPLETED or REFUNDED. Resolving needs a note and evidence.
- Reviewers cannot set execution states.
- Auth is `Authorization: Bearer $SPAK_ADMIN_TOKEN` (32+ characters) plus `X-SPak-Reviewer: <name>`. It is separate from user sessions and fails closed (503) when the token is not set.

## API

| Method | Path | Notes |
|---|---|---|
| GET | /api/executions/:id/failure | Classification, recovery options, review status, history |
| GET | /api/executions/:id/refund | Eligibility, instructions (automatic), refund record, refund txs, original amounts |
| POST | /api/executions/:id/refund/transactions | `{ txHash }`. Idempotent per hash. 10 per minute and 10 per hour per execution |
| POST | /api/executions/:id/refund/verify | Verify now |
| GET | /api/executions/:id/review | Review status, without internal notes |
| GET | /api/admin/reviews?status= | Reviewer only |
| GET | /api/admin/reviews/:id | Full evidence |
| POST | /api/admin/reviews/:id/notes | `{ note, evidence }` |
| POST | /api/admin/reviews/:id/refund-tx | `{ txHash, note }`. SPak verifies it |
| POST | /api/admin/reviews/:id/resolve | `{ resolution, note, evidence }` |

User endpoints need a session, ownership (404 otherwise), the same origin for POST, strict body schemas and rate limits. GET /api/executions/:id/tracking now also returns `failure`, `refund` and `review`.

## Database

Migration `0005_failure_refund.sql`, additive:

- `spak_executions`: refund_reason, refund_verified_amount, refund_verified_at, failure.
- New tables: `spak_refunds`, `spak_refund_txs` (unique network and tx_hash), `spak_failure_events`, `spak_recovery_attempts`, `spak_reviews` (unique open case per execution), `spak_review_notes`.

## Environment

| Name | Purpose |
|---|---|
| SPAK_ADMIN_TOKEN | Reviewer bearer token, 32+ random characters. Server only |

The others (CRON_SECRET, SPAK_MONITOR_SECRET, SPAK_RPC_*) are unchanged.

## Testing

| Kind | File |
|---|---|
| Classification rules (pure) | tests/failures/classify.test.ts |
| Mocked provider and chain, real SQL: refund lifecycle, partial, delayed, wrong recipient, wrong asset, failed tx, confirmations, idempotency, concurrency, tampered and duplicate refs, cross-user, rate limit, cancel guard, manual review | tests/failures/refunds.test.ts |
| Routes: auth, ownership, origin, validation, admin token separation | tests/failures/routes.test.ts |
| Real chain and provider (LIVE=1) | tests/live/tracking.live.test.ts. The refund verifier uses these same chain verifiers |

## Known limitations

- No real refund was observed. Triggering one needs a funded failed swap, which was not done.
- The REFUNDED provider response shape comes from the OpenAPI spec, not from a live response.
- NEAR Intents gives no refund transaction field. If the refund transaction is not in `originChainTxHashes`, SPak needs the user or a reviewer to supply it. Until then the refund stays INITIATED or DELAYED.
- A user can submit any transfer to their own refund address as a refund candidate. It completes a refund only if the provider reports REFUNDED and the amount covers the provider's figure. Block time is not yet checked against the deposit time.
- The refund fee formula is not documented by the provider. A refund below the deposit is shown as partial, with no breakdown.
- There is no admin web screen yet, only the API.
- Native EVM refunds sent through an internal call cannot be verified without trace RPC.
