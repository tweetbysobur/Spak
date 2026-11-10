/** SPak Execution against a MOCKED 1Click provider (deterministic). Real users, real SPak-in plans, real SQL. */
import { beforeEach, describe, expect, it } from "vitest";
import { ExecutionError, INDICATIVE_TTL_MS } from "@/execution";
import { approval, harness } from "./harness";
import { statusPayload } from "./fake-1click";

let h: Awaited<ReturnType<typeof harness>>;
let u: Awaited<ReturnType<Awaited<ReturnType<typeof harness>>["newUser"]>>;
const SWAP = "Swap 50 USDC on Base to SOL on Solana";
beforeEach(async () => { h = await harness(); u = await h.newUser(); });

const create = async (text = SWAP, key = `k-${Math.random().toString(36).slice(2)}`) => {
  const r = await u.plan(text);
  expect(r.status, JSON.stringify(r.errors)).toBe("VALIDATED");
  return { intent: r, ...(await h.svc.create({ userId: u.userId, planHash: r.plan!.hash, idempotencyKey: key, wallets: await u.wallets() })) };
};
/** Phase 3 flow: indicative quote → firm quote (reviewed) → approve that firm quote. */
const firm = async (x: Awaited<ReturnType<typeof create>>) => (await h.svc.firmQuote({ userId: u.userId, executionId: x.execution.id, quoteId: x.quote!.id, wallets: await u.wallets() })).quote;
const approve = async (x: Awaited<ReturnType<typeof create>>, extra: { quoteId?: string; allowDuplicate?: boolean } = {}) => {
  const quoteId = extra.quoteId ?? (await firm(x)).id;
  return h.svc.approve({ userId: u.userId, executionId: x.execution.id, quoteId, approval: approval(x.execution.planHash, h.now(), extra.allowDuplicate, x.execution.planRevision), wallets: await u.wallets() });
};
const code = async (p: Promise<unknown>) => { try { await p; return "OK"; } catch (e) { return (e as ExecutionError).code ?? (e as Error).message; } };

describe("valid execution plans", () => {
  it("creates an execution with an indicative quote that matches the plan, using provider asset ids, never symbols", async () => {
    const x = await create();
    expect(x.created).toBe(true);
    expect(x.execution).toMatchObject({ state: "AWAITING_APPROVAL", sourceNetwork: "base", destinationNetwork: "solana", amountIn: "50000000", recipient: u.sol.address, recipientKind: "SELF" });
    expect(x.quote).toMatchObject({ kind: "INDICATIVE", status: "VALID", providerOriginAsset: "nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near", providerDestinationAsset: "nep141:sol.omft.near", amountIn: "50000000", slippageBps: 100 });
    expect(x.quote!.providerSignature).toBeTruthy();
    expect(x.quote!.expiresAt.getTime()).toBe(h.clock.now + INDICATIVE_TTL_MS);
    const req = h.fake.calls.find((c) => c.path === "/v0/quote")!.body as Record<string, unknown>;
    expect(req).toMatchObject({ dry: true, swapType: "EXACT_INPUT", recipient: u.sol.address, refundTo: u.evm.address.toLowerCase(), amount: "50000000", recipientType: "DESTINATION_CHAIN", refundType: "ORIGIN_CHAIN" });
  });
  it("approval gets a firm quote with deposit instructions and is recorded in the state history", async () => {
    const x = await create();
    const a = await approve(x);
    expect(a.execution.state).toBe("AWAITING_DEPOSIT");
    expect(a.execution.depositAddress).toMatch(/^0x[0-9a-f]{40}$/);
    expect(a.quote).toMatchObject({ kind: "FIRM", status: "VALID" });
    const d = await h.svc.details(x.execution.id, u.userId);
    expect(d.events.map((e) => e.to)).toEqual(["DRAFT", "AWAITING_APPROVAL", "AWAITING_APPROVAL", "AWAITING_DEPOSIT"]);
    expect(d.deposit).toMatchObject({ network: "base", amount: "50000000", address: a.execution.depositAddress });
    expect(d.quotes.map((q) => `${q.kind}:${q.status}`)).toEqual(["INDICATIVE:SUPERSEDED", "FIRM:VALID"]);
  });
  it("payments to an external address are allowed but refunds must go to a verified wallet", async () => {
    const x = await create("Send 10 USDC on Base to 0x2222222222222222222222222222222222222222 on Arbitrum");
    expect(x.execution).toMatchObject({ recipientKind: "EXTERNAL", recipient: "0x2222222222222222222222222222222222222222", refundAddress: u.evm.address.toLowerCase() });
  });
});

