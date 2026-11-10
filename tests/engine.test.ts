import { describe, expect, it } from "vitest";
import { IntentRegistry, createDefaultRegistry, SpakIn, sequentialIds } from "@/spak-in";
import { BTC, EVM, NEAR, NOW, SOL, WALLETS, run } from "./helpers";

describe("SPak-in: brief examples", () => {
  it("Swap 50 USDC on Base to SOL on Solana", async () => {
    const r = await run("Swap 50 USDC on Base to SOL on Solana");
    expect(r).toMatchObject({
      intentType: "CROSS_CHAIN_SWAP", status: "VALIDATED", executionMode: "MANUAL", approvalRequired: true, missingFields: [], errors: [],
      source: { network: "base", asset: { symbol: "USDC", chainId: "8453", id: "base:0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", decimals: 6 }, amount: { kind: "EXACT", value: "50" } },
      destination: { network: "solana", asset: { symbol: "SOL", id: "solana:native" } },
      recipient: { address: SOL, kind: "SELF" }, refundAddress: EVM,
    });
    expect(r.plan?.legs[0]).toMatchObject({ sourceAssetId: "base:0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", destinationAssetId: "solana:native" });
    expect(r.plan?.executable).toBe(true);
  });
  it("Bridge 0.5 ETH from Ethereum to NEAR", async () => {
    const r = await run("Bridge 0.5 ETH from Ethereum to NEAR");
    expect(r).toMatchObject({ intentType: "BRIDGE", status: "VALIDATED", destination: { network: "near", asset: { id: "near:eth.bridge.near" } }, recipient: { address: NEAR } });
  });
  it("Send 100 USDC to this Arbitrum address", async () => {
    const r = await run("Send 100 USDC to this Arbitrum address");
    expect(r.intentType).toBe("PAYMENT");
    expect(r.status).toBe("NEEDS_CLARIFICATION");
    expect(r.missingFields).toEqual(expect.arrayContaining(["recipient", "source.network"]));
  });
  it("Move 25% of my USDC balance to NEAR", async () => {
    const r = await run("Move 25% of my USDC balance to NEAR", { text: "Move 25% of my USDC balance from Base to NEAR" });
    expect(r).toMatchObject({ intentType: "BRIDGE", status: "VALIDATED", source: { amount: { kind: "PERCENT_OF_BALANCE", percent: "25" } } });
    expect(r.plan).toMatchObject({ executable: false, requires: ["BALANCES"] });
    const vague = await run("Move 25% of my USDC balance to NEAR");
    expect(vague.missingFields).toEqual(["source.network"]);
  });
  it("Transfer 50 USDC from Base to Ethereum", async () => {
    const r = await run("Transfer 50 USDC from Base to Ethereum");
    expect(r).toMatchObject({ intentType: "CROSS_CHAIN_TRANSFER", status: "VALIDATED", recipient: { kind: "SELF", address: EVM } });
  });
  it("Show my transaction history", async () => {
    const r = await run("Show my transaction history");
    expect(r).toMatchObject({ intentType: "TRANSACTION_HISTORY", status: "VALIDATED", approvalRequired: false });
  });
  it("Cancel my pending transaction", async () => {
    const txs = [{ id: "spak_sub_9", intentType: "SWAP", state: "AWAITING_DEPOSIT", createdAt: NOW }];
    expect(await run("Cancel my pending transaction", { transactions: txs })).toMatchObject({ intentType: "CANCEL_TRANSACTION", status: "VALIDATED", target: { resolvedId: "spak_sub_9" }, approvalRequired: true });
    const two = [...txs, { id: "spak_sub_8", intentType: "BRIDGE", state: "AWAITING_APPROVAL", createdAt: NOW }];
    const r2 = await run("Cancel my pending transaction", { transactions: two });
    expect(r2.status).toBe("NEEDS_CLARIFICATION");
    expect(r2.clarifications[0].options).toHaveLength(2);
    expect((await run("Cancel my pending transaction")).errors[0].code).toBe("NO_PENDING_TRANSACTION");
  });
  it("Schedule a transfer of 20 USDC every Monday", async () => {
    const r = await run("Schedule a transfer of 20 USDC every Monday");
    expect(r).toMatchObject({ intentType: "SCHEDULED_TRANSACTION", status: "NEEDS_CLARIFICATION", schedule: { frequency: "WEEKLY", daysOfWeek: [1] } });
    expect(r.missingFields).toEqual(expect.arrayContaining(["schedule.time", "schedule.timezone"]));
    const full = await run("Schedule a transfer of 20 USDC from Base to Arbitrum every Monday at 9am", { timezone: "Africa/Lagos" });
    expect(full).toMatchObject({ intentType: "SCHEDULED_TRANSACTION", innerIntentType: "CROSS_CHAIN_TRANSFER", status: "VALIDATED" });
    expect(full.plan?.requires).toContain("SCHEDULER");
  });
});

