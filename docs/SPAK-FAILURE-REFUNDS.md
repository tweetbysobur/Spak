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

- REFUNDED needs the provider reporting REFUNDED, a provider refunded amount, and transfers that are verified on the source chain, in the time window, and associated with this execution (provider-listed). Together they must cover that amount. See "Refund transaction association" below.
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

## Refund transaction association (Phase 5.1)

### Why a matching transfer is not proof

A transfer to the refund address in the right token, for the right amount, at a plausible time proves only that some transfer happened. Anyone can send the user tokens, and the user can point at any incoming transfer. None of these facts says NEAR Intents sent it as this execution's refund:

- refund address
- token contract or mint
- amount
- timestamp
- success
- finality

### Two separate questions

1. Chain verification. Each check is stored separately in `spak_refund_txs.checks`:
   - exists
   - success
   - network: queried on the source network only
   - recipient: the refund address
   - asset: the exact contract or mint
   - amount
   - finality: EVM confirmations, Solana finalized, NEAR FINAL
   - time: at or after the deposit transaction, and no later than the deposit deadline + 7 days
   - provider: NEAR Intents reports REFUNDED
2. Association: does the transfer belong to this execution's refund. Stored in `association`, with `association_evidence`:
   - PROVIDER_LISTED: NEAR Intents returned the hash in `originChainTxHashes` of the status response for this execution's unique deposit address, under this execution's firm quote signature. This is the only evidence SPak accepts. NEAR Intents does not say which origin transaction is the refund and has no refund reference field, so SPak claims nothing more.
   - PENDING_ASSOCIATION: a candidate. It was submitted by the user or a reviewer, or seen but not linked. It is checked on chain and never counted. A confirmed but unlinked candidate puts the refund in ASSOCIATION_PENDING and opens a review.
   - REJECTED: the time check failed. Shown with `rejected_reason`, and it opens a review.

The time check is supplementary. Passing it never associates a transfer. The time window is SPak policy, because NEAR Intents documents no refund timing.

### Completion rules

The refund is COMPLETED, and the execution REFUNDED, only when all of these hold:

- The provider status is REFUNDED.
- The provider stated `refundedAmount`.
- No provider-listed transaction is still pending.
- The sum of PROVIDER_LISTED, CONFIRMED, time-PASS transfers is at least `refundedAmount`.

Otherwise:

| Situation | Refund state |
|---|---|
| Associated amount below the provider's figure | PARTIAL (outstanding amount stored) |
| Associated transfer, but the provider has not reported REFUNDED | VERIFICATION_PENDING |
| Provider reported REFUNDED with no amount | VERIFICATION_PENDING, review opened |
| Only unlinked candidates verified | ASSOCIATION_PENDING, review opened |
| Linked transfers show nothing reaching the refund address | FAILED, review opened |
| No transaction after 6 hours | DELAYED (review after 72 hours) |

Three amounts are kept and shown separately:

1. `providerRefundedAmount`: what NEAR Intents reports, not proof.
2. `verifiedAmount`: any confirmed transfers to the refund address, associated or not.
3. `associatedAmount`: verified and linked. This is the only amount ever called returned.

`outstandingAmount` is the provider figure minus the associated amount. SPak calculates no refund fees. A refund below the deposit is shown as "less than the deposit" without guessing why.

### Duplicate protection

- `spak_refund_txs` has a unique (network, tx_hash) index. EVM hashes are stored lowercase so case variants collide.
- Refused as refunds: the execution's deposit transaction (any case), its destination transactions, and hashes linked to another execution.
- Concurrent submissions resolve in the database. Refused attempts stay in `spak_recovery_attempts` with the error code.

## Background worker

FAILED and REFUNDING are now monitored states. Each attempt runs the deposit check, the provider check, destination verification, refund verification, and classification. The Phase 4 leases, backoff, attempt and run history, and crash recovery are unchanged. Refund records and refund tx rows are idempotent (insert on conflict, compare-and-set), so interrupted or concurrent runs cannot duplicate them. Give-up and NEEDS_RECONCILIATION now open a review case.

## Manual reconciliation

