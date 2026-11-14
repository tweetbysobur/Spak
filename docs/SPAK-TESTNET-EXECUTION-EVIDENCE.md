# SPak testnet execution evidence

The first real end-to-end SPak settlement, on the isolated Tidepool testnet environment. Test tokens only.

Tidepool is a community-run sandbox and is not affiliated with NEAR or 1Click. This run proves SPak's own lifecycle. It does not prove 1Click production settlement.

All data below was copied from public testnet chains, Tidepool's public status API and SPak's testnet database (`spak_tidepool_testnet`). No private key, service token or credential appears in this document.

## Identifiers

| Item | Value |
| --- | --- |
| Execution | `exe_adf513ec746688a2cddd7019` |
| Final state | `COMPLETED` |
| Plan hash (prefix) | `abc3f928965f7ec0…` |
| Agent | `agt_bcaeea6ff942fc01b3c02db6`; owner NEAR testnet implicit account `280720b51feff870a3dd5e98f54b58ec318bd198e153499184f5702f1a5e6f10` |
| Agent permission | `agg_444a49e010cfa5adea08ae0d`, version 1 |
| Indicative quote | `qte_3768b36c76f3654ff571a0f6` (SUPERSEDED); Tidepool correlation `d7d3a0e2-42a8-4f05-8bd7-bd490a8f9146` |
| Firm quote | `qte_43d496bd51b585fea72bc5c0` (USED); Tidepool correlation `3f17e794-59b5-40f8-b964-3c793373ad35`; signature prefix `ed25519:HEYxVkFwpJuCDQQj…` |
| Deposit attempt | `dep_96f14a2637176b5d13d0f178` (CONFIRMED, 29 confirmations at verification) |
| Approval | `AGENT_GRANT`, grant version 1, at 2026-11-14T06:24:14.893Z, never invalidated |
| Guard reservation | $3.8148, RESERVED at 06:24:14.921Z, CONSUMED at 06:46:04.318Z ("Execution completed.") |
| User wallet (disposable) | `0xbAF4cFB500a338859517F43f0Ec02Ec13330Da3e` |

## Instruction and quote

| Item | Value |
| --- | --- |
| Instruction | "Swap 0.002 ETH on Base to USDC on Arbitrum" (testnet build: Base means Base Sepolia, Arbitrum means Arbitrum Sepolia) |
| Route | `base-sepolia:native` to `arbitrum-sepolia:0x38d81431b9f76d9699af7517040d5221d9dea252` |
| Tidepool assets | `nep141:base.tp-omft.testnet` to `nep141:arb-0x38d81431b9f76d9699af7517040d5221d9dea252.tp-omft.testnet` |
| Amount in | 2,000,000,000,000,000 wei (0.002 ETH), about $3.8148 as reported by Tidepool |
| Expected out | 3,799,041 USDC units (3.799041 USDC) |
| Minimum out | 3,761,050 USDC units (1% slippage) |
| Recipient and refund address | The user wallet, for both |
| Deposit address | `0x2391Aba8bd413163D179a69C331bb7b836713D36` (fresh for this quote) |
| Deposit deadline | 2026-11-14T06:54:10.974Z |
| Signature | Verified by the server at quote time, and again from the stored response before signing, against Tidepool's maker key `ed25519:U1Mu4u1nHnHmgABpCkfDGXt2FZj8k29UGqhkMAu4iWY` |

## Funding of the disposable wallet (Base Sepolia, chain 84532)

These were initiated by the user, confirmed by the user, and checked by SPak's tooling through two RPCs and Blockscout.

| Transaction | From | Value | Block | Time (UTC) |
| --- | --- | --- | --- | --- |
| `0x4d2ea9c291266aa38540847ef9d30a93553f7ede76a00399c0a097771ca41faa` | `0xc6392ad8a14794ea57d237d12017e7295bea2363` | 0.025 ETH | 58,574,234 | 06:11:55 |
| `0x3bc86b90fd65e4c838932abf20f9b69165a5ae6f25fb2a694c00f2da5b72ef64` | `0x0264538C189FdFccFe233Fb1413e444f81638F7f` | 0.007 ETH | 58,577,123 | 06:21:33 |

## Pre-sign checks (06:28:03 UTC, by `scripts/tidepool-send-deposit.ts`)

| Check | Result |
| --- | --- |
| Firm quote kind and status | FIRM, VALID |
| Source | `base-sepolia`, `base-sepolia:native` |
| Destination | `arbitrum-sepolia`, USDC `0x38d8…a252` |
| Amount in execution, quote and prepared transaction | exactly 2,000,000,000,000,000 wei |
| Deposit address in execution, quote and prepared transaction | `0x2391…3D36` |
| Recipient and refund address | the user wallet |
| Time left before the deadline | 1,567 s |
| Gas estimate | 21,000 (plain transfer); max fee 0.007 gwei; L1 fee 90 wei; worst-case cost 0.000000147 ETH |
| Balance before | 0.032 ETH, nonce 0 |

## Source transaction (Base Sepolia)

