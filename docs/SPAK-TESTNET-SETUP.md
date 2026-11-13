# SPak testnet infrastructure: setup and live testing

Testnet success does not establish mainnet readiness. See the mainnet blockers in [SPAK-AGENT-SECURITY.md](SPAK-AGENT-SECURITY.md#mainnet-blockers).

## Status on this branch

| | Result |
|---|---|
| Parent account | **Not configured.** No credentials exist in the development environment. |
| Actual NEAR testnet transactions | **None.** No account was created and no rotation was sent. |
| Live tests | `tests/live/agent-account.live.test.ts` and `tests/live/agent-rotation.live.test.ts`: **skipped** (no credentials). |
| Modelled-chain tests | Pass (see the stage report). They model NEAR; they are not evidence that NEAR behaves the same. |
| Meteor wallet rotation support | **Not tested.** See below. |

## 1. Create the parent account (you, outside SPak)

1. Create a dedicated testnet account used only for SPak Agent creation, for example with NEAR CLI: `near account create-account sponsor-by-faucet-service <name>.testnet autogenerate-new-keypair save-to-keychain network-config testnet create` (docs.near.org/protocol/tutorials/creating-implicit-and-named-accounts.md). Do not reuse a personal account.
2. Fund it with testnet NEAR (docs.near.org/getting-started/faucet.md). With the initial limits you need at least 3 × (0.1 + 0.007 creation burn + 0.01 gas margin) plus the account's own storage.
3. Keep only the full-access key you will give the server. Never paste it into chat, a ticket, Git or the browser.

## 2. Configure the server (secret stays server-side)

Set these in Vercel project settings (Preview environment for testing) or in an untracked `.env.local`:

```
SPAK_AGENT_NEAR_NETWORK=testnet
SPAK_AGENT_NEAR_RPC_URL=https://rpc.testnet.near.org
SPAK_AGENT_PARENT_ACCOUNT=<name>.testnet
SPAK_AGENT_PARENT_PRIVATE_KEY=ed25519:<secret key>
SPAK_AGENT_INITIAL_BALANCE=0.1
SPAK_AGENT_SPONSORSHIP_BUDGET=1
SPAK_AGENT_MAX_SPONSORED_ACCOUNTS=3
SPAK_AGENT_BACKGROUND_RECHECK_ENABLED=true
SPAK_AGENT_RECHECK_INTERVAL_HOURS=24
```

The requested generic names `NEAR_NETWORK` and `NEAR_RPC_URL` are not used: `NEAR_RPC_URL` already points owner-identity checks at mainnet, and reusing it would break them. Earlier yocto names (`SPAK_AGENT_INITIAL_BALANCE_YOCTO`, `SPAK_AGENT_SPONSOR_BUDGET_YOCTO`) still work.

Validation: network must be `testnet` (no mainnet fallback), the parent must end in `.testnet`, the RPC must be an https testnet endpoint, the key must be an ed25519 secret key, the initial balance must not exceed the budget, the account cap must be 1 to 1000. The key is never logged, returned by an API, stored in the database or sent to the browser.

## 3. Check readiness (read-only, no transaction)

```
npx tsx scripts/agent-testnet-check.ts
```

Prints chain id, whether the parent exists, whether the configured key is a full-access key on it, spendable balance versus what one account needs, and the limits. The app shows the same three states: **Not configured**, **Temporarily unavailable** (with the reason), **Ready**.

## 4. Live tests (testnet only)

```
LIVE=1 npx vitest run tests/live/agent-account.live.test.ts
LIVE=1 npx vitest run tests/live/agent-rotation.live.test.ts
```

- Account test: the parent creates `alive<hex>.<parent>.testnet` with a test-generated owner key (one transaction: CreateAccount, Transfer, AddKey), then reads the keys back.
- Rotation test: the test plays the user's wallet and signs, as the dedicated account, AddKey(new) + DeleteKey(old) in one transaction; then NEAR must show only the new key.
- Each run spends testnet NEAR from the parent (initial balance + creation burn + gas). Both print transaction hashes. Record them below.

## 5. Live results

None yet. Fill in after the first run: date, parent account, account ids, transaction hashes, keys returned by `view_access_key_list`.

## Meteor wallet and key rotation

Not tested. Meteor's wallet-selector integration signs for the account the user is signed into in Meteor. Rotation must be signed by the dedicated account itself, so the user would need that account available in their wallet (it holds the user's own key, so importing it is a user action). Until tested, the documented alternative is NEAR CLI on the user's machine, which can build one transaction with several actions and sign it with a local keychain or Ledger. SPak never signs the rotation and never sees either key.
