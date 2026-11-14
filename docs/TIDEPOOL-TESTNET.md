# SPak on the Tidepool testnet sandbox

An isolated testnet environment for validating SPak's transaction lifecycle with test tokens.

Tidepool (https://www.usetidepool.tech) is a community-run sandbox that speaks the 1Click API shape on NEAR testnet. It runs NEAR's unmodified `defuse` v0.4.5 verifier. It is not operated, endorsed or reviewed by NEAR Foundation, Defuse Labs or 1Click. Its EVM, Solana and other bridges are trusted relayers holding Tidepool keys. Results on Tidepool say nothing about 1Click production settlement.

## How separation works

One build and one server run exactly one environment.

| Layer | Mainnet build (default) | Testnet build |
| --- | --- | --- |
| Build flag | `NEXT_PUBLIC_SPAK_NETWORK_ENV` unset or `mainnet` | `NEXT_PUBLIC_SPAK_NETWORK_ENV=tidepool-testnet` |
| Server flag | `SPAK_EXECUTION_ENV` unset or `mainnet` | `SPAK_EXECUTION_ENV=tidepool-testnet` (must match the build) |
| Build output | `.next` | `.next-testnet` |
| Networks | `MAINNET_NETWORKS` | `TESTNET_NETWORKS`: `base-sepolia` (84532), `arbitrum-sepolia` (421614), `ethereum-sepolia` (11155111), `bsc-testnet` (97) |
| Assets | `data/assets.json` (from 1Click) | `data/testnet-assets.json` (from Tidepool `/v0/tokens`) |
| Provider ids | `asset-map.json` | `tidepool-asset-map.json` (every id ends in `.testnet`) |
| Provider | 1Click, `ONECLICK_API_URL` | Tidepool, `SPAK_TIDEPOOL_API_URL` |
| Quote signatures | Optional (`SPAK_ONECLICK_VERIFY_SIGNATURES=1`) | Always verified against Tidepool's maker key |
| Source and destination RPC | Mainnet RPCs | Testnet RPCs (`SPAK_RPC_BASE_SEPOLIA`, …) |
| NEAR identity RPC | Mainnet | Testnet |
| Database | Marked `mainnet` | Marked `tidepool-testnet` |

Testnet ids never reuse a mainnet id (`base-sepolia:native`, never `base:native`). A testnet record can never be read as a mainnet one.

The server refuses to start, and serves nothing, when any of these hold:

- The build flag and `SPAK_EXECUTION_ENV` differ.
- A testnet server has any of `ONECLICK_API_URL`, `ONECLICK_API_KEY` or `ONECLICK_JWT` set.
- A testnet server has no `SPAK_TIDEPOOL_API_URL`.
- `SPAK_TIDEPOOL_API_URL` is not https, points at 1Click, or is not usetidepool.tech (unless `SPAK_TIDEPOOL_ALLOW_CUSTOM_HOST=1`).
- A mainnet server has any `SPAK_TIDEPOOL_*` variable set, or `ONECLICK_API_URL` points at Tidepool.
- `NEAR_RPC_URL` points at the other network.
- The database belongs to the other environment. A testnet server also refuses an unmarked database that already has users.

There is no fallback in any direction.

## Environment variables (testnet)

| Variable | Required | Value |
| --- | --- | --- |
| `NEXT_PUBLIC_SPAK_NETWORK_ENV` | yes, at build and run | `tidepool-testnet` |
| `SPAK_EXECUTION_ENV` | yes | `tidepool-testnet` |
| `SPAK_TIDEPOOL_API_URL` | yes | `https://www.usetidepool.tech` |
| `DATABASE_URL` | yes | A separate, empty PostgreSQL database. Never the production one. |
| `SPAK_APP_ORIGIN` | yes | The testnet server's origin |
| `SPAK_TIDEPOOL_QUOTE_PUBLIC_KEY` | no | Defaults to Tidepool's published maker key `ed25519:U1Mu4u1nHnHmgABpCkfDGXt2FZj8k29UGqhkMAu4iWY` |
| `SPAK_RPC_BASE_SEPOLIA`, `SPAK_RPC_ARBITRUM_SEPOLIA`, `SPAK_RPC_ETHEREUM_SEPOLIA`, `SPAK_RPC_BSC_TESTNET` | no | Override public testnet RPCs (comma-separated) |
| `SPAK_AGENT_NEAR_RPC_URL` | no | NEAR testnet RPC for Agent funding reads (default `https://rpc.testnet.near.org`) |
| `SPAK_MONITOR_SECRET` | no | Lets a scheduler call `/api/internal/monitor` |

## Run it locally

```bash
npm run registry:sync:testnet                     # refresh the testnet registry from Tidepool's live tokens
createdb spak_tidepool_testnet                    # a NEW database, only for testnet
DATABASE_URL=postgres://…/spak_tidepool_testnet npm run db:migrate
NEXT_PUBLIC_SPAK_NETWORK_ENV=tidepool-testnet npx next build
NEXT_PUBLIC_SPAK_NETWORK_ENV=tidepool-testnet SPAK_EXECUTION_ENV=tidepool-testnet \
  SPAK_TIDEPOOL_API_URL=https://www.usetidepool.tech DATABASE_URL=postgres://…/spak_tidepool_testnet \
  SPAK_APP_ORIGIN=http://localhost:3200 npx next start -p 3200
```

## What each operation uses

| Operation | Uses | Signed by |
| --- | --- | --- |
| Sign in, wallet ownership | The user's EVM wallet | User wallet (EIP-4361) |
| Agent identity | The owner's NEAR testnet key | Owner key (NEP-413), checked by SPak |
| Agent permission (grant) | The owner's NEAR testnet key over exact limits | Owner key (NEP-413), checked by SPak |
| Agent funding check | Public `view_account` of the dedicated Agent account on NEAR testnet | Nothing. A read needs no key. |
| Agent approval of a quote | The grant and Guard, server-side, in one transaction | Nothing. A database decision, never a chain signature. |
| Deposit instructions | Tidepool firm quote (signature verified) plus the user's balance on the source testnet | Nothing |
| Deposit | The user's wallet sends `amountIn` to Tidepool's deposit address | User wallet |
| Settlement | Tidepool's maker and relayer, NEAR testnet verifier | Tidepool |
| Destination verification | SPak reads the destination testnet itself | Nothing |

The Agent account never signs deposits. SPak holds no key on it. The owner's wallet funds it, and SPak only reads its balance.

## Lifecycle runner

`scripts/tidepool-lifecycle.ts` drives a running testnet server over HTTP, the way the browser does.

- It uses disposable keys stored in `SPAK_E2E_KEYS`. That file is outside the repository, mode 0600.
- The disposable keys play the user's wallets. The server never sees them.
- Only addresses are printed.
- Each step is reported as REAL, BLOCKED or FAILED.

`scripts/tidepool-negatives.ts` runs the error cases against the live systems.

## Funding the disposable wallet

The default route is native ETH on Base Sepolia to USDC on Arbitrum Sepolia. It needs only Base Sepolia ETH; no Tidepool token claim is needed.

1. Send at least 0.005 Base Sepolia ETH to the wallet address the runner prints. That covers the 0.002 ETH deposit plus gas, with room for a second run. Tidepool caps native ETH at 0.006 ETH per swap.
   - Option A: send it from any wallet you already hold Base Sepolia ETH in.
   - Option B: use a Base Sepolia faucet listed at https://docs.base.org/get-started/get-funds. Most require a sign-in or a small mainnet balance.
2. Check the funds arrived: https://sepolia.basescan.org/address/<address>.
3. Run the lifecycle again with the same `SPAK_E2E_KEYS` file.

For a USDC route instead, claim test USDC on the Tidepool faucet page (https://app.usetidepool.tech/faucet). The faucet is site-only; direct API calls get 403. The EVM address must first hold Ethereum Sepolia ETH or have sent a transaction there, and still needs Base Sepolia ETH for gas.

## Not covered yet

- Solana devnet: SPak's Solana deposit builder targets `solana:mainnet`.
- NEAR testnet tokens: SPak does not have NEAR deposits signed in the wallet yet.
- Dedicated Agent account funding against a real account: creating the account needs SPak's testnet parent account (`SPAK_AGENT_PARENT_*`). The read path is key-free and was checked against real testnet accounts.
- Marketing pages describe the mainnet product. The app shows a testnet banner on every screen.
