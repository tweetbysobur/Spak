# SPak Execution

SPak Execution takes a plan that SPak-in validated and runs it through NEAR Intents (1Click API): it validates the plan again on the server, resolves assets against the provider's live token list, requests and validates quotes, records everything in Postgres, and tracks the execution until the provider reports a verified outcome.

It never signs, never holds keys, never sends funds and never acts without the user's approval. The user's wallet sends the deposit. The deposit-sending UI is phase 3.

## Architecture

```
browser ──► /api/executions…  (Execution API Controller: src/server/execution.ts + src/app/api/executions, /api/quotes)
              │  session user + verified wallets (from the auth system, never from the request)
              ▼
         ExecutionService (src/execution/service.ts)
              ├─ Execution Plan Validator   plan-validator.ts   plan issued by SPak-in, owned by user, latest revision, untampered, wallets verified
              ├─ Asset & Network Resolver   asset-resolver.ts   SPak asset id → NEAR Intents asset id, checked against live /v0/tokens
              ├─ Quote Service              quote-service.ts    builds the 1Click request, calls the provider, persists every quote
              ├─ Quote Validator            quote-validator.ts  response must match the request exactly
              ├─ Execution Record Manager   records.ts          Drizzle repositories, compare-and-set state changes, event history
              └─ Execution State Manager    state.ts            states, allowed transitions, provider status mapping
                        │
                        ▼
         NEAR Intents Client (src/integrations/near-intents/client.ts)  → https://1click.chaindefuser.com
```

This replaces the earlier `ExecutionCoordinator` (`src/spak-in/coordinator`). Its safeguards (plan hash check, issued-plan check, approval binding, duplicate-transfer guard, audit log) moved here. The old `spak_submissions` table is left in place unused; no destructive migration was run.

## Flow

1. **Create** `POST /api/executions {planHash}` with an `Idempotency-Key`. The plan is looked up by hash in the server's intent log, validated, its assets resolved, and an execution row is created in `DRAFT`. An **indicative** quote (`dry: true`, no deposit address) is requested, validated and stored; the execution moves to `AWAITING_APPROVAL`.
2. **Approve** `POST /api/executions/:id/approve {quoteId, approval}`. The approval must name the execution's plan hash, be under 10 minutes old and reference the current, unexpired indicative quote. Exactly one approval can proceed (atomic claim). A **firm** quote (`dry: false`) is requested; it must pass validation and be at least as good as the approved worst case (`firm.amountOut ≥ indicative.minAmountOut`). The execution moves to `AWAITING_DEPOSIT` with deposit instructions.
3. **Deposit** (phase 3): the user's wallet sends exactly `amountIn` of the source asset to the deposit address (with memo if given).
4. **Track** `GET /api/executions/:id/status` asks 1Click `/v0/status` and moves the state machine.

## Services

| Service | Responsibility |
|---|---|
| Execution Plan Validator | Looks up the plan by hash in `spak_intents` (what SPak-in issued). Rejects unknown plans, other users' plans (same 404 as unknown), superseded revisions, hash mismatch, non-executable plans (percent or fiat amounts, schedules, triggers), autonomous plans, invalid addresses. The refund address must be a verified wallet of the user, enabled on the source network. A SELF recipient must still be a verified wallet; EXTERNAL recipients (payments) keep the address SPak-in validated. |
| Asset & Network Resolver | Maps SPak ids (`base:0x8335…`) to NEAR Intents ids (`nep141:base-0x8335….omft.near`) from the generated asset map, then checks the live `/v0/tokens` entry: chain, decimals and contract must match the registry. Never matches by symbol. Token list cached 5 minutes; a miss is re-checked against a fresh list before refusing. |
| NEAR Intents Client | Typed HTTP client. `X-API-Key` (recommended) or legacy JWT from env. 15 s timeout. Every response is schema-checked (Zod); provider errors map to `BAD_REQUEST`, `UNAUTHORIZED`, `NOT_FOUND`, `RATE_LIMITED`, `UNAVAILABLE`, `TIMEOUT`, `INVALID_RESPONSE`. |
| Quote Service | Builds `EXACT_INPUT` / `ORIGIN_CHAIN` requests: amount in smallest units (bigint decimal math), slippage from the plan, recipient and refund from the validated plan, deadline now + 30 min, `MEMO` deposit mode for Stellar. Stores every quote, valid or rejected, with the provider's signature, correlation id and timestamp. Indicative quotes are honoured for 2 minutes. Enforces the plan's minimum-output constraint. |
| Quote Validator | The provider's echoed request must equal ours (assets, amount, recipient, refund, swap type, slippage, deposit/refund/recipient types, dry). `amountIn` must equal the request, `minAmountOut ≤ amountOut`, slippage within tolerance, app fees ≤ 100 bps. Firm quotes need a signature and a deposit address valid on the source network, with a future deadline. |
| Execution Record Manager | `spak_executions`, `spak_quotes`, `spak_execution_events`. Idempotent create (unique `(user, idempotency_key)` and `(user, plan_hash)`), atomic approval claim, compare-and-set state transitions with an event per change. |
| Execution State Manager | State list, allowed transitions, provider status mapping, delay detection. |
| Execution API Controller | Session check, verified wallets, Zod validation, rate limits, error mapping. |

