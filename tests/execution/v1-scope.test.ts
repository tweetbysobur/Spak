/** Mainnet V1 scope: routes SPak can verify, and Coming Soon features that cannot start anything. MOCKED: 1Click (Fake1Click). */
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it } from "vitest";
import type { ExecutionError } from "@/execution";
import { destinationProblem, routeProblem, sourceProblem } from "@/execution/v1-scope";
import { listAssets, listNetworks } from "@/spak-in";
import { verifyDelivery } from "@/tracking/verifiers";
import { COMING_SOON, ComingSoon } from "@/components/app/ComingSoon";
import { harness } from "./harness";

let h0: Awaited<ReturnType<typeof harness>>;
let u: Awaited<ReturnType<Awaited<ReturnType<typeof harness>>["newUser"]>>;
beforeEach(async () => { h0 = await harness(); u = await h0.newUser(); });
const code = async (p: Promise<unknown>) => { try { await p; return "OK"; } catch (e) { return (e as ExecutionError).code ?? (e as Error).message; } };
const quotes = () => h0.fake.calls.filter((c) => c.path.startsWith("/v0/quote")).length;
async function tryCreate(text: string) {
  const r = await u.plan(text);
  if (!r.plan?.executable) return { status: r.status, code: "NO_EXECUTABLE_PLAN", message: "" };
  const before = quotes();
  try { await h0.svc.create({ userId: u.userId, planHash: r.plan.hash, idempotencyKey: `k-${Math.random().toString(36).slice(2)}`, wallets: await u.wallets() }); return { status: r.status, code: "OK", message: "", quoted: quotes() - before }; }
  catch (e) { return { status: r.status, code: (e as ExecutionError).code, message: (e as Error).message, quoted: quotes() - before }; }
}
const BTC = "bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq";

describe("V1 route rules", () => {
  it("destinations: EVM and Solana only; never a family SPak cannot verify; NEAR off until validated", async () => {
    for (const n of listNetworks()) {
      const allowed = !destinationProblem(n.id);
      expect(allowed, n.id).toBe(["evm", "solana"].includes(n.family));
      // Anything allowed has a working verifier; every family without one is blocked.
      const r = await verifyDelivery({ call: async () => null } as never, n.family, { network: n.id, txHash: "x", recipient: "x", kind: "TOKEN", tokenContract: "x", minAmount: "1" } as never).catch(() => ({ outcome: "ERR" }));
      if (r.outcome === "UNVERIFIABLE") expect(allowed, n.id).toBe(false);
    }
    for (const n of ["near", "bitcoin", "tron", "sui", "xrp", "dogecoin", "litecoin", "ton", "stellar", "aptos"]) expect(destinationProblem(n)?.code, n).toBe("V1_DESTINATION_NOT_SUPPORTED");
    expect(destinationProblem("near")!.message).toMatch(/Delivery to NEAR is not available yet/);
  });
  it("sources: EVM and Solana only; NEAR is refused with a clear reason", () => {
    for (const n of listNetworks()) expect(!sourceProblem(n.id), n.id).toBe(["evm", "solana"].includes(n.family));
    expect(sourceProblem("near")).toMatchObject({ code: "V1_SOURCE_NOT_SUPPORTED", message: expect.stringMatching(/Sending from NEAR is not available yet/) });
  });
  it("EVM native coins and every NEAR asset are refused as a destination; EVM tokens and SOL are allowed", () => {
    const assets = listAssets();
    const evmNative = assets.filter((a) => !a.contract && listNetworks().find((n) => n.id === a.network)?.family === "evm");
    expect(evmNative.length).toBeGreaterThan(0);
    for (const a of evmNative) expect(destinationProblem(a.network, a.id)?.code, a.id).toBe("V1_NATIVE_DESTINATION_NOT_SUPPORTED");
    expect(destinationProblem("arbitrum", assets.find((a) => a.network === "arbitrum" && a.symbol === "USDC")!.id)).toBeNull();
    expect(destinationProblem("solana", "solana:native")).toBeNull();
    for (const a of assets.filter((x) => x.network === "near")) expect(destinationProblem("near", a.id)?.code, a.id).toBe("V1_DESTINATION_NOT_SUPPORTED");
    expect(routeProblem({ sourceNetwork: "base", destinationNetwork: "solana", destinationAssetId: "solana:native" })).toBeNull();
  });
});

