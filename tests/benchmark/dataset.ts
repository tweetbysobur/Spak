/**
 * SPak-in benchmark dataset. Each case is an instruction plus the expected structured reading.
 *
 * Expectation fields (all optional except type and status):
 *   amt  amount: "50" exact, "25%" percent of balance, "$100" fiat value
 *   sa/sn  source asset symbol / source network id
 *   da/dn  destination asset symbol / destination network id
 *   r     recipient address, or "SELF"
 *   miss  fields that must be in missingFields
 *   code  an error code that must be present
 *
 * Wallet context for every case unless overridden: see BENCH_WALLETS.
 */
export const E1 = "0x1111111111111111111111111111111111111111";
export const E2 = "0x2222222222222222222222222222222222222222";
export const S1 = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";
export const S2 = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
export const N1 = "bob.near";
export const B1 = "bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq";

export const BENCH_WALLETS = { base: E1, ethereum: E1, arbitrum: E1, optimism: E1, polygon: E1, bsc: E1, avalanche: E1, solana: S1, near: "alice.near" };

export type Status = "VALIDATED" | "NEEDS_CLARIFICATION" | "INVALID" | "UNSUPPORTED" | "POLICY_REJECTED";
export interface Expect {
  type: string; status: Status; inner?: string;
  amt?: string; sa?: string; sn?: string; da?: string; dn?: string; r?: string;
  miss?: string[]; code?: string;
}
export interface BenchCase {
  id: string;
  text: string;
  tags: string[];
  ctx?: Record<string, unknown>;
  expect: Expect;
}

const cases: BenchCase[] = [];
let n = 0;
function c(tags: string, text: string, expect: Expect, ctx?: Record<string, unknown>) {
  cases.push({ id: `b${String(++n).padStart(3, "0")}`, text, tags: tags.split(","), expect, ...(ctx ? { ctx } : {}) });
}
const V = "VALIDATED", Q = "NEEDS_CLARIFICATION", I = "INVALID", U = "UNSUPPORTED", P = "POLICY_REJECTED";
const TXS = [
  { id: "spak_sub_a1", intentType: "SWAP", state: "AWAITING_DEPOSIT", createdAt: "2026-11-10T09:00:00.000Z", summary: "50 USDC to SOL" },
  { id: "spak_sub_a2", intentType: "PAYMENT", state: "COMPLETED", createdAt: "2026-11-09T09:00:00.000Z" },
];
const TWO_PENDING = [...TXS, { id: "spak_sub_a3", intentType: "BRIDGE", state: "AWAITING_APPROVAL", createdAt: "2026-11-10T09:30:00.000Z" }];
const SCHED = [{ id: "spak_sub_s1", intentType: "SCHEDULED_TRANSACTION", state: "SCHEDULED", createdAt: "2026-11-01T09:00:00.000Z" }];
const LAGOS = { timezone: "Africa/Lagos" };

