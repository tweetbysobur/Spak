# SPak

Cross-chain execution agent on NEAR. You state an intent. SPak-in parses and validates it, NEAR Intents quotes and settles it, and SPak tracks it until delivery is verified.

- SPak-in technical docs: [docs/SPAK-IN.md](docs/SPAK-IN.md)
- Wallet authentication: [docs/AUTH.md](docs/AUTH.md)
- SPak Execution: [docs/SPAK-EXECUTION.md](docs/SPAK-EXECUTION.md)
- Benchmark: [docs/BENCHMARK.md](docs/BENCHMARK.md)
- Marketing website (`/`, `/developers`, `/docs`; the app is at `/app`): [docs/SPAK-MARKETING-WEBSITE.md](docs/SPAK-MARKETING-WEBSITE.md)
- PRD: `gentles-build-brain/projects/spak.md`

## Layout

```
src/spak-in/            SPak-in engine (deterministic, no LLM, no keys)
  processor/ tokenizer/ parser/ extractor/ classifier/ context/
  validator/ planner/ policy/ coordinator/ schemas/ registries/ errors/ lib/
src/execution/          SPak Execution: plan validation, asset resolution, quotes, execution records, states
src/integrations/near-intents/   NEAR Intents 1Click client (the only provider-specific code)
src/auth/               Wallet sign-in: challenges, signature verification (EVM, Solana, NEAR), sessions, wallets
src/wallets/            Browser wallet connectors: EIP-6963, Wallet Standard, NEAR Wallet Selector
src/database/           Drizzle schema, migrations, Postgres repositories
src/server/             Server wiring for the API routes
src/app/api/spak-in/    HTTP API
src/components/ src/app/ UI: chat, manual swap, review, tracking, history
tests/                  Engine, context, policy, coordinator, database, benchmark, live tests
scripts/                Registry sync, benchmark, migrations
```

## Local development

Requirements: Node 20+.

    npm install
    cp .env.example .env.local   # all values optional
    npm run dev                  # http://localhost:3000

Without `DATABASE_URL`, local development uses an embedded PGlite database in `.data/pglite`. Production needs Postgres and `SPAK_APP_ORIGIN`:

    DATABASE_URL=postgres://… npm run db:migrate

## Commands

| Command | What it does |
|---|---|
| `npm test` | Unit, integration, database (PGlite) and benchmark regression tests |
| `npm run test:live` | Dry quote against the real NEAR Intents API. Moves no funds |
| `npm run bench` | Accuracy and latency on the 219-case set and the 40-case held-out set. Add `-- --write` to update docs/BENCHMARK.md |
| `npm run typecheck` | Strict TypeScript |
| `npm run lint` | ESLint |
| `npm run registry:sync` | Rebuild the asset registry from the NEAR Intents token list |
| `npm run db:generate` | New migration after a schema change |
| `npm run db:migrate` | Apply migrations to `DATABASE_URL` |

## Not built yet

- Sending the deposit from the connected wallet inside SPak. You still send it from your wallet app.
- Balance reader, price feed, scheduler and condition monitor. Percentage amounts, rebalancing, schedules and triggers are understood and planned but not executed.
- Creating a new NEAR account for the agent, and stored Guard settings. Autonomous execution is off.

## Safety rules in code

- SPak-in never signs, holds keys or calls a provider. SPak Execution returns deposit instructions; your wallet sends them.
- A deposit address is created only after explicit approval bound to the exact plan hash.
- SPak Execution accepts only plans SPak-in issued to you, and refuses changed plans, stale approvals, mismatched quotes and duplicates.
- Ambiguous instructions stop with a question. Nothing is guessed: no invented contracts, addresses, amounts or networks.
- Success shows only after NEAR Intents reports verified delivery.

## Deposits

Approval and deposit flow: see [docs/SPAK-DEPOSIT-FLOW.md](docs/SPAK-DEPOSIT-FLOW.md).

## Tracking

Background monitoring and destination verification: see [docs/SPAK-TRACKING.md](docs/SPAK-TRACKING.md).

## Failures and refunds

See [docs/SPAK-FAILURE-REFUNDS.md](docs/SPAK-FAILURE-REFUNDS.md).
