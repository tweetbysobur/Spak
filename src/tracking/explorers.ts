/** Transaction explorer links per network. Unknown networks get no link rather than a wrong one. */
const TX: Readonly<Record<string, string>> = {
  ethereum: "https://etherscan.io/tx/", base: "https://basescan.org/tx/", arbitrum: "https://arbiscan.io/tx/",
  optimism: "https://optimistic.etherscan.io/tx/", polygon: "https://polygonscan.com/tx/", bsc: "https://bscscan.com/tx/",
  avalanche: "https://snowtrace.io/tx/", gnosis: "https://gnosisscan.io/tx/", solana: "https://solscan.io/tx/",
  near: "https://nearblocks.io/txns/", bitcoin: "https://mempool.space/tx/", tron: "https://tronscan.org/#/transaction/",
};
export function txExplorerUrl(network: string, hash: string): string | null {
  const base = TX[network];
  return base ? `${base}${encodeURIComponent(hash)}` : null;
}
