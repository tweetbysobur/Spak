# SPak shipping readiness

| | |
| --- | --- |
| Branch | `feature/spak-agent-execution` (base `a93a5c5`, remediation uncommitted at time of writing) |
| Date | 2026-11-14 |
| Verdict | **Not ready for production.** Ready to prepare one authorized mainnet canary (section 15). Blockers in section 12. |

Statuses: PASS (implemented and verified at the stated level), PARTIAL (implemented, not fully verified), FAIL (unresolved), NOT APPLICABLE.

Evidence levels used below: **Unit** (pure code), **Mock** (fake provider or chain), **Local integration** (real SQL on PostgreSQL 16 or PGlite, real HTTP locally), **Live testnet** (real Tidepool sandbox and public testnets), **Official 1Click** (real 1Click mainnet API, quotes only), **Mainnet** (real funds). Nothing has reached the Mainnet level. **Mainnet read-only** below means real mainnet chain data or live 1Click quotes, with no funds moved.

## 1. Product architecture (unchanged north star)

SPak is an intelligent cross-chain execution agent built on NEAR. It understands what a user wants, finds a route, and coordinates the transaction through NEAR infrastructure. Two directions, equally important: a consumer agent (natural language and manual controls) and developer infrastructure (APIs and SDKs for wallets and apps).

| Module | Role | State |
| --- | --- | --- |
| SPak-in | Deterministic intent interpretation | Live (mainnet and testnet registries) |
| SPak Execution | Orchestration and settlement through NEAR Intents | Live; destination proof hardened this sprint |
| SPak Guard | Permission and spending control | Live; values now independent of the provider |
| SPak Agent | NEAR-proven identity, permissions, dedicated NEAR account | Identity and permissions live; dedicated account blocked on a testnet parent account |
| SPak Intelligence | Portfolio intelligence | Planned, not built (not in this sprint) |
| Conditional Execution | Scheduled and trigger-based actions | Planned; SPak-in understands them, nothing runs them |
| SPak Connect | Developer integration layer | Planned; no public API or SDK yet |

## 2. NEAR integration status

| Area | Status | Evidence |
| --- | --- | --- |
| NEAR Intents 1Click as the execution provider (mainnet) | PARTIAL | Official 1Click quotes and signatures verified live (quotes only). No mainnet settlement has run. |
| NEAR Intents verifier on testnet (via Tidepool, community-run, not affiliated with NEAR or 1Click) | PASS (Live testnet) | One real settlement, `exe_adf513ec746688a2cddd7019` |
| Agent identity (NEP-413 ownership proof from a full-access key) | PASS (Live testnet) | Verified by the server in every testnet run |
| Agent permissions (owner-signed grants under Guard) | PASS (Live testnet) | Agent approved the real settlement under permission v1 |
| Agent funding check (key-free `view_account`) | PARTIAL | Read path verified against real testnet accounts; no dedicated Agent account exists yet |
| Dedicated Agent NEAR account | FAIL (blocked) | Needs a funded testnet parent account; `scripts/agent-parent-preflight.ts` checks it read-only |
| NEAR destination delivery proof | PARTIAL (Mock) | Receipts from `intents.near` only, bound to time; no live NEAR destination run |

Manual approval remains the default. Agents act only inside a signed permission and Guard. Revoked, suspended or expired Agents cannot act (tested). SPak never signs for the user and holds no key on Agent accounts.

## 3. Audit findings and resolutions

