/** Mapping between SPak canonical network ids and NEAR Intents 1Click blockchain codes. Provider-specific. */
export const SPAK_TO_ONECLICK: Readonly<Record<string, string>> = {
  ethereum: "eth", base: "base", arbitrum: "arb", optimism: "op", polygon: "pol", bsc: "bsc",
  avalanche: "avax", gnosis: "gnosis", near: "near", solana: "sol", bitcoin: "btc", tron: "tron",
  sui: "sui", xrp: "xrp", dogecoin: "doge", litecoin: "ltc", ton: "ton", stellar: "stellar", aptos: "aptos",
};

export const ONECLICK_TO_SPAK: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(SPAK_TO_ONECLICK).map(([k, v]) => [v, k]),
);
