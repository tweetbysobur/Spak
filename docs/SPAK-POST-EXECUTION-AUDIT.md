# SPak post-execution audit

> **Remediation update (2026-11-14).** Every finding below has been worked on. Current statuses are in the table at the
> end of this document ("Remediation status") and in `docs/SPAK-SHIPPING-READINESS.md`. The original findings are kept
> unchanged above it as the audit record.

| | |
| --- | --- |
| Scope | First real end-to-end settlement on the isolated Tidepool testnet, execution `exe_adf513ec746688a2cddd7019` |
| Branch and commit | `feature/spak-agent-execution` at `a93a5c5` |
| Date | 2026-11-14 |
| Status key | PASS (verified with evidence), PARTIAL (works, with a stated gap), FAIL (defect or false output), NOT TESTED |

This is a review, not an external audit. Evidence is in `docs/SPAK-TESTNET-EXECUTION-EVIDENCE.md`.

## Summary

| Area | Status |
| --- | --- |
| Evidence preserved, no secrets | PASS |
| Lifecycle from instruction to COMPLETED | PASS |
| Destination verification against the real token transfer | PARTIAL (A-4: not bound to time or sender) |
| Verification fix in `a93a5c5` | PASS, with a leftover display defect (A-3: FAIL, low) |
| Wallet key handling (Doppler) | PARTIAL (S-1, S-2) |
| Quote signatures | PASS on testnet; PARTIAL for mainnet (S-3) |
| Deposit authorisation, replay protection, idempotency | PASS |
| Agent permissions and Guard | PASS, with a shared trust note (S-6) |
| Status transitions, false COMPLETED | PASS (single path), see A-4 |
| Failure handling | Mostly PASS with mocks; mostly NOT TESTED live |
| Production readiness | Not ready: 9 blockers (section 7) |

## 1. Evidence preservation

| ID | Finding | Status |
| --- | --- | --- |
| E-1 | Evidence files in `/root/spak-e2e/` were found: four run JSONs, one server log and helper scripts. They were scanned for 64-hex values and token prefixes. The only 64-hex values are the two transaction hashes; there are no keys or tokens. The local wallet key file was shredded earlier, and the key now lives only in Doppler. | PASS |
| E-2 | A durable copy is in the repository (`docs/SPAK-TESTNET-EXECUTION-EVIDENCE.md`). It holds hashes, explorer links, identifiers, quote data, verification records, every state transition and every Guard decision. | PASS |
| E-3 | The raw JSON files and the testnet database live on a temporary container and will be lost when it is reclaimed. Tidepool keeps its own copy only in a JSON file with no SLA. The chain data is permanent. | PARTIAL |

## 2. Review of the successful execution

### Lifecycle, and who decided each step

| Step | Decided by | Trusts Tidepool for | Status |
| --- | --- | --- | --- |
| Sign-in and wallet ownership | Server: EIP-4361 signature, single-use challenge | nothing | PASS |
| Agent identity | Server: NEP-413 signature (implicit account, so key equals account) | nothing | PASS |
| Interpretation and plan | Server: deterministic SPak-in on the testnet registry | nothing | PASS |
| Guard (plan) | Server | nothing | PASS |
| Asset resolution | Server: testnet registry checked against Tidepool's live `/v0/tokens` (chain, decimals, contract) | the token listing | PASS |
| Indicative and firm quote | Server: request echo, amount, slippage floor, fee ceiling, deposit address format, deadline, and the signature against Tidepool's maker key | price, `amountInUsd`, the deposit address being Tidepool's | PASS |
| Guard (quote and firm quote) | Server | `amountInUsd` for the USD limits (S-6) | PASS |
| Agent approval | Server: grant assessment and Guard reservation in one transaction, with rows locked | `amountInUsd` (S-6) | PASS |
| Deposit instructions | Server: approval, quote, wallet, Agent and grant re-checked, full Guard re-check, balance read on Base Sepolia | nothing | PASS |
| Deposit | User wallet (disposable key from Doppler), after the pre-sign checks | nothing | PASS |
| Deposit verification | Server, on Base Sepolia: sender, recipient, exact amount, success, 29 confirmations | nothing | PASS |
| AWAITING_DEPOSIT to PROCESSING to VERIFYING_DESTINATION | Server, from Tidepool `/v0/status` | status and the list of destination hashes | PASS (by design, these are informational states) |
| VERIFYING_DESTINATION to COMPLETED | Server, on Arbitrum Sepolia: receipt success, exact token contract, recipient, sum at or above the approved minimum, confirmations | which transaction to look at (A-4) | PARTIAL |