| Item | Value |
| --- | --- |
| Hash | `0xe1b2fbc6d0d75f7428fa1f3a6bd6f854420a39ef8fd4ecd99269aba79389fcaa` |
| Explorer | https://sepolia.basescan.org/tx/0xe1b2fbc6d0d75f7428fa1f3a6bd6f854420a39ef8fd4ecd99269aba79389fcaa |
| Receipt | success, block 58,579,080, gas used 21,000, effective gas price 0.006 gwei |
| Value | 0.002 ETH to `0x2391…3D36`, data `0x` |
| Fee | 0.000000126 ETH |
| SPak deposit verification | CONFIRMED (sender, recipient, exact amount, success, 29 confirmations) |
| Wallet after | 0.029999874 ETH, nonce 1 |

## Settlement (Tidepool, from `GET /v0/status`)

| Item | Value |
| --- | --- |
| Status | SUCCESS, updated 2026-11-14T06:28:31.274Z |
| Origin hashes | `0xe1b2…fcaa` |
| Destination hashes | `isvXCRDGHHCVZ7jBjPrWmuTVXyE1oqGt4BgaNp5Wv4f` (NEAR testnet settlement step) and `0x97a4501a49beba6c8691fa26c698be34d3743aa96a8db60b870e34fb6ac42da2` (Arbitrum Sepolia payout) |
| NEAR testnet hashes | `8MoUEKDuHGgJ4GDvU6xNr8Lr3cm7qDdTm7fJUZWoSaiz`, `CnYGGe9GQVWX3PkVJqGRA89TPaRqD8wcvuDC31oHRwrF`, `isvXCRDGHHCVZ7jBjPrWmuTVXyE1oqGt4BgaNp5Wv4f` |
| Amount out reported | 3,796,820 |

## Destination transaction (Arbitrum Sepolia)