| ID | Finding | Resolution | Status |
| --- | --- | --- | --- |
| A-2 | Non-EVM provider reference blocked completion | Fixed in `a93a5c5`; regression tests | PASS |
| A-3 | Stale NEAR reference shown as a pending Arbitrum transaction | New terminal outcome `NOT_DESTINATION_CHAIN`, set through the normal update path on refresh in any state; view never links it; applied to the real record (88 to 89 attempts, previous outcome kept, execution untouched) | PASS |
| A-4 | Destination proof not bound to the execution | Counted only if: right chain id, token, recipient, sender in trusted route evidence, block at or after the source deposit's block, final, not reused, total at or above the minimum. Missing facts stay pending; untrusted or older transfers go to manual reconciliation | PARTIAL: replayed on a real Arbitrum Sepolia receipt and on a real Arbitrum **mainnet** PoA bridge payout through the real EVM verifier; service-tested. Trusted senders established for Base and Arbitrum mainnet (section 14). No live settlement has run under the new rule. Other mainnet EVM networks and Solana still go to manual review |
| S-2 | Wallet key reachable environment-wide | No application path reads Doppler or the key (static test). Credential scope remains environment-wide | PARTIAL: user action needed, section 5 |
| S-3 | Official 1Click signatures unproven | Verification mandatory on mainnet and testnet; cannot be turned off; keys cannot be swapped between providers; proven on real 1Click dry and firm quotes; 10 tamper cases | PASS (Official 1Click, quotes only) |
| S-6 | USD limits trusted the provider | Independent valuation: Chainlink on Ethereum mainnet (identity checked every read), CoinGecko only with provider agreement; stale, missing, invalid, depegged or disagreeing values fail closed; Guard, Agent permissions and the ceiling use SPak's value | PARTIAL: live Chainlink reads verified; applied to live 1Click mainnet quotes for the canary route (indicative and firm, 2026-11-14), and Guard blocked the same live quote under a lower limit; not yet used in a settlement |
| S-10 | In-memory rate limiting, spoofable IP | Shared PostgreSQL limiter, atomic upsert, hashed keys; trusted proxy only; stricter unauthenticated limits; 503 if the store is down | PASS (Local integration, PostgreSQL 16) |
| L-4 | Monitor only advanced on manual refresh | The 5-minute GitHub Actions scheduler existed (the earlier audit missed it); a testnet step was added; Vercel daily backstop kept; idempotent leases, backoff and give-up verified by tests | PARTIAL: not configured in any deployed environment |
| P-4 | No monitoring or alerting | Structured redacted logs at every choke point; alert table with dedupe and auto-resolve; scan rules; signed webhook delivery | PARTIAL: delivery proven to a local receiver only; no real destination configured |
| P-5 | Refund operations | Reviewed: refunds verified on chain, early transactions rejected, evidence UNCONFIRMED by default, manual review alerts | PARTIAL: Mock only |
| E-3 | Evidence on a temporary container | Durable docs in the repository | PARTIAL until committed |
| S-11 | Send script did not re-verify the signature itself | Server verifies at quote time; script re-checks fields and deadline | PARTIAL (low; test tooling) |

## 4. Security controls

- **Quotes:** every quote's signature is verified against the configured provider key. Without a key, nothing is accepted.
- **Value:** SPak's own price, conservative (the higher of SPak's and the provider's figure, stablecoins never below $1). Refused when stale, invalid, depegged or more than 3% from the provider's figure.
- **Approval:** user approval, or Agent approval inside an owner-signed permission. Both run under Guard in one database transaction with the rows locked.
- **Deposit:** only the user's wallet signs it. Deposit instructions re-check the approval, quote, wallet, Agent, grant and full Guard policy.
- **Delivery:** COMPLETED only through execution-bound on-chain proof (A-4).
- **State machine:** COMPLETED and REFUNDED each have one code path; an unexpected transition is refused and raises a CRITICAL alert.
- **Environment separation:** separate builds, registries, RPCs and keys, plus a database marker checked before any write.
- **Rate limits:** shared and atomic; they fail closed.
- **Logs:** sensitive keys and token-shaped values are redacted. Transaction hashes are kept (public evidence).

## 5. Secrets (S-2): what must be reviewed by a person

Doppler tokens cannot be listed or revoked by SPak. Check these in the Doppler dashboard:

| Credential | Scope | Action |
| --- | --- | --- |
| `dp.st…7Ajblo` | `spak-testnet-wallet/dev_tweetbysobur`, read only | Revoke (unused) |
| `dp.st…HROb3v` | `spak-testnet-wallet/dev`, read/write | Revoke (was temporary) |
| `dp.st…tvFBsU` | `spak-testnet-wallet/dev`, read only | Keep while testnet runs continue; it is the only runtime path to the key |

The secret `SPAK_TESTNET_WALLET_PRIVATE_KEY` is the only copy of the disposable wallet key. Do not delete it while the wallet holds test funds.

The saved credential applies to every session in this cloud environment. To narrow it, move signing runs to a dedicated cloud environment that holds only this credential, and remove it from the shared one.

