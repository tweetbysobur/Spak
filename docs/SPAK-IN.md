# SPak-in: SPak Intent Brain Box

SPak-in turns an instruction ("Swap 50 USDC on Base to SOL on Solana") into a validated, policy-checked execution plan. It is deterministic TypeScript. It calls no LLM, holds no keys, signs nothing and never calls an execution provider. Execution is handled by SPak Execution (`src/execution`, see docs/SPAK-EXECUTION.md), which replaced the Execution Coordinator described below.

## Status: what is real and what is not

| Part | State |
|---|---|
| Input processor, tokenizer, parser, extractor, classifier | Implemented, tested |
| Context resolver (follow-ups, clarification answers, expiry) | Implemented, tested. Memory and Postgres session stores |
| Validation engine | Implemented for all 12 built-in intents |
| Policy engine (SPak Guard rules) | Implemented. Guard settings are passed per request; there is no stored Guard profile yet |
| Execution planner | Implemented. Plans for swaps, bridges, transfers and payments with an exact amount are executable |
| Execution Coordinator | Implemented: approval binding, issued-plan check, duplicate prevention, audit log |
| NEAR Intents provider | Implemented. Verified live with dry quotes only. No real deposit has been sent through it yet |
| Postgres (Drizzle) | Schema, migration and repositories implemented, tested on PGlite. Not yet run against a hosted database |
| Percentage amounts, fiat amounts, rebalancing | Parsed, validated and planned. Not executable: needs a balance reader and price feed (`plan.requires`) |
| Scheduled and conditional execution | Parsed, validated and planned. Not executable: needs a scheduler and condition monitor |
| Portfolio queries, status, history, cancel | Parsed and validated. Reading balances and transaction stores is not built |
| Authentication | Placeholder. The API trusts an anonymous `x-spak-user` id. Replace before multi-user use |
| Autonomous execution over HTTP | Off. The policy engine supports it, but the API forces it off until Guard settings are stored server-side |

## Pipeline

```
text
 └─ A. Input Processor     processor/      normalize, reject malformed, keep numbers exact
 └─    Tokenizer           tokenizer/      typed tokens: number, percent, money, address, word
 └─ C. Entity Extractor    extractor/      networks, assets, schedules, triggers, slippage, min output
 └─ B. Intent Parser       parser/         roles from grammar: source, destination, recipient
 └─ D. Intent Classifier   classifier/     scored match against the intent registry
 └─ E. Context Resolver    context/        apply follow-ups to the session's draft
 └─ F. Validation Engine   validator/      registry lookups, addresses, amounts, required fields
 └─ H. Policy Engine       policy/         Guard: limits, allow-lists, slippage, recipients, autonomy
 └─ G. Execution Planner   planner/        provider-neutral legs and steps, hashed
 └─ I. Execution Coordinator coordinator/  approval check, duplicates, provider hand-off
```

The parser runs after extraction because roles depend on entities: "sol" after "on" is the Solana network, after "to" in a swap it is the SOL asset.

## Public interface

```ts
import { SpakIn, ExecutionCoordinator } from "@/spak-in";
import { NearIntentsProvider } from "@/integrations/near-intents";

const engine = new SpakIn();
const r = await engine.interpret({
  text: "Swap 50 USDC on Base to SOL on Solana",
  sessionId: "user-session-1",        // enables follow-ups
  wallets: { base: "0x…", solana: "7xK…" }, // addresses the user controls
  timezone: "Africa/Lagos",           // needed for clock-time schedules
  policy: { maxTransactionUsd: "500", maxSlippageBps: 100 },
  runtime: { pricesUsd: { "base:0x8335…": "1" }, spentTodayUsd: "120" },
});

if (r.status === "VALIDATED" && r.plan?.executable) {
  const coordinator = new ExecutionCoordinator({ providers: [new NearIntentsProvider()] });
  const quote = await coordinator.quote(r.plan);                 // dry, nothing moves
  const sub = await coordinator.submit({                        // after the user approves
    plan: r.plan, userId: "u1",
    approval: { intentId: r.intentId, planId: r.plan.planId, planHash: r.plan.hash, approvedBy: "USER", approvedAt: new Date().toISOString(), idempotencyKey: "…" },
  });
  // sub.value.submission.deposit: address and amount for the user's wallet to send
}
```

