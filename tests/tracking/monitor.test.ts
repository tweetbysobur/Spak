/**
 * Background monitor and destination verification end to end. MOCKED: 1Click (Fake1Click) and chain RPC (FakeChain).
 * Real: users, wallets, SPak-in plans, approvals, deposits, SQL, atomic claims.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { executions, monitorAttempts, executionEvents } from "@/database/schema";
import { MONITOR } from "@/tracking";
import { approval, harness } from "../execution/harness";
import { statusPayload } from "../execution/fake-1click";

let h: Awaited<ReturnType<typeof harness>>;
let u: Awaited<ReturnType<Awaited<ReturnType<typeof harness>>["newUser"]>>;
beforeEach(async () => { h = await harness(); u = await h.newUser(); });
const USDC = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
const SOLVER = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";
let n = 0;

/** Approved execution with a source deposit SPak verified on chain. */
async function deposited(who = u, text = "Swap 50 USDC on Base to SOL on Solana") {
  const r = await who.plan(text);
  const wallets = await who.wallets();
  const x = await h.svc.create({ userId: who.userId, planHash: r.plan!.hash, idempotencyKey: `k-${++n}-${Math.random()}`, wallets });
  const f = await h.svc.firmQuote({ userId: who.userId, executionId: x.execution.id, quoteId: x.quote!.id, wallets });
  const a = await h.svc.approve({ userId: who.userId, executionId: x.execution.id, quoteId: f.quote.id, approval: approval(x.execution.planHash, h.now(), true, x.execution.planRevision), wallets });
  const ex = a.execution;
  h.chain.setBalance("base", who.evm.address, 50_000_000n, USDC);
  const p = await h.deposits.prepare({ userId: who.userId, executionId: ex.id, wallets });
  const tx = `0x${(++n).toString(16).padStart(64, "a")}`;
  h.chain.evmTx(tx, { from: who.evm.address, to: USDC, logs: [{ address: USDC, from: who.evm.address, to: ex.depositAddress!, amount: 50_000_000n }] });
  expect((await h.deposits.submit({ userId: who.userId, depositId: p.deposit.id, txHash: tx })).state).toBe("CONFIRMED");
  const min = BigInt((await h.records.getQuote(ex.firmQuoteId!))!.minAmountOut!);
  return { ex, sig: a.quote!.providerSignature!, min, who };
}
const providerSuccess = (dep: string, sig: string, hashes: string[]) =>
  h.fake.statuses.set(dep, statusPayload("SUCCESS", { amountOut: "999", destinationChainTxHashes: hashes.map((hash) => ({ hash, explorerUrl: "x" })) }, sig));
const delivered = (sig: string, to: string, lamports: bigint, status: "finalized" | "confirmed" = "finalized") =>
  h.chain.solTx(sig, { feePayer: SOLVER, keys: [SOLVER, to], pre: [10n ** 12n, 0].map(Number), post: [Number(10n ** 12n - lamports - 5000n), Number(lamports)], status });
const tick = async (ms = 60_000) => { h.clock.now += ms; return h.monitor.run({ trigger: "test" }); };
const get = async (id: string) => (await h.records.get(id))!;