describe("SPak-in: clarification instead of guessing", () => {
  it("Swap 50 USDC. asks for destination", async () => {
    const r = await run("Swap 50 USDC.");
    expect(r.status).toBe("NEEDS_CLARIFICATION");
    expect(r.missingFields).toEqual(expect.arrayContaining(["destination.asset", "destination.network", "source.network"]));
  });
  it("Send 100 USDC to Base asks for a recipient", async () => {
    const r = await run("Send 100 USDC to Base");
    expect(r.missingFields).toContain("recipient");
    expect(r.recipient).toBeNull();
  });
  it("Move my money asks for asset, amount and destination", async () => {
    const r = await run("Move my money");
    expect(r.missingFields).toEqual(expect.arrayContaining(["source.asset", "source.amount", "destination.network"]));
  });
  it("unsupported network", async () => {
    const r = await run("Swap 50 USDC on an unsupported network");
    expect(r.status).toBe("UNSUPPORTED");
    expect(r.errors[0].code).toBe("UNSUPPORTED_NETWORK");
    expect((await run("Swap 50 USDC on Fantom to SOL")).errors[0].message).toContain("Fantom");
  });
  it("unknown action", async () => {
    const r = await run("hello there");
    expect(r).toMatchObject({ intentType: "UNKNOWN", status: "NEEDS_CLARIFICATION" });
  });
  it("malformed input never reaches planning", async () => {
    const r = await run("   ");
    expect(r).toMatchObject({ status: "INVALID", plan: null, errors: [{ code: "INPUT_EMPTY" }] });
  });
  it("does not resolve names or invent addresses", async () => {
    expect((await run("send 5 usdc on base to vitalik.eth")).errors[0].code).toBe("INVALID_ADDRESS");
    expect((await run("send 5 usdc on base to 0x123")).status).toBe("INVALID");
    const r = await run("Swap 50 USDC on Base to SOL on Solana", { wallets: {} });
    expect(r.missingFields).toEqual(["recipient", "refundAddress"]);
  });
});