The Agent-owner NEAR key from the first runs was lost when the local key file was shredded. The Agent it owned was revoked and replaced by the normal path; nothing was reconstructed.

## 6. Test evidence (final run on the current working tree, 2026-11-14)

| Suite | Result | Level |
| --- | --- | --- |
| Lint, type check | PASS | |
| Full suite, PGlite | PASS: 826 passed, 1 skipped (the PostgreSQL-only race test), 62 files | Unit, Mock, Local integration |
| Full suite, PostgreSQL 16 | PASS: 827/827 | Local integration |
| Concurrency stress, PostgreSQL 16 | PASS: S-6 races 48/48 runs (3-way and 8-way); Stage 8 claim 24/24 runs plus a deterministic two-session test (fails on the old query, passes on the fix); auth routes 20/20 | Local integration |
| Intermittent failures recorded during this work | S-6 assertion failed 3 of 32 stress runs before the fix (cause: wrong assertion, total 83 is legal). Stage 8 failed once in an earlier full run (cause: real claim race, fixed). Auth per-IP limit failed in one earlier full run and has not reproduced in 26 later runs; cause not identified. One full PostgreSQL run was void because the server died in a worker restart (396 failures in 1 ms each, connection refused) | |
| Schema drift | None | |
| Production builds, mainnet and testnet | PASS | |
| Browser, mainnet build (simulated wallet, real 1Click quotes, live prices) | PASS: app 62/62, Guard 34/34, permissions 16/16 (asserts no Agent approval on Review), Agent pages 20/20 | Local integration |
| Browser, testnet build (Tidepool) | PASS: 6/6 | Live testnet quotes |
| Live, read-only | PASS: payout senders (Base, Arbitrum), Chainlink 9 feeds, canary execution test, five routes into and out of NEAR, NEAR payout verification | Mainnet read-only, Official 1Click (quotes only) |
| Migration upgrade 0014 to 0019 with data | PASS (PGlite and PostgreSQL 16) | Local integration |
| Testnet settlement | One run, before the remediation | Live testnet |
| Mainnet settlement | None | |

## 7. Known limitations

- Mainnet destinations on Base and Arbitrum can auto-complete (PoA bridge sender, section 14). Every other mainnet EVM network and Solana goes to manual review until the same kind of evidence is collected. That is deliberate (fail closed).
- Payouts of tokens bridged by anything other than the PoA bridge (for example `*.omdep.near` assets) have no sender evidence and go to manual review on every network.
- The Arbitrum fallback RPC (publicnode) refuses receipts older than a few minutes without a token. The client now moves to the next endpoint on that answer, but Arbitrum has only two defaults; set `SPAK_RPC_ARBITRUM` to a provider you trust in production.
- Testnet test tokens are valued at their mainnet counterparts' prices, so limits behave the same. They have no value.
- CoinGecko-only assets (for example NEAR) need the provider's figure to agree.
- Assets with no price source cannot be transferred (fail closed).
- Solana devnet and NEAR testnet are not in the testnet registry.
- Alert delivery needs a real https endpoint and secret.

## 8. Environment separation

The build flag `NEXT_PUBLIC_SPAK_NETWORK_ENV` and the server flag `SPAK_EXECUTION_ENV` must match.

- **Testnet:** Tidepool only, `.next-testnet` build, testnet registries and RPCs, database marked `tidepool-testnet`.
- **Mainnet:** 1Click only, `.next` build, database marked `mainnet`.
- **Mixing:** any mixed configuration refuses to start. Trusted senders are accepted only for networks of the running environment.

## 9. Configuration

| Variable | Where | Purpose |
| --- | --- | --- |
| `SPAK_TRUSTED_PROXY=vercel` | both | Trust `x-real-ip` set by Vercel; required for per-address limits |
| `SPAK_ALERT_WEBHOOK_URL`, `SPAK_ALERT_WEBHOOK_SECRET` | both | Alert delivery (https, 16+ character secret, HMAC header `x-spak-signature`) |
| `SPAK_MONITOR_SECRET` (or `CRON_SECRET`) | both | Authenticates the monitor endpoint |
| `SPAK_PRICE_RPC_URL` | both | Ethereum mainnet RPC list for Chainlink reads (default public nodes) |
| `SPAK_TRUSTED_DESTINATION_SENDERS` | mainnet | Optional. Adds payout senders per network to the built-in list, from the same kind of evidence only (section 14) |
| `SPAK_RPC_BASE`, `SPAK_RPC_ARBITRUM` | mainnet | Recommended. Comma-separated RPCs for deposit and delivery checks on the canary route |
| `SPAK_ONECLICK_QUOTE_PUBLIC_KEY` | mainnet | Only if 1Click rotates its key |
| GitHub secrets `SPAK_MONITOR_URL`, `SPAK_MONITOR_SECRET`, `SPAK_TESTNET_MONITOR_URL`, `SPAK_TESTNET_MONITOR_SECRET` | repository | Five-minute scheduler |

