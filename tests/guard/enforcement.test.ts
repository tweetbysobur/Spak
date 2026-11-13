/**
 * SPak Guard enforcement through the real execution and deposit services: real users, real SPak-in plans,
 * real SQL (PGlite). MOCKED: the 1Click provider (Fake1Click) and chain RPC (FakeChain).
 */
import { beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import type { ExecutionError, ExecutionState } from "@/execution";
import { guardDecisions, guardPolicyHistory, guardReservations } from "@/database/schema";
import { approval, harness } from "../execution/harness";

let h: Awaited<ReturnType<typeof harness>>;
let u: Awaited<ReturnType<Awaited<ReturnType<typeof harness>>["newUser"]>>;
beforeEach(async () => { h = await harness(); u = await h.newUser(); });

const USDC = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
const USDC_BASE = `base:${USDC}`;
const code = async (p: Promise<unknown>) => { try { await p; return "OK"; } catch (e) { return (e as ExecutionError).code ?? (e as Error).message; } };
const swap = (n: number) => `Swap ${n} USDC on Base to SOL on Solana`;

async function create(text = swap(50), who = u) {
  const r = await who.plan(text);
  expect(r.status, JSON.stringify(r.errors)).toBe("VALIDATED");
  return h.svc.create({ userId: who.userId, planHash: r.plan!.hash, idempotencyKey: `k-${Math.random().toString(36).slice(2)}`, wallets: await who.wallets() });
}
async function firm(x: Awaited<ReturnType<typeof create>>, who = u) {
  return (await h.svc.firmQuote({ userId: who.userId, executionId: x.execution.id, quoteId: x.quote!.id, wallets: await who.wallets() })).quote;
}
async function approve(x: Awaited<ReturnType<typeof create>>, quoteId: string, who = u) {
  return h.svc.approve({ userId: who.userId, executionId: x.execution.id, quoteId, approval: approval(x.execution.planHash, h.now(), true, x.execution.planRevision), wallets: await who.wallets() });
}
async function approved(text = swap(50), who = u) {
  const x = await create(text, who);
  return (await approve(x, (await firm(x, who)).id, who)).execution;
}
const settings = async (who = u) => (await h.guard.view(who.userId)).policy;
const update = async (patch: Record<string, unknown>, who = u) => h.guard.update(who.userId, { version: (await settings(who)).version, ...patch });
const reservation = (executionId: string) => h.guard.reservationFor(u.userId, executionId);
const state = async (id: string) => (await h.records.get(id))!.state;

describe("default policy and the existing flow", () => {
  it("first use creates the default policy (version 1, all supported networks, platform ceiling) and the normal flow still works", async () => {
    const p = await settings();
    expect(p).toMatchObject({ version: 1, status: "ACTIVE", executionDisabled: false, maxSlippageBps: 100, assetMode: "ANY", recipientMode: "ANY" });
    expect(Object.keys(p.networks)).toContain("base");
    const ex = await approved();
    expect(ex.state).toBe("AWAITING_DEPOSIT");
    expect(await reservation(ex.id)).toMatchObject({ status: "RESERVED", amountUsd: "50.0" });
    const stages = (await h.guard.decisionsFor(u.userId, ex.id)).map((d) => `${d.stage}:${d.outcome}`);
    expect(stages).toEqual(["QUOTE:REQUIRES_APPROVAL", "QUOTE:REQUIRES_APPROVAL", "FIRM_QUOTE:REQUIRES_APPROVAL", "APPROVAL:ALLOWED"]);
  });
  it("concurrent first use creates exactly one policy", async () => {
    const v = await Promise.all([h.guard.view(u.userId), h.guard.view(u.userId), h.guard.view(u.userId)]);
    expect(new Set(v.map((x) => x.policy.version))).toEqual(new Set([1]));
    const hist = await h.db.select().from(guardPolicyHistory);
    expect(hist.filter((r) => r.userId === u.userId)).toHaveLength(1);
  });
});

describe("enforcement at every step", () => {
  it("plan: a disallowed network blocks before anything is quoted or created", async () => {
    await update({ networks: [{ network: "solana", allowSource: true, allowDestination: false, disabled: false }] });
    const quotes = () => h.fake.calls.filter((c) => c.path.startsWith("/v0/quote")).length;
    const before = quotes();
    expect(await code(create())).toBe("GUARD_BLOCKED");
    expect(quotes()).toBe(before);
    expect(await h.db.execute(sql`select count(*)::int as n from spak_executions`).then((r) => (r as unknown as { rows: { n: number }[] }).rows[0].n)).toBe(0);
    const [d] = await h.db.select().from(guardDecisions).where(sql`${guardDecisions.stage} = 'PLAN'`);
    expect(d).toMatchObject({ outcome: "BLOCKED", policyVersion: 2, executionId: null });
  });
  it("plan: slippage above the user's maximum is refused, never raised to fit", async () => {
    await update({ maxSlippageBps: 50 });
    expect(await code(create())).toBe("GUARD_BLOCKED");
  });
  it("quote: the quoted USD value is checked against limits and the blocked quote is rejected", async () => {
    await update({ maxTransactionUsd: "40" });
    expect(await code(create())).toBe("GUARD_BLOCKED");
    const [q] = await h.db.execute(sql`select status from spak_quotes`).then((r) => (r as unknown as { rows: { status: string }[] }).rows);
    expect(q.status).toBe("REJECTED");
  });
  it("quote: an unknown USD value fails closed", async () => {
    h.fake.usdIn = null;
    expect(await code(create())).toBe("GUARD_BLOCKED");
  });
  it("firm quote: a policy change after the indicative quote blocks the firm quote, and no deposit address is shown", async () => {
    const x = await create();
    await update({ maxTransactionUsd: "40" });
    expect(await code(firm(x))).toBe("GUARD_BLOCKED");
    expect((await h.records.get(x.execution.id))!.firmQuoteId).toBeNull();
  });
  it("approval: a policy change after the firm quote is applied; nothing is approved or reserved", async () => {
    const x = await create();
    const f = await firm(x);
    await update({ maxTransactionUsd: "40" });
    expect(await code(approve(x, f.id))).toBe("GUARD_BLOCKED");
    const row = (await h.records.get(x.execution.id))!;
    expect(row).toMatchObject({ state: "AWAITING_APPROVAL", approvedAt: null });
    expect(await h.records.activeApproval(row.id)).toBeNull();
    expect(await reservation(row.id)).toBeNull();
    // The blocked decision is on record even though the approval transaction rolled back.
    expect((await h.guard.decisionsFor(u.userId, row.id)).at(-1)).toMatchObject({ stage: "APPROVAL", outcome: "BLOCKED", policyVersion: 2 });
    // Relaxing the policy again lets the same reviewed quote be approved, against the latest version.
    await update({ maxTransactionUsd: "60" });
    expect((await approve(x, f.id)).execution.state).toBe("AWAITING_DEPOSIT");
    expect((await h.guard.decisionsFor(u.userId, row.id)).at(-1)).toMatchObject({ stage: "APPROVAL", outcome: "ALLOWED", policyVersion: 3 });
  });
  it("approval: pausing Guard after review blocks approval", async () => {
    const x = await create();
    const f = await firm(x);
    await h.guard.pause(u.userId, "REQUESTS");
    expect(await code(approve(x, f.id))).toBe("GUARD_BLOCKED");
  });
  it("approval requires that Guard checked that exact firm quote", async () => {
    const x = await create();
    const f = await firm(x);
    await h.db.delete(guardDecisions).where(sql`${guardDecisions.quoteId} = ${f.id}`);
    expect(await code(approve(x, f.id))).toBe("GUARD_BLOCKED");
  });
  it("no bypass: the approval state change itself refuses to run without a Guard reservation", async () => {
    const x = await create();
    await firm(x);
    expect(await code(h.records.transition(x.execution.id, "AWAITING_APPROVAL", "AWAITING_DEPOSIT", "direct"))).toBe("GUARD_BLOCKED");
    expect(await state(x.execution.id)).toBe("AWAITING_APPROVAL");
  });
  it("recipients: approved-only mode needs the recipient approved on the destination network", async () => {
    const R = "0x2222222222222222222222222222222222222222";
    await update({ recipientMode: "APPROVED_ONLY" });
    const send = `Send 5 USDC on Base to ${R} on Arbitrum`;
    expect(await code(create(send))).toBe("GUARD_BLOCKED");
    await h.guard.addRecipient(u.userId, { version: (await settings()).version, network: "base", address: R });
    expect(await code(create(send))).toBe("GUARD_BLOCKED"); // approved on Base only
    await h.guard.addRecipient(u.userId, { version: (await settings()).version, network: "arbitrum", address: R.toUpperCase().replace("0X", "0x") });
    expect(await code(create(send))).toBe("OK");
  });
  it("blocked tokens by canonical id", async () => {
    await update({ assets: [{ assetId: USDC_BASE, rule: "BLOCK" }] });
    expect(await code(create())).toBe("GUARD_BLOCKED");
  });
});

describe("spending reservations", () => {
  it("concurrent approvals cannot overspend the daily limit: exactly one wins", async () => {
    await update({ dailyLimitUsd: "80" });
    const a = await create(swap(50)), b = await create(swap(51));
    const [fa, fb] = [await firm(a), await firm(b)];
    const r = await Promise.all([code(approve(a, fa.id)), code(approve(b, fb.id))]);
    expect(r.sort()).toEqual(["GUARD_BLOCKED", "OK"]);
    const rows = await h.db.select().from(guardReservations);
    expect(rows.filter((x) => x.status === "RESERVED")).toHaveLength(1);
  });
  it("is idempotent: the same approval twice makes one reservation", async () => {
    const x = await create();
    const f = await firm(x);
    const r = await Promise.all([code(approve(x, f.id)), code(approve(x, f.id))]);
    expect(r).toContain("OK");
    expect((await h.db.select().from(guardReservations))).toHaveLength(1);
    expect(await code(approve(x, f.id))).toBe("OK"); // replay returns the existing approval
    expect((await h.db.select().from(guardReservations))).toHaveLength(1);
  });
  it("a quote never counts as spending; only an approval does", async () => {
    await update({ dailyLimitUsd: "80" });
    const a = await create(swap(50));
    await firm(a);
    expect((await h.guard.spending(u.userId)).dayUsd).toBe("0");
    expect(await code(approved(swap(51)))).toBe("OK");
  });
  it("cancelled, expired and refunded transfers release spending; failed and unknown keep it", async () => {
    await update({ dailyLimitUsd: "80" });
    const a = await approved(swap(50));
    expect(await code(approved(swap(51)))).toBe("GUARD_BLOCKED");
    await h.svc.cancel({ userId: u.userId, executionId: a.id });
    expect(await reservation(a.id)).toMatchObject({ status: "RELEASED" });
    const b = await approved(swap(51));
    await h.records.transition(b.id, "AWAITING_DEPOSIT", "FAILED", "test");
    expect(await reservation(b.id)).toMatchObject({ status: "RESERVED" });
    expect(await code(approved(swap(52)))).toBe("GUARD_BLOCKED");
  });
  it("rolling windows: after 24 hours the daily limit frees up, the weekly limit still counts", async () => {
    await update({ dailyLimitUsd: "80", weeklyLimitUsd: "120" });
    await approved(swap(50));
    h.clock.now += 24 * 3600_000 + 1;
    expect(await h.guard.spending(u.userId)).toEqual({ dayUsd: "0", weekUsd: "50", monthUsd: "50" });
    await approved(swap(51));
    h.clock.now += 1;
    expect(await code(approved(swap(52)))).toBe("GUARD_BLOCKED"); // 150 > weekly 120
  });

  // Every path through the state machine after approval, and what it does to the reservation.
  const PATHS: [ExecutionState[], "RESERVED" | "CONSUMED" | "RELEASED"][] = [
    [["CANCELLED"], "RELEASED"],
    [["EXPIRED"], "RELEASED"],
    [["PROCESSING"], "RESERVED"],
    [["PROCESSING", "VERIFYING_DESTINATION"], "RESERVED"],
    [["PROCESSING", "VERIFYING_DESTINATION", "COMPLETED"], "CONSUMED"],
    [["VERIFYING_DESTINATION", "COMPLETED"], "CONSUMED"],
    [["FAILED"], "RESERVED"],
    [["FAILED", "REFUNDING"], "RESERVED"],
    [["FAILED", "REFUNDING", "REFUNDED"], "RELEASED"],
    [["PROCESSING", "REFUNDING", "REFUNDED"], "RELEASED"],
    [["REFUNDING", "UNKNOWN"], "RESERVED"],
    [["UNKNOWN"], "RESERVED"],
    [["UNKNOWN", "EXPIRED"], "RELEASED"],
    [["UNKNOWN", "PROCESSING", "VERIFYING_DESTINATION", "COMPLETED"], "CONSUMED"],
    [["FAILED", "UNKNOWN", "REFUNDING", "REFUNDED"], "RELEASED"],
  ];
  for (const [path, expected] of PATHS) {
    it(`AWAITING_DEPOSIT → ${path.join(" → ")}: ${expected}`, async () => {
      const ex = await approved();
      let from: ExecutionState = "AWAITING_DEPOSIT";
      for (const to of path) { expect(await h.records.transition(ex.id, from, to, "test")).not.toBeNull(); from = to; }
      expect(await reservation(ex.id)).toMatchObject({ status: expected });
      const counted = (await h.guard.spending(u.userId)).dayUsd;
      expect(counted).toBe(expected === "RELEASED" ? "0" : "50");
    });
  }
  it("a settled reservation is never re-opened by a later transition", async () => {
    const ex = await approved();
    await h.records.transition(ex.id, "AWAITING_DEPOSIT", "UNKNOWN", "t");
    await h.records.transition(ex.id, "UNKNOWN", "EXPIRED", "t");
    const r = await reservation(ex.id);
    expect(r).toMatchObject({ status: "RELEASED" });
    expect(r!.settledAt).not.toBeNull();
  });
});

describe("pause and emergency controls", () => {
  const fund = () => h.chain.setBalance("base", u.evm.address, 100_000_000n, USDC);
  const prep = async (id: string) => h.deposits.prepare({ userId: u.userId, executionId: id, wallets: await u.wallets() });
  it("pausing stops new requests but an approved transfer can still be deposited and tracked", async () => {
    const ex = await approved();
    await h.guard.pause(u.userId, "REQUESTS");
    expect(await code(create(swap(60)))).toBe("GUARD_BLOCKED");
    fund();
    expect(await code(prep(ex.id))).toBe("OK");
    expect(await code(h.trackingService.view(u.userId, ex.id))).toBe("OK");
  });
  it("disabling all execution also stops deposit preparation; resume restores it", async () => {
    const ex = await approved();
    await h.guard.pause(u.userId, "ALL");
    fund();
    expect(await code(prep(ex.id))).toBe("GUARD_BLOCKED");
    await h.guard.resume(u.userId, (await settings()).version);
    expect(await code(prep(ex.id))).toBe("OK");
  });
  it("disabling the source network stops deposit preparation for an approved transfer", async () => {
    const ex = await approved();
    await update({ networks: [{ network: "base", allowSource: true, allowDestination: true, disabled: true }] });
    fund();
    expect(await code(prep(ex.id))).toBe("GUARD_BLOCKED");
  });
  it("a deposit needs a live reservation: after a release, no deposit instructions", async () => {
    const ex = await approved();
    await h.db.update(guardReservations).set({ status: "RELEASED" }).where(sql`${guardReservations.executionId} = ${ex.id}`);
    fund();
    expect(await code(prep(ex.id))).toBe("GUARD_BLOCKED");
  });
  it("pause works without a version and is recorded in history", async () => {
    await h.guard.pause(u.userId, "REQUESTS");
    const hist = await h.guard.history(u.userId);
    expect(hist.map((x) => x.action)).toEqual(["PAUSED", "CREATED_DEFAULT"]);
  });
});

describe("settings: ownership, versions, validation, history", () => {
  it("one user cannot read or change another user's settings by id", async () => {
    const other = await h.newUser();
    const v = await settings();
    await h.guard.addRecipient(u.userId, { version: v.version, network: "base", address: "0x3333333333333333333333333333333333333333" });
    const rid = (await settings()).recipients[0].id;
    expect(await code(h.guard.removeRecipient(other.userId, rid, (await settings(other)).version))).toBe("GUARD_RECIPIENT_NOT_FOUND");
    expect((await settings()).recipients).toHaveLength(1);
    expect((await settings(other)).recipients).toHaveLength(0);
    const ex = await approved();
    expect(await h.guard.decisionsFor(other.userId, ex.id)).toEqual([]);
    expect(await h.guard.reservationFor(other.userId, ex.id)).toBeNull();
  });
  it("a stale version is refused; every change bumps the version and is in history", async () => {
    const v1 = (await settings()).version;
    await h.guard.update(u.userId, { version: v1, dailyLimitUsd: "100" });
    expect(await code(h.guard.update(u.userId, { version: v1, dailyLimitUsd: "200" }))).toBe("GUARD_VERSION_CONFLICT");
    expect((await settings()).limits.dailyUsd).toBe("100");
    const [last] = await h.guard.history(u.userId);
    expect(last).toMatchObject({ version: v1 + 1, action: "UPDATED", actor: `user:${u.userId}`, changes: { dailyLimitUsd: { from: null, to: "100" } } });
  });
  it("concurrent edits with the same version: exactly one applies", async () => {
    const v = (await settings()).version;
    const r = await Promise.all([code(h.guard.update(u.userId, { version: v, dailyLimitUsd: "100" })), code(h.guard.update(u.userId, { version: v, dailyLimitUsd: "200" }))]);
    expect(r.sort()).toEqual(["GUARD_VERSION_CONFLICT", "OK"]);
  });
  it("malformed or unsafe settings are refused", async () => {
    const v = (await settings()).version;
    const bad = [
      { maxTransactionUsd: "-5" }, { maxTransactionUsd: "abc" }, { maxTransactionUsd: "0" }, { maxTransactionUsd: "1000.01" },
      { minTransactionUsd: "60", maxTransactionUsd: "50" }, { dailyLimitUsd: "500", weeklyLimitUsd: "100" },
      { maxSlippageBps: 0 }, { maxSlippageBps: 9000 }, { networks: [{ network: "dogechain", allowSource: true, allowDestination: true, disabled: false }] },
      { assets: [{ assetId: "USDC", rule: "ALLOW" }] }, { assets: [{ assetId: USDC_BASE, rule: "ALLOW" }, { assetId: USDC_BASE, rule: "BLOCK" }] },
      { userId: "usr_someoneelse" }, { recipientMode: "EVERYONE" },
    ];
    for (const b of bad) expect(await code(h.guard.update(u.userId, { version: v, ...b })), JSON.stringify(b)).toBe("GUARD_INVALID_SETTING");
    expect(await code(h.guard.update(u.userId, { dailyLimitUsd: "5" }))).toBe("GUARD_INVALID_SETTING"); // no version
    expect((await settings()).version).toBe(v);
  });
  it("recipient addresses are validated for their network", async () => {
    const v = (await settings()).version;
    expect(await code(h.guard.addRecipient(u.userId, { version: v, network: "base", address: "not-an-address" }))).toBe("GUARD_INVALID_SETTING");
    expect(await code(h.guard.addRecipient(u.userId, { version: v, network: "solana", address: "0x3333333333333333333333333333333333333333" }))).toBe("GUARD_INVALID_SETTING");
    await h.guard.addRecipient(u.userId, { version: v, network: "base", address: "0x3333333333333333333333333333333333333333" });
    expect(await code(h.guard.addRecipient(u.userId, { version: v + 1, network: "base", address: "0x3333333333333333333333333333333333333333" }))).toBe("GUARD_INVALID_SETTING");
  });
});

describe("fail closed", () => {
  it("when Guard cannot read the policy, nothing proceeds", async () => {
    const x = await create();
    const f = await firm(x);
    const orig = h.guard.load.bind(h.guard);
    h.guard.load = async () => { throw new Error("connection reset"); };
    expect(await code(create(swap(60)))).toBe("GUARD_UNAVAILABLE");
    expect(await code(approve(x, f.id))).toBe("GUARD_UNAVAILABLE");
    expect((await h.records.get(x.execution.id))!).toMatchObject({ state: "AWAITING_APPROVAL", approvedAt: null });
    h.guard.load = orig;
  });
  it("when the stored policy is corrupt, nothing proceeds", async () => {
    await settings();
    await h.db.execute(sql`update spak_guard_policies set daily_limit_usd = 'lots' where user_id = ${u.userId}`);
    expect(await code(create())).toBe("GUARD_UNAVAILABLE");
  });
  it("when the decision cannot be recorded, nothing proceeds", async () => {
    const orig = h.guard.record.bind(h.guard);
    h.guard.record = async () => { throw new Error("disk full"); };
    expect(await code(create())).toBe("GUARD_UNAVAILABLE");
    h.guard.record = orig;
  });
  it("when spending cannot be read at approval, nothing is approved", async () => {
    const x = await create();
    const f = await firm(x);
    const orig = h.guard.spending.bind(h.guard);
    h.guard.spending = async () => { throw new Error("timeout"); };
    expect(await code(approve(x, f.id))).toBe("GUARD_UNAVAILABLE");
    h.guard.spending = orig;
    expect(await reservation(x.execution.id)).toBeNull();
  });
});

describe("migration 0009 backfill", () => {
  it("gives transfers approved before Guard the reservation they would have had, by state, and is idempotent", async () => {
    const { readFileSync } = await import("node:fs");
    const file = readFileSync("src/database/migrations/0009_guard_policies.sql", "utf8");
    const backfill = file.slice(file.indexOf("-- guard-backfill"));
    const live = await approved(swap(50));
    const done = await approved(swap(51));
    await h.records.transition(done.id, "AWAITING_DEPOSIT", "CANCELLED", "t");
    await h.db.delete(guardReservations);
    await h.db.execute(sql.raw(backfill));
    await h.db.execute(sql.raw(backfill));
    expect(await reservation(live.id)).toMatchObject({ status: "RESERVED", amountUsd: "50.0", decisionId: "migration-0009" });
    expect(await reservation(done.id)).toMatchObject({ status: "RELEASED" });
    expect(await h.db.select().from(guardReservations)).toHaveLength(2);
    h.chain.setBalance("base", u.evm.address, 100_000_000n, USDC);
    expect(await code(h.deposits.prepare({ userId: u.userId, executionId: live.id, wallets: await u.wallets() }))).toBe("OK");
  });
});

describe("audit regressions", () => {
  it("a user with no policy row (approved before Guard) still gets deposit instructions", async () => {
    const ex = await approved();
    await h.db.execute(sql`delete from spak_guard_policies where user_id = ${u.userId}`);
    h.chain.setBalance("base", u.evm.address, 100_000_000n, USDC);
    expect(await code(h.deposits.prepare({ userId: u.userId, executionId: ex.id, wallets: await u.wallets() }))).toBe("OK");
  });
  it("re-approving an execution that already holds a reservation is still refused when Guard now blocks", async () => {
    const x = await create();
    const f = await firm(x);
    await approve(x, f.id);
    await h.guard.pause(u.userId, "REQUESTS");
    const row = (await h.records.get(x.execution.id))!;
    const quote = (await h.records.getQuote(f.id))!;
    await expect(h.db.transaction(async (tx) => h.guard.reserveInTx(tx as never, row, quote))).rejects.toThrow(/paused/);
  });
  it("disabling all execution never stops recording a deposit the user already sent", async () => {
    const ex = await approved();
    await h.guard.pause(u.userId, "ALL");
    const txHash = `0x${"ab".repeat(32)}`;
    h.chain.evmTx(txHash, { from: u.evm.address, to: USDC, logs: [{ address: USDC, from: u.evm.address, to: ex.depositAddress!, amount: 50_000_000n }] });
    const r = await code(h.deposits.submitManual({ userId: u.userId, executionId: ex.id, txHash, wallets: await u.wallets() }));
    expect(r).not.toMatch(/GUARD/);
  });
  it("provider USD values that are not plain numbers fail closed", async () => {
    const { cleanUsd } = await import("@/guard");
    expect(cleanUsd("1,234.56")).toBeNull();
    expect(cleanUsd("1.2e3")).toBeNull();
    expect(cleanUsd("50.0")).toBe("50.0");
    h.fake.usdIn = "1,234.56";
    expect(await code(create())).toBe("GUARD_BLOCKED");
  });
});