describe("background monitoring with destination verification", () => {
  it("EVM destination: a provider's non-EVM settlement hash among destination hashes is ignored, delivery is still proven on chain", async () => {
    // Regression from the first real Tidepool settlement: Tidepool lists its NEAR settlement hash next to the Arbitrum payout.
    const USDC_ARB = "0xaf88d065e77c8cc2239327c5edb3a432268e5831";
    const { ex, sig, min } = await deposited(u, "Swap 50 USDC on Base to USDC on Arbitrum");
    const payout = `0x${"97a4".padEnd(64, "0")}`;
    providerSuccess(ex.depositAddress!, sig, ["isvXCRDGHHCVZ7jBjPrWmuTVXyE1oqGt4BgaNp5Wv4f", payout]);
    h.chain.evmTx(payout, { network: "arbitrum", from: "0x2e6ad9e6d59bb4585ea0e6762c3b637dde29dad2", to: USDC_ARB, logs: [{ address: USDC_ARB, from: "0x2e6ad9e6d59bb4585ea0e6762c3b637dde29dad2", to: u.evm.address, amount: min }] });
    await tick(); await tick();
    const done = await get(ex.id);
    expect(done).toMatchObject({ state: "COMPLETED", amountOutVerified: min.toString() });
    const ev = (await h.db.select().from(executionEvents).where(eq(executionEvents.executionId, ex.id))).find((e) => e.toState === "COMPLETED");
    expect(ev?.data).toMatchObject({ txs: [payout], ignoredNonChainReferences: ["isvXCRDGHHCVZ7jBjPrWmuTVXyE1oqGt4BgaNp5Wv4f"] });
  });
  it("EVM destination with only non-EVM references: never COMPLETED, goes to manual reconciliation", async () => {
    const { ex, sig } = await deposited(u, "Swap 50 USDC on Base to USDC on Arbitrum");
    providerSuccess(ex.depositAddress!, sig, ["isvXCRDGHHCVZ7jBjPrWmuTVXyE1oqGt4BgaNp5Wv4f"]);
    await tick(); await tick();
    const r = await get(ex.id);
    expect(r.state).toBe("UNKNOWN");
    expect(r.amountOutVerified).toBeNull();
  });

  it("deposit confirmed → processing → destination detected → verified on chain → COMPLETED", async () => {
    const { ex, sig, min } = await deposited();
    expect((await get(ex.id)).state).toBe("PROCESSING"); // confirmed source deposit, provider has not reported yet
    providerSuccess(ex.depositAddress!, sig, ["dsig1"]);
    delivered("dsig1", u.sol.address, min, "confirmed");
    await tick();
    expect((await get(ex.id)).state).toBe("VERIFYING_DESTINATION"); // provider success is not proof; not finalized yet
    delivered("dsig1", u.sol.address, min);
    await tick();
    const done = await get(ex.id);
    expect(done).toMatchObject({ state: "COMPLETED", amountOutVerified: min.toString(), monitorNextAt: null });
    const v = await h.trackingService.view(u.userId, ex.id);
    expect(v.steps.every((s) => s.status === "done")).toBe(true);
    expect(v.destination.verifiedAmountOut).toBe(min.toString());
    expect(v.destinationTxs[0]).toMatchObject({ outcome: "CONFIRMED", explorerUrl: "https://solscan.io/tx/dsig1" });
    // Idempotent: further runs change nothing.
    const events = (await h.db.select().from(executionEvents).where(eq(executionEvents.executionId, ex.id))).length;
    await tick(); await tick();
    expect((await h.db.select().from(executionEvents).where(eq(executionEvents.executionId, ex.id))).length).toBe(events);
  });

  it("insufficient output, wrong recipient and reused destination tx never complete; flagged for reconciliation", async () => {
    const a = await deposited();
    providerSuccess(a.ex.depositAddress!, a.sig, ["short"]);
    delivered("short", u.sol.address, a.min - 1n);
    await tick();
    expect(await get(a.ex.id)).toMatchObject({ state: "UNKNOWN", error: { code: "NEEDS_RECONCILIATION" } });
    expect((await get(a.ex.id)).monitorGaveUpAt).not.toBeNull();

    const b = await deposited();
    providerSuccess(b.ex.depositAddress!, b.sig, ["elsewhere"]);
    delivered("elsewhere", SOLVER.replace("7x", "8x"), b.min);
    await tick();
    expect((await get(b.ex.id)).state).toBe("UNKNOWN");

    const c = await deposited();
    providerSuccess(c.ex.depositAddress!, c.sig, ["short"]); // tampered: a tx already linked to execution a
    await tick();
    expect(await get(c.ex.id)).toMatchObject({ state: "UNKNOWN" });
    expect((await get(c.ex.id)).lastStatusError).toMatch(/already linked to another execution/);
  });

  it("delayed settlement is not failure: unknown destination tx keeps verifying", async () => {
    const { ex, sig } = await deposited();
    providerSuccess(ex.depositAddress!, sig, ["notyet"]);
    for (let i = 0; i < 3; i++) await tick();
    expect((await get(ex.id)).state).toBe("VERIFYING_DESTINATION");
  });
});