describe("invalid plans and unsupported routes", () => {
  it("rejects plans SPak-in never issued, another user's plan, and superseded revisions", async () => {
    const wallets = await u.wallets();
    expect(await code(h.svc.create({ userId: u.userId, planHash: "a".repeat(64), idempotencyKey: "key-00001", wallets }))).toBe("PLAN_NOT_FOUND");
    const other = await h.newUser();
    const theirs = await other.plan(SWAP);
    expect(await code(h.svc.create({ userId: u.userId, planHash: theirs.plan!.hash, idempotencyKey: "key-00002", wallets }))).toBe("PLAN_NOT_OWNED");
    const r1 = await u.plan(SWAP, "conv-1");
    await u.plan("make it 100 instead", "conv-1");
    expect(await code(h.svc.create({ userId: u.userId, planHash: r1.plan!.hash, idempotencyKey: "key-00003", wallets }))).toBe("PLAN_SUPERSEDED");
  });
  it("rejects plans that are not executable yet (percent of balance)", async () => {
    const r = await u.plan("Move 25% of my USDC from Base to Arbitrum");
    expect(await code(h.svc.create({ userId: u.userId, planHash: r.plan!.hash, idempotencyKey: "key-00004", wallets: await u.wallets() }))).toBe("PLAN_NOT_EXECUTABLE");
  });
  it("refuses when the refund or receiving wallet is no longer verified", async () => {
    const r = await u.plan(SWAP);
    const noSol = (await u.wallets()).filter((w) => w.family !== "solana");
    expect(await code(h.svc.create({ userId: u.userId, planHash: r.plan!.hash, idempotencyKey: "key-00005", wallets: noSol }))).toBe("WALLET_NOT_VERIFIED");
    const baseOff = (await u.wallets()).map((w) => ({ ...w, networks: w.networks.map((n) => ({ ...n, enabled: n.id !== "base" })) }));
    expect(await code(h.svc.create({ userId: u.userId, planHash: r.plan!.hash, idempotencyKey: "key-00006", wallets: baseOff }))).toBe("WALLET_NOT_VERIFIED");
  });
  it("refuses assets the provider no longer lists or lists differently (no silent substitution)", async () => {
    h.fake.delistedAssets.add("nep141:sol.omft.near");
    expect(await code(create())).toBe("UNSUPPORTED_ASSET");
    h.fake.delistedAssets.clear();
    h.fake.tokenOverrides["nep141:sol.omft.near"] = { blockchain: "near" };
    expect(await code(create())).toBe("ASSET_MISMATCH");
  });
  it("refuses a token whose decimals changed at the provider", async () => {
    h.fake.tokenOverrides["nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near"] = { decimals: 18 };
    expect(await code(create())).toBe("ASSET_MISMATCH");
  });
});

describe("quote validation", () => {
  it.each([
    ["echo-wrong-recipient", "QUOTE_MISMATCH"],
    ["echo-wrong-asset", "QUOTE_MISMATCH"],
    ["amount-in-differs", "QUOTE_MISMATCH"],
    ["excess-slippage", "QUOTE_MISMATCH"],
    ["invalid-json-shape", "PROVIDER_ERROR"],
    ["http400", "QUOTE_REJECTED"],
  ] as const)("provider %s -> %s, and the rejected quote is stored", async (mode, expected) => {
    h.fake.mode = mode;
    expect(await code(create())).toBe(expected);
  });
  it("mismatched quotes are persisted as REJECTED with the reason", async () => {
    h.fake.mode = "echo-wrong-recipient";
    const r = await u.plan(SWAP);
    const e = await h.svc.create({ userId: u.userId, planHash: r.plan!.hash, idempotencyKey: "key-mm-1", wallets: await u.wallets() }).catch((x) => x as ExecutionError);
    const q = await h.records.getQuote((e as ExecutionError).details!.quoteId as string);
    expect(q).toMatchObject({ status: "REJECTED" });
    expect(q!.rejectionReason).toMatch(/recipient/);
  });
  it("firm quotes without a valid deposit address are rejected and the firm quote can be retried", async () => {
    const x = await create();
    h.fake.mode = "no-deposit-address";
    expect(await code(firm(x))).toBe("QUOTE_MISMATCH");
    h.fake.mode = "bad-deposit-address";
    expect(await code(firm(x))).toBe("QUOTE_MISMATCH");
    h.fake.mode = "ok";
    expect((await approve(x)).execution.state).toBe("AWAITING_DEPOSIT");
  });
  it("an indicative quote cannot be approved: the firm quote must be reviewed first", async () => {
    const x = await create();
    expect(await code(approve(x, { quoteId: x.quote!.id }))).toBe("FIRM_QUOTE_REQUIRED");
  });
  it("respects the plan's minimum output constraint", async () => {
    h.fake.rate = { num: 1n, den: 1n }; // 50 USDC (6dp) -> 50000000 lamports = 0.05 SOL
    expect(await code(create("Swap 50 USDC on Base to SOL on Solana and receive at least 1 SOL"))).toBe("QUOTE_REJECTED");
  });
});