## Execution states

| State | Meaning |
|---|---|
| `DRAFT` | Execution created, no valid quote yet (first quote failed; the next create or re-quote retries). |
| `QUOTED` | Quote obtained and no approval needed. Reserved for autonomous mode, which is off. |
| `AWAITING_APPROVAL` | Indicative quote stored; waiting for the user. |
| `AWAITING_DEPOSIT` | Approved; firm quote and deposit instructions issued. |
| `PROCESSING` | Provider saw the deposit (`KNOWN_DEPOSIT_TX`, `PROCESSING`, `INCOMPLETE_DEPOSIT`), or reported `SUCCESS` without destination proof yet. |
| `COMPLETED` | Provider reported `SUCCESS` **and** at least one destination-chain transaction **and** a settled amount. |
| `FAILED` | Provider reported `FAILED`. |
| `REFUNDED` | Provider refunded to the refund address. |
| `EXPIRED` | No deposit before the provider's deposit deadline. |
| `UNKNOWN` | Unrecognised provider status, or no successful status check for 30 minutes while processing. Recovers when the provider answers. |
| `CANCELLED` | Cancelled by the user before any deposit. |

Transitions are whitelisted in `state.ts`; terminal states never change.

Quote statuses: `VALID`, `EXPIRED`, `REJECTED` (failed validation, kept for audit), `SUPERSEDED` (a newer quote replaced it), `USED`.

## API

All endpoints need a signed-in session, pass the CSRF origin check, validate input with Zod, and return the same 404 for "not yours" as for "does not exist".

| Method | Path | Notes | Rate limit |
|---|---|---|---|
| POST | `/api/executions` | `{planHash}` + `Idempotency-Key` header (or `idempotencyKey`). 201 created, 200 existing | 20/min/user |
| GET | `/api/executions?limit&before` | History, newest first | — |
| GET | `/api/executions/:id` | Details, quotes, state history | — |
| POST | `/api/executions/:id/quote` | New indicative quote before approval | 30/min/user |
| POST | `/api/executions/:id/approve` | `{quoteId, approval: {planHash, approvedAt, allowDuplicate?}}` → firm quote + deposit | 10/min/user |
| GET | `/api/executions/:id/status` | Refresh from NEAR Intents (at most every 3 s per execution) | 60/min/user |
| POST | `/api/executions/:id/cancel` | Before deposit only | — |
| GET | `/api/quotes/:id` | One quote with provider reference | — |

Responses never include raw provider requests or responses; those stay in the database.

## Database changes (migration `0002_execution_engine.sql`, additive)

- `spak_executions`: user, intent, plan id/hash/revision, plan snapshot, idempotency key, fingerprint, state, source/destination network and asset, amount in smallest units, recipient (+ kind), refund address, current/firm quote, approval time, deposit address/memo/deadline, provider status and tx hashes, settled/refunded amounts, status-check bookkeeping. Unique `(user_id, idempotency_key)`, `(user_id, plan_hash)`, `deposit_address`.
- `spak_quotes`: every quote with kind, status, both SPak and provider asset ids, amounts, fees, deposit, expiry, provider deadline, provider signature/correlation id/timestamp, rejection reason, raw request and response.
- `spak_execution_events`: append-only state history.

No existing table was altered.

## Environment variables

| Variable | Purpose |
|---|---|
| `ONECLICK_API_URL` | Default `https://1click.chaindefuser.com` |
| `ONECLICK_API_KEY` | Partner key, sent as `X-API-Key`. Optional; without it 1Click applies its default 0.2% fee |
| `ONECLICK_JWT` | Legacy partner JWT, used only if no API key |
| `DATABASE_URL`, `SPAK_APP_ORIGIN` | As before (required in production) |

## Error handling