The testnet variables are in `docs/TIDEPOOL-TESTNET.md`.

## 10. Migration readiness

| Migration | Content | Environment | Data risk | Rollback or forward fix |
| --- | --- | --- | --- | --- |
| 0015 | `spak_executions.agent_id`, `spak_agent_funding_checks` | both | none (nullable column, new table) | Forward fix. Dropping is safe only before any Agent execution or funding check exists |
| 0016 | Agent grants and challenges; approval provenance columns with a check | both | none (default `USER`) | Forward fix. Dropping loses permission history |
| 0017 | `spak_environment` marker | both | none | Do not drop: the marker is the environment guard |
| 0018 | Quote valuation columns with a check | both | none (nullable) | Forward fix |
| 0019 | Rate-limit counters, alerts | both | none | Counters may be truncated at any time; alerts are history |

**Order:**
1. Back up.
2. Apply 0015 to 0019 in one `npm run db:migrate`. Each migration is transactional in Drizzle.
3. Start one mainnet server on the migrated database first, so it writes the `mainnet` marker before anything else connects.

**Backup and restore:**
- Before migrating: `pg_dump --format=custom --no-owner "$DATABASE_URL" > spak-pre-0015.dump`. Use the provider's point-in-time recovery where available.
- To restore: `pg_restore --clean --if-exists --no-owner -d "$DATABASE_URL" spak-pre-0015.dump`.
- Restoring discards writes made after the dump. Prefer a forward fix.

**Verified:** fresh PostgreSQL 16 (all 20 migrations, idempotent), and an upgrade from a populated 0014 database. Existing rows are unchanged, every new constraint is validated against them, and schema drift is none. The upgrade from the real production database was **not** tested: no production data or dump was used, by rule.

## 11. Deployment and rollback

**Deployment** (not performed in this sprint; needs explicit approval):
1. Confirm the configuration in section 9 on the target environment. Keep testnet and mainnet in separate Vercel projects and databases.
2. Back up the database, then apply the migrations (section 10).
3. Deploy a preview, then promote.
4. **Smoke test:**
   - `GET /app` returns 200.
   - Sign in.
   - A SPak-in interpretation works.
   - A quote is valued and signature-verified (look for `quote.security_rejected` absent in logs).
   - The monitor endpoint returns 200 with an `alerts` field.
   - Alert delivery reaches the destination: trigger `MONITOR_SILENT` in staging.
5. **Watch for 24 hours:** alerts, `rate_limit.store_unavailable`, `guard.unavailable`, `provider.error`.

**Roll back when** any of these happen:
- a CRITICAL alert of kind `UNEXPECTED_TRANSITION` or `SECURITY_QUOTE_REJECTED` that is not explained by a provider incident
- error rate above baseline on approval or deposit routes
- migration failure

**Rollback procedure:**
1. Promote the previous deployment.
2. Leave the database migrated: every migration is additive, so the previous code ignores the new columns.
3. Restore from backup only for data corruption.

**Incident response:**
1. Pause Guard for affected users. Pause and disable are user controls; an operator-wide execution switch is not built.
2. Executions in flight continue to be tracked.
3. Reconcile UNKNOWN executions through review.

## 12. Remaining blockers before production

