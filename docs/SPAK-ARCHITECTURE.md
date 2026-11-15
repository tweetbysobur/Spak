# SPak architecture

## Components

| Component | Path | Role |
|---|---|---|
| SPak-in | `src/spak-in/` | Text to typed, hashed plan. No keys, no network calls |
| SPak Intelligence | `src/intelligence/` | Read-only balances, prices, feasibility |
| SPak Guard | `src/guard/` | User policy checked before quote and before deposit |
| SPak Execution | `src/execution/` | Plan validation, asset resolution, quotes, execution records and states |
| NEAR Intents client | `src/integrations/near-intents/` | 1Click quotes, deposit addresses, status. The only provider-specific code |
| Deposits | `src/deposits/` | Builds wallet transactions per chain family and verifies deposits |
| Tracking | `src/tracking/` | Background monitoring and destination verification |
| Auth and wallets | `src/auth/`, `src/wallets/` | Sign-in challenges, signature verification, browser wallet connectors |
| Database | `src/database/` | Drizzle schema, migrations, repositories |
| UI | `src/app/`, `src/components/` | Website and app |

## Data flow

```
instruction
  └▶ SPak-in ─▶ plan(hash)
        └▶ Intelligence (balance check) ─▶ Guard ─▶ indicative quote
              └▶ user confirm ─▶ firm quote (compare to shown minimum) ─▶ approval bound to plan hash
                    └▶ deposit transaction built ─▶ user wallet signs and sends
                          └▶ deposit verified on source chain ─▶ NEAR Intents settles
                                └▶ destination chain check against trusted payout senders ─▶ Complete
```

## Environments

| Variable | Values | Effect |
|---|---|---|
| `NEXT_PUBLIC_SPAK_NETWORK_ENV` | `mainnet`, `testnet` | Which networks and labels the app uses |
| `SPAK_EXECUTION_ENV` | `mainnet`, `tidepool-testnet` | 1Click on mainnet, Tidepool on testnet |

Tidepool is a third-party testnet sandbox and is not an official NEAR service.

## Hosting

Vercel for the app, Neon PostgreSQL for data. Local development uses PGlite.