Manual Access uses `engine.interpretManual({ wallets, intent: { type, amount, sourceNetwork, sourceAsset, destinationNetwork, destinationAsset, recipient? } })`. Assets may be symbols or canonical ids. It runs the same validation, policy and planning.

## Output: `IntentResult`

Every call returns the same shape (`src/spak-in/schemas/result.ts`, Zod).

```json
{
  "intentId": "spak_int_001",
  "sessionId": "s1",
  "revision": 0,
  "intentType": "CROSS_CHAIN_SWAP",
  "innerIntentType": null,
  "status": "VALIDATED",
  "source": { "network": "base", "asset": { "symbol": "USDC", "id": "base:0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", "chainId": "8453", "decimals": 6, "contract": "0x8335…" }, "amount": { "kind": "EXACT", "value": "50" } },
  "destination": { "network": "solana", "asset": { "symbol": "SOL", "id": "solana:native", "chainId": null, "decimals": 9, "contract": null } },
  "recipient": { "address": "7xK…", "network": "solana", "kind": "SELF" },
  "refundAddress": "0x1111…",
  "executionMode": "MANUAL",
  "approvalRequired": true,
  "missingFields": [],
  "errors": [],
  "clarifications": [],
  "assumptions": ["Delivering to your connected Solana wallet."],
  "policy": { "outcome": "REQUIRE_APPROVAL", "reasons": ["Manual Access always asks for your approval."], "violations": [], "valueUsd": null },
  "plan": { "planId": "spak_plan_…", "executable": true, "legs": [ … ], "steps": [ … ], "hash": "…" },
  "meta": { "engineVersion": "spak-in/1.0.0", "processingMs": 0.4, "contextApplied": "NONE" }
}
```

Statuses: `VALIDATED`, `NEEDS_CLARIFICATION` (missing or ambiguous; see `clarifications` with `options`), `INVALID`, `UNSUPPORTED`, `POLICY_REJECTED`. A plan exists only when the status is `VALIDATED`.

Intent types: `SWAP`, `CROSS_CHAIN_SWAP`, `BRIDGE`, `CROSS_CHAIN_TRANSFER`, `PAYMENT`, `PORTFOLIO_QUERY`, `PORTFOLIO_REBALANCE`, `SCHEDULED_TRANSACTION`, `CONDITIONAL_TRANSACTION`, `TRANSACTION_STATUS`, `TRANSACTION_HISTORY`, `CANCEL_TRANSACTION`, `UNKNOWN`. Scheduled and conditional intents carry the wrapped type in `innerIntentType`.

Amounts are decimal strings. `AmountSpec` is `EXACT`, `PERCENT_OF_BALANCE` or `FIAT_VALUE`. All money math uses bigint fixed point (`lib/decimal.ts`); there is no floating point in any financial path.

## Rules SPak-in follows

- Never invents a contract, address, amount, network or route. Unknown means a clarification or an error.
- A ticker never picks an asset by itself. Assets resolve by symbol and network against the registry. Several matches produce `AMBIGUOUS_ASSET` with the candidate ids.
- Only grammar-based inference, each one listed in `assumptions`: a single network in a swap applies to both sides when both assets exist there; a payment with a source network and a matching address stays on that network; transfers and bridges deliver to the user's own wallet on the destination network.
- `send` and `pay` never default to the user's own wallet. They need an explicit recipient.
- Ambiguity (two amounts, two recipients, two actions, a bare network that could be either side) stops with a question.
- A refund address on the source network is required. NEAR Intents returns funds there on failure.
- Clock-time schedules require a time zone. A bare hour ("at 9") is ambiguous.

## Registries

- Networks: `registries/networks.ts`. 19 networks with canonical ids, EVM chain ids and aliases. Words that are also tickers ("sol", "near", "eth") only count as networks in a network slot.
- Assets: `registries/data/assets.json`, 169 assets generated from the NEAR Intents token list by `npm run registry:sync`. Nothing is typed by hand. The asset id is `<network>:<contract|native>`.
- Equivalence: NEAR Intents lists native NEAR as wNEAR (`wrap.near`). "NEAR" resolves to wNEAR and says so in `assumptions`.
- Unsupported names (Fantom, zkSync, Linea…) are listed so SPak answers "not supported" instead of "unknown".
- Intents: `registries/intent-registry.ts`. Register a new intent with a `match` scorer and a `validate` function. An intent registered without a validator returns `UNSUPPORTED` and is never planned.