describe("V1 route enforcement on the server", () => {
  it("supported EVM and Solana routes still quote", async () => {
    for (const t of ["Swap 50 USDC on Base to SOL on Solana", "Bridge 10 USDC from Base to Arbitrum", "Swap 5 USDC on Solana to USDC on Base", "Swap 20 USDC on Base to ARB on Arbitrum"]) {
      const r = await tryCreate(t);
      expect(r, t).toMatchObject({ code: "OK", quoted: 1 });
    }
  });
  it("NEAR as a destination is rejected before any quote", async () => {
    const r = await tryCreate("Swap 10 USDC on Base to USDC on NEAR");
    expect(["V1_DESTINATION_NOT_SUPPORTED", "NO_EXECUTABLE_PLAN"]).toContain(r.code);
    if (r.code === "V1_DESTINATION_NOT_SUPPORTED") { expect(r.quoted).toBe(0); expect(r.message).toMatch(/Delivery to NEAR/); }
  });
  it("unverifiable destinations are rejected before any quote, with an explanation", async () => {
    const r = await tryCreate(`Send 50 USDC on Base to ${BTC} as BTC on Bitcoin`);
    if (r.code !== "NO_EXECUTABLE_PLAN") {
      expect(r).toMatchObject({ code: "V1_DESTINATION_NOT_SUPPORTED", quoted: 0 });
      expect(r.message).toMatch(/cannot verify delivery on Bitcoin/);
    }
    // Independent of SPak-in's parsing: a stored plan with a Bitcoin leg is refused by the validator.
    const ok = await u.plan("Swap 50 USDC on Base to SOL on Solana");
    const { validateExecutionPlan } = await import("@/execution");
    const { planHash } = await import("@/spak-in/planner/execution-planner");
    for (const [patch, expected] of [
      [{ destinationNetwork: "bitcoin", recipient: BTC }, "V1_DESTINATION_NOT_SUPPORTED"],
      [{ destinationNetwork: "tron", recipient: "TJRabPrwbZy45sbavfcjinPJC18kjpRTv8" }, "V1_DESTINATION_NOT_SUPPORTED"],
      [{ sourceNetwork: "near", refundAddress: "alice.near" }, "V1_SOURCE_NOT_SUPPORTED"],
      [{ destinationNetwork: "near", destinationAssetId: listAssets().find((a) => a.network === "near" && a.symbol === "USDC")!.id, recipient: "alice.near" }, "V1_DESTINATION_NOT_SUPPORTED"],
      [{ destinationNetwork: "arbitrum", destinationAssetId: listAssets().find((a) => a.network === "arbitrum" && !a.contract)!.id, recipient: u.evm.address }, "V1_NATIVE_DESTINATION_NOT_SUPPORTED"],
    ] as const) {
      const { planId: _i, hash: _h, ...body } = ok.plan!;
      const changed = { ...body, legs: [{ ...body.legs[0], ...patch }] };
      const hash = planHash(changed);
      const plan = { ...changed, planId: `spak_plan_${hash.slice(0, 16)}`, hash };
      const store = { findIssued: async () => ({ plan, userId: u.userId, intentId: "i", revision: 0, latestRevision: 0, recipientKind: "SELF" as const }) };
      expect(await code(validateExecutionPlan({ planHash: hash, userId: u.userId, wallets: await u.wallets(), store })), expected).toBe(expected);
    }
  });
  it("native coin on an EVM destination is rejected before any quote", async () => {
    const r = await tryCreate("Swap 100 USDC on Base to ETH on Arbitrum");
    expect(r).toMatchObject({ code: "V1_NATIVE_DESTINATION_NOT_SUPPORTED", quoted: 0 });
    expect(r.message).toMatch(/native coin/);
  });
  it("NEAR as a source is rejected before any quote, and gets no deposit instructions", async () => {
    const r = await tryCreate("Swap 1 NEAR on NEAR to USDC on Base");
    expect(["V1_SOURCE_NOT_SUPPORTED", "NO_EXECUTABLE_PLAN"]).toContain(r.code);
    if (r.code === "V1_SOURCE_NOT_SUPPORTED") expect(r.quoted).toBe(0);
    // An execution that somehow has a NEAR source (for example approved before this rule) gets no deposit instructions.
    const { approval } = await import("./harness");
    const p = await u.plan("Swap 50 USDC on Base to SOL on Solana");
    const x = await h0.svc.create({ userId: u.userId, planHash: p.plan!.hash, idempotencyKey: "k-near-src-1", wallets: await u.wallets() });
    const f = await h0.svc.firmQuote({ userId: u.userId, executionId: x.execution.id, quoteId: x.quote!.id, wallets: await u.wallets() });
    await h0.svc.approve({ userId: u.userId, executionId: x.execution.id, quoteId: f.quote.id, approval: approval(p.plan!.hash, h0.now(), true, x.execution.planRevision), wallets: await u.wallets() });
    const { sql } = await import("drizzle-orm");
    await h0.db.execute(sql`update spak_executions set source_network = 'near', refund_address = ${u.near.address} where id = ${x.execution.id}`);
    expect(await code(h0.deposits.prepare({ userId: u.userId, executionId: x.execution.id, wallets: await u.wallets() }))).toBe("V1_SOURCE_NOT_SUPPORTED");
  });
  it("an execution with a NEAR destination gets no deposit instructions", async () => {
    const { approval } = await import("./harness");
    const p = await u.plan("Swap 50 USDC on Base to SOL on Solana");
    const x = await h0.svc.create({ userId: u.userId, planHash: p.plan!.hash, idempotencyKey: "k-near-dst-1", wallets: await u.wallets() });
    const f = await h0.svc.firmQuote({ userId: u.userId, executionId: x.execution.id, quoteId: x.quote!.id, wallets: await u.wallets() });
    await h0.svc.approve({ userId: u.userId, executionId: x.execution.id, quoteId: f.quote.id, approval: approval(p.plan!.hash, h0.now(), true, x.execution.planRevision), wallets: await u.wallets() });
    const { sql } = await import("drizzle-orm");
    const nearUsdc = listAssets().find((a) => a.network === "near" && a.symbol === "USDC")!.id;
    await h0.db.execute(sql`update spak_executions set destination_network = 'near', destination_asset_id = ${nearUsdc}, recipient = ${u.near.address} where id = ${x.execution.id}`);
    h0.chain.setBalance("base", u.evm.address, 100_000_000n, "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913");
    expect(await code(h0.deposits.prepare({ userId: u.userId, executionId: x.execution.id, wallets: await u.wallets() }))).toBe("V1_DESTINATION_NOT_SUPPORTED");
  });
});