describe("expiry", () => {
  it("expired indicative quotes cannot be turned into firm quotes; a re-quote can", async () => {
    const x = await create();
    h.clock.now += INDICATIVE_TTL_MS + 1;
    expect(await code(approve(x))).toBe("QUOTE_EXPIRED");
    const rq = await h.svc.requote({ userId: u.userId, executionId: x.execution.id, wallets: await u.wallets() });
    expect(await code(approve({ ...x, quote: rq.quote }))).toBe("OK");
  });
  it("superseded quotes cannot be approved", async () => {
    const x = await create();
    await h.svc.requote({ userId: u.userId, executionId: x.execution.id, wallets: await u.wallets() });
    expect(await code(approve(x))).toBe("QUOTE_NOT_CURRENT");
  });
  it("stale approvals and approvals for another plan are refused", async () => {
    const x = await create();
    const wallets = await u.wallets();
    const f = await firm(x);
    expect(await code(h.svc.approve({ userId: u.userId, executionId: x.execution.id, quoteId: f.id, approval: approval("b".repeat(64), h.now()), wallets }))).toBe("APPROVAL_MISMATCH");
    expect(await code(h.svc.approve({ userId: u.userId, executionId: x.execution.id, quoteId: f.id, approval: approval(x.execution.planHash, h.now(), false, 7), wallets }))).toBe("APPROVAL_MISMATCH");
    expect(await code(h.svc.approve({ userId: u.userId, executionId: x.execution.id, quoteId: f.id, approval: approval(x.execution.planHash, new Date(h.clock.now - 11 * 60_000)), wallets }))).toBe("APPROVAL_EXPIRED");
  });
  it("no deposit before the deadline -> EXPIRED", async () => {
    const x = await create();
    const a = await approve(x);
    h.clock.now = a.execution.depositDeadline!.getTime() + 1000;
    expect((await h.svc.refresh({ userId: u.userId, executionId: x.execution.id })).state).toBe("EXPIRED");
  });
});

describe("idempotency and duplicates", () => {
  it("same idempotency key or same plan returns the same execution without a new quote", async () => {
    const x = await create(SWAP, "same-key-1");
    const quotesBefore = h.fake.calls.filter((c) => c.path === "/v0/quote").length;
    const again = await h.svc.create({ userId: u.userId, planHash: x.execution.planHash, idempotencyKey: "same-key-1", wallets: await u.wallets() });
    const otherKey = await h.svc.create({ userId: u.userId, planHash: x.execution.planHash, idempotencyKey: "other-key-1", wallets: await u.wallets() });
    expect([again.created, otherKey.created]).toEqual([false, false]);
    expect(again.execution.id).toBe(x.execution.id);
    expect(otherKey.execution.id).toBe(x.execution.id);
    expect(h.fake.calls.filter((c) => c.path === "/v0/quote").length).toBe(quotesBefore);
  });
  it("concurrent approvals of one firm quote produce exactly one approval", async () => {
    const x = await create();
    const f = await firm(x);
    const rs = await Promise.allSettled([1, 2, 3].map(() => approve(x, { quoteId: f.id })));
    const firmCalls = h.fake.calls.filter((c) => c.path === "/v0/quote" && (c.body as { dry: boolean }).dry === false);
    expect(firmCalls).toHaveLength(1);
    expect(rs.filter((r) => r.status === "fulfilled").length).toBeGreaterThanOrEqual(1);
    const rows = await h.db.execute(`select count(*)::int as n from spak_approvals where execution_id = '${x.execution.id}' and invalidated_at is null`) as unknown as { rows: { n: number }[] };
    expect(rows.rows[0].n).toBe(1);
    const repeat = await approve(x, { quoteId: f.id });
    expect(repeat.duplicate).toBe(true);
  });
  it("the same transfer twice within 2 minutes needs explicit confirmation", async () => {
    const a = await create(SWAP);
    await approve(a);
    const b = await create(SWAP);
    const fb = await firm(b);
    expect(await code(approve(b, { quoteId: fb.id }))).toBe("DUPLICATE_SUSPECTED");
    expect(await code(approve(b, { quoteId: fb.id, allowDuplicate: true }))).toBe("OK");
  });
});