1. **No mainnet settlement has ever run.** The canary in section 15 needs your explicit authorization of the exact transaction, amount, source, destination and wallet.
2. **Monitoring and alerting are not configured in any deployed environment.** That includes the scheduler secrets, a real alert destination, `SPAK_TRUSTED_PROXY` and the production RPC variables. SPak cannot read the Vercel project's variables (403), so this check is yours.
3. **Production database backup and migration level are unverified.** The production `DATABASE_URL` and its provider were not accessible. Before deploying, confirm a restorable backup and which migrations the production database already has.
4. **Refunds have never been observed live** on mainnet or testnet.
5. **Doppler credentials (section 5) still need the two revocations in the dashboard.** Doppler is testnet-only and never on the mainnet path.
6. **The Agent approval API route still exists** (`/api/executions/[id]/agent-approve`). The Review screen no longer offers it (decision of 2026-11-14); the route needs an owner-signed permission and the user's wallet still signs the deposit.

Resolved in this pass (evidence in sections 6 and 14):
- Trusted payout senders for Base and Arbitrum mainnet.
- The PostgreSQL concurrency failures. The S-6 failure was a wrong test assertion (83 is a legal total when the 41 and 42 USDC approvals win the race). Spending cannot be over-reserved: every reservation runs under `SELECT ... FOR UPDATE` on the user's Guard policy row, and a missing row fails closed. Proven by 48 parallel race runs on PostgreSQL 16, including a new eight-way race.
- The Stage 8 failure was a real race in the Agent recheck claim (`UPDATE ... WHERE id IN (subquery)` under READ COMMITTED). It is fixed with the lease condition in the outer WHERE and `FOR UPDATE SKIP LOCKED`, and proven by a deterministic two-session test that fails on the old query and passes on the new one. The execution monitor's claim was already correct.
- Agent account creation is out of scope for this release and no longer counted as a blocker.

## 13. Controlled testnet failure plan (not executed; needs authorization per case)

All cases run on the Tidepool sandbox (community-run; evidence labelled Live testnet), using the disposable wallet, 0.001–0.002 ETH.

| Case | How | Expected SPak result |
| --- | --- | --- |
| Late deposit | Deposit after the quote deadline | Execution EXPIRED; Tidepool refunds after its deadline; refund verified on Base Sepolia; association UNCONFIRMED until evidence capability is confirmed |
| Failed deposit | Send the wrong amount | Deposit MISMATCH; no approval of extra value |
| Wrong destination amount, wrong recipient | Not producible on a honest sandbox; covered by the real-receipt replay | Manual reconciliation |
| Provider timeout or outage | Block Tidepool's host for the server | No state change; PROVIDER_OUTAGE alert after 3 executions or 15 minutes |
| RPC failover | Point the first RPC at a dead host | Second endpoint used; RPC_FAILURES alert when all fail |
| Delayed settlement | Observe a slow route | VERIFYING or PROCESSING; STALLED_EXECUTION alert after 60 minutes |
| Refund pending, verified, unverifiable | Late-deposit case, with and without an on-chain refund | REFUNDING, then REFUNDED only with on-chain proof; otherwise review |

## 14. Mainnet integration evidence (read-only, 2026-11-14)

No funds were moved. Every item below is real mainnet data or a live 1Click mainnet answer.

| Check | Result | Level |
| --- | --- | --- |
| Payout sender, Base and Arbitrum | 29 of 29 payouts sent by `0x2cff890f0378a11913b6129b2e97417a2c302680`: 19 USDC (12 Arbitrum, 7 Base) and 10 native ETH (5 each). Each NEAR withdrawal from `intents.near` (memo `WITHDRAW_TO`, listed by api.nearblocks.io) was resolved to its destination transaction by the official PoA bridge API (`bridge.chaindefuser.com/rpc`, `withdrawal_status`), and each receipt was read from the chain. Every on-chain amount equals the bridge's record, and every recipient equals the memo | Mainnet read-only |
| How it is used | Built in for `base` and `arbitrum` mainnet only (`src/tracking/route-trust.ts`); fixture `tests/tracking/fixtures/oneclick-mainnet-payouts.json`; `tests/live/payout-senders.live.test.ts` derives it again from today's chain | Unit plus Live |
| Why it covers 1Click | 1Click's Base and Arbitrum assets are PoA tokens (`*.omft.near` in `asset-map.json`, fetched from 1Click `/v0/tokens`); their only exit is the PoA bridge withdrawal | Code plus Mainnet read-only |
| A-4 on a real mainnet payout | Full Arbitrum receipt for withdrawal `H2P5osk…qU4W` (tx `0xb8a55d0f…f749c`, 9,000 USDC) through the real EVM verifier: CONFIRMED with the built-in trust; rejected for a wrong chain id, a deposit after the payout, or empty trust | Unit on real mainnet data |
| Canary quote | Live 1Click indicative and firm quotes for 5 USDC Base → USDC Arbitrum, signatures verified against the published 1Click key. Identities: `base:0x8335…2913` to `arbitrum:0xaf88…5831`. Out 4,994,123 units, minimum 4,944,181. Firm deposit address `0x05e40fC9…c5C8`, cancelled straight after | Official 1Click (quotes only) |
| Canary valuation | Chainlink USDC/USD `0x8fFfFfd4…18f6` read 0.99976; SPak value $5.000000 (stablecoins never below $1); provider $4.997915; deviation 4 bps | Mainnet read-only |
| Canary Guard | The same live quote is blocked under a $4.99 per-transfer limit | Local integration on a live quote |