| Item | Value |
| --- | --- |
| Hash | `0x97a4501a49beba6c8691fa26c698be34d3743aa96a8db60b870e34fb6ac42da2` |
| Explorer | https://sepolia.arbiscan.io/tx/0x97a4501a49beba6c8691fa26c698be34d3743aa96a8db60b870e34fb6ac42da2 |
| Receipt | success, block 329,063,241 |
| USDC Transfer logs (contract `0x38d81431…a252`) | one: from `0x2e6AD9E6D59bB4585ea0E6762c3b637dde29DAD2` (Tidepool's Arbitrum vault, as listed by Tidepool `/v0/health`) to the user wallet, 3,796,820 units |

## Destination verification

| Source | Result |
| --- | --- |
| SPak record `dvf_c76f5b42067500fba9ada83f` | `0x97a4…da2`: CONFIRMED, received 3,796,820, 19 confirmations, verified at 06:28:32.009Z |
| SPak record `dvf_fbccea7b0368a92ad14b0153` | `isvXCRDG…` (a NEAR hash registered as an Arbitrum Sepolia transaction): PENDING, 88 attempts, last at 06:43:33.81Z; never verifiable. See audit finding A-3. |
| Independent ERC-20 balance check | User USDC on Arbitrum Sepolia: 0 before settlement, 3,796,820 after |
| Minimum | 3,761,050. Received is 35,770 units above it. |

## State transitions (from `spak_execution_events`)

| Time (UTC) | From | To | Reason |
| --- | --- | --- | --- |
| 06:24:10.632 | none | DRAFT | Execution created. |
| 06:24:10.936 | DRAFT | AWAITING_APPROVAL | Indicative quote received. |
| 06:24:14.847 | AWAITING_APPROVAL | AWAITING_APPROVAL | Firm quote received for review. |
| 06:24:14.910 | AWAITING_APPROVAL | AWAITING_DEPOSIT | Firm quote approved by the Agent under permission version 1. |
| 06:28:10.463 | AWAITING_DEPOSIT | PROCESSING | Provider status KNOWN_DEPOSIT_TX. |
| 06:28:31.601 | PROCESSING | VERIFYING_DESTINATION | Provider reported success with destination transaction(s). |
| 06:46:04.318 | VERIFYING_DESTINATION | COMPLETED | Delivery verified on Arbitrum Sepolia: recipient received 3796820 (minimum 3761050). |

The 17.5 minutes in VERIFYING_DESTINATION were caused by the defect fixed in `a93a5c5` (audit finding A-2). The Arbitrum payout itself was CONFIRMED by SPak at 06:28:32.

## Guard decisions (from `spak_guard_decisions`, policy version 1)

| Time (UTC) | Stage | Outcome | Value |
| --- | --- | --- | --- |
| 06:24:10.254 | PLAN | REQUIRES_APPROVAL | none (from interpretation) |
| 06:24:10.629 | PLAN | REQUIRES_APPROVAL | none (at execution create) |
| 06:24:10.933 | QUOTE | REQUIRES_APPROVAL | $3.8148 |
| 06:24:10.969 | QUOTE | REQUIRES_APPROVAL | $3.8148 |
| 06:24:14.841 | FIRM_QUOTE | REQUIRES_APPROVAL | $3.8148 |
| 06:24:14.872 | PLAN | REQUIRES_APPROVAL | none (re-validation during approval) |
| 06:24:14.921 | APPROVAL | ALLOWED | $3.8148 (reservation written in the approval transaction) |
| 06:24:14.957 | APPROVAL | ALLOWED | $3.8148 (full re-check before deposit instructions, Agent-approved) |
| 06:24:14.962 | DEPOSIT | ALLOWED | $3.8148 |
| 06:28:03.662 | APPROVAL | ALLOWED | $3.8148 (re-check when the deposit was prepared again before signing) |
| 06:28:03.668 | DEPOSIT | ALLOWED | $3.8148 |

## Earlier runs on the same environment

| Run | Outcome |
| --- | --- |
| run 1 (04:48 UTC) | Stopped at Agent permission: the database environment check ran too late, after sign-in had written a user. Fixed before `d6ae9cb`. |
| run 2 (04:50 UTC) | Steps 1–12 real; deposit refused: INSUFFICIENT_BALANCE (wallet unfunded). |
| error cases (live) | 7/7 passed: mainnet chain refused, Tidepool 0.006 ETH cap surfaced, out-of-permission token needs the user, revoked permission, insufficient balance (read from Base Sepolia), expired approval, duplicate transfer. |
| prepare (06:24 UTC) | Steps 1–12 real; stopped before signing for review. |
| settlement (06:28 UTC) | Deposit signed and sent after user authorisation; COMPLETED at 06:46 UTC after the fix. |

## Where the raw evidence lives

The raw JSON files are `/root/spak-e2e/evidence-run1.json`, `evidence-run2.json`, `evidence-prepare.json` and `evidence-settlement.json`.

- They are on the session container, which is temporary and will disappear. This document is the durable copy.
- They contain transaction hashes, identifiers and quote data. They contain no keys.
- The wallet key lives only in Doppler: `spak-testnet-wallet/dev`, secret `SPAK_TESTNET_WALLET_PRIVATE_KEY`, read with a read-only service token.


## Remediation evidence (2026-11-14)

### A-3 reclassification of the stale reference (through the application's refresh path)

| | Before | After |
| --- | --- | --- |
| `dvf_fbccea7b0368a92ad14b0153` (`isvXCRDG…`) | PENDING, 88 attempts | NOT_DESTINATION_CHAIN, 89 attempts, `previousOutcome: PENDING`, problem "Provider reference, not a … transaction … Kept for audit; never counted as delivery." |
| `dvf_c76f5b42067500fba9ada83f` (`0x97a4…da2`) | CONFIRMED, 3,796,820 | unchanged |
| Execution | COMPLETED, 3,796,820, verified 06:46:04.318Z, 7 events | unchanged |

### A-4 replay on the real receipts

`tests/tracking/fixtures/tidepool-settlement-receipts.json` holds the unmodified RPC results. The Arbitrum Sepolia payout is block 329,063,241 at unix 1794637706; the Base Sepolia deposit is block 58,579,080 at unix 1794637684.

- The ERC-20 Transfer sender is `0x2e6ad9e6d59bb4585ea0e6762c3b637dde29dad2` (Tidepool's vault). The transaction sender is relayer `0x55f2c8044d790e1b8369508c31c756c0c2ca0e93`.
- The execution-bound rule accepts the payout: right chain, token and recipient, trusted vault sender, 22 s after the deposit, and 3,796,820 is at or above the 3,761,050 minimum.
- The historical CONFIRMED record was made by evidence version 1. The execution is not re-verified; the replay shows it would pass version 2.

### S-6 live prices (Chainlink, Ethereum mainnet, read only, 2026-11-14)

| Pair | Price | Updated |
| --- | --- | --- |
| ETH / USD | 1,896.25 | 07:19:23Z |
| BTC / USD | 66,955.09 | 07:47:35Z |
| USDC / USD | 0.99976 | 01:54:47Z |
| USDT / USD | 0.99887 | 13 Nov 14:51:47Z |
| DAI / USD | 0.99965 | 07:52:11Z |
| SOL / USD | 75.50 | 02:29:47Z |
| BNB / USD | 616.96 | 03:33:11Z |
| AVAX / USD | 8.07 | 02:23:59Z |
| LINK / USD | 9.55 | 08:07:11Z |

SPak values 0.002 ETH at $3.792501. Tidepool's quote said $3.8148, a 0.59% difference: within the 3% limit.

### S-3 official 1Click signatures (mainnet, quotes only)

| Quote | Correlation | Result |
| --- | --- | --- |
| Dry, 5 USDC Base to Arbitrum | `7d03a44a-8733-49a7-a89d-7b3098286a1c` | Verifies with 1Click's key; fails with Tidepool's |
| Firm, deposit address `0x4eb5BFCC3ee2FA155dCE1ea9A066682d7fd0aCaA` | `3aeda71b-d451-48d9-86a9-e9b28710ea20` | Verifies with 1Click's key; fails with Tidepool's |

Nothing was deposited to that address and nothing was signed. The fixtures are in `tests/integrations/fixtures/`.
