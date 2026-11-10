/**
 * Held-out set. Written after the engine was tuned on DATASET and never used for tuning.
 * Its score is the honest estimate of how SPak-in handles phrasing it has not seen.
 */
import { E1, E2, S2, type BenchCase, type Expect } from "./dataset";

const cases: BenchCase[] = [];
let n = 0;
function h(tags: string, text: string, expect: Expect, ctx?: Record<string, unknown>) {
  cases.push({ id: `h${String(++n).padStart(3, "0")}`, text, tags: tags.split(","), expect, ...(ctx ? { ctx } : {}) });
}
const V = "VALIDATED", Q = "NEEDS_CLARIFICATION", I = "INVALID", U = "UNSUPPORTED";
const TXS = [{ id: "spak_sub_h1", intentType: "SWAP", state: "AWAITING_DEPOSIT", createdAt: "2026-11-10T09:00:00.000Z" }];
const LAGOS = { timezone: "Africa/Lagos" };

h("swap", "hey spak, swap 40 usdc on arbitrum to sol on solana for me", { type: "CROSS_CHAIN_SWAP", status: V, amt: "40", sn: "arbitrum", da: "SOL", dn: "solana" });
h("swap", "turn 0.3 ETH on Base into USDC on Base", { type: "SWAP", status: V, amt: "0.3", sa: "ETH", da: "USDC" });
h("swap", "I'd like to exchange 250 USDT on BSC for ETH on Arbitrum", { type: "CROSS_CHAIN_SWAP", status: V, sa: "USDT", sn: "bsc", dn: "arbitrum" });
h("swap", "swap 12.5 usdc base sol solana", { type: "CROSS_CHAIN_SWAP", status: V, amt: "12.5" });
h("swap", "sell 3 SOL for USDC, both on Solana", { type: "SWAP", status: V, sa: "SOL", da: "USDC" });
h("swap", "swap 1 eth on ethereum to dai", { type: "SWAP", status: V, da: "DAI", dn: "ethereum" });
h("swap", "get me SOL on Solana for 30 USDC from Base", { type: "CROSS_CHAIN_SWAP", status: V, amt: "30", sa: "USDC", sn: "base", da: "SOL" });
h("swap", "convert 0.75 eth (arbitrum) → usdc (optimism)", { type: "CROSS_CHAIN_SWAP", status: V, sn: "arbitrum", dn: "optimism" });
h("bridge", "can you move 300 usdc from polygon over to arbitrum?", { type: "BRIDGE", status: V, amt: "300", sn: "polygon", dn: "arbitrum" });
h("bridge", "bridge my 2 ETH from Base back to Ethereum", { type: "BRIDGE", status: V, amt: "2", sn: "base", dn: "ethereum" });
h("bridge", "send 40 usdc from optimism to my arbitrum wallet", { type: "CROSS_CHAIN_TRANSFER", status: V, sn: "optimism", dn: "arbitrum", r: "SELF" });
h("bridge", "move 10% of my eth from arbitrum to base", { type: "BRIDGE", status: V, amt: "10%" });
h("bridge", "bridge 5 USDC to Solana from Base", { type: "BRIDGE", status: V, sn: "base", dn: "solana" });
h("payment", `send ${E2} 60 usdc on optimism`, { type: "PAYMENT", status: V, amt: "60", sn: "optimism", r: E2 });
h("payment", `please send 0.5 SOL to ${S2}`, { type: "PAYMENT", status: Q, r: S2, miss: ["source.network"] });
h("payment", `pay 99 USDC from Base to ${E2} on Polygon`, { type: "PAYMENT", status: V, sn: "base", dn: "polygon" });
h("payment", "send 20 usdc to alice", { type: "PAYMENT", status: Q, miss: ["recipient"] });
h("payment", `send 10 usdc on base to ${E1.slice(0, 20)}`, { type: "PAYMENT", status: I, code: "INVALID_ADDRESS" });
h("portfolio", "how much usdc do I hold on arbitrum", { type: "PORTFOLIO_QUERY", status: V });
h("portfolio", "what's my net worth", { type: "PORTFOLIO_QUERY", status: V });
h("portfolio", "show balances", { type: "PORTFOLIO_QUERY", status: V });
h("rebalance", "rebalance: 40% eth, 40% sol, 20% usdc", { type: "PORTFOLIO_REBALANCE", status: V });
h("schedule", "every friday at 6pm send 25 usdc from base to arbitrum", { type: "SCHEDULED_TRANSACTION", status: V }, LAGOS);
h("schedule", "swap 10 usdc on base to eth on base every day", { type: "SCHEDULED_TRANSACTION", status: Q, miss: ["schedule.time"] }, LAGOS);
h("schedule", "bridge 50 usdc from base to arbitrum on 2026-12-01 at 10:00", { type: "SCHEDULED_TRANSACTION", status: V }, LAGOS);
h("condition", "if eth drops under 3000 buy eth on base with 500 usdc", { type: "CONDITIONAL_TRANSACTION", status: V });
h("condition", "ping me when gas on ethereum is under 8 gwei", { type: "CONDITIONAL_TRANSACTION", status: V });
h("condition", "swap 100 usdc on base to sol on solana once sol is below $150", { type: "CONDITIONAL_TRANSACTION", inner: "CROSS_CHAIN_SWAP", status: V });
h("status", "has my last swap completed", { type: "TRANSACTION_STATUS", status: V }, { transactions: TXS });
h("status", "what happened to spak_sub_h1", { type: "TRANSACTION_STATUS", status: V }, { transactions: TXS });
h("history", "show me everything I did this week", { type: "TRANSACTION_HISTORY", status: V });
h("cancel", "never mind, cancel that transaction", { type: "CANCEL_TRANSACTION", status: V }, { transactions: TXS });
h("cancel", "halt my pending bridge", { type: "CANCEL_TRANSACTION", status: V }, { transactions: TXS });
h("missing", "bridge some usdc to base", { type: "BRIDGE", status: Q, miss: ["source.amount", "source.network"] });
h("missing", "swap to sol", { type: "SWAP", status: Q, miss: ["source.amount", "source.asset"] });
h("ambiguous", "swap 10 usdc or eth on base to sol", { type: "SWAP", status: Q });
h("unsupported", "bridge 100 usdc from base to blast", { type: "BRIDGE", status: U, code: "UNSUPPORTED_NETWORK" });
h("unsupported", "swap 5 PEPEXX on base to eth on base", { type: "SWAP", status: U, code: "UNSUPPORTED_ASSET" });
h("invalid", "swap -5 usdc on base to sol on solana", { type: "CROSS_CHAIN_SWAP", status: Q });
h("invalid", "swap 5 usdc on base to sol on solana with 0.001% slippage", { type: "CROSS_CHAIN_SWAP", status: I, code: "INVALID_CONSTRAINT" });

export const HOLDOUT: readonly BenchCase[] = cases;
