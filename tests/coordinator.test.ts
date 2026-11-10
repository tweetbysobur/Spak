import { describe, expect, it } from "vitest";
import { ExecutionCoordinator, MemoryPlanStore, SpakIn, sequentialIds, planHash, type ExecutionPlan, type ExecutionProvider, type ProviderQuote } from "@/spak-in";
import { NOW, run } from "./helpers";

/** Test double. It proves coordinator logic only; it is not evidence that any blockchain integration works. */
class RecordingProvider implements ExecutionProvider {
  readonly id = "test-provider";
  prepared = 0;
  status_ = "AWAITING_DEPOSIT" as const;
  supports() { return { ok: true as const }; }
  private q: ProviderQuote = { provider: this.id, amountIn: "50", amountOut: "0.5", minAmountOut: "0.49", amountInUsd: null, amountOutUsd: null, fees: [], estimatedSeconds: 30, expiresAt: null };
  async quote() { return this.q; }
  async prepare(plan: ExecutionPlan) {
    this.prepared++;
    return { provider: this.id, providerRef: `dep-${this.prepared}`, quote: this.q, deposit: { network: plan.legs[0].sourceNetwork, assetId: plan.legs[0].sourceAssetId, amount: "50", address: `dep-${this.prepared}`, memo: null, deadline: "2026-11-10T10:30:00.000Z" } };
  }
  async status() { return { state: this.status_, originTxHashes: [], destinationTxHashes: [], amountOut: null, raw: "PENDING_DEPOSIT" }; }
}

const setup = async () => {
  const provider = new RecordingProvider();
  const c = new ExecutionCoordinator({ providers: [provider], ids: sequentialIds(), clock: () => new Date(NOW) });
  const r = await run("Swap 50 USDC on Base to SOL on Solana");
  const plan = r.plan!;
  const approval = { intentId: plan.intentId, planId: plan.planId, planHash: plan.hash, approvedBy: "USER" as const, approvedAt: NOW, idempotencyKey: "idem-0001" };
  return { provider, c, plan, approval };
};

describe("execution coordinator", () => {
  it("prepares deposit instructions after approval and never claims success", async () => {
    const { c, plan, approval } = await setup();
    const s = await c.submit({ plan, approval, userId: "u1" });
    expect(s.ok && s.value.submission.state).toBe("AWAITING_DEPOSIT");
    expect(s.ok && s.value.submission.deposit?.address).toBe("dep-1");
  });
  it("prevents duplicate execution: retries, same plan, same transfer", async () => {
    const { c, plan, approval, provider } = await setup();
    await c.submit({ plan, approval, userId: "u1" });
    const retry = await c.submit({ plan, approval, userId: "u1" });
    expect(retry.ok && retry.value.duplicate).toBe(true);
    const samePlan = await c.submit({ plan, approval: { ...approval, idempotencyKey: "idem-0002" }, userId: "u1" });
    expect(samePlan.ok && samePlan.value.duplicate).toBe(true);
    expect(provider.prepared).toBe(1);
    // same transfer under a new intent within 2 minutes
    const other = new SpakIn({ ids: (p) => `${p}_other`, clock: () => new Date(NOW) });
    const again = (await run("Swap 50 USDC on Base to SOL on Solana", {}, other)).plan!;
    const a2 = { ...approval, intentId: again.intentId, planId: again.planId, planHash: again.hash, idempotencyKey: "idem-0003" };
    const dup = await c.submit({ plan: again, approval: a2, userId: "u1" });
    expect(!dup.ok && dup.error.code).toBe("DUPLICATE_SUSPECTED");
    const forced = await c.submit({ plan: again, approval: { ...a2, allowDuplicate: true }, userId: "u1" });
    expect(forced.ok).toBe(true);
    expect(provider.prepared).toBe(2);
  });
  it("concurrent double-submit prepares once", async () => {
    const { c, plan, approval, provider } = await setup();
    const [a, b] = await Promise.all([c.submit({ plan, approval, userId: "u1" }), c.submit({ plan, approval, userId: "u1" })]);
    expect(a.ok && b.ok).toBe(true);
    expect(provider.prepared).toBe(1);
  });
  it("rejects tampered plans, mismatched or stale approvals, and unearned autonomy", async () => {
    const { c, plan, approval } = await setup();
    const tampered = structuredClone(plan); tampered.legs[0].recipient = "0x9999999999999999999999999999999999999999";
    expect((await c.submit({ plan: tampered, approval, userId: "u1" })) as unknown).toMatchObject({ ok: false, error: { code: "APPROVAL_MISMATCH" } });
    expect(await c.submit({ plan, approval: { ...approval, planHash: "0".repeat(64) }, userId: "u1" })).toMatchObject({ ok: false, error: { code: "APPROVAL_MISMATCH" } });
    expect(await c.submit({ plan, approval: { ...approval, approvedAt: "2026-11-10T09:00:00.000Z" }, userId: "u1" })).toMatchObject({ ok: false, error: { code: "APPROVAL_EXPIRED" } });
    expect(await c.submit({ plan, approval: { ...approval, approvedBy: "POLICY" }, userId: "u1" })).toMatchObject({ ok: false, error: { code: "AUTONOMY_NOT_PERMITTED" } });
  });
  it("refuses plans that are not executable yet", async () => {
    const { c } = await setup();
    const r = await run("Move 25% of my USDC from Base to NEAR");
    expect(await c.quote(r.plan)).toMatchObject({ ok: false, error: { code: "PLAN_NOT_EXECUTABLE" } });
  });
  it("cancels only before deposit, and audits every step", async () => {
    const { c, plan, approval, provider } = await setup();
    const s = await c.submit({ plan, approval, userId: "u1" });
    if (!s.ok) throw new Error();
    expect((await c.cancel(s.value.submission.id, "someone-else")).ok).toBe(false);
    expect(await c.cancel(s.value.submission.id, "u1")).toMatchObject({ ok: true, value: { state: "CANCELLED" } });
    provider.status_ = "AWAITING_DEPOSIT";
    const events = (c.audit as unknown as { events: { event: string }[] }).events.map((e) => e.event);
    expect(events).toEqual(["PLAN_APPROVED", "DEPOSIT_PREPARED", "CANCELLED"]);
  });

  it("accepts only plans SPak-in issued when a plan source is set", async () => {
    const plans = new MemoryPlanStore();
    const e = new SpakIn({ ids: sequentialIds(), clock: () => new Date(NOW), onResult: (r) => (r.plan ? plans.put(r.plan) : undefined) });
    const provider = new RecordingProvider();
    const c = new ExecutionCoordinator({ providers: [provider], planSource: plans, clock: () => new Date(NOW) });
    const issued = (await run("Swap 50 USDC on Base to SOL on Solana", {}, e)).plan!;
    expect((await c.quote(issued)).ok).toBe(true);
    // A self-made plan with a correct hash is still refused.
    const { planId: _p, hash: _h, ...body } = structuredClone(issued);
    body.legs[0].recipient = "0x9999999999999999999999999999999999999999";
    const h = planHash(body);
    const forged = { ...body, planId: `spak_plan_${h.slice(0, 16)}`, hash: h };
    expect(await c.quote(forged)).toMatchObject({ ok: false, error: { code: "APPROVAL_MISMATCH" } });
  });
});