describe("provider failures", () => {
  it.each([["network", "PROVIDER_UNAVAILABLE"], ["timeout", "PROVIDER_UNAVAILABLE"], ["http500", "PROVIDER_UNAVAILABLE"], ["http429", "PROVIDER_UNAVAILABLE"], ["http401", "PROVIDER_ERROR"]] as const)("%s -> %s", async (mode, expected) => {
    h.fake.mode = mode;
    expect(await code(create())).toBe(expected);
  });
  it("a failed first quote leaves a DRAFT that the next request retries", async () => {
    const r = await u.plan(SWAP);
    h.fake.mode = "http500";
    await h.svc.create({ userId: u.userId, planHash: r.plan!.hash, idempotencyKey: "retry-key-1", wallets: await u.wallets() }).catch(() => {});
    h.fake.mode = "ok";
    const again = await h.svc.create({ userId: u.userId, planHash: r.plan!.hash, idempotencyKey: "retry-key-1", wallets: await u.wallets() });
    expect(again.execution.state).toBe("AWAITING_APPROVAL");
  });
});

describe("status tracking", () => {
  const setup = async () => { const x = await create(); const a = await approve(x); return { id: x.execution.id, dep: a.execution.depositAddress!, sig: a.quote!.providerSignature! }; };
  const step = async (id: string) => { h.clock.now += 5_000; return h.svc.refresh({ userId: u.userId, executionId: id }); };

  it("404 before deposit keeps waiting; deposit seen -> PROCESSING; SUCCESS with destination tx -> VERIFYING_DESTINATION (never COMPLETED from the provider)", async () => {
    const { id, dep, sig } = await setup();
    expect((await step(id)).state).toBe("AWAITING_DEPOSIT");
    h.fake.statuses.set(dep, statusPayload("KNOWN_DEPOSIT_TX", {}, sig));
    expect((await step(id)).state).toBe("PROCESSING");
    h.fake.statuses.set(dep, statusPayload("SUCCESS", { amountOut: "600000000", destinationChainTxHashes: [{ hash: "5xSol", explorerUrl: "x" }] }, sig));
    const done = await step(id);
    expect(done).toMatchObject({ state: "VERIFYING_DESTINATION", amountOutSettled: "600000000", amountOutVerified: null, destinationTxHashes: ["5xSol"] });
  });
  it("accepts the live PENDING_DEPOSIT shape (200 with null fields, captured 2026-11-10)", async () => {
    const { id, dep, sig } = await setup();
    h.fake.statuses.set(dep, { status: "PENDING_DEPOSIT", updatedAt: "2026-11-10T16:33:44.780Z", correlationId: "c", quoteResponse: { signature: sig },
      swapDetails: { depositedAmount: null, depositedAmountUsd: null, depositedAmountFormatted: null, intentHashes: [], nearTxHashes: [], amountIn: null, amountInFormatted: null, amountInUsd: null, amountOut: null, amountOutFormatted: null, amountOutUsd: null, slippage: null, refundedAmount: "0", refundedAmountFormatted: "0", refundedAmountUsd: "0", refundReason: null, refundFee: "2400", withdrawFee: "122164", originChainTxHashes: [], destinationChainTxHashes: [] } });
    const r = await step(id);
    expect(r).toMatchObject({ state: "AWAITING_DEPOSIT", providerStatus: "PENDING_DEPOSIT", lastStatusError: null });
  });
  it("SUCCESS without a destination transaction is NOT completed", async () => {
    const { id, dep, sig } = await setup();
    h.fake.statuses.set(dep, statusPayload("SUCCESS", { amountOut: "1" }, sig));
    expect((await step(id)).state).toBe("PROCESSING");
  });
  it("a provider refund is not taken on its word: REFUNDED status moves to REFUNDING until verified on chain", async () => {
    const a = await setup();
    h.fake.statuses.set(a.dep, statusPayload("REFUNDED", { refundedAmount: "50000000", refundReason: "PARTIAL_DEPOSIT" }, a.sig));
    expect((await step(a.id))).toMatchObject({ state: "REFUNDING", refundedAmount: "50000000", refundReason: "PARTIAL_DEPOSIT", refundVerifiedAmount: null });
  });
  it("a status response for a different quote is ignored", async () => {
    const { id, dep } = await setup();
    h.fake.statuses.set(dep, statusPayload("SUCCESS", { amountOut: "1", destinationChainTxHashes: [{ hash: "x" }] }, "ed25519:someone-else"));
    const r = await step(id);
    expect(r.state).toBe("AWAITING_DEPOSIT");
    expect(r.lastStatusError).toMatch(/different quote/);
  });
  it("delayed: provider errors while PROCESSING for 30+ minutes -> UNKNOWN, and it recovers later", async () => {
    const { id, dep, sig } = await setup();
    h.fake.statuses.set(dep, statusPayload("PROCESSING", {}, sig));
    expect((await step(id)).state).toBe("PROCESSING");
    h.fake.statuses.set(dep, "500");
    expect((await step(id)).state).toBe("PROCESSING");
    h.clock.now += 31 * 60_000;
    expect((await step(id)).state).toBe("UNKNOWN");
    h.fake.statuses.set(dep, statusPayload("SUCCESS", { amountOut: "5", destinationChainTxHashes: [{ hash: "y" }] }, sig));
    expect((await step(id)).state).toBe("VERIFYING_DESTINATION");
  });
  it("cancel works before deposit, not after", async () => {
    const a = await setup();
    expect((await h.svc.cancel({ userId: u.userId, executionId: a.id })).state).toBe("CANCELLED");
    const b = await (async () => { const x = await create("Bridge 10 USDC from Base to Arbitrum"); const ap = await approve(x); return { id: x.execution.id, dep: ap.execution.depositAddress!, sig: ap.quote!.providerSignature! }; })();
    h.fake.statuses.set(b.dep, statusPayload("PROCESSING", {}, b.sig));
    h.clock.now += 5000;
    expect(await code(h.svc.cancel({ userId: u.userId, executionId: b.id }))).toBe("INVALID_STATE");
  });
});