| Into NEAR: 5 USDC Base → USDC NEAR | SPak-in plan, signed live indicative and firm quotes, $5.000000 (3 bps), out 4,995,309, minimum 4,945,355, EVM deposit address on Base | Official 1Click (quotes only) |
| Out of NEAR: 5 USDC NEAR → USDC Base | SPak-in plan, signed live indicative and firm quotes, $5.000000 (3 bps), out 4,996,958, minimum 4,946,988, implicit NEAR deposit account | Official 1Click (quotes only) |
| NEAR deposit account storage | Every 1Click NEAR deposit account checked (3 of 3) had no storage on the USDC contract. A plain `ft_transfer` to it fails. SPak's instructions now add `storage_deposit` (registration only, the contract's minimum of 0.00125 NEAR) before `ft_transfer`, built against mainnet NEAR | Mainnet read-only |
| NEAR delivery proof | Real `intents.near` payout of 4,999,746 USDC units to `x3lang.near` (tx `CXoXgJ5F…u4ia`) confirmed by SPak's NEAR verifier through mainnet RPC; binds only with `intents.near` trusted | Mainnet read-only |

Not yet evidenced: a settlement, a refund, payouts from any non-PoA bridge, and whether 1Click registers storage for a NEAR recipient that has none. Until that is known, a NEAR recipient must already hold storage on the destination token contract.

## 14b. Mainnet route coverage (live, read-only, 2026-11-14)

Discovery: 1Click `/v0/tokens` lists 231 provider tokens. SPak's registry, refreshed from it on 2026-11-14, holds 170 on 19 networks. SPak can execute on 10 of them (it has a deposit builder and a delivery verifier for EVM, NEAR and Solana): Ethereum 29 tokens, Base 18, Arbitrum 7, Optimism 6, Polygon 5, BNB Smart Chain 9, Avalanche 3, Gnosis 9, NEAR 36, Solana 23. Aptos, Bitcoin, Dogecoin, Litecoin, Stellar, Sui, TON, Tron and XRP are listed but not executable: SPak has no wallet, deposit builder or delivery verifier for them.

**All 90 directed USDC routes between the 10 networks** (25 USDC, through SPak-in, live 1Click with mandatory signature check, SPak valuation and Guard): 90 of 90 quote. Before the registry refresh, 48 failed the signature check: SPak's map used HOT Omni ids that 1Click has retired on Polygon, BSC and Avalanche, and the official SDK also rejects those quotes. The sync now skips retired ids, and the resolver refuses them at runtime.

| Level | Routes | Meaning |
| --- | --- | --- |
| Quote available, signature verified, valued | 90 of 90 | Official 1Click (quotes only) |
| Deposit instructions validated | EVM sources: browser wallet. NEAR source: one transaction (storage_deposit plus ft_transfer) sent from the user's NEAR wallet, hash pasted. Solana source: built and checked in the live deposit test | Mainnet read-only plus Mock |
| Delivery verified automatically | 45: any source into Ethereum, Base, Arbitrum, Gnosis (PoA bridge sender, 34 real payouts) or NEAR (intents.near, 5 real payouts) | Mainnet read-only evidence |
| Delivery goes to manual review | 45: any source into Optimism (HOT Omni), Polygon, BSC, Avalanche (`*.omdep.near` bridge) or Solana (Omni Bridge). The Review screen says so before approval | No payout evidence |
| Settlement verified | None on mainnet | |