### Transitions

| ID | Finding | Status |
| --- | --- | --- |
| L-1 | All 7 events follow the allowed transition table (`src/execution/state.ts`). COMPLETED was reached only through `DestinationVerifier`. | PASS |
| L-2 | The Guard reservation was written in the approval transaction and CONSUMED on COMPLETED in the same transaction as the state change. | PASS |
| L-3 | The firm quote was marked USED and the indicative quote SUPERSEDED. The approval was never invalidated. | PASS |
| L-4 | Tracking advanced only because the runner called `/refresh`. No scheduled monitor runs in the testnet environment (no `SPAK_MONITOR_SECRET` caller). | PARTIAL |
| L-5 | 17.5 minutes in VERIFYING_DESTINATION came from defect A-2. Tidepool settled 21 s after the deposit was seen. | PASS after the fix |

### Destination verification

| ID | Finding | Status |
| --- | --- | --- |
| A-1 | SPak read the Arbitrum Sepolia receipt and decoded the ERC-20 Transfer log from the exact USDC contract to the user: 3,796,820 units with 19 confirmations. The balance check outside SPak agrees (0 to 3,796,820), and the sender is Tidepool's published vault. | PASS |
| A-4 | **The destination check is not bound to time or sender.** Any successful transfer of the token to the recipient counts if the provider lists its hash, including one older than this deposit or unrelated to it. A transfer cannot be counted twice across executions (unique index on network and hash). But a lying or buggy provider could point at a previous, unrelated transfer to the same wallet and SPak would mark COMPLETED. Recommended: require the destination block to be after the source deposit's block time (or after approval), and record the sender. Mainnet 1Click has the same exposure. | PARTIAL (medium) |
| A-5 | `EVM_MIN_CONFIRMATIONS` has no testnet ids, so the testnet chains use the default of 5. That is safe, but implicit. | PARTIAL (low) |

## 3. The verification defect and the fix

| ID | Finding | Status |
| --- | --- | --- |
| A-2 | **Defect:** Tidepool lists its NEAR settlement hash (`isvXCRDG…`) among `destinationChainTxHashes`. SPak checked it as an Arbitrum transaction, where it can never be found. That kept the result "not all final" and blocked COMPLETED. | FAIL, fixed in `a93a5c5` |
| A-2a | **The fix:** on EVM destinations, references that are not 32-byte `0x` hashes are recorded as ignored (in the COMPLETED event data as `ignoredNonChainReferences`, and in the audit log) and never counted. With no valid reference left, the execution goes UNKNOWN, never COMPLETED. Two regression tests cover both cases. It only removes references; it cannot add value to the total. | PASS |
| A-2b | The fix applies to EVM destinations only. A NEAR hash on a Solana or NEAR destination is format-ambiguous and would still be checked on that chain. That is a safe failure (pending, then reconciliation), not a false success. | PARTIAL |
| A-3 | **Leftover:** record `dvf_fbccea7b0368a92ad14b0153` (`isvXCRDG…` registered as `arbitrum-sepolia`) stays PENDING forever. It was created before the fix, and the fixed verifier now skips the hash, so nothing ever updates it. The tracking view returns all records, so a COMPLETED transfer shows a "pending" destination transaction with a broken Arbiscan link. That breaks the rule "never show what is not true". | FAIL (low) |