// ---------------- Cross-chain swaps ----------------
c("swap,cross", "Swap 50 USDC on Base to SOL on Solana", { type: "CROSS_CHAIN_SWAP", status: V, amt: "50", sa: "USDC", sn: "base", da: "SOL", dn: "solana", r: "SELF" });
c("swap,cross,variation", "swap 50 usdc on base for sol on solana", { type: "CROSS_CHAIN_SWAP", status: V, amt: "50", sa: "USDC", sn: "base", da: "SOL", dn: "solana" });
c("swap,cross,variation", "Convert 50 USDC (Base) -> SOL (Solana)", { type: "CROSS_CHAIN_SWAP", status: V, amt: "50", sn: "base", dn: "solana" });
c("swap,cross,variation", "exchange 50 usdc from base into sol on solana", { type: "CROSS_CHAIN_SWAP", status: V, sn: "base", da: "SOL", dn: "solana" });
c("swap,cross,variation", "trade 50 USD Coin on Base to Solana SOL", { type: "CROSS_CHAIN_SWAP", status: V, sa: "USDC", da: "SOL", dn: "solana" });
c("swap,cross,variation", "50usdc base to sol solana, swap please", { type: "CROSS_CHAIN_SWAP", status: V, amt: "50", sn: "base", dn: "solana" });
c("swap,cross", "swap 0.25 ETH on Arbitrum to USDC on Base", { type: "CROSS_CHAIN_SWAP", status: V, amt: "0.25", sa: "ETH", sn: "arbitrum", da: "USDC", dn: "base" });
c("swap,cross", "Swap 1000 USDT on Ethereum to NEAR on NEAR", { type: "CROSS_CHAIN_SWAP", status: V, amt: "1000", sa: "USDT", sn: "ethereum", da: "NEAR", dn: "near" });
c("swap,cross", "swap 2 SOL on solana to ETH on base", { type: "CROSS_CHAIN_SWAP", status: V, amt: "2", sa: "SOL", sn: "solana", da: "ETH", dn: "base" });
c("swap,cross", "Swap 100 NEAR on NEAR to USDC on Arbitrum", { type: "CROSS_CHAIN_SWAP", status: V, sa: "NEAR", sn: "near", da: "USDC", dn: "arbitrum" });
c("swap,cross,alias", "swap 1,500 usdc on bnb chain to eth on optimism", { type: "CROSS_CHAIN_SWAP", status: V, amt: "1500", sn: "bsc", da: "ETH", dn: "optimism" });
c("swap,cross,alias", "swap 3 avax on avalanche to usdc on polygon", { type: "CROSS_CHAIN_SWAP", status: V, sa: "AVAX", sn: "avalanche", dn: "polygon" });
c("swap,cross,alias", "Convert 10 matic on polygon to usdc on base", { type: "CROSS_CHAIN_SWAP", status: V, sa: "POL", sn: "polygon", dn: "base" });
c("swap,cross", "swap 0.01 eth on ethereum to sol on solana", { type: "CROSS_CHAIN_SWAP", status: V, amt: "0.01", sa: "ETH", da: "SOL" });
c("swap,cross,variation", "I want to swap 20 usdc on arbitrum to sol on solana", { type: "CROSS_CHAIN_SWAP", status: V, amt: "20", sn: "arbitrum", dn: "solana" });
c("swap,cross,variation", "can you convert 75 USDC on Base into NEAR on NEAR", { type: "CROSS_CHAIN_SWAP", status: V, amt: "75", da: "NEAR", dn: "near" });
c("swap,cross,variation", "Please swap 5 USDC from Optimism to SOL on Solana", { type: "CROSS_CHAIN_SWAP", status: V, sn: "optimism", dn: "solana" });
c("swap,cross,constraint", "swap 50 usdc on base to sol on solana with max 0.5% slippage", { type: "CROSS_CHAIN_SWAP", status: V, amt: "50" });
c("swap,cross,constraint", "Swap 50 USDC on Base to SOL on Solana and receive at least 0.5 SOL", { type: "CROSS_CHAIN_SWAP", status: V, amt: "50" });
c("swap,cross,fiat", "swap $100 of eth on base to sol on solana", { type: "CROSS_CHAIN_SWAP", status: V, amt: "$100", sa: "ETH" });
c("swap,cross,buy", "buy SOL on Solana with 50 USDC on Base", { type: "CROSS_CHAIN_SWAP", status: V, amt: "50", sa: "USDC", sn: "base", da: "SOL", dn: "solana" });
c("swap,cross,sell", "sell 1 ETH on Ethereum for USDC on Arbitrum", { type: "CROSS_CHAIN_SWAP", status: V, sa: "ETH", da: "USDC", dn: "arbitrum" });
c("swap,cross,percent", "swap half my usdc on base to sol on solana", { type: "CROSS_CHAIN_SWAP", status: V, amt: "50%" });
c("swap,cross,decimal", "swap .5 eth on arbitrum to usdc on base", { type: "CROSS_CHAIN_SWAP", status: V, amt: "0.5" });
c("swap,cross,suffix", "swap 2k usdc on base to sol on solana", { type: "CROSS_CHAIN_SWAP", status: V, amt: "2000" });

// ---------------- Same-chain swaps ----------------
c("swap,same", "swap 1 ETH to USDC on Base", { type: "SWAP", status: V, amt: "1", sa: "ETH", sn: "base", da: "USDC", dn: "base" });
c("swap,same", "Swap 100 USDC for ETH on Arbitrum", { type: "SWAP", status: V, sa: "USDC", sn: "arbitrum", da: "ETH", dn: "arbitrum" });
c("swap,same", "convert 10 SOL to USDC on Solana", { type: "SWAP", status: V, sn: "solana", dn: "solana" });
c("swap,same", "swap 500 usdt on ethereum to usdc on ethereum", { type: "SWAP", status: V, sa: "USDT", da: "USDC", dn: "ethereum" });
c("swap,same", "swap 50 NEAR to USDC on NEAR", { type: "SWAP", status: V, sa: "NEAR", sn: "near" });
c("swap,same", "on base, swap 20 usdc to eth", { type: "SWAP", status: V, sn: "base", da: "ETH" });
c("swap,same,variation", "trade 0.1 eth for usdc on optimism", { type: "SWAP", status: V, amt: "0.1", dn: "optimism" });
c("swap,same,variation", "exchange 25 usdc into weth on base", { type: "SWAP", status: V, da: "WETH" });

