import { describe, expect, it } from "vitest";
import { interpret } from "./interpret";

const EVM = "0x1111111111111111111111111111111111111111";
const SOL = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";
const ctx = { addresses: { base: EVM, arb: EVM, eth: EVM, sol: SOL } };

describe("SPak-in", () => {
  it("parses the PRD swap example", () => {
    const r = interpret("Swap 50 USDC on Base to SOL on Solana", ctx);
    expect(r.status).toBe("ready");
    if (r.status !== "ready") return;
    expect(r.intent).toMatchObject({
      action: "swap", amount: "50", sourceToken: "USDC", sourceNetwork: "base",
      destToken: "SOL", destNetwork: "sol", recipient: SOL, refundTo: EVM,
    });
    expect(r.plan.kind).toBe("cross_chain_swap");
  });

  it("infers the destination network for native tokens", () => {
    const r = interpret("swap 50 usdc on base to sol", ctx);
    expect(r.status).toBe("ready");
    if (r.status === "ready") expect(r.intent.destNetwork).toBe("sol");
  });

  it("parses a bridge", () => {
    const r = interpret("bridge 0.1 ETH from Ethereum to Base", ctx);
    expect(r.status).toBe("ready");
    if (r.status === "ready") {
      expect(r.intent).toMatchObject({ sourceToken: "ETH", destToken: "ETH", sourceNetwork: "eth", destNetwork: "base" });
      expect(r.plan.kind).toBe("bridge");
    }
  });

  it("parses a payment with an explicit address", () => {
    const r = interpret(`Send 50 USDC on Base to ${EVM} on Arbitrum`, ctx);
    expect(r.status).toBe("ready");
    if (r.status === "ready") {
      expect(r.intent).toMatchObject({ action: "transfer", destToken: "USDC", destNetwork: "arb", recipient: EVM });
      expect(r.plan.kind).toBe("cross_chain_transfer");
    }
  });

  it("asks for the source network when the payment does not name it", () => {
    const r = interpret(`Send 50 USDC to ${EVM} on Arbitrum`, ctx);
    expect(r.status).toBe("needs_info");
    if (r.status === "needs_info") expect(r.missing).toContain("sourceNetwork");
  });

  it("asks for recipient and refund address without a connected wallet", () => {
    const r = interpret("Swap 50 USDC on Base to SOL on Solana");
    expect(r.status).toBe("needs_info");
    if (r.status === "needs_info") expect(r.missing).toEqual(["recipient", "refundTo"]);
  });

  it("never executes without an action verb", () => {
    const r = interpret("50 USDC on Base to SOL", ctx);
    expect(r.status).toBe("needs_info");
    if (r.status === "needs_info") expect(r.missing).toContain("action");
  });

  it("blocks multiple amounts", () => {
    const r = interpret("swap 50 or 60 usdc on base to sol", ctx);
    expect(r.status).toBe("needs_info");
  });

  it("rejects a recipient on the wrong network", () => {
    const r = interpret(`Send 10 USDC on Base to ${SOL} on Arbitrum`, ctx);
    expect(r.status).toBe("rejected");
  });

  it("rejects a no-op swap", () => {
    expect(interpret("swap 5 usdc on base to usdc on base", ctx).status).toBe("rejected");
  });

  it("rejects zero amounts", () => {
    expect(interpret("swap 0 usdc on base to sol", ctx).status).toBe("rejected");
  });

  it("enforces Guard network allowlists", () => {
    const r = interpret("swap 5 usdc on base to sol", ctx, { maxSlippageBps: 100, allowedNetworks: ["base", "arb"] });
    expect(r.status).toBe("rejected");
  });

  it("handles arrows and thousand separators", () => {
    const r = interpret("swap 1,000 usdc base -> sol", ctx);
    expect(r.status).toBe("ready");
    if (r.status === "ready") expect(r.intent.amount).toBe("1000");
  });

  it("is deterministic", () => {
    const a = interpret("Swap 50 USDC on Base to SOL on Solana", ctx);
    const b = interpret("Swap 50 USDC on Base to SOL on Solana", ctx);
    expect(a).toEqual(b);
  });
});