**Proposed cleanup for A-3. Not applied: it is a code change, and you asked for no commits before review.**
1. Add an outcome `IGNORED_NOT_ON_CHAIN`, which needs no constraint change: `outcome` has no check constraint.
2. In `DestinationVerifier.verify`, for each ignored reference, update any existing record for that execution and hash to that outcome. Add a problem note ("provider settlement reference, not a destination-chain transaction"). Use the normal update path, so attempts and `lastCheckedAt` are kept.
3. In the tracking view, show such records as "Provider reference, not checked on <chain>", with no explorer link, or a NEAR testnet link when the hash is NEAR-shaped.
4. Never delete the row and never touch the execution state. Next time someone opens the execution, it moves the row to the new outcome.
5. Add a regression test.

## 4. Security

| ID | Finding | Status |
| --- | --- | --- |
| S-1 | The wallet key is read from Doppler at run time into memory only. Scripts print only addresses and status codes, and refuse to run if the key derives a different address. The token is injected by the network proxy and never seen by the scripts. The local copy was shredded after a read-back check from a separate container. A write with the read-only token was refused (403). | PASS |
| S-2 | The Doppler credential is saved at the environment level. Every session in this cloud environment can read the wallet key, which is broader than "one script". The read/write token and the old `dev_tweetbysobur` token were not confirmed revoked. When the local file was shredded, the Agent-owner NEAR key in it was lost; it was never in Doppler. The Agent was replaced, and no funds were affected. | PARTIAL |
| S-3 | Tidepool quotes must carry a valid signature from the maker key, or they are rejected. The real signature and 8 tamper cases are tested against real fixtures. On **mainnet** the check is off unless `SPAK_ONECLICK_VERIFY_SIGNATURES=1`, and the mainnet key was copied from the SDK but has never been tested against a live 1Click quote. Status responses compare the signature string with the stored quote; they do not re-verify it. | PASS testnet / PARTIAL mainnet |
| S-4 | **Deposit authorisation:** deposit instructions need all of these: <ul><li>a live approval bound to the firm quote, plan hash and revision</li><li>the deposit address and amount matching the quote</li><li>a deadline still in the future</li><li>the sender being the user's verified wallet on that network</li><li>the Agent able to act</li><li>for Agent approvals, the exact grant version active and the full Guard re-check passing</li><li>a live reservation</li></ul>SPak never signs; the wallet does. | PASS |
| S-5 | **Replay protection and idempotency:** <ul><li>Challenges (sign-in, Agent, grant) are single-use, short-lived and bound to the domain.</li><li>Execution creation is idempotent per key and per plan, and a plan cannot be re-attributed between manual and Agent.</li><li>A live approval is unique per execution.</li><li>A deposit transaction can fund one deposit only.</li><li>A destination hash can belong to one execution only.</li><li>The duplicate-transfer guard was proven live (409).</li></ul> | PASS |
| S-6 | **Agent permissions and Guard:** <ul><li>Limits are checked inside the approval transaction with the Agent, grant and policy rows locked.</li><li>Concurrency is proven on PostgreSQL 16 with separate connections (10 parallel approvals against a cap of 3 give exactly 3).</li><li>Revoke while approvals are in flight is covered.</li><li>Live: out-of-permission token and revoked permission both refused.</li></ul>**Shared trust:** every USD limit (Guard per-transfer, daily, grant limits) uses the provider's `amountInUsd`. A provider that under-reports value bypasses the USD caps; SPak has no price source of its own. | PASS / PARTIAL (USD trust) |
| S-7 | **Status transitions:** COMPLETED has one code path (`DestinationVerifier`). REFUNDED has one (source-chain refund verification). Provider SUCCESS alone moves only to VERIFYING_DESTINATION. Terminal states have no exits. | PASS |
| S-8 | **False COMPLETED:** none found in code, except the provider-trust gap A-4. | PARTIAL (see A-4) |
| S-9 | **Environment separation:** testnet and mainnet are separate builds, registries and RPCs, with a database marker checked before any write. The testnet run refused a Solana (mainnet-only) instruction live. | PASS |
| S-10 | **Rate limiting:** the limiter is in process memory. It is reset by restarts, not shared between instances, and keys on `x-forwarded-for` when no user is known (spoofable without a trusted proxy). | PARTIAL |
| S-11 | The lifecycle and send scripts are test tooling, not product code. The send script re-checks the quote fields and deadline but does not re-verify the signature itself; it relies on the server's check at quote time. | PARTIAL (low) |

