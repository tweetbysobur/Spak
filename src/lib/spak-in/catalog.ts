import type { NetworkId } from "./types";

export interface NetworkInfo {
  id: NetworkId;
  name: string;
  family: "evm" | "solana" | "near" | "btc" | "other";
}

export const NETWORKS: Record<NetworkId, NetworkInfo> = {
  eth: { id: "eth", name: "Ethereum", family: "evm" },
  base: { id: "base", name: "Base", family: "evm" },
  arb: { id: "arb", name: "Arbitrum", family: "evm" },
  op: { id: "op", name: "Optimism", family: "evm" },
  pol: { id: "pol", name: "Polygon", family: "evm" },
  bsc: { id: "bsc", name: "BNB Chain", family: "evm" },
  avax: { id: "avax", name: "Avalanche", family: "evm" },
  gnosis: { id: "gnosis", name: "Gnosis", family: "evm" },
  bera: { id: "bera", name: "Berachain", family: "evm" },
  monad: { id: "monad", name: "Monad", family: "evm" },
  scroll: { id: "scroll", name: "Scroll", family: "evm" },
  sol: { id: "sol", name: "Solana", family: "solana" },
  near: { id: "near", name: "NEAR", family: "near" },
  btc: { id: "btc", name: "Bitcoin", family: "btc" },
  tron: { id: "tron", name: "Tron", family: "other" },
  ton: { id: "ton", name: "TON", family: "other" },
  sui: { id: "sui", name: "Sui", family: "other" },
  doge: { id: "doge", name: "Dogecoin", family: "other" },
  xrp: { id: "xrp", name: "XRP Ledger", family: "other" },
  zec: { id: "zec", name: "Zcash", family: "other" },
  ltc: { id: "ltc", name: "Litecoin", family: "other" },
  aptos: { id: "aptos", name: "Aptos", family: "other" },
  stellar: { id: "stellar", name: "Stellar", family: "other" },
  cardano: { id: "cardano", name: "Cardano", family: "other" },
};

/** Unambiguous network names. Safe to match anywhere a network is expected. */
const NETWORK_ALIASES: Record<string, NetworkId> = {
  ethereum: "eth", eth: "eth", mainnet: "eth",
  base: "base",
  arbitrum: "arb", arb: "arb",
  optimism: "op", op: "op",
  polygon: "pol", matic: "pol", pol: "pol",
  bsc: "bsc", bnb: "bsc", binance: "bsc", "bnb chain": "bsc",
  avalanche: "avax", avax: "avax",
  gnosis: "gnosis",
  berachain: "bera", bera: "bera",
  monad: "monad",
  scroll: "scroll",
  solana: "sol", sol: "sol",
  near: "near",
  bitcoin: "btc", btc: "btc",
  tron: "tron",
  ton: "ton",
  sui: "sui",
  dogecoin: "doge", doge: "doge",
  xrp: "xrp", ripple: "xrp",
  zcash: "zec", zec: "zec",
  litecoin: "ltc", ltc: "ltc",
  aptos: "aptos",
  stellar: "stellar",
  cardano: "cardano",
};

export function resolveNetwork(word: string): NetworkId | undefined {
  return NETWORK_ALIASES[word.toLowerCase()];
}

/** Tokens that live natively on exactly one network. Lets SPak-in infer the network. */
export const NATIVE_HOME: Record<string, NetworkId> = {
  SOL: "sol", BTC: "btc", NEAR: "near", ZEC: "zec", DOGE: "doge", XRP: "xrp",
  TRX: "tron", TON: "ton", SUI: "sui", LTC: "ltc", APT: "aptos", ADA: "cardano",
  XLM: "stellar", BERA: "bera", MON: "monad",
};

const TOKEN_ALIASES: Record<string, string> = {
  usdc: "USDC", usdt: "USDT", tether: "USDT", dai: "DAI",
  eth: "ETH", ether: "ETH", weth: "WETH", wbtc: "WBTC",
  sol: "SOL", btc: "BTC", near: "NEAR", wnear: "wNEAR",
  bnb: "BNB", pol: "POL", matic: "POL", avax: "AVAX", arb: "ARB", op: "OP",
  zec: "ZEC", doge: "DOGE", xrp: "XRP", trx: "TRX", ton: "TON", sui: "SUI",
  ltc: "LTC", apt: "APT", ada: "ADA", xlm: "XLM", bera: "BERA", mon: "MON",
};

export function resolveToken(word: string): string | undefined {
  const w = word.toLowerCase().replace(/^\$/, "");
  if (TOKEN_ALIASES[w]) return TOKEN_ALIASES[w];
  // Accept unknown tickers that look like tickers. Execution verifies them against the live token list.
  if (/^[a-z][a-z0-9]{1,9}$/.test(w) && !STOP_WORDS.has(w)) return w.toUpperCase();
  return undefined;
}

export const STOP_WORDS = new Set([
  "swap", "convert", "exchange", "trade", "bridge", "move", "send", "pay", "transfer",
  "to", "into", "for", "on", "from", "at", "the", "my", "of", "a", "an", "and", "address",
  "chain", "network", "please", "me", "wallet", "worth", "in", "via", "using", "with",
]);