describe("worker safety", () => {
  it("concurrent runs claim each execution once", async () => {
    const { ex } = await deposited();
    h.clock.now += 60_000;
    const [r1, r2, r3] = await Promise.all([h.monitor.run({ trigger: "a" }), h.monitor.run({ trigger: "b" }), h.monitor.run({ trigger: "c" })]);
    expect(r1.claimed + r2.claimed + r3.claimed).toBe(1);
    expect((await h.db.select().from(monitorAttempts).where(eq(monitorAttempts.executionId, ex.id))).length).toBe(1);
  });

  it("an interrupted worker's lease expires and another run recovers the execution", async () => {
    const { ex } = await deposited();
    h.clock.now += 60_000;
    expect(await h.tracking.claim(ex.id, "crashed-worker", MONITOR.leaseMs)).not.toBeNull(); // claimed, then the worker dies
    expect((await h.monitor.run({ trigger: "t" })).claimed).toBe(0);
    h.clock.now += MONITOR.leaseMs + 1;
    expect((await h.monitor.run({ trigger: "t" })).claimed).toBe(1);
    expect((await get(ex.id)).monitorLeaseOwner).toBeNull();
  });

  it("provider outage: controlled backoff, bounded retries, then UNKNOWN for reconciliation (never FAILED)", async () => {
    const { ex } = await deposited();
    h.fake.statuses.set(ex.depositAddress!, "500");
    h.clock.now += 60_000;
    await h.monitor.run({ trigger: "t" });
    const r1 = await get(ex.id);
    expect(r1.monitorFailures).toBe(1);
    expect(r1.monitorNextAt!.getTime() - h.clock.now).toBe(MONITOR.baseRetryMs);
    h.clock.now = r1.monitorNextAt!.getTime();
    h.fake.statuses.set(ex.depositAddress!, "429"); // rate limited: same handling
    await h.monitor.run({ trigger: "t" });
    const r2 = await get(ex.id);
    expect(r2.monitorNextAt!.getTime() - h.clock.now).toBe(2 * MONITOR.baseRetryMs);
    h.fake.mode = "timeout";
    for (let i = 2; i < MONITOR.maxFailures; i++) { h.clock.now = (await get(ex.id)).monitorNextAt!.getTime(); await h.monitor.run({ trigger: "t" }); }
    const last = await get(ex.id);
    expect(last.monitorGaveUpAt).not.toBeNull();
    expect(last.state).toBe("UNKNOWN");
    const attempts = await h.db.select().from(monitorAttempts).where(eq(monitorAttempts.executionId, ex.id));
    expect(attempts).toHaveLength(MONITOR.maxFailures);
    expect(attempts.at(-1)).toMatchObject({ outcome: "GAVE_UP" });
    expect(attempts[0].detail).toMatch(/provider: UNAVAILABLE/);
    expect((await h.monitor.run({ trigger: "t" })).claimed).toBe(0); // stopped; no unbounded retries
    h.fake.mode = "ok";
    h.fake.statuses.set(ex.depositAddress!, "404");
    await h.trackingService.refresh(u.userId, ex.id); // a user refresh resumes monitoring
    expect((await get(ex.id)).monitorGaveUpAt).toBeNull();
  });

  it("scheduled runs skip executions that are not due, terminal, or not yet deposited", async () => {
    const { ex } = await deposited();
    h.clock.now += 60_000;
    expect((await h.monitor.run({ trigger: "t" })).claimed).toBe(1);
    expect((await h.monitor.run({ trigger: "t" })).claimed).toBe(0); // next check scheduled in the future
    await h.db.update(executions).set({ state: "COMPLETED" }).where(eq(executions.id, ex.id));
    h.clock.now += 3600_000;
    expect((await h.monitor.run({ trigger: "t" })).claimed).toBe(0);
  });
});

describe("tracking security", () => {
  it("another user cannot read or refresh my execution", async () => {
    const { ex } = await deposited();
    const bob = await h.newUser();
    for (const p of [h.trackingService.view(bob.userId, ex.id), h.trackingService.refresh(bob.userId, ex.id), h.trackingService.events(bob.userId, ex.id), h.trackingService.destination(bob.userId, ex.id)]) {
      await expect(p).rejects.toMatchObject({ code: "EXECUTION_NOT_FOUND" });
    }
  });
});
