import { describe, expect, it } from "vitest";
import { SpakIn, sequentialIds } from "@/spak-in";
import { EVM2, NOW, WALLETS } from "./helpers";

const make = () => {
  let t = Date.parse(NOW);
  const e = new SpakIn({ ids: sequentialIds(), validateOutput: true, clock: () => new Date(t) });
  const say = (text: string, extra = {}) => e.interpret({ text, sessionId: "s1", wallets: WALLETS, ...extra });
  return { e, say, advance: (ms: number) => { t += ms; } };
};

describe("context resolver", () => {
  it("Make it 100 instead keeps every other parameter", async () => {
    const { say } = make();
    const a = await say("Swap 50 USDC on Base to SOL on Solana");
    const b = await say("Make it 100 instead.");
    expect(b).toMatchObject({ intentId: a.intentId, revision: 1, status: "VALIDATED", meta: { contextApplied: "AMENDMENT" }, source: { amount: { value: "100" }, network: "base" }, destination: { network: "solana" } });
    expect(b.plan?.hash).not.toBe(a.plan?.hash); // the old approval no longer matches
  });
  it("answers a clarification", async () => {
    const { say } = make();
    const a = await say("Swap 50 USDC on Base");
    expect(a.missingFields).toEqual(expect.arrayContaining(["destination.asset"]));
    const b = await say("to SOL on Solana");
    expect(b).toMatchObject({ status: "VALIDATED", intentType: "CROSS_CHAIN_SWAP", meta: { contextApplied: "CLARIFICATION_ANSWER" } });
  });
  it("fills the one missing network from a bare name", async () => {
    const { say } = make();
    await say("Send 100 USDC to this Arbitrum address");
    const b = await say("on base");
    expect(b.source.network).toBe("base");
    const c = await say(EVM2);
    expect(c).toMatchObject({ status: "VALIDATED", intentType: "PAYMENT", recipient: { address: EVM2, network: "arbitrum" } });
  });
  it("asks when a bare network could be either side", async () => {
    const { say } = make();
    await say("Swap 50 USDC on Base to SOL on Solana");
    const r = await say("use arbitrum instead");
    expect(r.status).toBe("NEEDS_CLARIFICATION");
    expect(r.errors[0].code).toBe("AMBIGUOUS_NETWORK_ROLE");
    const r2 = await say("change the destination to arbitrum");
    expect(r2.errors.map((e) => e.code)).toContain("ASSET_NOT_ON_NETWORK"); // SOL is not on Arbitrum: told, not guessed
  });
  it("adds a schedule to a pending transfer", async () => {
    const { say } = make();
    await say("Transfer 20 USDC from Base to Arbitrum");
    const r = await say("every monday at 9am", { timezone: "Africa/Lagos" });
    expect(r).toMatchObject({ intentType: "SCHEDULED_TRANSACTION", innerIntentType: "CROSS_CHAIN_TRANSFER", status: "VALIDATED" });
  });
  it("does not apply stale or submitted context", async () => {
    const { e, say, advance } = make();
    const a = await say("Swap 50 USDC on Base to SOL on Solana");
    advance(16 * 60_000);
    expect((await say("make it 100")).errors[0].code).toBe("CONTEXT_EXPIRED");
    await say("Swap 50 USDC on Base to SOL on Solana");
    const s = await e.sessions.get("s1");
    await e.sessions.markSubmitted("s1", s!.intentId);
    expect((await say("make it 100")).errors[0].code).toBe("NOTHING_TO_AMEND");
    void a;
  });
  it("a new full instruction replaces the context", async () => {
    const { say } = make();
    const a = await say("Swap 50 USDC on Base to SOL on Solana");
    const b = await say("Bridge 1 ETH from Ethereum to Base");
    expect(b.intentId).not.toBe(a.intentId);
    expect(b.meta.contextApplied).toBe("NONE");
  });
  it("unknown input keeps the pending draft", async () => {
    const { say } = make();
    await say("Swap 50 USDC on Base");
    await say("hmm");
    expect((await say("to SOL on Solana")).status).toBe("VALIDATED");
  });
});