describe("cross-user access", () => {
  it("another user cannot read, quote, approve, refresh or cancel my execution or quote", async () => {
    const x = await create();
    const eve = await h.newUser();
    const w = await eve.wallets();
    for (const p of [
      h.svc.details(x.execution.id, eve.userId), h.svc.quote(x.quote!.id, eve.userId),
      h.svc.requote({ userId: eve.userId, executionId: x.execution.id, wallets: w }),
      h.svc.approve({ userId: eve.userId, executionId: x.execution.id, quoteId: x.quote!.id, approval: approval(x.execution.planHash, h.now()), wallets: w }),
      h.svc.firmQuote({ userId: eve.userId, executionId: x.execution.id, quoteId: x.quote!.id, wallets: w }),
      h.svc.refresh({ userId: eve.userId, executionId: x.execution.id }), h.svc.cancel({ userId: eve.userId, executionId: x.execution.id }),
    ]) expect(["EXECUTION_NOT_FOUND", "QUOTE_NOT_FOUND"]).toContain(await code(p));
    expect(await h.svc.history(eve.userId, { limit: 10 })).toEqual([]);
  });
});

describe("persistence", () => {
  it("survives a new service instance on the same database", async () => {
    const x = await create();
    await approve(x);
    const { ExecutionService, ExecutionRecords, IntentLogPlanStore } = await import("@/execution");
    const { OneClickClient } = await import("@/integrations/near-intents/client");
    const fresh = new ExecutionService({ client: new OneClickClient({ fetchImpl: h.fake.fetch as typeof fetch }), records: new ExecutionRecords(h.db, h.now), plans: new IntentLogPlanStore(h.db), clock: h.now });
    const d = await fresh.details(x.execution.id, u.userId);
    expect(d).toMatchObject({ state: "AWAITING_DEPOSIT", plan: { planHash: x.execution.planHash } });
    expect((await fresh.history(u.userId, { limit: 5 }))[0].id).toBe(x.execution.id);
  });
});