// ---------------- Bridges ----------------
c("bridge", "Bridge 0.5 ETH from Ethereum to NEAR", { type: "BRIDGE", status: V, amt: "0.5", sa: "ETH", sn: "ethereum", da: "ETH", dn: "near", r: "SELF" });
c("bridge", "bridge 100 usdc from base to arbitrum", { type: "BRIDGE", status: V, sa: "USDC", sn: "base", dn: "arbitrum" });
c("bridge", "Bridge 1 ETH from Arbitrum to Base", { type: "BRIDGE", status: V, sn: "arbitrum", dn: "base" });
c("bridge", "move 50 USDC from Base to Solana", { type: "BRIDGE", status: V, sn: "base", dn: "solana" });
c("bridge,alias", "bridge 1 ether from mainnet to arbitrum one", { type: "BRIDGE", status: V, sa: "ETH", sn: "ethereum", dn: "arbitrum" });
c("bridge,alias", "bridge 10 tether from bnb chain to polygon", { type: "BRIDGE", status: V, sa: "USDT", sn: "bsc", dn: "polygon" });
c("bridge,percent", "Move 25% of my USDC balance from Base to NEAR", { type: "BRIDGE", status: V, amt: "25%", sa: "USDC", sn: "base", dn: "near" });
c("bridge,percent", "bridge all my eth from optimism to base", { type: "BRIDGE", status: V, amt: "100%", sn: "optimism", dn: "base" });
c("bridge,percent", "move half of my usdc from arbitrum to base", { type: "BRIDGE", status: V, amt: "50%" });
c("bridge,variation", "port 200 usdc over from polygon to base", { type: "BRIDGE", status: V, sn: "polygon", dn: "base" });
c("bridge,variation", "I need to bridge 0.2 eth from base over to arbitrum", { type: "BRIDGE", status: V, amt: "0.2", dn: "arbitrum" });
c("bridge,self", "move 5 usdc from base to my wallet on arbitrum", { type: "BRIDGE", status: V, dn: "arbitrum", r: "SELF" });
c("bridge,swap", "bridge 1 eth from ethereum to usdc on base", { type: "CROSS_CHAIN_SWAP", status: V, da: "USDC", dn: "base" });
c("bridge,near", "bridge 20 usdc from arbitrum to near", { type: "BRIDGE", status: V, dn: "near" });
c("bridge,arrow", "bridge 30 usdc base -> arbitrum", { type: "BRIDGE", status: V, sn: "base", dn: "arbitrum" });

// ---------------- Cross-chain transfers ----------------
c("transfer", "Transfer 50 USDC from Base to Ethereum", { type: "CROSS_CHAIN_TRANSFER", status: V, amt: "50", sa: "USDC", sn: "base", da: "USDC", dn: "ethereum", r: "SELF" });
c("transfer", "transfer 10 usdc from arbitrum to optimism", { type: "CROSS_CHAIN_TRANSFER", status: V, sn: "arbitrum", dn: "optimism" });
c("transfer", "transfer 0.1 eth from base to arbitrum", { type: "CROSS_CHAIN_TRANSFER", status: V, sa: "ETH" });
c("transfer", "Transfer 100 USDT from Ethereum to BSC", { type: "CROSS_CHAIN_TRANSFER", status: V, sa: "USDT", dn: "bsc" });
c("transfer", "transfer 25 usdc from base to solana", { type: "CROSS_CHAIN_TRANSFER", status: V, dn: "solana", r: "SELF" });
c("transfer,self", "send 10 usdc from base to myself on arbitrum", { type: "CROSS_CHAIN_TRANSFER", status: V, dn: "arbitrum", r: "SELF" });
c("transfer,self", "send 5 USDC on Base to my own wallet on Optimism", { type: "CROSS_CHAIN_TRANSFER", status: V, dn: "optimism", r: "SELF" });
c("transfer,missing", "Send 100 USDC to Base", { type: "CROSS_CHAIN_TRANSFER", status: Q, dn: "base", miss: ["recipient", "source.network"] });
c("transfer,missing", "transfer 50 usdc to arbitrum", { type: "CROSS_CHAIN_TRANSFER", status: Q, miss: ["source.network"] });
c("transfer,wallet", "Transfer 50 USDC from Base to Ethereum", { type: "CROSS_CHAIN_TRANSFER", status: Q, miss: ["recipient", "refundAddress"] }, { wallets: {} });