## 5. Failure handling

| Case | Mocked tests | Live testnet | Status |
| --- | --- | --- | --- |
| Expired quote or approval | yes (quote expiry, firm TTL, approval TTL) | approval expiry 410 | PASS |
| Insufficient balance | yes | read from Base Sepolia, 422 | PASS |
| Failed deposit (reverted, wrong sender or amount) | yes (`tests/deposits`) | no | PARTIAL |
| Delayed settlement | yes (backoff, UNKNOWN after 30 min, never FAILED) | no | PARTIAL |
| Incorrect destination amount | yes (below minimum goes UNKNOWN for reconciliation) | no | PARTIAL |
| Wrong recipient or token | yes (verifier problems, then UNKNOWN) | no | PARTIAL |
| Duplicate callbacks | no webhooks exist; SPak polls. Repeated status and refresh calls are idempotent (tests) | repeated refresh and monitor calls | PASS |
| RPC failures | yes (fallback endpoints, `RpcUnavailable` changes nothing) | no | PARTIAL |
| Refund uncertainty | yes. Refund evidence defaults to UNCONFIRMED in production, so a refund is never claimed on the provider's word | no | PARTIAL / NOT TESTED live |
| Provider refusal | yes | Tidepool's 0.006 ETH cap surfaced as 422 QUOTE_REJECTED | PASS |

## 6. Test coverage

Gate results from this audit (commit `a93a5c5` plus these two documents):

| Gate | Result |
| --- | --- |
| Lint | PASS, no findings |
| Type check | PASS, no errors |
| Tests, in-process Postgres (PGlite) | PASS, 741/741 in 53 files |
| Tests, PostgreSQL 16 (fresh database per test, real pool) | PASS, 741/741 in 53 files (341 throwaway databases, dropped afterwards) |
| Production build, mainnet | PASS |
| Production build, testnet | PASS (`.next-testnet`) |
| Schema drift (drizzle) | PASS, no schema changes |

| ID | Finding | Status |
| --- | --- | --- |
| T-1 | PostgreSQL concurrency is covered for approvals, grant caps and revoke during approval, with separate connections and row locks. | PASS |
| T-2 | **Covered only by mocks:** the 1Click and Tidepool provider (`Fake1Click`), source and destination chain RPC (`FakeChain`), NEAR key lookups, refunds, failure classification and the background monitor. | PARTIAL |
| T-3 | **Missing integration tests:** <ul><li>an automated Tidepool test (quote, deposit, status) that is repeatable without a human</li><li>destination verification against a recorded real receipt (the Arbitrum receipt above could become a fixture)</li><li>a test that the A-3 record is shown truthfully</li><li>the A-4 time binding</li><li>monitor scheduling on testnet</li><li>RPC failover against real endpoints</li><li>Solana and NEAR destinations on testnet (not supported)</li></ul> | NOT TESTED |
| T-4 | Browser checks exist (mainnet agent, guard, permissions, branding, marketing; testnet 6/6). They are not part of `npm test` and must be run by hand. | PARTIAL |

## 7. Production blockers

