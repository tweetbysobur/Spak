/**
 * Phase 5.3: post-completion reconciliation and remaining association cases. MOCKED provider and chain, real SQL.
 * "CONFIRMED" capability is SIMULATED (h.capability); production stays UNCONFIRMED.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { failureEvents, refundTxs, reviews } from "@/database/schema";
import { REFUND_TIMING } from "@/failures";
import { verifyDelivery } from "@/tracking/verifiers";
import { FakeChain } from "../deposits/fake-chain";
import { approval, harness } from "../execution/harness";
import { statusPayload } from "../execution/fake-1click";

let h: Awaited<ReturnType<typeof harness>>;
let u: Awaited<ReturnType<Awaited<ReturnType<typeof harness>>["newUser"]>>;
beforeEach(async () => { h = await harness(); u = await h.newUser(); });
const USDC = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", BRIDGE = "0x7777777777777777777777777777777777777777";
let n = 0;
const H = () => `0x${(++n).toString(16).padStart(64, "e")}`;

async function deposited() {
  const r = await u.plan("Swap 50 USDC on Base to SOL on Solana");
  const wallets = await u.wallets();
  const x = await h.svc.create({ userId: u.userId, planHash: r.plan!.hash, idempotencyKey: `k-${++n}-${Math.random()}`, wallets });
  const f = await h.svc.firmQuote({ userId: u.userId, executionId: x.execution.id, quoteId: x.quote!.id, wallets });
  const a = await h.svc.approve({ userId: u.userId, executionId: x.execution.id, quoteId: f.quote.id, approval: approval(x.execution.planHash, h.now(), true, x.execution.planRevision), wallets });
  h.chain.setBalance("base", u.evm.address, 50_000_000n, USDC);
  const p = await h.deposits.prepare({ userId: u.userId, executionId: a.execution.id, wallets });
  const depTx = H();
  h.chain.evmTx(depTx, { from: u.evm.address, to: USDC, logs: [{ address: USDC, from: u.evm.address, to: a.execution.depositAddress!, amount: 50_000_000n }] });
  await h.deposits.submit({ userId: u.userId, depositId: p.deposit.id, txHash: depTx });
  return { ex: a.execution, sig: a.quote!.providerSignature!, depTx };
}
const pay = (to: string, amount: bigint, from = BRIDGE) => { const hash = H(); h.chain.evmTx(hash, { from, to: USDC, logs: [{ address: USDC, from, to, amount }] }); return hash; };
const report = (x: { ex: { depositAddress: string | null }; sig: string }, status: string, amount: string | null, hashes: string[]) =>
  h.fake.statuses.set(x.ex.depositAddress!, statusPayload(status, { ...(amount ? { refundedAmount: amount } : {}), originChainTxHashes: hashes.map((hash) => ({ hash, explorerUrl: "x" })) }, x.sig));
const tick = async (ms = 5 * 60_000) => { h.clock.now += ms; await h.monitor.run({ trigger: "t" }); };
const due = async (id: string) => { h.clock.now = Math.max(h.clock.now, (await h.records.get(id))!.monitorNextAt?.getTime() ?? h.clock.now) + 1; await h.monitor.run({ trigger: "t" }); };
const refund = async (id: string) => (await h.failureRecords.refund(id))!;
const events = async (id: string, code: string) => (await h.db.select().from(failureEvents).where(eq(failureEvents.executionId, id))).filter((e) => e.code === code);

async function completed() {
  const x = await deposited();
  const t = pay(x.ex.refundAddress, 50_000_000n);
  report(x, "REFUNDED", "50000000", [x.depTx, t]);
  await tick();
  expect((await h.records.get(x.ex.id))!.state).toBe("REFUNDED");
  return { ...x, t };
}

describe("post-completion reconciliation", () => {
  it("consistent provider data: stays CONSISTENT, no review, no extra events", async () => {
    const x = await completed();
    const before = await refund(x.ex.id);
    expect(before).toMatchObject({ reconciliation: "CONSISTENT", completionSnapshot: expect.objectContaining({ providerRefundedAmount: "50000000", associatedAmount: "50000000" }) });
    await due(x.ex.id); await due(x.ex.id);
    expect((await refund(x.ex.id)).reconciliation).toBe("CONSISTENT");
    expect(await h.failureRecords.openReviewFor(x.ex.id)).toBeNull();
  });

  it("provider amount changes after completion: discrepancy and review; completion record and state untouched", async () => {
    const x = await completed();
    const before = await refund(x.ex.id);
    report(x, "REFUNDED", "45000000", [x.depTx, x.t]);
    await due(x.ex.id); await due(x.ex.id); await due(x.ex.id);
    const after = await refund(x.ex.id);
    expect(after).toMatchObject({ state: "COMPLETED", reconciliation: "DISCREPANCY", associatedAmount: "50000000", completedAt: before.completedAt });
    expect((after.completionSnapshot as { providerRefundedAmount: string }).providerRefundedAmount).toBe("50000000"); // history not rewritten
    expect((await h.records.get(x.ex.id))!.state).toBe("REFUNDED");
    expect(await events(x.ex.id, "REFUND_RECONCILIATION_DISCREPANCY")).toHaveLength(1); // not repeated each run
    expect((await h.failureRecords.openReviewFor(x.ex.id))!.reason).toMatch(/45000000/);
    expect((await h.failures.failure(u.userId, x.ex.id)).classification.code).toBe("REFUND_RECONCILIATION_DISCREPANCY");
  });

  it("provider status changes after completion, or lists new origin transactions: discrepancy, nothing recounted", async () => {
    const a = await completed();
    report(a, "FAILED", "50000000", [a.depTx, a.t]);
    await due(a.ex.id);
    expect((await refund(a.ex.id)).reconciliation).toBe("DISCREPANCY");
    const b = await completed();
    const extra = pay(b.ex.refundAddress, 10_000_000n);
    report(b, "REFUNDED", "50000000", [b.depTx, b.t, extra]);
    await due(b.ex.id);
    expect(await refund(b.ex.id)).toMatchObject({ reconciliation: "DISCREPANCY", associatedAmount: "50000000" });
    expect((await h.db.select().from(refundTxs).where(eq(refundTxs.executionId, b.ex.id))).length).toBe(1);
  });

  it("provider outage during the watch is a retry, not a discrepancy", async () => {
    const x = await completed();
    h.fake.mode = "timeout";
    await due(x.ex.id);
    const r = (await h.records.get(x.ex.id))!;
    expect(r.monitorFailures).toBe(1);
    expect((await refund(x.ex.id)).reconciliation).toBe("CONSISTENT");
  });

  it("the watch ends after 30 days and the execution is no longer claimed", async () => {
    const x = await completed();
    h.clock.now += REFUND_TIMING.watchAfterCompletionMs + 1;
    await h.monitor.run({ trigger: "t" });
    expect((await h.records.get(x.ex.id))!.monitorGaveUpAt).not.toBeNull();
    expect((await h.monitor.run({ trigger: "t" })).claimed).toBe(0);
  });

  it("concurrent watch runs claim once", async () => {
    const x = await completed();
    h.clock.now = ((await h.records.get(x.ex.id))!.monitorNextAt?.getTime() ?? h.clock.now) + 1;
    const rs = await Promise.all([h.monitor.run({ trigger: "a" }), h.monitor.run({ trigger: "b" })]);
    expect(rs[0].claimed + rs[1].claimed).toBe(1);
  });
});

describe("association edge cases", () => {
  it("same sender (the bridge) and same amount, but not provider-listed: never associated", async () => {
    const x = await deposited();
    report(x, "REFUNDED", "50000000", []);
    await tick();
    await h.failures.submitRefundTx(u.userId, x.ex.id, pay(x.ex.refundAddress, 50_000_000n, BRIDGE));
    await tick();
    expect((await h.records.get(x.ex.id))!.state).toBe("REFUNDING");
    expect((await refund(x.ex.id)).associatedAmount).toBe("0");
  });
  it("UNCONFIRMED capability: everything recorded, nothing completes, explanation in the review", async () => {
    h.capability.value = "UNCONFIRMED";
    const x = await deposited();
    report(x, "REFUNDED", "50000000", [pay(x.ex.refundAddress, 50_000_000n)]);
    await tick();
    expect((await h.records.get(x.ex.id))!.state).toBe("REFUNDING");
    expect((await h.db.select().from(reviews).where(eq(reviews.executionId, x.ex.id)))[0].reason).toMatch(/UNCONFIRMED/);
  });
  it("unsupported source network family: unverifiable, never a refund", async () => {
    const r = await verifyDelivery(new FakeChain(), "tron", { network: "tron", txHash: "abc", recipient: "T1", kind: "NATIVE", tokenContract: null });
    expect(r.outcome).toBe("UNVERIFIABLE");
  });
  it("the quoted refund fee is shown but never used in arithmetic", async () => {
    const x = await completed();
    const r = await h.failures.refund(u.userId, x.ex.id);
    expect(r.refund!.associatedAmount).toBe("50000000");
    expect(r.refund!.expectedAmount).toBe("50000000");
  });
});