// ---------------- Payments ----------------
c("payment", `Send 50 USDC on Base to ${E2}`, { type: "PAYMENT", status: V, amt: "50", sn: "base", dn: "base", r: E2 });
c("payment", `send 100 usdc on base to ${E2} on arbitrum`, { type: "PAYMENT", status: V, sn: "base", dn: "arbitrum", r: E2 });
c("payment", `pay ${E2} 25 USDC on Arbitrum`, { type: "PAYMENT", status: V, amt: "25", sn: "arbitrum", r: E2 });
c("payment", `Send 1 SOL on Solana to ${S2}`, { type: "PAYMENT", status: V, sa: "SOL", dn: "solana", r: S2 });
c("payment", `send 10 NEAR on near to ${N1}`, { type: "PAYMENT", status: V, sa: "NEAR", r: N1 });
c("payment", `transfer 30 usdc on base to ${E2} on optimism`, { type: "PAYMENT", status: V, dn: "optimism", r: E2 });
c("payment", `send 0.002 BTC on bitcoin to ${B1}`, { type: "PAYMENT", status: V, sa: "BTC", r: B1 }, { wallets: { bitcoin: B1 } });
c("payment,cross", `send 20 usdc from base to ${S2} on solana`, { type: "PAYMENT", status: V, sn: "base", dn: "solana", r: S2 });
c("payment,variation", `Please pay 15 USDC on Base to ${E2}`, { type: "PAYMENT", status: V, amt: "15" });
c("payment,variation", `tip ${E2} 5 usdc on base`, { type: "PAYMENT", status: V, amt: "5", r: E2 });
c("payment,variation", `send ${E2} 12 usdc on arbitrum`, { type: "PAYMENT", status: V, amt: "12", sn: "arbitrum" });
c("payment,missing", "Send 100 USDC to this Arbitrum address", { type: "PAYMENT", status: Q, dn: "arbitrum", miss: ["recipient", "source.network"] });
c("payment,missing", `send 100 usdc to ${E2} on arbitrum`, { type: "PAYMENT", status: Q, miss: ["source.network"] });
c("payment,missing", "pay 40 usdc on base", { type: "PAYMENT", status: Q, miss: ["recipient"] });
c("payment,missing", `send usdc on base to ${E2}`, { type: "PAYMENT", status: Q, miss: ["source.amount"] });
c("payment,missing", `send 20 on base to ${E2}`, { type: "PAYMENT", status: Q, miss: ["source.asset"] });
c("payment,address", `send 10 usdc on base to ${S2}`, { type: "PAYMENT", status: Q, miss: ["destination.network"] });
c("payment,address", `send 10 usdc on base to ${S2} on arbitrum`, { type: "PAYMENT", status: I, code: "ADDRESS_NETWORK_MISMATCH" });
c("payment,address", "send 10 usdc on base to 0x12345", { type: "PAYMENT", status: I, code: "INVALID_ADDRESS" });
c("payment,address", "send 10 usdc on base to vitalik.eth", { type: "PAYMENT", status: I, code: "INVALID_ADDRESS" });
c("payment,address", `send 1 sol on solana to ${E2}`, { type: "PAYMENT", status: Q, miss: ["destination.network"] });
c("payment,address", "send 5 usdc on base to 0x…", { type: "PAYMENT", status: I, code: "INVALID_ADDRESS" });

// ---------------- Portfolio ----------------
c("portfolio", "show my portfolio", { type: "PORTFOLIO_QUERY", status: V });
c("portfolio", "what's my USDC balance on Base", { type: "PORTFOLIO_QUERY", status: V });
c("portfolio", "how much ETH do I have", { type: "PORTFOLIO_QUERY", status: V });
c("portfolio", "check my balances", { type: "PORTFOLIO_QUERY", status: V });
c("portfolio", "what is my total portfolio worth", { type: "PORTFOLIO_QUERY", status: V });
c("portfolio", "show my holdings on solana", { type: "PORTFOLIO_QUERY", status: V });
c("portfolio", "display my assets across all networks", { type: "PORTFOLIO_QUERY", status: V });
c("portfolio", "get my balance", { type: "PORTFOLIO_QUERY", status: V });
c("portfolio,missing", "show my portfolio", { type: "PORTFOLIO_QUERY", status: Q, miss: ["wallets"] }, { wallets: {} });
c("portfolio", "list my funds on arbitrum and base", { type: "PORTFOLIO_QUERY", status: V });

// ---------------- Rebalance ----------------
c("rebalance", "rebalance my portfolio to 60% ETH and 40% USDC", { type: "PORTFOLIO_REBALANCE", status: V });
c("rebalance", "rebalance to 50% SOL, 30% ETH, 20% USDC", { type: "PORTFOLIO_REBALANCE", status: V });
c("rebalance", "reallocate my holdings: ETH 70%, USDC 30%", { type: "PORTFOLIO_REBALANCE", status: V });
c("rebalance,invalid", "rebalance to 60% ETH and 30% USDC", { type: "PORTFOLIO_REBALANCE", status: I, code: "INVALID_ALLOCATION" });
c("rebalance,missing", "rebalance my portfolio", { type: "PORTFOLIO_REBALANCE", status: Q, miss: ["allocations"] });
c("rebalance", "diversify into 50% eth and 50% usdc", { type: "PORTFOLIO_REBALANCE", status: V });
c("rebalance,invalid", "rebalance to 50% FOOBAR and 50% USDC", { type: "PORTFOLIO_REBALANCE", status: U, code: "UNSUPPORTED_ASSET" });