- `spak_reviews`: at most one open case per execution. `spak_review_notes` is append-only, with an author and evidence JSON.
- Opened by SPak: give-up, NEEDS_RECONCILIATION, failed refund verification, refund missing after 72 hours, a refund reference that belongs to another execution.
- Reviewers see the execution, the original deposit transaction, the provider's references and refunded amount, every candidate with its separate checks, association and evidence, time and asset and recipient comparisons, outstanding amount, refund state, previous notes and the audit trail.
- Reviewers can add notes and evidence, attach a candidate transaction (checked on chain, but it stays PENDING_ASSOCIATION), request another verification, and resolve with NO_ACTION_NEEDED, USER_CONTACTED, REFERRED_TO_PROVIDER or RESOLVED_BY_VERIFICATION. The last is allowed only when SPak already verified COMPLETED or REFUNDED. Resolving needs a note and evidence.
- Reviewers cannot mark a refund verified, associate a transaction, mark an execution refunded or completed, or skip chain checks. There is no override path. A reviewer can close an investigation but cannot manufacture proof.

### Reviewer authentication

- `SPAK_REVIEWERS=alice:<sha256 hex of alice's token>,bob:<sha256 hex of bob's token>`. Each person has their own token. Only hashes are configured.
- Requests send `Authorization: Bearer <own token>`. The server hashes it, compares in constant time against every entry, and takes the identity from the matching entry. Any name in headers or bodies is ignored, and the strict body schemas reject unknown fields.
- Legacy `SPAK_ADMIN_TOKEN` (raw, 32+ characters) maps to `shared-admin`, a shared identity that does not identify a person.
- Every reviewer action, including reads and refused actions, goes to `spak_admin_audit` with reviewer id, credential fingerprint (hash prefix), action, execution, review, time, reason, evidence and outcome.
- Unknown, missing and malformed credentials get 401. No configuration gets 503. User session cookies never grant access.
- To create a token: `openssl rand -hex 32`. Hash it with `printf %s "$TOKEN" | sha256sum`.

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
| SPAK_REVIEWERS | `id:sha256hex` entries, one per reviewer. Server only. Preferred |
| SPAK_ADMIN_TOKEN | Legacy single shared reviewer token, identity `shared-admin`. Avoid when there is more than one reviewer |

The others (CRON_SECRET, SPAK_MONITOR_SECRET, SPAK_RPC_*) are unchanged.

## Testing

| Kind | File |
|---|---|
| Classification rules (pure) | tests/failures/classify.test.ts |
| Mocked provider and chain, real SQL: refund lifecycle, partial, delayed, wrong recipient, wrong asset, failed tx, confirmations, idempotency, concurrency, tampered and duplicate refs, cross-user, rate limit, cancel guard, manual review | tests/failures/refunds.test.ts |
| Routes: auth, ownership, origin, validation, reviewer credentials | tests/failures/routes.test.ts |
| Association: provider-listed vs candidates, time window, wrong chain, provider not confirming, amount missing, uniqueness, concurrency, reviewer identity | tests/failures/association.test.ts |
| Real chain: block time and sender for the time check | tests/live/refund-facts.live.test.ts |
| Real chain and provider (LIVE=1) | tests/live/tracking.live.test.ts. The refund verifier uses these same chain verifiers |

## Known limitations

- No real refund was observed. Triggering one needs a funded swap that fails. Not done.
- Association relies on NEAR Intents listing the refund transaction in `originChainTxHashes`. The docs do not promise refunds are listed there. If they are not, every real refund ends in ASSOCIATION_PENDING or DELAYED and needs manual handling with the provider. Fail-closed behaviour; check this before production.
- The REFUNDED response shape comes from the OpenAPI spec, not a live response.
- The refund time window (deadline + 7 days) is SPak policy.
- The refund fee formula is not documented by the provider.
- Native EVM refunds through an internal call cannot be verified without trace RPC. They stay UNVERIFIABLE.
- There is no admin web screen yet, only the API.

## Before production

1. Run one small funded swap that NEAR Intents refunds (for example, deposit below the quoted amount). Confirm the REFUNDED response fields and whether the refund hash appears in `originChainTxHashes`.
2. Confirm the time window against the observed refund timing.
3. Configure `SPAK_REVIEWERS` with one token per person. Do not use `SPAK_ADMIN_TOKEN` for more than one person.
4. Use paid RPC endpoints (`SPAK_RPC_<NETWORK>`).
5. Run `npm test` and `LIVE=1 npm run test:live`.
