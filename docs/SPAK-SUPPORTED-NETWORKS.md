# Supported networks

SPak routes through NEAR Intents across 19 networks. You can **send from** the 10 networks you can sign in with, and **send to** all 19.

## Networks you can send from and to

| Network | Family | Wallets |
|---|---|---|
| Ethereum | EVM | EIP-6963 wallets |
| Base | EVM | EIP-6963 wallets |
| Arbitrum | EVM | EIP-6963 wallets |
| Optimism | EVM | EIP-6963 wallets |
| Polygon | EVM | EIP-6963 wallets |
| BNB Smart Chain | EVM | EIP-6963 wallets |
| Avalanche C-Chain | EVM | EIP-6963 wallets |
| Gnosis | EVM | EIP-6963 wallets |
| Solana | Solana | Wallet Standard |
| NEAR | NEAR | NEAR Wallet Selector |

## Networks you can send to

Bitcoin, Tron, Sui, XRP Ledger, Dogecoin, Litecoin, TON, Stellar and Aptos. SPak has no wallet sign-in for these, so it cannot send from them (a deposit needs your signature and a refund address you own). Asking to send from one gets a plain explanation, not a request to connect a wallet that cannot be connected. Payments to these networks need the recipient's address.

## Route audit

`scripts/route-audit.ts` runs every route a user can ask for through SPak's real steps before approval: a sentence through SPak-in, asset resolution against the live NEAR Intents token list, a live dry quote (no funds, no deposit address), SPak's quote checks including the signature, and the delivery-verification classification. Read-only.

    NEXT_PUBLIC_SPAK_NETWORK_ENV=mainnet npx tsx scripts/route-audit.ts [--out file.json] [--only near,base]

Cases per pair of networks: USDC to USDC, the source's native token to USDC, USDC to the destination's native token, and USDC to USDT where the destination has no USDC.

Results on mainnet, 15 November 2026:

| Routes | Quoted cleanly |
|---|---|
| Between the 10 sign-in networks | **290 of 290** |
| To Aptos, Sui | 30 of 30 each |
| To Dogecoin, Litecoin, Tron (TRX and USDT) | all |
| To TON (USDT) | all |
| To Stellar (XLM) | 10 of 10 |
| To Stellar (USDC) | refused by NEAR Intents unless the recipient has a USDC trustline (a Stellar rule) |
| To Bitcoin | refused by SPak: NEAR Intents' Bitcoin quotes do not verify against its published signing key (the official 1Click SDK also rejects them). SPak never uses an unverified quote |
| To XRP Ledger | NEAR Intents returns a server error for every XRP quote (any address, any amount). Unavailable on their side |

No route failed because of SPak's planning, asset mapping or quote handling.

What the user sees for each refusal:

| Case | Message |
|---|---|
| Stellar recipient without a trustline | "The recipient's Stellar account has no trustline for this token, so it cannot receive it. The recipient must add the trustline first. Nothing was sent." |
| Provider error on a route | "NEAR Intents could not quote this route right now. Nothing was sent. Try again later." |
| Unverifiable quote | "SPak could not verify the signature from NEAR Intents on this quote against its published key, so it will not use it. Nothing was sent" (also raises a security alert) |
| Sending from a receive-only network | "SPak can send to Sui but not from it yet, because there is no Sui wallet sign-in. Send from a network where you have a connected EVM, Solana or NEAR wallet." |

## Assets

Assets come from the NEAR Intents token registry (`npm run registry:sync`). Tokens marked deprecated by 1Click are skipped and retired ids are refused. NEAR Intents lists no native TON, so TON routes use USDT.

## Delivery verification coverage

SPak confirms delivery automatically when the payout asset and sender can be checked on chain: PoA bridge assets on Base, Arbitrum, Ethereum and Gnosis, and NEP-141 assets on NEAR. In the audit, 145 of the 290 routes between sign-in networks verify automatically. Every other route, including all routes to the nine receive-only networks, is marked for manual review in the app before you confirm, and is never marked complete without a check.