// ---------------- Scheduled ----------------
c("schedule,missing", "Schedule a transfer of 20 USDC every Monday", { type: "SCHEDULED_TRANSACTION", status: Q, amt: "20", miss: ["schedule.time", "schedule.timezone", "source.network"] });
c("schedule", "Schedule a transfer of 20 USDC from Base to Arbitrum every Monday at 9am", { type: "SCHEDULED_TRANSACTION", inner: "CROSS_CHAIN_TRANSFER", status: V, amt: "20" }, LAGOS);
c("schedule", `send 10 usdc on base to ${E2} every friday at 5pm`, { type: "SCHEDULED_TRANSACTION", inner: "PAYMENT", status: V, r: E2 }, LAGOS);
c("schedule", "swap 50 usdc on base to sol on solana every day at 08:00", { type: "SCHEDULED_TRANSACTION", inner: "CROSS_CHAIN_SWAP", status: V }, LAGOS);
c("schedule", "bridge 100 usdc from base to arbitrum weekly on mondays at 10am", { type: "SCHEDULED_TRANSACTION", inner: "BRIDGE", status: V }, LAGOS);
c("schedule", `pay ${E2} 200 usdc on base monthly on the 1st at 9am`, { type: "SCHEDULED_TRANSACTION", inner: "PAYMENT", status: V }, LAGOS);
c("schedule", "transfer 5 usdc from base to optimism every 2 hours", { type: "SCHEDULED_TRANSACTION", inner: "CROSS_CHAIN_TRANSFER", status: V });
c("schedule", "swap 1 eth to usdc on base tomorrow at 9am", { type: "SCHEDULED_TRANSACTION", inner: "SWAP", status: V }, LAGOS);
c("schedule", "swap 1 eth to usdc on base in 3 hours", { type: "SCHEDULED_TRANSACTION", inner: "SWAP", status: V });
c("schedule,missing", "swap 1 eth to usdc on base tomorrow", { type: "SCHEDULED_TRANSACTION", status: Q, miss: ["schedule.time"] }, LAGOS);
c("schedule,missing", "bridge 10 usdc from base to arbitrum every monday at 9", { type: "SCHEDULED_TRANSACTION", status: I, code: "INVALID_SCHEDULE" }, LAGOS);
c("schedule,missing", "send 10 usdc from base to arbitrum every weekday at 9am", { type: "SCHEDULED_TRANSACTION", status: Q, miss: ["schedule.timezone"] });
c("schedule", "set up a recurring transfer of 15 usdc from base to arbitrum every sunday at 6pm", { type: "SCHEDULED_TRANSACTION", status: V }, LAGOS);
c("schedule", "automate swapping 10 usdc on base to sol on solana every week on friday at 12:00", { type: "SCHEDULED_TRANSACTION", status: V }, LAGOS);
c("schedule,missing", "schedule a swap every monday", { type: "SCHEDULED_TRANSACTION", status: Q, miss: ["source.amount", "source.asset"] }, LAGOS);

// ---------------- Conditional ----------------
c("condition", "Swap 1 ETH on Base to USDC when ETH reaches $4,000", { type: "CONDITIONAL_TRANSACTION", inner: "SWAP", status: V });
c("condition", "when SOL drops below 100, swap 50 usdc on base to sol on solana", { type: "CONDITIONAL_TRANSACTION", inner: "CROSS_CHAIN_SWAP", status: V });
c("condition", "if ETH goes above 5000 sell 0.5 eth on arbitrum for usdc on arbitrum", { type: "CONDITIONAL_TRANSACTION", inner: "SWAP", status: V });
c("condition", "bridge 1 eth from ethereum to base when gas is below 10 gwei", { type: "CONDITIONAL_TRANSACTION", inner: "BRIDGE", status: V });
c("condition", "bridge 100 usdc from base to arbitrum once fees fall below $1", { type: "CONDITIONAL_TRANSACTION", status: V });
c("condition,notify", "Notify me when a preferred execution route becomes available", { type: "CONDITIONAL_TRANSACTION", status: V });
c("condition,notify", "alert me when ETH is above $4500", { type: "CONDITIONAL_TRANSACTION", status: V });
c("condition,notify", "let me know if SOL falls under 120", { type: "CONDITIONAL_TRANSACTION", status: V });
c("condition,invalid", "swap 1 eth on base to usdc when it goes up", { type: "CONDITIONAL_TRANSACTION", status: I, code: "INVALID_CONDITION" });
c("condition,missing", "when eth hits 4000 swap it", { type: "CONDITIONAL_TRANSACTION", status: Q });
c("condition", "as soon as SOL hits $200 swap 2 sol on solana to usdc on base", { type: "CONDITIONAL_TRANSACTION", inner: "CROSS_CHAIN_SWAP", status: V });
c("condition", "If BTC drops below 60000, swap 1000 USDC on Ethereum to ETH on Ethereum", { type: "CONDITIONAL_TRANSACTION", inner: "SWAP", status: V });
c("condition,invalid", "swap 1 eth on base to usdc when FOOBAR is above 5", { type: "CONDITIONAL_TRANSACTION", status: U, code: "UNSUPPORTED_ASSET" });

