/** Transaction explorer links per network. Unknown networks get no link rather than a wrong one. */
import { IS_TESTNET } from "../environment";

const MAINNET_TX: Readonly<Record<string, string>> = {
  ethereum: "https://etherscan.io/tx/", base: "https://basescan.org/tx/", arbitrum: "https://arbiscan.io/tx/",
  optimism: "https://optimistic.etherscan.io/tx/", polygon: "https://polygonscan.com/tx/", bsc: "https://bscscan.com/tx/",
  avalanche: "https://snowtrace.io/tx/", gnosis: "https://gnosisscan.io/tx/", solana: "https://solscan.io/tx/",
  near: "https://nearblocks.io/txns/", bitcoin: "https://mempool.space/tx/", tron: "https://tronscan.org/#/transaction/",
};
const TESTNET_TX: Readonly<Record<string, string>> = {
  "base-sepolia": "https://sepolia.basescan.org/tx/", "arbitrum-sepolia": "https://sepolia.arbiscan.io/tx/",
  "ethereum-sepolia": "https://sepolia.etherscan.io/tx/", "bsc-testnet": "https://testnet.bscscan.com/tx/",
  "near-testnet": "https://testnet.nearblocks.io/txns/",
};
const TX = IS_TESTNET ? TESTNET_TX : MAINNET_TX;
export function txExplorerUrl(network: string, hash: string): string | null {
  const base = TX[network];
  return base ? `${base}${encodeURIComponent(hash)}` : null;
}
