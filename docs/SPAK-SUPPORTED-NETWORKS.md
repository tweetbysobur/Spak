# Supported networks

| Network | Family | Wallets |
|---|---|---|
| Ethereum | EVM | EIP-6963 wallets |
| Base | EVM | EIP-6963 wallets |
| Arbitrum | EVM | EIP-6963 wallets |
| Optimism | EVM | EIP-6963 wallets |
| Polygon | EVM | EIP-6963 wallets |
| BNB Chain | EVM | EIP-6963 wallets |
| Avalanche | EVM | EIP-6963 wallets |
| Gnosis | EVM | EIP-6963 wallets |
| Solana | Solana | Wallet Standard |
| NEAR | NEAR | NEAR Wallet Selector |

## Assets

Assets come from the NEAR Intents token registry (`npm run registry:sync`). Tokens marked deprecated by 1Click are skipped and retired ids are refused.

## Delivery verification coverage

SPak confirms delivery automatically when the payout asset and sender can be checked on chain: PoA bridge assets on Base, Arbitrum, Ethereum and Gnosis, and NEP-141 assets on NEAR. For USDC this covers 45 of 90 routes. The other 45 (Optimism, Polygon, BNB Chain, Avalanche and Solana payouts) are marked for manual review in the app before you confirm.