// ---------------- Status and history ----------------
c("status", "what's the status of my last transaction", { type: "TRANSACTION_STATUS", status: V }, { transactions: TXS });
c("status", "where is my swap", { type: "TRANSACTION_STATUS", status: V }, { transactions: TXS });
c("status", "track spak_sub_a1", { type: "TRANSACTION_STATUS", status: V }, { transactions: TXS });
c("status", "did my transfer arrive", { type: "TRANSACTION_STATUS", status: V }, { transactions: TXS });
c("status", "status of spak_sub_a2", { type: "TRANSACTION_STATUS", status: V }, { transactions: TXS });
c("status,invalid", "status of spak_sub_zz", { type: "TRANSACTION_STATUS", status: I, code: "TRANSACTION_NOT_FOUND" }, { transactions: TXS });
c("status,invalid", "check the status of my transaction", { type: "TRANSACTION_STATUS", status: I, code: "TRANSACTION_NOT_FOUND" });
c("status", "is my pending transaction done", { type: "TRANSACTION_STATUS", status: V }, { transactions: TXS });
c("history", "Show my transaction history", { type: "TRANSACTION_HISTORY", status: V });
c("history", "list my recent transactions", { type: "TRANSACTION_HISTORY", status: V });
c("history", "show my activity", { type: "TRANSACTION_HISTORY", status: V });
c("history", "what transactions did I do yesterday", { type: "TRANSACTION_HISTORY", status: V });
c("history", "view my past swaps", { type: "TRANSACTION_HISTORY", status: V });
c("history", "history", { type: "TRANSACTION_HISTORY", status: V });

// ---------------- Cancel ----------------
c("cancel", "Cancel my pending transaction", { type: "CANCEL_TRANSACTION", status: V }, { transactions: TXS });
c("cancel,ambiguous", "Cancel my pending transaction", { type: "CANCEL_TRANSACTION", status: Q, code: "AMBIGUOUS_TARGET", miss: ["target"] }, { transactions: TWO_PENDING });
c("cancel,invalid", "Cancel my pending transaction", { type: "CANCEL_TRANSACTION", status: I, code: "NO_PENDING_TRANSACTION" });
c("cancel", "cancel spak_sub_a1", { type: "CANCEL_TRANSACTION", status: V }, { transactions: TXS });
c("cancel,invalid", "cancel spak_sub_a2", { type: "CANCEL_TRANSACTION", status: I, code: "NO_PENDING_TRANSACTION" }, { transactions: TXS });
c("cancel", "stop my scheduled transfer", { type: "CANCEL_TRANSACTION", status: V }, { transactions: SCHED });
c("cancel", "cancel all pending transactions", { type: "CANCEL_TRANSACTION", status: V }, { transactions: TWO_PENDING });
c("cancel", "abort the swap", { type: "CANCEL_TRANSACTION", status: V }, { transactions: TXS });
c("cancel", "cancel my last transaction", { type: "CANCEL_TRANSACTION", status: V }, { transactions: TXS });
c("cancel,invalid", "cancel my recurring payment", { type: "CANCEL_TRANSACTION", status: I, code: "NO_PENDING_TRANSACTION" }, { transactions: TXS });
c("cancel", "undo my transaction", { type: "CANCEL_TRANSACTION", status: V }, { transactions: TXS });

// ---------------- Missing parameters ----------------
c("missing", "Swap 50 USDC.", { type: "SWAP", status: Q, amt: "50", sa: "USDC", miss: ["destination.asset", "destination.network", "source.network"] });
c("missing", "Move my money", { type: "BRIDGE", status: Q, miss: ["source.amount", "source.asset", "destination.network"] });
c("missing", "swap usdc to sol", { type: "SWAP", status: Q, miss: ["source.amount", "source.network"] });
c("missing", "swap 50 usdc on base", { type: "SWAP", status: Q, sn: "base", miss: ["destination.asset"] });
c("missing", "bridge 100 usdc to arbitrum", { type: "BRIDGE", status: Q, dn: "arbitrum", miss: ["source.network"] });
c("missing", "bridge usdc from base to arbitrum", { type: "BRIDGE", status: Q, miss: ["source.amount"] });
c("missing", "swap 50 on base to sol on solana", { type: "CROSS_CHAIN_SWAP", status: Q, miss: ["source.asset"] });
c("missing", "send 50 usdc", { type: "PAYMENT", status: Q, miss: ["recipient", "source.network"] });
c("missing", "swap 50 usdc on base to sol", { type: "SWAP", status: Q, miss: ["destination.network"] });
c("missing", "Move 25% of my USDC balance to NEAR", { type: "BRIDGE", status: Q, amt: "25%", dn: "near", miss: ["source.network"] });
c("missing", "swap something", { type: "SWAP", status: Q, miss: ["source.amount", "source.asset"] });
c("missing", "send money to my friend", { type: "PAYMENT", status: Q, miss: ["source.amount", "recipient"] });
c("missing", "bridge 1 eth", { type: "BRIDGE", status: Q, miss: ["source.network", "destination.network"] });