| ID | Blocker | Status |
| --- | --- | --- |
| P-1 | **Official NEAR Intents (1Click mainnet):** the whole deposit-to-COMPLETED path has never run against 1Click with real funds. The 1Click signature check is untested live and off by default. Mainnet now settles confidentially (see Tidepool's compatibility notes), so destination hashes and status may differ from Tidepool. | NOT TESTED |
| P-2 | **Agent account funding and identity:** no dedicated Agent account exists because the testnet parent account is not configured. The funding read is proven only against other real accounts. The Agent owner key in this run was an implicit testnet key held in memory. Mainnet Agent accounts are out of scope by design. | NOT TESTED |
| P-3 | **Production migrations:** 0015–0017 are unapplied in production. 0017 adds the environment marker. The first mainnet server must start before anything else touches the database. Rollback is not scripted (Drizzle migrations are forward-only). | NOT TESTED |
| P-4 | **Monitoring and alerting:** the monitor endpoint exists but has no scheduler configured outside Vercel Cron. There are no alerts on UNKNOWN, stuck VERIFYING_DESTINATION, RPC exhaustion or Guard unavailability. | FAIL |
| P-5 | **Refund operations:** refunds are verified on chain, but refund evidence from NEAR Intents is UNCONFIRMED. Manual review exists, and there is no runbook for operators. | PARTIAL |
| P-6 | **Rate limiting:** see S-10. It needs a shared store for more than one instance. | PARTIAL |
| P-7 | **Deployment and rollback safety:** no staged rollout for this branch, the testnet build is not deployed anywhere, and there is no rollback plan for 0015–0017. | NOT TESTED |
| P-8 | **Destination time binding:** see A-4. | PARTIAL |
| P-9 | **USD limits rely on the provider's value:** see S-6. | PARTIAL |

## 8. Recommended next actions, in order

1. Fix A-3: show the leftover record truthfully, with no deletion and no state change. Small, and it touches only display and verifier bookkeeping.
2. Fix A-4: bind destination evidence to after the source deposit (block timestamp) and record the sender. Add tests using the real Arbitrum receipt as a fixture.
3. Revoke the unused Doppler tokens. Decide whether an environment-wide credential is acceptable, or move test runs to a dedicated environment.
4. Add a scheduled monitor and alerts (P-4) before any further live run.
5. Make the Tidepool lifecycle repeatable (a funded wallet, plus a CI-style runner behind a flag), and cover failure cases live: a deposit after the deadline (refund path), wrong amount and RPC failover.
6. Only then plan a 1Click mainnet canary: smallest amount, user-signed, signature verification on, and stop-on-failure.


## Remediation status (2026-11-14)

Allowed statuses: PASS (implemented and verified), PARTIAL (implemented, not fully verified), FAIL (unresolved), NOT APPLICABLE.

| ID | Original status | Root cause | Change | Regression tests | Verification evidence | Final status |
| --- | --- | --- | --- | --- | --- | --- |
| A-2 | FAIL, fixed in `a93a5c5` | NEAR hash treated as an EVM tx | Non-chain references ignored on EVM destinations | `tests/tracking/monitor.test.ts` (2) | Real execution COMPLETED after the fix | PASS |
| A-3 | FAIL (low) | Pre-fix record never revisited | `NOT_DESTINATION_CHAIN` outcome via `classifyReferences` on refresh (any state); view hides links; text kept | `tests/tracking/destination-binding.test.ts` (A-3: mixed refs, historical record, repeated refresh, correct ref untouched) | Real record `dvf_fbccea7b0368a92ad14b0153`: PENDING to NOT_DESTINATION_CHAIN, attempts 88 to 89, `previousOutcome` kept; execution unchanged (state, amount, timestamps, 7 events) | PASS |
| A-4 | PARTIAL (medium) | No time or sender binding | `bind()`: chain id, token, recipient, trusted sender (`src/tracking/route-trust.ts`), block at or after the source deposit, finality, uniqueness, evidence v2 | Real Arbitrum receipt fixture (7 cases) and service cases (older, wrong sender, wrong recipient, wrong token, below minimum, reused receipt, no chain evidence, low confirmations, RPC failure, no trusted sender) | Fixture replay accepts the real payout (vault sender, 22 s after the deposit) | PARTIAL: no live settlement under v2. Base and Arbitrum mainnet senders now established from the official PoA bridge API plus 29 on-chain payouts, and a real Arbitrum mainnet payout replays through the verifier (`tests/tracking/mainnet-payout-senders.test.ts`). Other mainnet EVM networks and Solana: manual review |
| A-5 | PARTIAL (low) | Testnet ids missing from the confirmation table | Unchanged: default 5 applies | n/a | n/a | PARTIAL |
| S-1 | PASS | | | | | PASS |
| S-2 | PARTIAL | Environment-wide credential | Static guard: no application code reaches Doppler or the key; review list in the readiness doc | `tests/ops/alerts.test.ts` (static) | Doppler token previews identified | PARTIAL: dashboard review and dedicated environment pending |
| S-3 | PARTIAL mainnet | Opt-in 1Click check, untested | Mandatory everywhere; no off switch; key swap refused; fake provider signs with a test key | `tests/integrations/oneclick-signature.test.ts`, `tests/tidepool/*`, engine bad-signature test | Real 1Click dry and firm quotes (2026-11-14) verify with 1Click's key and fail with Tidepool's | PASS |
| S-6 | PARTIAL | Provider USD authorised spending | `src/pricing`: Chainlink primary, CoinGecko with agreement, depeg, staleness, 3% deviation; quote stores `valuation_usd` (migration 0018) | `tests/pricing/valuation.test.ts` (20) | Live Chainlink: 9 feeds identity-checked; 0.002 ETH = $3.792501 vs Tidepool $3.8148 (0.59%) | PARTIAL: applied to live 1Click mainnet quotes for the canary route (5 USDC Base to Arbitrum: $5.000000, 4 bps from the provider; Guard blocks it under $4.99); not yet in a settlement |
| S-7, S-8 | PASS, PARTIAL | | A-4 closes the gap in S-8 | | | PASS (code), A-4 remains PARTIAL live |
| S-9 | PASS | | | | | PASS |
| S-10 | PARTIAL | In-memory limiter | PostgreSQL limiter (migration 0019), trusted proxy, unauthenticated half limits, 503 on store failure | `tests/ops/rate-limit.test.ts` | PostgreSQL 16: 50 parallel requests against limit 20 allow exactly 20; shared across instances and restarts | PASS (Local integration) |
| S-11 | PARTIAL (low) | | Unchanged | | | PARTIAL |
| L-4 | PARTIAL | Scheduler not configured; audit missed `.github/workflows/monitor.yml` | Testnet step added; Vercel daily backstop kept | `tests/tracking/monitor.test.ts` | Not observed in a deployment | PARTIAL |
| P-4 | FAIL | No alerting | `src/ops/log.ts`, `src/ops/alerts.ts`, monitor wiring | `tests/ops/alerts.test.ts` | Delivery to a local receiver with HMAC | PARTIAL: no real destination |
| P-5 | PARTIAL | | Reviewed; unchanged | `tests/failures/*` | Mock only | PARTIAL |
| P-2 | NOT TESTED | No parent account | `scripts/agent-parent-preflight.ts` (read-only) | n/a | Preflight fails closed without configuration | FAIL (blocked on authorization) |
| P-3 | NOT TESTED | | Upgrade tested from a populated 0014 database | `tests/database/upgrade.test.ts` | PGlite and PostgreSQL 16 | PASS (local); production apply not done by rule |
| P-1 | NOT TESTED | | Official 1Click quotes verified | | Quotes only | FAIL (needs an authorised mainnet canary) |
| P-6 | PARTIAL | | S-10 | | | PASS (Local integration) |
| P-7 | NOT TESTED | | Procedure in the readiness doc | | | PARTIAL |
| P-8, P-9 | PARTIAL | | A-4, S-6 | | | PARTIAL |
| E-3 | PARTIAL | | Docs in repository | | | PARTIAL until committed |
| T-2, T-3 | PARTIAL, NOT TESTED | | Real fixtures (Arbitrum receipt, 1Click quotes), live price test, PostgreSQL suite, upgrade test | | | PARTIAL: provider and refund lifecycles still mock-only |

Corrections to the original audit:
- L-4 said no scheduler existed. A 5-minute GitHub Actions scheduler (`execution-monitor`) was already in the repository; what was missing was configuration and a testnet step.
- Section 2 said the send script did not re-verify signatures. That is still true (S-11).
