# SPak Execution Tracking and Destination Verification

Phase 4. Extends SPak Execution. No second engine: the monitor calls the existing deposit verifier, the existing provider status check, and a new destination verifier, over the same records.

## Architecture

| Part | File | Job |
|---|---|---|
| Execution State Manager | src/execution/state.ts | Maps provider status to states. Never assigns COMPLETED |
| Provider check | ExecutionService.checkProvider (src/execution/service.ts) | One 1Click status call. Used by user refreshes and the monitor |
| Destination verifier | src/tracking/destination.ts, src/tracking/verifiers/* | Reads the destination chain. The only path to COMPLETED |
| Execution monitor | src/tracking/monitor.ts | Claims due executions, runs the three checks, schedules the next one |
| Tracking service | src/tracking/service.ts | User-facing view, events, refresh |
| Records | src/tracking/records.ts | Claims, leases, attempts, runs, verification rows |

## Execution states

DRAFT, QUOTED, AWAITING_APPROVAL, AWAITING_DEPOSIT, PROCESSING, VERIFYING_DESTINATION (new), COMPLETED, FAILED, EXPIRED, REFUNDED, UNKNOWN, CANCELLED.

Deposit states stay separate (see SPAK-DEPOSIT-FLOW.md).

The UI shows 7 steps, derived from both:

1. Transaction approved: approvedAt set.
2. Deposit submitted: a deposit has a tx hash, or the provider reports an origin tx.
3. Deposit confirmed: a deposit is CONFIRMED by SPak on the source chain.
4. Cross-chain processing: execution PROCESSING or later.
5. Destination transaction detected: the provider reported a destination tx hash.
6. Destination verification: execution VERIFYING_DESTINATION.
7. Completed: SPak verified delivery.

Rules:

- A confirmed source deposit moves the execution to PROCESSING. It is never expired for "no deposit".
- Provider SUCCESS with destination tx hashes moves it to VERIFYING_DESTINATION. Without hashes it stays PROCESSING.
- COMPLETED is allowed only from VERIFYING_DESTINATION, set by the destination verifier.
- A missing provider status field changes nothing. Seen tx references are never erased by an incomplete response.
- Delays never become FAILED. FAILED comes only from the provider's FAILED status.

## Provider status handling

| 1Click | SPak |
|---|---|
| PENDING_DEPOSIT, 404 | Waiting. EXPIRED after the deadline only if no confirmed deposit and not processing |
| KNOWN_DEPOSIT_TX, INCOMPLETE_DEPOSIT, PROCESSING | PROCESSING |
| SUCCESS + destination txs | VERIFYING_DESTINATION |
| SUCCESS without destination txs | PROCESSING |
| FAILED | FAILED |
| REFUNDED | REFUNDED |
| Unknown value | UNKNOWN |
| Missing status | No change |
| 429, 5xx, timeout, network error | No change. Retry with backoff. PROCESSING over 30 minutes without an answer becomes UNKNOWN |

A status response signed for a different quote is ignored. Provider references kept for reconciliation: deposit address, memo, firm quote signature and correlation id, origin and destination tx hashes, provider status and its update time.

## Destination verification

Expected values come from the approved execution, never from the provider: recipient, destination asset id, token contract or mint from the asset registry, and the firm quote's minimum output.

Every destination tx hash gets a `spak_destination_verifications` row. The unique (network, tx_hash) index means a tx can prove delivery for one execution only. A tx already linked to another execution sends this one to UNKNOWN for review.

| Network | How | Final when |
|---|---|---|
| EVM tokens | Receipt status 1. Sum of Transfer logs from the exact token contract to the recipient, any emitter path | 3 confirmations (Polygon 32, BSC and Gnosis 5) |
| EVM native | Direct transfer to the recipient. Internal transfers return UNVERIFIABLE | same |
| Solana SPL | Recipient owner's balance change for the exact mint. Covers Token, Token-2022, inner instructions, new token accounts | finalized |
| Solana SOL | Recipient's lamport increase. Wrapped SOL is a separate mint and is not counted as SOL | finalized |
| NEAR | EXPERIMENTAL_tx_status receipts: Transfer to the recipient, or ft_transfer / ft_transfer_call on the exact token contract. Failed receipts and system gas refunds are ignored | FINAL |

Outcomes per tx: CONFIRMED, PENDING, NOT_FOUND, FAILED, NO_TRANSFER, UNVERIFIABLE.

The execution decision:

- Any tx pending, not found, unverifiable, or an RPC error: stay VERIFYING_DESTINATION and retry.
- All final, and the recipient received at least the approved minimum: COMPLETED, with `amountOutVerified`.
- All final, but less than the minimum or nothing: UNKNOWN with NEEDS_RECONCILIATION. Never FAILED, never COMPLETED.

Supported destination families: EVM (ethereum, base, arbitrum, optimism, polygon, bsc, avalanche, gnosis), Solana, NEAR. Other registry networks (bitcoin, tron, sui, xrp, dogecoin, litecoin, ton, stellar, aptos) return UNVERIFIABLE. Those executions stop at VERIFYING_DESTINATION and then UNKNOWN for manual review.

## Background worker

`GET` or `POST /api/internal/monitor`. Each run:

1. Picks up to 25 executions in AWAITING_DEPOSIT, PROCESSING, VERIFYING_DESTINATION or UNKNOWN that have a deposit address, are due, have no live lease and were not given up.
2. Claims each atomically: `UPDATE ... SET lease WHERE lease IS NULL OR lease < now`. One worker per execution.
3. Verifies pending source deposits, checks the provider, verifies destinations.
4. Records a `spak_monitor_attempts` row and releases the lease with the next check time.
5. Stops after 45 seconds. The rest waits for the next run.

| Setting | Value |
|---|---|
| Lease | 2 minutes. A crashed worker's executions are picked up after it ends |
| Next check after success | 60 s awaiting deposit, 30 s processing or verifying, 5 min unknown |
| Retry after failure | 30 s, doubling, max 30 min |
| Give up | 24 consecutive failures, 7 days in flight, or NEEDS_RECONCILIATION. The execution moves to UNKNOWN and is flagged |
| Resume | A user refresh clears the give-up flag |

Every step is compare-and-set, so concurrent or repeated runs do not duplicate events or verifications. Each run writes a `spak_monitor_runs` row.

### Schedulers

- Vercel Cron, in `vercel.json`: daily at 04:17 UTC. Hobby plans allow one run a day. On Pro, change the schedule to `*/5 * * * *`. Vercel sends `Authorization: Bearer $CRON_SECRET`. Crons run on production only.
- GitHub Actions, in `.github/workflows/monitor.yml`: every 5 minutes. Set repository secrets `SPAK_MONITOR_URL` (https://usespak.vercel.app/api/internal/monitor) and `SPAK_MONITOR_SECRET`. GitHub may delay scheduled runs.
- The tracking page also requests a permitted refresh every 15 seconds while it is open. Monitoring does not depend on it.

No in-memory timers or node-cron.

## API

| Method | Path | Auth |
|---|---|---|
| GET | /api/executions/:id/tracking | Session, owner, rate limited |
| GET | /api/executions/:id/events | Session, owner, rate limited |
| GET | /api/executions/:id/destination | Session, owner, rate limited |
| POST | /api/executions/:id/refresh | Session, owner, same origin, empty body, 20 per minute |
| GET, POST | /api/internal/monitor | Bearer CRON_SECRET or SPAK_MONITOR_SECRET (min 16 chars, constant-time compare). 503 if none is set |

Another user's execution returns 404. The monitor response has counts only.

## Database

Migration `0004_execution_tracking.sql`, additive:

- `spak_executions`: amount_out_verified, destination_verified_at, monitor_lease_owner, monitor_lease_until, monitor_next_at, monitor_failures, monitor_gave_up_at. Index on (state, monitor_next_at).
- `spak_destination_verifications`: one row per destination tx. Unique (network, tx_hash).
- `spak_monitor_attempts`: every attempt with outcome and error detail.
- `spak_monitor_runs`: every worker run.

Migrations run in the Vercel build (`npm run db:migrate && npm run build`).

## Environment variables

| Name | Purpose |
|---|---|
| CRON_SECRET | Vercel Cron bearer token. Set it in Vercel |
| SPAK_MONITOR_SECRET | Bearer token for the external scheduler |
| SPAK_RPC_<NETWORK> | RPC endpoints, comma separated, for failover. Public defaults rate-limit. Use paid endpoints in production |
| DATABASE_URL, SPAK_APP_ORIGIN, ONECLICK_API_KEY | As before |

## Testing

| Kind | File |
|---|---|
| Mocked chain: destination verifiers for EVM, Solana, NEAR | tests/tracking/verifiers.test.ts |
| Mocked provider: status responses, lifecycle mapping | tests/tracking/provider.test.ts |
| Mocked provider and chain, real SQL: monitor flow, concurrency, leases, retries, give-up, idempotency, cross-user | tests/tracking/monitor.test.ts |
| Routes: auth, ownership, origin, validation, internal endpoint auth | tests/tracking/routes.test.ts |
| Real chain and provider data | tests/live/tracking.live.test.ts (LIVE=1) |

## Known limitations

- No funded cross-chain transfer was run. End-to-end delivery was tested with mocked data. The verifiers were tested on real Base and Solana mainnet transactions.
- No real NEAR Intents withdrawal was verified. NEAR delivery logic is tested with mocked receipts. Real NEAR RPC was only checked for an unknown hash.
- NEAR lookups assume intents.near as the signer (NEAR_DESTINATION_SIGNERS). A relayer-signed hash with another signer returns NOT_FOUND and the execution stays pending.
- EVM native delivery through an internal call cannot be seen without trace RPC. It stays unverifiable and is flagged for review.
- Hobby Vercel crons run once a day. Use the GitHub Actions scheduler or Vercel Pro for 5-minute monitoring.
- Reconciliation is manual. Flagged executions show in the UI. There is no admin screen yet.

## Phase 5

FAILED and REFUNDING are monitored too. Provider REFUNDED now moves to REFUNDING; REFUNDED needs source-chain verification. See SPAK-FAILURE-REFUNDS.md.