## Context

Sessions hold the last draft for 15 minutes. A message with no action of its own ("make it 100 instead", "on Arbitrum", "every Monday at 9am") amends that draft and bumps `revision`. A new plan hash means an old approval no longer matches. Bare values fill the one missing field; if they could fill two, SPak asks. Expired or already-submitted context is never applied.

## Policy (SPak Guard)

`policyConfigSchema`: `maxTransactionUsd`, `dailyLimitUsd`, `allowedNetworks`, `allowedAssets`, `maxSlippageBps` (default 100), `recipientMode` and `approvedRecipients`, `manualApprovalAboveUsd`, `autonomous { enabled, maxTransactionUsd, allowedIntentTypes }`.

Outcomes: `DENY`, `REQUIRE_APPROVAL`, `ALLOW_AUTONOMOUS`. When the USD value is unknown, limits cannot pass silently: the outcome is `REQUIRE_APPROVAL`. Autonomy needs Agent mode, opt-in, an allowed intent type, a known value under the autonomous limit and an approved or self recipient.

## Execution Coordinator

- Recomputes the plan hash; a plan changed after planning is refused.
- With a `planSource`, accepts only plans SPak-in issued and uses the stored copy, not the client's.
- The approval must name the same intent, plan id and hash, and be under 10 minutes old.
- `approvedBy: "POLICY"` works only on plans the policy marked autonomous.
- Duplicates: same idempotency key or same plan returns the existing submission; the same transfer within 2 minutes needs `allowDuplicate`. The reservation insert is atomic (unique indexes in Postgres), so concurrent double submits prepare once.
- Returns deposit instructions. The user's wallet sends the deposit. State moves to `COMPLETED` only when the provider reports verified delivery.
- Cancel works only before a deposit.
- Every step goes to the audit log.

Providers implement `ExecutionProvider` (`supports`, `quote`, `prepare`, `status`). NEAR Intents lives in `src/integrations/near-intents/` and is the only provider-specific code.

## Storage: Drizzle, not Prisma

Drizzle was chosen because:
- Schema is plain TypeScript next to the code; no separate schema language or generated client.
- No binary query engine. It runs on Vercel serverless and edge without extra setup.
- It works with both node-postgres and PGlite, so repository tests run real SQL migrations in-process with no Docker.
- Smaller dependency footprint.

Tables: `spak_sessions`, `spak_intents` (every revision, also the plan source), `spak_submissions` (unique plan hash and idempotency key), `spak_audit_log`. Migration: `src/database/migrations/0000_init.sql`.

## HTTP API (Next.js route handlers)

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/spak-in/interpret` | Natural-language instruction to `IntentResult` |
| POST | `/api/spak-in/manual` | Manual Access fields to `IntentResult` |
| POST | `/api/spak-in/quote` | `{ plan }` to a NEAR Intents dry quote |
| POST | `/api/spak-in/submit` | `{ plan, approval }` to deposit instructions |
| GET | `/api/spak-in/submissions/:id` | Refresh execution state |
| POST | `/api/spak-in/submissions/:id/cancel` | Cancel before deposit |
| GET | `/api/spak-in/registry` | Networks and assets |

## Performance

Local processing only. Benchmark median 0.37 ms and p95 1.1 ms per instruction on the 219-case set (`docs/BENCHMARK.md`). Target was under 100 ms.

## Accuracy

See `docs/BENCHMARK.md`. The main set (219 cases) was used to tune the engine and is a regression guard. The 40-case held-out set is the honest estimate: 85% intent classification, 89.7% entity extraction, 82.5% exact status. Every held-out miss fails safe: SPak asks a question rather than validating something wrong (0 unsafe validations on both sets).

Known gaps from the held-out set: verbs like "turn into" and "get me", "my arbitrum wallet" as a self recipient, a schedule clause at the start of the sentence, "has my last swap completed", and "everything I did this week".