`ExecutionError` codes (status): `PLAN_NOT_FOUND`/`PLAN_NOT_OWNED` (404), `PLAN_SUPERSEDED` (409), `PLAN_TAMPERED` (409), `PLAN_NOT_EXECUTABLE` (422), `AUTONOMY_DISABLED` (403), `WALLET_NOT_VERIFIED` (403), `UNSUPPORTED_NETWORK`/`UNSUPPORTED_ASSET` (422), `ASSET_MISMATCH` (502), `INVALID_AMOUNT` (422), `QUOTE_EXPIRED`/`QUOTE_NOT_CURRENT`/`QUOTE_WORSE_THAN_APPROVED` (409), `QUOTE_MISMATCH` (502), `QUOTE_REJECTED` (422, provider refused, e.g. amount too low), `APPROVAL_MISMATCH` (409), `APPROVAL_EXPIRED` (410), `APPROVAL_IN_PROGRESS` (409), `DUPLICATE_SUSPECTED` (409), `INVALID_STATE` (409), `PROVIDER_UNAVAILABLE` (503: network, timeout, 5xx, 429), `PROVIDER_ERROR` (502: bad credentials, unparseable response).

A failed firm quote releases the approval claim so the user can retry. A failed status check never changes the state except to `UNKNOWN` after 30 minutes of failures while processing.

## Security controls

- Identity and wallets come from the session and verified wallets only. The browser sends a plan hash, never plan contents or addresses.
- Only plans SPak-in issued to this user, at the latest revision, execute.
- Refunds always go to a verified wallet; SELF deliveries must still be verified at approval time.
- Assets are resolved by id and checked against the live provider listing; any difference refuses.
- Quotes must match the request exactly; nothing is substituted. Rejected quotes are stored with the reason.
- Firm terms must be at least as good as what the user approved.
- One approval and one firm quote per execution (atomic claim); idempotent creation; 2-minute same-transfer guard.
- `COMPLETED` needs a destination transaction from the provider. Status responses for a different quote signature are ignored.
- Approvals and cancellations go to the audit log. Provider credentials stay server-side.
- Autonomous execution is off: every plan must be `MANUAL` with `approvalRequired`.

## Testing

| Kind | Where | Provider |
|---|---|---|
| Unit | `tests/execution/units.test.ts` | none |
| Engine | `tests/execution/engine.test.ts` (real users signed in with real keys, real SPak-in plans, PGlite with real migrations) | **mocked** (`tests/execution/fake-1click.ts`) |
| HTTP | `tests/execution/routes.test.ts` (real route handlers, cookies, CSRF) | **mocked** |
| Live | `tests/live/execution.live.test.ts`, `LIVE=1 [LIVE_FIRM=1] npm run test:live` | **real 1Click** |

The mocked provider follows the official OpenAPI 0.1.10 shapes and replays a live `PENDING_DEPOSIT` response captured on 2026-11-10. Mocked tests prove SPak's logic, not the provider.

Live results (2026-11-10, no funds sent): asset resolution against the live token list; indicative quote 50 USDC (Base) → 0.609 SOL with 20 bps app fee, destination fee and refund fee; firm quote with a real Base deposit address and provider deadline about 3 days out; status `PENDING_DEPOSIT` mapped to `AWAITING_DEPOSIT`; cancel. A browser run of the app did the same for 10 USDC Base → Arbitrum.

## Known limitations

- No real deposit has been executed, so `PROCESSING`, `COMPLETED`, `REFUNDED` and `FAILED` are tested only against the mocked provider.
- Destination verification relies on the provider's reported destination transaction; SPak does not yet read the destination chain itself.
- The deposit-sending UI (wallet transaction, `/v0/deposit/submit`) is phase 3. `OneClickClient.submitDeposit` exists but is not exposed.
- Status is refreshed when the client asks; there is no background worker yet, so an unwatched execution only updates when viewed.
- SPak Guard limits are not re-evaluated at approval time (they are evaluated when SPak-in plans, using the policy sent with that request); stored Guard settings do not exist yet.
- One leg per plan; `EXACT_INPUT` and `ORIGIN_CHAIN` deposits only. Same asset on the same network is refused (wallet transfer, not an intent).
- Re-executing a plan after it failed or expired needs a new plan (one execution per plan hash per user).
- The provider's deposit deadline (about 3 days in testing) is shown to the user; the requested refund deadline is 30 minutes.

## Phase 3

Approval now requires the firm quote. Deposits are tracked separately. See SPAK-DEPOSIT-FLOW.md.

## Phase 4

COMPLETED now requires SPak's own destination-chain verification. New state VERIFYING_DESTINATION. Background monitoring. See SPAK-TRACKING.md.

Phase 5: REFUNDING state; FAILED is no longer final; refunds verified on chain. See SPAK-FAILURE-REFUNDS.md.