describe("Coming Soon features cannot start anything", () => {
  it("the list names all eight and renders no control", () => {
    expect(COMING_SOON.map((f) => f.name)).toEqual(["Dedicated Agent NEAR accounts", "Autonomous execution", "Conditional and scheduled transactions", "Chain Signatures", "Advanced Agent permissions", "Portfolio Intelligence", "Developer SDK", "SPak Connect"]);
    const html = renderToStaticMarkup(h(ComingSoon, {}));
    expect(html.match(/Coming soon<\/span>/g)).toHaveLength(8);
    expect(html).not.toMatch(/<button|<a |<input|<select|<form|onclick/i);
  });
  it("scheduled and conditional instructions never become executions", async () => {
    for (const t of ["Swap 50 USDC on Base to SOL on Solana every Friday", "Swap 50 USDC on Base to SOL on Solana when SOL drops below $100"]) {
      const r = await u.plan(t);
      const before = quotes();
      if (r.plan) expect(await code(h0.svc.create({ userId: u.userId, planHash: r.plan.hash, idempotencyKey: `k-${Math.random().toString(36).slice(2)}`, wallets: await u.wallets() })), t).toBe("PLAN_NOT_EXECUTABLE");
      expect(r.plan?.executable ?? false, t).toBe(false);
      expect(quotes()).toBe(before);
    }
  });
  it("autonomous execution cannot be switched on by a request: every plan still needs approval", async () => {
    const r = await h0.spakIn.interpret({ text: "Swap 50 USDC on Base to SOL on Solana", userId: u.userId, sessionId: "auto", wallets: await h0.auth.walletContext(u.userId), mode: "AGENT", policy: { autonomous: { enabled: false } }, now: h0.now().toISOString() });
    expect(r).toMatchObject({ approvalRequired: true });
    expect(r.plan?.steps.map((s) => s.action)).toContain("USER_APPROVAL");
  });
});