// ---------------- Ambiguous ----------------
c("ambiguous", "swap 50 or 60 usdc on base to sol on solana", { type: "CROSS_CHAIN_SWAP", status: Q, code: "AMBIGUOUS_AMOUNT" });
c("ambiguous", "swap 5 usdc on base to sol on solana and send it to " + E2, { type: "CROSS_CHAIN_SWAP", status: U, code: "MULTI_STEP_NOT_SUPPORTED" });
c("ambiguous", "buy 2 SOL with USDC on solana", { type: "SWAP", status: Q, code: "AMBIGUOUS_AMOUNT" });
c("ambiguous", `send 5 usdc on base to ${E1} and ${E2}`, { type: "PAYMENT", status: Q, code: "AMBIGUOUS_TARGET" });
c("ambiguous", "hello there", { type: "UNKNOWN", status: Q, code: "UNKNOWN_INTENT" });
c("ambiguous", "do the thing", { type: "UNKNOWN", status: Q });
c("ambiguous", "usdc", { type: "UNKNOWN", status: Q });
c("ambiguous", "make it 100", { type: "UNKNOWN", status: Q });
c("ambiguous", "what can you do", { type: "UNKNOWN", status: Q });
c("ambiguous", "swap 5 usdc from base from arbitrum to sol", { type: "SWAP", status: Q, code: "AMBIGUOUS_NETWORK_ROLE" });

// ---------------- Invalid and unsupported ----------------
c("unsupported", "Swap 50 USDC on an unsupported network", { type: "SWAP", status: U, code: "UNSUPPORTED_NETWORK" });
c("unsupported", "swap 50 usdc on fantom to sol on solana", { type: "CROSS_CHAIN_SWAP", status: U, code: "UNSUPPORTED_NETWORK" });
c("unsupported", "bridge 1 eth from ethereum to zksync", { type: "BRIDGE", status: U, code: "UNSUPPORTED_NETWORK" });
c("unsupported", "bridge 10 usdc from base to linea", { type: "BRIDGE", status: U, code: "UNSUPPORTED_NETWORK" });
c("unsupported", "swap 50 FOOBAR on base to usdc on base", { type: "SWAP", status: U, code: "UNSUPPORTED_ASSET" });
c("unsupported", "swap 50 usdc on base to ZZZQ on solana", { type: "CROSS_CHAIN_SWAP", status: U, code: "UNSUPPORTED_ASSET" });
c("unsupported", "swap 50 usdc on base to sol on base", { type: "SWAP", status: U, code: "ASSET_NOT_ON_NETWORK" });
c("unsupported", "bridge 1 sol from solana to arbitrum", { type: "BRIDGE", status: U, code: "ASSET_NOT_ON_NETWORK" });
c("unsupported", "swap 10 usdc on cosmos to atom", { type: "SWAP", status: U, code: "UNSUPPORTED_NETWORK" });
c("invalid", "swap 0 usdc on base to sol on solana", { type: "CROSS_CHAIN_SWAP", status: I, code: "INVALID_AMOUNT" });
c("invalid", "swap 1.1234567 usdc on base to sol on solana", { type: "CROSS_CHAIN_SWAP", status: I, code: "AMOUNT_PRECISION" });
c("invalid", "move 150% of my usdc from base to near", { type: "BRIDGE", status: I, code: "INVALID_PERCENTAGE" });
c("invalid", "swap 5 usdc on base to usdc on base", { type: "SWAP", status: I, code: "SAME_ASSET_SAME_NETWORK" });
c("invalid", "swap 5 usdc on base to sol on solana with 80% slippage", { type: "CROSS_CHAIN_SWAP", status: I, code: "INVALID_CONSTRAINT" });
c("invalid", "", { type: "UNKNOWN", status: I, code: "INPUT_EMPTY" });
c("invalid", "!!! ??? 123", { type: "UNKNOWN", status: I, code: "INPUT_MALFORMED" });
c("invalid", "swap ".repeat(120), { type: "UNKNOWN", status: I, code: "INPUT_TOO_LONG" });
c("invalid", "swap 5 usdc on base to sol on solana and receive at least 1 ETH", { type: "CROSS_CHAIN_SWAP", status: I, code: "INVALID_CONSTRAINT" });