**Amounts** (any amount the user types; SPak never changes it):
- Minimum: set by 1Click per route and reported in its own words, for example "Amount is too low for bridge, try at least 150000" (0.15 USDC, Base to NEAR) and 300001 (Ethereum to Solana). NEAR to Arbitrum quoted 0.01 USDC.
- Maximum: the Guard per-transfer limit, by default the platform ceiling of $1,000 (`SPAK_MAX_EXECUTION_USD`), lower if the user set one. 999 USDC quoted on every swept route; 1,001 and 50,000 were blocked by Guard.
- Cost: shown in full. On small amounts fixed bridge fees dominate (1 USDC Ethereum to Solana delivers 0.80). Review now warns when fees exceed 5% of the amount.

**Other tokens** (12 live combinations): 11 quote and value (ETH, SOL, wNEAR, BNB, AVAX, USDT, xDAI across chains). POL is refused by Guard: no independent price source, so its value cannot be checked (fail closed). "NEAR" means wNEAR (`wrap.near`), the only NEAR asset 1Click lists; a user holding only native NEAR must wrap it first.

## 15. First controlled mainnet transactions (prepared, not executed)

Two canaries cover the core: one into NEAR, one out of NEAR. Run them one at a time. The Base to Arbitrum route below follows the same steps and is the lowest-risk first run, since both legs use the PoA bridge and an EVM wallet signs in the browser.

**Into NEAR:** 5 USDC on Base to USDC on your NEAR account. Before quoting, check read-only that your NEAR account has storage on `17208628…133a1` (`storage_balance_of` not null). Delivery is proven by the `intents.near` receipt.

**Out of NEAR:** 5 USDC on your NEAR account to USDC on Base. SPak shows one transaction with two actions on the USDC contract: `storage_deposit` for the deposit account (0.00125 NEAR) and `ft_transfer` of exactly the amount. You send it from your NEAR wallet and paste the hash; SPak checks the signer, the contract, the receiver and the amount on chain. Delivery on Base is proven by the PoA bridge sender.

Nothing below runs without your separate, explicit authorization of the exact values.

**Proposed values**
- Route: 5 USDC on Base to USDC on Arbitrum, sent to your own address on Arbitrum.
- Wallet: your own EVM wallet, signing in the browser. No server key and no Doppler key are involved.
- Refund address: the same wallet on Base.
- Limits: Guard per-transfer limit $10 and daily limit $10 for the account used.
- Cost: about $0.006 in fees at today's quote, plus Base gas.

**Before the deposit (all read-only)**
1. Run the gates: lint, type check, both test engines, both builds.
2. Run `LIVE=1 npx vitest run tests/live/payout-senders.live.test.ts tests/live/prices.live.test.ts tests/live/execution.live.test.ts`. All must pass on the day.
3. Start the mainnet build locally on a fresh PostgreSQL database marked `mainnet`, with `SPAK_RPC_BASE`, `SPAK_RPC_ARBITRUM` and `SPAK_ALERT_WEBHOOK_URL` and `SPAK_ALERT_WEBHOOK_SECRET` set. Call `/api/internal/monitor` once with the secret, and confirm the webhook receives a signed test alert.
4. Sign in with your wallet. Type the intent. Check that the Review screen shows exactly: source Base USDC `0x8335…2913`, destination Arbitrum USDC `0xaf88…5831`, your recipient, the amount, the minimum, the fee, the SPak value and the Guard result.
5. Get the firm quote. Read the deposit address and the deadline back to me. I verify the signature record and valuation in the database before you approve.

**Deposit (needs your authorization)**
6. Approve, then sign the 5 USDC transfer to the deposit address in your wallet, before the deadline.

**After the deposit**
7. SPak confirms the deposit on Base, tracks 1Click, then verifies the Arbitrum payout: sender `0x2cff…2680`, USDC contract, your address, amount at or above the minimum, after the deposit block, with final confirmations.
8. Record the deposit hash, the payout hash and the receipt screen as evidence.

**If it does not complete**
- Provider failure or expiry: 1Click refunds to your Base address. SPak records REFUNDING and marks REFUNDED only with an on-chain refund transaction.
- Payout from an unexpected sender, an amount below the minimum, or missing facts: the execution goes to UNKNOWN for manual reconciliation and an alert is raised. Nothing is marked COMPLETED.
- Stop at the first unexpected result. No retry without review.
