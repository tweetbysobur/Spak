# SPak Transaction Approval and Deposit Flow

Phase 3. Builds on SPak-in (plans) and SPak Execution (quotes and states). No second execution engine.

## Flow

1. Review the indicative quote.
2. Get the firm quote. It shows the deposit address, memo, deadline, fees, minimum output and references. Approve within 10 minutes.
3. Prepare the deposit. The server builds the transaction from the approved firm quote and checks your balance.
4. Choose the wallet. SPak checks the account and network. It never switches the network by itself; a button asks the wallet.
5. Sign in the wallet. The wallet broadcasts. SPak receives only the transaction reference.
6. Verify. The server reads the source chain and compares every field with the deposit requirements.
7. Track. The cross-chain transfer moves only on the NEAR Intents status. Completion needs the provider's destination confirmation.

## Approval rules

- Only a FIRM quote can be approved (`FIRM_QUOTE_REQUIRED` otherwise).
- The approval stores execution id, quote id, plan hash and plan revision.
- One active approval per execution (unique partial index). A concurrent second approval gets `APPROVAL_IN_PROGRESS`.
- A new quote, a requote or a cancel invalidates the approval.
- Recipient, refund address and amount in the provider request must match the execution.
- `SPAK_MAX_EXECUTION_USD` (default 1000) caps the value. Unknown USD value fails closed.

## Deposit states

Separate from execution states.

| State | Meaning |
|---|---|
| WALLET_CONFIRMATION_REQUESTED | Transaction prepared, waiting for the wallet |
| SUBMITTED | Reference received. Not proof of anything |
| VERIFICATION_PENDING | Not found yet, not enough confirmations, or chain unreadable |
| CONFIRMED | Chain shows the exact transfer with enough confirmations |
| REJECTED | Rejected in the wallet, or the transaction does not match |
| FAILED | Transaction failed on chain |
| EXPIRED | Deadline passed without a confirmed deposit |

## Server-side verification

| Network | Checks | Confirmed when |
|---|---|---|
| EVM native | sender, to = deposit address, exact value, chain id, status | 3 confirmations (Polygon 32, BSC 5, Gnosis 5) |
| ERC-20 | sender, to = token contract, Transfer logs to deposit address sum to exact amount, no native value | same |
| Solana SOL | fee payer, deposit account balance delta = amount | finalized |
| SPL | fee payer, owner token balance delta for the mint = amount | finalized |
| NEAR native | signer, receiver, Transfer total = amount, all receipts succeeded | FINAL |
| NEP-141 | signer, receiver = token contract, ft_transfer to deposit account = amount | FINAL |

A transaction reference can link to one deposit only (unique network + hash). Another user's deposit returns 404. RPC failures leave the deposit pending. Nothing is assumed.

## Wallet support

- EVM (MetaMask, Phantom EVM): `eth_sendTransaction` of a plain transfer. No `approve()` call, ever. `approvals` is always empty.
- Solana (Phantom): server-built transaction (ATA create-idempotent, TransferChecked, memo if needed) through `solana:signAndSendTransaction`. Token-2022 supported; other token programs refused.
- NEAR (Meteor): manual. Meteor transaction signing requires sign-in that adds an access key to your account, so SPak does not request it. Send from your NEAR wallet and paste the hash. SPak verifies it on chain.

## API

All routes need a session, a same-origin request, a valid body and a rate-limit slot.

| Method | Path | Purpose |
|---|---|---|
| POST | /api/executions/:id/firm-quote | Indicative to firm quote |
| POST | /api/executions/:id/approve | Approve the firm quote (`planRevision` required) |
| GET | /api/executions/:id/deposits | Deposit instructions and attempts |
| POST | /api/executions/:id/deposits | Prepare the wallet transaction |
| POST | /api/executions/:id/deposits/manual | Submit a hash for a manual deposit |
| POST | /api/deposits/:id/submit | Record the wallet's transaction reference, then verify |
| POST | /api/deposits/:id/reject | Record a wallet rejection |
| POST | /api/deposits/:id/verify | Re-check the chain (rate limited per deposit) |
| GET | /api/deposits/:id | Deposit with its events |
| GET | /api/deposits | Deposit history |

## Database

Migration `0003_approval_deposit.sql` (additive): `spak_approvals`, `spak_deposits`, `spak_deposit_events`.

## Tests

| Kind | File | What it covers |
|---|---|---|
| Mocked chain | tests/deposits/verifiers.test.ts | All verifiers: correct, wrong address/asset/amount/sender/chain, unconfirmed, failed, unknown |
| Mocked chain and provider | tests/deposits/service.test.ts | Prepare guards, balance, submit, delayed verification, expiry, duplicates, replay, cross-user, rejection |
| Mocked chain and provider | tests/deposits/routes.test.ts | Route auth, CSRF, validation, ownership, history |
| Simulated wallets | tests/deposits/wallet-deposit.sim.test.ts | Send, wrong network (no silent switch), wrong account, locked, rejected, disconnected |
| Real chain data | tests/live/deposit-verify.live.test.ts | Verifiers on real Base, Solana, NEAR mainnet data; builder against real Solana RPC |

## Limitations

- No real deposit was made. No funded wallet was available. The deposit path to a real 1Click address is untested with real funds.
- NEAR deposits are manual.
- Public RPC endpoints rate-limit. Set `SPAK_RPC_<NETWORK>` for production.
