import { IS_TESTNET } from "../../environment";
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
  /** Set only on networks of the Tidepool testnet registry. */
  testnet?: true;
}

export const MAINNET_NETWORKS: readonly NetworkDefinition[] = [
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

/**
 * Testnet networks for the isolated Tidepool environment. Ids never reuse a mainnet id, so a testnet record can never
 * be read as a mainnet one. Chain ids are the public testnet ids (Base Sepolia 84532, Arbitrum Sepolia 421614,
 * Ethereum Sepolia 11155111, BSC Testnet 97), matching Tidepool's /v0/health. Only EVM chains for now: SPak's Solana
 * deposit builder targets mainnet, and NEAR deposits are not wallet-signed in SPak yet.
 */
export const TESTNET_NETWORKS: readonly NetworkDefinition[] = [
  { id: "base-sepolia", name: "Base Sepolia", family: "evm", chainId: "84532", nativeSymbol: "ETH", aliases: ["base sepolia", "base"], slotAliases: [], testnet: true },
  { id: "arbitrum-sepolia", name: "Arbitrum Sepolia", family: "evm", chainId: "421614", nativeSymbol: "ETH", aliases: ["arbitrum sepolia", "arbitrum"], slotAliases: ["arb"], testnet: true },
  { id: "ethereum-sepolia", name: "Ethereum Sepolia", family: "evm", chainId: "11155111", nativeSymbol: "ETH", aliases: ["ethereum sepolia", "sepolia", "ethereum"], slotAliases: ["eth"], testnet: true },
  { id: "bsc-testnet", name: "BSC Testnet", family: "evm", chainId: "97", nativeSymbol: "BNB", aliases: ["bsc testnet", "bsc", "bnb chain"], slotAliases: ["bnb"], testnet: true },
];

/** The registry this build runs on. Exactly one of the two lists; never both. */
export const NETWORKS: readonly NetworkDefinition[] = IS_TESTNET ? TESTNET_NETWORKS : MAINNET_NETWORKS;

/** Names users write for chains SPak does not support yet. Lets SPak say "unsupported" instead of "unknown". */
export const KNOWN_UNSUPPORTED_NETWORKS: Readonly<Record<string, string>> = {
  fantom: "Fantom", sonic: "Sonic", linea: "Linea", zksync: "zkSync", "zksync era": "zkSync Era", blast: "Blast",
  mantle: "Mantle", celo: "Celo", cronos: "Cronos", kava: "Kava", moonbeam: "Moonbeam", harmony: "Harmony",
  cosmos: "Cosmos", osmosis: "Osmosis", polkadot: "Polkadot", cardano: "Cardano", algorand: "Algorand",
  hedera: "Hedera", tezos: "Tezos", starknet: "Starknet", sei: "Sei", injective: "Injective", hyperliquid: "Hyperliquid",
  monad: "Monad", berachain: "Berachain", scroll: "Scroll", zcash: "Zcash", unichain: "Unichain", ink: "Ink",
};

/** In the testnet build, mainnet-only chain names are known but unsupported, so SPak says so instead of "unknown". */
const TESTNET_UNSUPPORTED: Readonly<Record<string, string>> = {
  solana: "Solana (not in SPak's testnet environment)", near: "NEAR (not in SPak's testnet environment)", optimism: "Optimism (not in SPak's testnet environment)",
  polygon: "Polygon (not in SPak's testnet environment)", avalanche: "Avalanche (not in SPak's testnet environment)", gnosis: "Gnosis (not in SPak's testnet environment)",
  bitcoin: "Bitcoin (not in SPak's testnet environment)", tron: "Tron (not in SPak's testnet environment)", stellar: "Stellar (not in SPak's testnet environment)",
};
if (IS_TESTNET) Object.assign(KNOWN_UNSUPPORTED_NETWORKS as Record<string, string>, TESTNET_UNSUPPORTED);

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