// ---------------- Policy ----------------
const PRICE = { pricesUsd: { "base:0x833589fcd6edb6e08f4c7c32d4f71b54bda02913": "1" } };
c("policy", "swap 500 usdc on base to sol on solana", { type: "CROSS_CHAIN_SWAP", status: P, code: "POLICY_TX_LIMIT_EXCEEDED" }, { policy: { maxTransactionUsd: "100" }, runtime: PRICE });
c("policy", "swap 50 usdc on base to sol on solana", { type: "CROSS_CHAIN_SWAP", status: P, code: "POLICY_DAILY_LIMIT_EXCEEDED" }, { policy: { dailyLimitUsd: "100" }, runtime: { ...PRICE, spentTodayUsd: "60" } });
c("policy", "swap 50 usdc on base to sol on solana", { type: "CROSS_CHAIN_SWAP", status: P, code: "POLICY_NETWORK_NOT_ALLOWED" }, { policy: { allowedNetworks: ["base", "arbitrum"] } });
c("policy", "swap 50 usdc on base to sol on solana", { type: "CROSS_CHAIN_SWAP", status: P, code: "POLICY_ASSET_NOT_ALLOWED" }, { policy: { allowedAssets: ["USDC"] } });
c("policy", "swap 50 usdc on base to sol on solana with 2% slippage", { type: "CROSS_CHAIN_SWAP", status: P, code: "POLICY_SLIPPAGE_EXCEEDED" });
c("policy", `send 5 usdc on base to ${E2}`, { type: "PAYMENT", status: P, code: "POLICY_RECIPIENT_NOT_APPROVED" }, { policy: { recipientMode: "APPROVED_ONLY" } });
c("policy", `send 5 usdc on base to ${E2}`, { type: "PAYMENT", status: V }, { policy: { recipientMode: "APPROVED_ONLY", approvedRecipients: [E2] } });
c("policy", "swap 50 usdc on base to sol on solana", { type: "CROSS_CHAIN_SWAP", status: V }, { policy: { maxTransactionUsd: "100" }, runtime: PRICE });

// ---------------- Extra wording variations ----------------
c("variation", "Swap fifty dollars of USDC on Base to SOL on Solana", { type: "CROSS_CHAIN_SWAP", status: Q, miss: ["source.amount"] });
c("variation", "swap 50 USDC (on Base) for SOL (on Solana) please", { type: "CROSS_CHAIN_SWAP", status: V, amt: "50" });
c("variation", "SWAP 50 USDC ON BASE TO SOL ON SOLANA", { type: "CROSS_CHAIN_SWAP", status: V, amt: "50" });
c("variation", "swap   50   usdc   on base   to   sol on solana!!!", { type: "CROSS_CHAIN_SWAP", status: V, amt: "50" });
c("variation", "Could you bridge 0.5 ETH from Ethereum mainnet over to NEAR Protocol?", { type: "BRIDGE", status: V, sn: "ethereum", dn: "near" });
c("variation", "get 50 usdc from base onto arbitrum, bridge it", { type: "BRIDGE", status: Q });
c("variation", "move 100 usdc base→arbitrum", { type: "BRIDGE", status: V, sn: "base", dn: "arbitrum" });
c("variation", "swap 1 eth for sol", { type: "SWAP", status: Q, miss: ["source.network"] });
c("variation", "convert all my USDC on Arbitrum to ETH on Arbitrum", { type: "SWAP", status: V, amt: "100%" });
c("variation", "swap 10 USDC.e on arbitrum to eth on arbitrum", { type: "SWAP", status: V, sa: "USDC" });
c("variation", `Send 25 USDT on Ethereum to ${E2} please`, { type: "PAYMENT", status: V, sa: "USDT", sn: "ethereum" });
c("variation", "swap 100 dai on ethereum to usdc on base", { type: "CROSS_CHAIN_SWAP", status: V, sa: "DAI" });
c("variation", "swap 0.5 wbtc on ethereum to eth on ethereum", { type: "SWAP", status: V, sa: "WBTC" });
c("variation", "bridge 50 usdc from base to arb", { type: "BRIDGE", status: V, dn: "arbitrum" });
c("variation", "bridge 0.05 eth from op to base", { type: "BRIDGE", status: V, sn: "optimism" });
c("variation", "swap 1 bnb on bsc to usdt on bsc", { type: "SWAP", status: V, sa: "BNB", sn: "bsc" });
c("variation", "move 5 sol from solana to near", { type: "BRIDGE", status: U, code: "ASSET_NOT_ON_NETWORK" }); // NEAR Intents lists no SOL on NEAR
c("variation", "transfer 1 near from near to solana", { type: "CROSS_CHAIN_TRANSFER", status: V, sa: "NEAR", dn: "solana" });
c("variation", "Swap 50 USDC on Base to SOL on Solana.", { type: "CROSS_CHAIN_SWAP", status: V });
c("variation", "swap 50 usdc on base to sol on solana, max slippage 1%", { type: "CROSS_CHAIN_SWAP", status: V });

export const DATASET: readonly BenchCase[] = cases;
