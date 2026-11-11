/**
 * Phase 5.2: refund timing, multi-transaction aggregation and provider evidence capability.
 * MOCKED provider and chain, real SQL. "CONFIRMED" capability here is SIMULATED; production defaults to UNCONFIRMED.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { refundTxs, reviews } from "@/database/schema";
import { REFUND_TIMING, refundEvidenceCapability } from "@/failures";
import type { ExecutionError } from "@/execution";
import { approval, harness } from "../execution/harness";
import { statusPayload } from "../execution/fake-1click";

let h: Awaited<ReturnType<typeof harness>>;
let u: Awaited<ReturnType<Awaited<ReturnType<typeof harness>>["newUser"]>>;
beforeEach(async () => { h = await harness(); u = await h.newUser(); });
const USDC = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", BRIDGE = "0x7777777777777777777777777777777777777777";
let n = 0;
const H = () => `0x${(++n).toString(16).padStart(64, "d")}`;
const code = async (p: Promise<unknown>) => { try { await p; return "OK"; } catch (e) { return (e as ExecutionError).code ?? (e as Error).message; } };

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
const pay = (to: string, amount: bigint, block?: number) => { const hash = H(); h.chain.evmTx(hash, { from: BRIDGE, to: USDC, block, logs: [{ address: USDC, from: BRIDGE, to, amount }] }); return hash; };
const report = (x: { ex: { depositAddress: string | null }; sig: string }, amount: string | null, hashes: string[], status = "REFUNDED") =>
  h.fake.statuses.set(x.ex.depositAddress!, statusPayload(status, { ...(amount ? { refundedAmount: amount } : {}), originChainTxHashes: hashes.map((hash) => ({ hash, explorerUrl: "x" })) }, x.sig));
const tick = async (ms = 5 * 60_000) => { h.clock.now += ms; await h.monitor.run({ trigger: "t" }); };
const state = async (id: string) => (await h.records.get(id))!.state;
const refund = async (id: string) => (await h.failureRecords.refund(id))!;
const openReview = async (id: string) => h.failureRecords.openReviewFor(id);

describe("multiple refund transactions (exact bigint sums)", () => {
  for (const parts of [[100_000_000n], [60_000_000n, 40_000_000n], [33_333_333n, 33_333_333n, 33_333_334n]]) {
    it(`${parts.length} transaction(s) complete a 100 USDC refund`, async () => {
      const x = await deposited();
      const hs = parts.map((p) => pay(x.ex.refundAddress, p));
      report(x, "100000000", hs);
      await tick();
      expect(await state(x.ex.id)).toBe("REFUNDED");
      expect(await refund(x.ex.id)).toMatchObject({ associatedAmount: "100000000", verifiedAmount: "100000000", outstandingAmount: "0" });
      expect((await h.db.select().from(refundTxs).where(eq(refundTxs.executionId, x.ex.id))).length).toBe(parts.length);
    });
  }
  it("partial refunds across transactions arriving at different times; never overcounted on repeat runs", async () => {
    const x = await deposited();
    const a = pay(x.ex.refundAddress, 30_000_000n);
    report(x, "100000000", [a]);
    await tick();
    expect(await refund(x.ex.id)).toMatchObject({ state: "PARTIAL", associatedAmount: "30000000", outstandingAmount: "70000000" });
    for (let i = 0; i < 3; i++) await tick();
    expect((await refund(x.ex.id)).associatedAmount).toBe("30000000");
    const b = pay(x.ex.refundAddress, 70_000_000n);
    report(x, "100000000", [a, b]);
    await tick();
    expect(await state(x.ex.id)).toBe("REFUNDED");
  });
  it("one valid and one invalid transaction: only the valid one counts", async () => {
    const x = await deposited();
    const ok = pay(x.ex.refundAddress, 60_000_000n), wrong = pay("0x9999999999999999999999999999999999999999", 40_000_000n);
    report(x, "100000000", [ok, wrong]);
    await tick();
    expect(await refund(x.ex.id)).toMatchObject({ state: "PARTIAL", associatedAmount: "60000000", verifiedAmount: "60000000" });
  });
  it("more than the reported amount: evidence kept, review opened, not completed", async () => {
    const x = await deposited();
    report(x, "100000000", [pay(x.ex.refundAddress, 60_000_000n), pay(x.ex.refundAddress, 60_000_000n)]);
    await tick();
    expect(await state(x.ex.id)).toBe("REFUNDING");
    expect(await refund(x.ex.id)).toMatchObject({ state: "VERIFICATION_PENDING", associatedAmount: "120000000", outstandingAmount: "0" });
    expect((await openReview(x.ex.id))!.reason).toMatch(/more than/);
  });
  it("provider amount changes between status responses: the latest figure is used", async () => {
    const x = await deposited();
    const a = pay(x.ex.refundAddress, 40_000_000n);
    report(x, "50000000", [a]);
    await tick();
    expect(await refund(x.ex.id)).toMatchObject({ state: "PARTIAL", providerRefundedAmount: "50000000" });
    report(x, "40000000", [a]);
    await tick();
    expect(await state(x.ex.id)).toBe("REFUNDED");
    expect((await refund(x.ex.id)).providerRefundedAmount).toBe("40000000");
  });
  it("duplicate hashes, case variants and cross-execution reuse never double count", async () => {
    const x = await deposited(), y = await deposited();
    const a = pay(x.ex.refundAddress, 50_000_000n);
    report(x, "50000000", [a, a.toUpperCase().replace("0X", "0x")]);
    report(y, "50000000", [a]); // provider lists the same hash for another execution: refused there
    await tick();
    expect(await state(x.ex.id)).toBe("REFUNDED");
    expect((await h.db.select().from(refundTxs).where(eq(refundTxs.txHash, a))).length).toBe(1);
    expect(await state(y.ex.id)).toBe("REFUNDING");
    expect((await refund(y.ex.id)).associatedAmount ?? "0").toBe("0");
    expect((await openReview(y.ex.id))!.reason).toMatch(/already linked to another transfer/);
  });
  it("concurrent verification and repeated worker runs: one completion, exact totals", async () => {
    const x = await deposited();
    report(x, "100000000", [pay(x.ex.refundAddress, 60_000_000n), pay(x.ex.refundAddress, 40_000_000n)]);
    h.clock.now += 5 * 60_000;
    await Promise.all([h.monitor.run({ trigger: "a" }), h.monitor.run({ trigger: "b" }), h.failures.verifyRefund(u.userId, x.ex.id), h.failures.verifyRefund(u.userId, x.ex.id)]);
    await tick(); await tick();
    expect(await state(x.ex.id)).toBe("REFUNDED");
    expect(await refund(x.ex.id)).toMatchObject({ associatedAmount: "100000000" });
  });
});

describe("timing assessment", () => {
  it("within seven days: EXPECTED_WINDOW", async () => {
    const x = await deposited();
    const t = pay(x.ex.refundAddress, 50_000_000n);
    report(x, "50000000", [t]);
    await tick();
    expect((await h.db.select().from(refundTxs).where(eq(refundTxs.txHash, t)))[0].timing).toBe("EXPECTED_WINDOW");
  });
  it("after seven days with provider association: LATE, still verified and counted, review opened; never auto-closed", async () => {
    const x = await deposited();
    const lateBlock = 1000 + Math.ceil((REFUND_TIMING.windowAfterDeadlineMs + 30 * 24 * 3600_000) / 2000);
    h.chain.evmHead = lateBlock + 20;
    const t = pay(x.ex.refundAddress, 50_000_000n, lateBlock);
    report(x, "50000000", [t]);
    await tick();
    expect((await h.db.select().from(refundTxs).where(eq(refundTxs.txHash, t)))[0]).toMatchObject({ timing: "LATE_TRANSACTION", association: "PROVIDER_LISTED" });
    expect(await state(x.ex.id)).toBe("REFUNDED");
    expect((await openReview(x.ex.id))!.reason).toMatch(/after the expected window/);
  });
  it("after seven days without provider association: verified, never counted, review", async () => {
    const x = await deposited();
    report(x, "50000000", []);
    await tick();
    const lateBlock = 1000 + Math.ceil((REFUND_TIMING.windowAfterDeadlineMs + 30 * 24 * 3600_000) / 2000);
    h.chain.evmHead = lateBlock + 20;
    const t = pay(x.ex.refundAddress, 50_000_000n, lateBlock);
    await h.failures.submitRefundTx(u.userId, x.ex.id, t);
    expect(await state(x.ex.id)).toBe("REFUNDING");
    expect(await refund(x.ex.id)).toMatchObject({ state: "ASSOCIATION_PENDING", associatedAmount: "0" });
  });
  it("monitoring of an open refund continues past seven days and after repeated provider failures", async () => {
    const x = await deposited();
    report(x, "50000000", []);
    await tick();
    h.clock.now += 9 * 24 * 3600_000;
    await tick();
    const r = (await h.records.get(x.ex.id))!;
    expect(r.state).toBe("REFUNDING");
    expect(r.monitorGaveUpAt).toBeNull();
    expect(r.monitorNextAt).not.toBeNull();
    h.fake.mode = "timeout";
    for (let i = 0; i < 30; i++) { h.clock.now = (await h.records.get(x.ex.id))!.monitorNextAt!.getTime(); await h.monitor.run({ trigger: "t" }); }
    const after = (await h.records.get(x.ex.id))!;
    expect(after.state).toBe("REFUNDING"); // a provider timeout is never a failure
    expect(after.monitorGaveUpAt).toBeNull();
    expect((await h.db.select().from(reviews).where(eq(reviews.executionId, x.ex.id))).length).toBe(1);
  });
});

describe("provider evidence capability", () => {
  it("defaults to UNCONFIRMED in production configuration", () => {
    expect(refundEvidenceCapability(undefined)).toBe("UNCONFIRMED");
    expect(refundEvidenceCapability("yes")).toBe("UNCONFIRMED");
    expect(refundEvidenceCapability("CONFIRMED")).toBe("CONFIRMED");
  });
  it("UNCONFIRMED: provider-listed, chain-verified refund is recorded but never completes; review explains why", async () => {
    h.capability.value = "UNCONFIRMED";
    const x = await deposited();
    report(x, "50000000", [pay(x.ex.refundAddress, 50_000_000n)]);
    await tick(); await tick();
    expect(await state(x.ex.id)).toBe("REFUNDING");
    expect(await refund(x.ex.id)).toMatchObject({ state: "ASSOCIATION_PENDING", providerListedAmount: "50000000", associatedAmount: "0", evidenceCapability: "UNCONFIRMED" });
    expect((await openReview(x.ex.id))!.reason).toMatch(/capability is UNCONFIRMED/);
    // Once the capability is confirmed (after a documented or observed real refund), the same evidence completes.
    h.capability.value = "CONFIRMED";
    await tick();
    expect(await state(x.ex.id)).toBe("REFUNDED");
  });
  it("UNSUPPORTED: provider listing is ignored for association", async () => {
    h.capability.value = "UNSUPPORTED";
    const x = await deposited();
    const t = pay(x.ex.refundAddress, 50_000_000n);
    report(x, "50000000", [t]);
    await tick();
    expect(await state(x.ex.id)).toBe("REFUNDING");
    expect((await h.db.select().from(refundTxs).where(eq(refundTxs.txHash, t)))[0].association).toBe("PENDING_ASSOCIATION");
  });
  it("refundedAmount \"0\" (observed live before any refund) is treated as unknown, not as a zero refund", async () => {
    const x = await deposited();
    report(x, "0", [pay(x.ex.refundAddress, 50_000_000n)], "FAILED");
    await tick();
    expect(await state(x.ex.id)).toBe("FAILED");
    expect(await refund(x.ex.id)).toMatchObject({ state: "VERIFICATION_PENDING", outstandingAmount: null });
    expect(await openReview(x.ex.id)).toBeNull(); // no false "excess" alarm
  });
  it("missing refund amount and unknown provider status never complete", async () => {
    const x = await deposited();
    report(x, null, [pay(x.ex.refundAddress, 50_000_000n)]);
    await tick();
    expect(await state(x.ex.id)).toBe("REFUNDING");
    const y = await deposited();
    report(y, "50000000", [pay(y.ex.refundAddress, 50_000_000n)], "SOMETHING_NEW");
    await tick();
    expect(await state(y.ex.id)).toBe("UNKNOWN");
    expect(await code(h.failures.refund(u.userId, y.ex.id))).toBe("OK");
  });
});
