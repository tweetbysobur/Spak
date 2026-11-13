import { describe, expect, it } from "vitest";
import { EVM2, run } from "./helpers";

const USDC_BASE = "base:0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
const prices = { pricesUsd: { [USDC_BASE]: "0.9996" } };

describe("policy engine (SPak Guard)", () => {
  it("per-transaction limit", async () => {
    const r = await run("Swap 500 USDC on Base to SOL on Solana", { policy: { maxTransactionUsd: "100" }, runtime: prices });
    expect(r.status).toBe("POLICY_REJECTED");
    expect(r.policy?.violations[0].code).toBe("POLICY_TX_LIMIT_EXCEEDED");
    expect(r.plan).toBeNull();
  });
  it("daily limit uses exact decimal math", async () => {
    const r = await run("Swap 50 USDC on Base to SOL on Solana", { policy: { dailyLimitUsd: "1000" }, runtime: { ...prices, spentTodayUsd: "960.03" } });
    expect(r.policy?.violations[0].code).toBe("POLICY_DAILY_LIMIT_EXCEEDED");
    const ok = await run("Swap 39.9 USDC on Base to SOL on Solana", { policy: { dailyLimitUsd: "1000" }, runtime: { ...prices, spentTodayUsd: "960.03" } });
    expect(ok.status).toBe("VALIDATED");
  });
  it("unknown value never passes silently", async () => {
    const r = await run("Swap 50 USDC on Base to SOL on Solana", { policy: { maxTransactionUsd: "100" } });
    expect(r).toMatchObject({ status: "VALIDATED", approvalRequired: true, policy: { outcome: "REQUIRE_APPROVAL" } });
  });
  it("allowed networks, assets, slippage, recipients", async () => {
    expect((await run("Swap 50 USDC on Base to SOL on Solana", { policy: { allowedNetworks: ["base", "arbitrum"] } })).policy?.violations[0].code).toBe("POLICY_NETWORK_NOT_ALLOWED");
    // Canonical ids only: a symbol in the list matches nothing, so USDC on Base is still not allowed.
    expect((await run("Swap 50 USDC on Base to SOL on Solana", { policy: { allowedAssets: ["USDC", "SOL"] } })).policy?.violations[0].code).toBe("POLICY_ASSET_NOT_ALLOWED");
    expect((await run("Swap 50 USDC on Base to SOL on Solana", { policy: { allowedAssets: [USDC_BASE] } })).policy?.violations[0].code).toBe("POLICY_ASSET_NOT_ALLOWED");
    expect((await run("Swap 50 USDC on Base to SOL on Solana with 3% slippage")).policy?.violations[0].code).toBe("POLICY_SLIPPAGE_EXCEEDED");
    expect((await run(`Send 5 USDC on Base to ${EVM2}`, { policy: { recipientMode: "APPROVED_ONLY" } })).status).toBe("POLICY_REJECTED");
    expect((await run(`Send 5 USDC on Base to ${EVM2}`, { policy: { recipientMode: "APPROVED_ONLY", approvedRecipients: [EVM2] } })).status).toBe("VALIDATED");
  });
  it("autonomous execution needs agent mode, opt-in, type, limit and known value", async () => {
    const policy = { autonomous: { enabled: true, maxTransactionUsd: "100", allowedIntentTypes: ["CROSS_CHAIN_SWAP"] } };
    const auto = await run("Swap 50 USDC on Base to SOL on Solana", { mode: "AGENT", policy, runtime: prices });
    expect(auto).toMatchObject({ executionMode: "AUTONOMOUS", approvalRequired: false, policy: { outcome: "ALLOW_AUTONOMOUS" } });
    expect(auto.plan?.steps.map((s) => s.action)).not.toContain("USER_APPROVAL");
    const off = { autonomous: { ...policy.autonomous, enabled: false } };
    const cases: [string, Parameters<typeof run>[1]][] = [
      ["Swap 50 USDC on Base to SOL on Solana", { mode: "MANUAL", policy, runtime: prices }],
      ["Swap 50 USDC on Base to SOL on Solana", { mode: "AGENT", policy: off, runtime: prices }],
      ["Swap 150 USDC on Base to SOL on Solana", { mode: "AGENT", policy, runtime: prices }],
      ["Swap 50 USDC on Base to SOL on Solana", { mode: "AGENT", policy, runtime: {} }],
      ["Bridge 50 USDC from Base to Arbitrum", { mode: "AGENT", policy, runtime: prices }],
    ];
    for (const [text, extra] of cases) {
      const r = await run(text, extra);
      expect(r.approvalRequired, text).toBe(true);
      expect(r.executionMode).toBe("MANUAL");
    }
  });
});
