/**
 * Network registry. Canonical network ids are SPak's own and never change.
 * chainId is set only for networks with an official numeric chain id (EVM).
 */
export type NetworkFamily = "evm" | "solana" | "near" | "bitcoin" | "tron" | "sui" | "xrp" | "dogecoin" | "litecoin" | "ton" | "stellar" | "aptos";

export interface NetworkDefinition {
  id: string;
  name: string;
  family: NetworkFamily;
  chainId: string | null;
  nativeSymbol: string;
  /** Words that always mean this network. */
  aliases: readonly string[];
  /** Words that mean this network only in a network slot ("on sol"), because they are also tickers. */
  slotAliases: readonly string[];
}

export const NETWORKS: readonly NetworkDefinition[] = [
  { id: "ethereum", name: "Ethereum", family: "evm", chainId: "1", nativeSymbol: "ETH", aliases: ["ethereum", "mainnet", "ethereum mainnet", "eth mainnet", "l1"], slotAliases: ["eth"] },
  { id: "base", name: "Base", family: "evm", chainId: "8453", nativeSymbol: "ETH", aliases: ["base"], slotAliases: [] },
  { id: "arbitrum", name: "Arbitrum", family: "evm", chainId: "42161", nativeSymbol: "ETH", aliases: ["arbitrum", "arbitrum one", "arb1"], slotAliases: ["arb"] },
  { id: "optimism", name: "Optimism", family: "evm", chainId: "10", nativeSymbol: "ETH", aliases: ["optimism", "op mainnet"], slotAliases: ["op"] },
  { id: "polygon", name: "Polygon", family: "evm", chainId: "137", nativeSymbol: "POL", aliases: ["polygon", "polygon pos"], slotAliases: ["matic", "pol"] },
  { id: "bsc", name: "BNB Smart Chain", family: "evm", chainId: "56", nativeSymbol: "BNB", aliases: ["bsc", "bnb chain", "bnb smart chain", "binance smart chain", "binance"], slotAliases: ["bnb"] },
  { id: "avalanche", name: "Avalanche C-Chain", family: "evm", chainId: "43114", nativeSymbol: "AVAX", aliases: ["avalanche", "avalanche c-chain", "avax c-chain"], slotAliases: ["avax"] },
  { id: "gnosis", name: "Gnosis", family: "evm", chainId: "100", nativeSymbol: "XDAI", aliases: ["gnosis", "gnosis chain", "xdai chain"], slotAliases: [] },
  { id: "near", name: "NEAR", family: "near", chainId: null, nativeSymbol: "NEAR", aliases: ["near protocol", "near mainnet"], slotAliases: ["near"] },
  { id: "solana", name: "Solana", family: "solana", chainId: null, nativeSymbol: "SOL", aliases: ["solana"], slotAliases: ["sol"] },
  { id: "bitcoin", name: "Bitcoin", family: "bitcoin", chainId: null, nativeSymbol: "BTC", aliases: ["bitcoin"], slotAliases: ["btc"] },
  { id: "tron", name: "Tron", family: "tron", chainId: null, nativeSymbol: "TRX", aliases: ["tron"], slotAliases: ["trx"] },
  { id: "sui", name: "Sui", family: "sui", chainId: null, nativeSymbol: "SUI", aliases: [], slotAliases: ["sui"] },
  { id: "xrp", name: "XRP Ledger", family: "xrp", chainId: null, nativeSymbol: "XRP", aliases: ["xrp ledger", "xrpl", "ripple"], slotAliases: ["xrp"] },
  { id: "dogecoin", name: "Dogecoin", family: "dogecoin", chainId: null, nativeSymbol: "DOGE", aliases: ["dogecoin"], slotAliases: ["doge"] },
  { id: "litecoin", name: "Litecoin", family: "litecoin", chainId: null, nativeSymbol: "LTC", aliases: ["litecoin"], slotAliases: ["ltc"] },
  { id: "ton", name: "TON", family: "ton", chainId: null, nativeSymbol: "TON", aliases: ["the open network"], slotAliases: ["ton"] },
  { id: "stellar", name: "Stellar", family: "stellar", chainId: null, nativeSymbol: "XLM", aliases: ["stellar"], slotAliases: ["xlm"] },
  { id: "aptos", name: "Aptos", family: "aptos", chainId: null, nativeSymbol: "APT", aliases: ["aptos"], slotAliases: ["apt"] },
];

/** Names users write for chains SPak does not support yet. Lets SPak say "unsupported" instead of "unknown". */
export const KNOWN_UNSUPPORTED_NETWORKS: Readonly<Record<string, string>> = {
  fantom: "Fantom", sonic: "Sonic", linea: "Linea", zksync: "zkSync", "zksync era": "zkSync Era", blast: "Blast",
  mantle: "Mantle", celo: "Celo", cronos: "Cronos", kava: "Kava", moonbeam: "Moonbeam", harmony: "Harmony",
  cosmos: "Cosmos", osmosis: "Osmosis", polkadot: "Polkadot", cardano: "Cardano", algorand: "Algorand",
  hedera: "Hedera", tezos: "Tezos", starknet: "Starknet", sei: "Sei", injective: "Injective", hyperliquid: "Hyperliquid",
  monad: "Monad", berachain: "Berachain", scroll: "Scroll", zcash: "Zcash", unichain: "Unichain", ink: "Ink",
};

const byId = new Map(NETWORKS.map((n) => [n.id, n]));
const byAlias = new Map<string, string>();
const bySlotAlias = new Map<string, string>();
for (const n of NETWORKS) {
  if (!n.slotAliases.includes(n.id)) byAlias.set(n.id, n.id);
  for (const a of n.aliases) byAlias.set(a, n.id);
  for (const a of n.slotAliases) bySlotAlias.set(a, n.id);
}

export const MAX_NETWORK_ALIAS_WORDS = Math.max(...[...byAlias.keys(), ...Object.keys(KNOWN_UNSUPPORTED_NETWORKS)].map((a) => a.split(" ").length));

export function getNetwork(id: string): NetworkDefinition | undefined {
  return byId.get(id);
}

/** Strong match: the phrase can only mean a network. */
export function lookupNetworkAlias(phrase: string): string | undefined {
  return byAlias.get(phrase.toLowerCase());
}

/** Weak match: the phrase is a network only when the grammar puts it in a network slot. */
export function lookupNetworkSlotAlias(phrase: string): string | undefined {
  return bySlotAlias.get(phrase.toLowerCase()) ?? byAlias.get(phrase.toLowerCase());
}

export function lookupUnsupportedNetwork(phrase: string): string | undefined {
  return KNOWN_UNSUPPORTED_NETWORKS[phrase.toLowerCase()];
}

export function listNetworks(): readonly NetworkDefinition[] {
  return NETWORKS;
}