describe("SPak-in: validation", () => {
  it("wording variations agree", async () => {
    for (const t of ["swap 50 usdc on base for sol on solana", "convert 50 USDC (Base) -> SOL (Solana)", "exchange 50 usdc on base into sol on solana", "trade 50 usd coin on base to solana sol", "50usdc base to sol solana, swap please"]) {
      const r = await run(t);
      expect(r.intentType, t).toBe("CROSS_CHAIN_SWAP");
      expect(r.source.asset?.symbol, t).toBe("USDC");
      expect(r.destination.network, t).toBe("solana");
    }
  });
  it("aliases", async () => {
    expect((await run("bridge 1 ether from mainnet to arbitrum one")).destination.network).toBe("arbitrum");
    expect((await run("bridge 10 tether from bnb chain to polygon")).source).toMatchObject({ network: "bsc", asset: { symbol: "USDT" } });
    expect((await run("swap 1 matic on polygon to usdc")).source.asset?.symbol).toBe("POL");
  });
  it("same-chain swap from one network mention", async () => {
    const r = await run("swap 1 ETH to USDC on Base");
    expect(r).toMatchObject({ intentType: "SWAP", status: "VALIDATED", source: { network: "base" }, destination: { network: "base" } });
    expect(r.assumptions.join(" ")).toContain("Base");
  });
  it("unsupported asset and asset not on network", async () => {
    expect((await run("swap 50 FOOBAR on base to usdc")).errors[0].code).toBe("UNSUPPORTED_ASSET");
    const r = await run("swap 50 usdc on base to sol on base");
    expect(r.status).toBe("UNSUPPORTED");
    expect(r.errors[0].code).toBe("ASSET_NOT_ON_NETWORK");
  });
  it("address and network compatibility", async () => {
    const r = await run(`send 10 usdc on base to ${SOL}`);
    expect(r.missingFields).toContain("destination.network");
    expect(r.clarifications.find((c) => c.field === "destination.network")?.options).toEqual(["solana"]);
    expect((await run(`send 10 usdc on base to ${SOL} on arbitrum`)).errors[0].code).toBe("ADDRESS_NETWORK_MISMATCH");
    expect((await run(`send 0.01 btc on bitcoin to ${BTC}`, { wallets: { bitcoin: BTC } })).status).toBe("VALIDATED");
  });
  it("amount precision and range", async () => {
    expect((await run("swap 1.1234567 usdc on base to sol on solana")).errors[0].code).toBe("AMOUNT_PRECISION");
    expect((await run("swap 0 usdc on base to sol on solana")).errors[0].code).toBe("INVALID_AMOUNT");
    expect((await run("move 150% of my usdc from base to near")).errors[0].code).toBe("INVALID_PERCENTAGE");
  });
  it("same asset same network", async () => {
    expect((await run("swap 5 usdc on base to usdc on base")).errors[0].code).toBe("SAME_ASSET_SAME_NETWORK");
  });
  it("rebalance allocations must sum to 100", async () => {
    expect((await run("rebalance to 60% ETH and 30% USDC")).errors[0].code).toBe("INVALID_ALLOCATION");
    expect((await run("rebalance to 60% ETH and 40% USDC")).status).toBe("VALIDATED");
  });
  it("portfolio query needs a wallet", async () => {
    expect((await run("what's my USDC balance on base")).status).toBe("VALIDATED");
    expect((await run("show my portfolio", { wallets: {} })).missingFields).toEqual(["wallets"]);
  });
  it("status lookup", async () => {
    const r = await run("what's the status of spak_sub_9", { transactions: [{ id: "spak_sub_9", intentType: "SWAP", state: "PROCESSING", createdAt: NOW }] });
    expect(r).toMatchObject({ intentType: "TRANSACTION_STATUS", target: { resolvedId: "spak_sub_9" } });
  });
  it("conditional with notify only moves no funds", async () => {
    const r = await run("Notify me when a preferred execution route becomes available");
    expect(r).toMatchObject({ intentType: "CONDITIONAL_TRANSACTION", status: "VALIDATED", approvalRequired: false, condition: { kind: "ROUTE_AVAILABLE", onTrigger: "NOTIFY" } });
    const c = await run("Swap 1 ETH on Base to USDC when ETH reaches $4,000");
    expect(c).toMatchObject({ intentType: "CONDITIONAL_TRANSACTION", innerIntentType: "SWAP", status: "VALIDATED" });
  });
});

describe("SPak-in: determinism and performance", () => {
  it("same input, same structured output", async () => {
    const a = await run("Swap 50 USDC on Base to SOL on Solana", { sessionId: "d1" });
    const b = await run("Swap 50 USDC on Base to SOL on Solana", { sessionId: "d1" }, new SpakIn({ ids: sequentialIds(), clock: () => new Date(NOW) }));
    const strip = (r: typeof a) => ({ ...r, meta: { ...r.meta, processingMs: 0 } });
    expect(strip(a)).toEqual(strip(b));
  });
  it("runs locally under 100 ms", async () => {
    const r = await run("Swap 50 USDC on Base to SOL on Solana with max 0.5% slippage");
    expect(r.meta.processingMs).toBeLessThan(100);
  });
});

describe("SPak-in: extensible intents", () => {
  it("registers a new intent without changing the parser", async () => {
    const registry = createDefaultRegistry().register({
      type: "STAKE", category: "TRANSACTION", priority: 50, movesFunds: true, description: "Stake an asset.",
      match: (f) => (f.tokens.some((t) => t.lower === "stake") ? 99 : 0),
    });
    const e = new SpakIn({ registry, ids: sequentialIds() });
    const r = await e.interpret({ text: "stake 10 NEAR", wallets: WALLETS, now: NOW });
    expect(r.intentType).toBe("STAKE");
    expect(r.status).not.toBe("VALIDATED"); // no validator registered for it: never auto-validated
    expect(() => new IntentRegistry().register(registry.get("SWAP")!).register(registry.get("SWAP")!)).toThrow();
  });
});
