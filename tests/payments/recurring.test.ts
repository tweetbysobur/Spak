/**
 * SPak Payments, recurring schedules. Real SQL (PGlite, or PostgreSQL 16 with SPAK_TEST_PG_URL for real row locks);
 * MOCKED NEAR Intents provider and chains. A schedule prepares payments; the user's wallet signs every deposit.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { base64, hex } from "@scure/base";
import { agents, deposits as depositTable, executions, paymentOccurrences } from "@/database/schema";
import { OWNERSHIP_VALID_MS } from "@/agents/service";
import { buildReceipt } from "@/tracking/receipt";
import { approval, harness } from "../execution/harness";
import { statusPayload } from "../execution/fake-1click";
import { nearWallet } from "../auth/keys";

const USDC_BASE = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
const USDC_ARB = "0xaf88d065e77c8cc2239327c5edb3a432268e5831";
const VAULT = "0x2e6ad9e6d59bb4585ea0e6762c3b637dde29dad2";
const PAYEE = "0x1111111111111111111111111111111111111111";
const DAY = 86_400_000;

let h: Awaited<ReturnType<typeof harness>>;
let u: Awaited<ReturnType<Awaited<ReturnType<typeof harness>>["newUser"]>>;
beforeEach(async () => {
  h = await harness(); u = await h.newUser();
  h.chain.setBalance("base", u.evm.address, 10_000_000_000n, USDC_BASE);
  h.clock.now = Date.parse("2026-11-10T12:00:00Z");
});
const code = async (p: Promise<unknown>) => { try { await p; return "OK"; } catch (e) { return (e as { code?: string }).code ?? (e as Error).message; } };
const at = (iso: string) => { h.clock.now = Date.parse(iso); };
const base = (o: Record<string, unknown> = {}) => ({
  name: "Rent", sourceNetwork: "base", sourceAssetId: `base:${USDC_BASE}`, destinationNetwork: "arbitrum", destinationAssetId: `arbitrum:${USDC_ARB}`,
  amount: "50", recipient: PAYEE, frequency: "WEEKLY", startDate: "2026-11-11", timezone: "UTC", ...o,
});
const create = (o: Record<string, unknown> = {}, who = u) => h.schedules.create(who.userId, base(o));
const occ = async (scheduleId: string) => (await h.schedules.view(u.userId, scheduleId)).occurrences;
const execOf = async (id: string) => (await h.db.select().from(executions).where(eq(executions.id, id)))[0];

describe("creating a schedule", () => {
  it("validates on the server and shows the summary, next date and an active status", async () => {
    const s = await create();
    expect(s).toMatchObject({ status: "ACTIVE", nextDueDate: "2026-11-11", amount: "50", recipient: PAYEE, description: "Every week, from 2026-11-11, until you cancel", occurrences: [] });
  });
  it.each([
    ["no name", { name: "" }], ["zero amount", { amount: "0" }], ["text amount", { amount: "fifty" }], ["unknown network", { sourceNetwork: "dogechain" }],
    ["token on the wrong network", { sourceAssetId: `arbitrum:${USDC_ARB}` }], ["unknown frequency", { frequency: "HOURLY" }], ["start in the past", { startDate: "2026-11-09" }],
    ["end before start", { endDate: "2026-11-10" }], ["bad timezone", { timezone: "Mars/Olympus" }], ["unknown field", { extra: 1 }],
  ])("refuses %s", async (_n, patch) => expect(await code(create(patch))).toBe("SCHEDULE_BAD_REQUEST"));
  it("refuses a payee that does not fit the destination network, and a payment to the user's own wallet", async () => {
    expect(await code(create({ recipient: "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin" }))).toBe("SCHEDULE_PLAN_INVALID");
    expect(await code(create({ recipient: u.evm.address }))).toBe("SCHEDULE_PLAN_INVALID");
  });
  it("refuses another user's Agent", async () => {
    expect(await code(create({ agentId: `agt_${"a".repeat(24)}` }))).toBe("SCHEDULE_BAD_REQUEST");
  });
});

describe("preparing due payments", () => {
  it("nothing before the date; on the date one payment is prepared with a fresh quote, waiting for the user's approval and wallet signature", async () => {
    const s = await create();
    expect((await h.schedules.processDue()).created).toBe(0);
    at("2026-11-11T00:00:01Z");
    const r = await h.schedules.processDue();
    expect(r).toMatchObject({ created: 1, prepared: 1, failed: 0 });
    const [o] = await occ(s.id);
    expect(o).toMatchObject({ seq: 0, dueDate: "2026-11-11", status: "PREPARED", executionState: "AWAITING_APPROVAL", action: "SIGN" });
    const x = await execOf(o.executionId!);
    expect(x).toMatchObject({ recipient: PAYEE, recipientKind: "EXTERNAL", sourceNetwork: "base", destinationNetwork: "arbitrum", currentQuoteId: expect.any(String) });
    expect(await h.db.select().from(depositTable).where(eq(depositTable.executionId, x.id))).toHaveLength(0); // nothing for the wallet yet; no signing
    expect((await h.schedules.view(u.userId, s.id)).nextDueDate).toBe("2026-11-18");
  });
  it("every occurrence gets its own execution and its own fresh quote", async () => {
    const s = await create();
    at("2026-11-11T01:00:00Z"); await h.schedules.processDue();
    at("2026-11-18T01:00:00Z"); await h.schedules.processDue();
    const [b, a] = await occ(s.id);
    expect(a.executionId).not.toBe(b.executionId);
    const [xa, xb] = [await execOf(a.executionId!), await execOf(b.executionId!)];
    expect(xa.currentQuoteId).not.toBe(xb.currentQuoteId);
  });
  it("running the scheduler again on the same day prepares nothing more", async () => {
    const s = await create();
    at("2026-11-11T01:00:00Z");
    await h.schedules.processDue(); await h.schedules.processDue(); await h.schedules.processDue();
    expect(await occ(s.id)).toHaveLength(1);
  });
  it("concurrent scheduler runs: exactly one occurrence and one execution per date", async () => {
    const s = await create();
    at("2026-11-11T01:00:00Z");
    await Promise.all(Array.from({ length: 6 }, () => h.schedules.processDue()));
    const rows = await h.db.select().from(paymentOccurrences).where(eq(paymentOccurrences.scheduleId, s.id));
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("PREPARED");
    const xs = await h.db.select().from(executions).where(eq(executions.userId, u.userId));
    expect(xs).toHaveLength(1);
  });
  it("a preparation interrupted mid-way (lease lapsed) resumes with the same idempotency key: one execution, not two", async () => {
    const s = await create();
    at("2026-11-11T01:00:00Z");
    await h.schedules.processDue();
    const [o] = await occ(s.id);
    // Simulate a crash after the execution was created but before the occurrence was marked PREPARED.
    await h.db.update(paymentOccurrences).set({ status: "PREPARING", executionId: null, leaseUntil: new Date(h.now().getTime() - 1) }).where(eq(paymentOccurrences.id, o.id));
    await h.schedules.processDue();
    const [again] = await occ(s.id);
    expect(again.executionId).toBe(o.executionId);
    expect(await h.db.select().from(executions).where(eq(executions.userId, u.userId))).toHaveLength(1);
  });
  it("a schedule ends after its last payment", async () => {
    const s = await create({ frequency: "DAILY", maxOccurrences: 2 });
    at("2026-11-11T01:00:00Z"); await h.schedules.processDue();
    at("2026-11-12T01:00:00Z"); await h.schedules.processDue();
    at("2026-11-13T01:00:00Z"); await h.schedules.processDue();
    const v = await h.schedules.view(u.userId, s.id);
    expect(v.status).toBe("FINISHED");
    expect(v.nextDueDate).toBeNull();
    expect(v.occurrences).toHaveLength(2);
  });
});

describe("missed payments", () => {
  it("when several dates passed, only the latest is prepared; the earlier ones are visible as missed", async () => {
    const s = await create();
    at("2026-11-25T09:00:00Z");
    await h.schedules.processDue();
    const o = await occ(s.id);
    expect(o.map((x) => [x.dueDate, x.status])).toEqual([["2026-11-25", "PREPARED"], ["2026-11-18", "MISSED"], ["2026-11-11", "MISSED"]]);
    expect(o[1].action).toBe("RECOVER");
    expect(await h.db.select().from(executions).where(eq(executions.userId, u.userId))).toHaveLength(1);
  });
  it("a missed date can be prepared on request; retrying twice at once still makes one payment", async () => {
    const s = await create();
    at("2026-11-18T09:00:00Z");
    await h.schedules.processDue();
    const missed = (await occ(s.id)).find((x) => x.status === "MISSED")!;
    const out = await Promise.all([code(h.schedules.retry(u.userId, missed.id)), code(h.schedules.retry(u.userId, missed.id))]);
    expect(out.filter((x) => x === "OK").length).toBeGreaterThanOrEqual(1);
    const after = (await occ(s.id)).find((x) => x.id === missed.id)!;
    expect(after).toMatchObject({ status: "PREPARED", action: "SIGN" });
    expect(await h.db.select().from(executions).where(eq(executions.userId, u.userId))).toHaveLength(2);
    expect(await code(h.schedules.retry(u.userId, missed.id))).toBe("OCCURRENCE_NOT_RETRYABLE"); // still live
  });
  it("a missed date can be skipped; skipped and live payments cannot be skipped again", async () => {
    const s = await create();
    at("2026-11-18T09:00:00Z");
    await h.schedules.processDue();
    const [live, missed] = await occ(s.id);
    expect((await h.schedules.skip(u.userId, missed.id)).occurrences.find((x) => x.id === missed.id)!.status).toBe("SKIPPED");
    expect(await code(h.schedules.skip(u.userId, missed.id))).toBe("OCCURRENCE_NOT_RETRYABLE");
    expect(await code(h.schedules.skip(u.userId, live.id))).toBe("OCCURRENCE_NOT_RETRYABLE");
  });
});

describe("pause, resume and cancel", () => {
  it("a paused schedule prepares nothing; resuming keeps the configuration and starts from the next date, without back-filling", async () => {
    const s = await create();
    await h.schedules.pause(u.userId, s.id);
    at("2026-11-26T09:00:00Z");
    await h.schedules.processDue();
    expect(await occ(s.id)).toHaveLength(0);
    const r = await h.schedules.resume(u.userId, s.id);
    expect(r).toMatchObject({ status: "ACTIVE", nextDueDate: "2026-12-02", amount: "50", recipient: PAYEE, recurrence: { frequency: "WEEKLY", startDate: "2026-11-11" } });
    await h.schedules.processDue();
    expect(await occ(s.id)).toHaveLength(0);
    at("2026-12-02T00:30:00Z"); await h.schedules.processDue();
    expect((await occ(s.id)).map((x) => x.dueDate)).toEqual(["2026-12-02"]);
  });
  it("pause and resume refuse the wrong state", async () => {
    const s = await create();
    expect(await code(h.schedules.resume(u.userId, s.id))).toBe("SCHEDULE_INVALID_STATE");
    await h.schedules.pause(u.userId, s.id);
    expect(await code(h.schedules.pause(u.userId, s.id))).toBe("SCHEDULE_INVALID_STATE");
  });
  it("a cancelled schedule never prepares another payment, and its missed dates cannot be prepared", async () => {
    const s = await create();
    at("2026-11-18T09:00:00Z"); await h.schedules.processDue();
    const prepared = (await occ(s.id)).find((x) => x.status === "PREPARED")!;
    await h.schedules.cancel(u.userId, s.id);
    const v = await h.schedules.view(u.userId, s.id);
    expect(v).toMatchObject({ status: "CANCELLED", nextDueDate: null });
    expect(v.occurrences.find((x) => x.dueDate === "2026-11-11")!.status).toBe("CANCELLED");
    expect(v.occurrences.find((x) => x.id === prepared.id)!.status).toBe("PREPARED"); // already prepared: the user decides
    at("2027-01-30T09:00:00Z"); await h.schedules.processDue();
    expect(await occ(s.id)).toHaveLength(2);
    expect(await code(h.schedules.retry(u.userId, v.occurrences[1].id))).toBe("SCHEDULE_INVALID_STATE");
    expect(await code(h.schedules.resume(u.userId, s.id))).toBe("SCHEDULE_INVALID_STATE");
  });
  it("cancelling between occurrence creation and preparation leaves it cancelled, with no execution", async () => {
    const s = await create();
    at("2026-11-11T01:00:00Z");
    await h.schedules.processDue();
    const [o] = await occ(s.id);
    await h.db.update(paymentOccurrences).set({ status: "PREPARING", executionId: null, leaseUntil: null }).where(eq(paymentOccurrences.id, o.id));
    await h.db.delete(executions).where(eq(executions.id, o.executionId!)).catch(() => undefined);
    await h.schedules.cancel(u.userId, s.id);
    await h.schedules.processDue();
    expect((await occ(s.id))[0].status).toBe("CANCELLED");
  });
});

describe("Guard, Agent and the wallet signature", () => {
  const settings = async () => (await h.guard.view(u.userId)).policy;
  it("Guard is checked again for every payment: a payee blocked after the schedule was made fails that occurrence with no execution", async () => {
    const s = await create();
    await h.guard.update(u.userId, { version: (await settings()).version, recipientMode: "APPROVED_ONLY" });
    at("2026-11-11T01:00:00Z"); await h.schedules.processDue();
    const [o] = await occ(s.id);
    expect(o).toMatchObject({ status: "FAILED", failureCode: "GUARD_BLOCKED", executionId: null, action: "RECOVER" });
    await h.guard.addRecipient(u.userId, { version: (await settings()).version, network: "arbitrum", address: PAYEE });
    expect((await h.schedules.retry(u.userId, o.id)).occurrences[0]).toMatchObject({ status: "PREPARED", action: "SIGN" });
  });
  it("Guard paused: the occurrence fails and the user can retry later", async () => {
    const s = await create();
    await h.guard.pause(u.userId, "ALL");
    at("2026-11-11T01:00:00Z"); await h.schedules.processDue();
    expect((await occ(s.id))[0]).toMatchObject({ status: "FAILED", executionId: null });
  });
  async function agentWithGrant(addresses: { network: string; address: string }[]) {
    const owner = nearWallet(`o${randomBytes(6).toString("hex")}.testnet`);
    const agentId = `agt_${randomBytes(12).toString("hex")}`;
    const now = h.now();
    await h.db.insert(agents).values({ id: agentId, userId: u.userId, displayName: "Agent", status: "VERIFIED", ownerNetwork: "near", ownerAccountId: owner.address, ownerPublicKey: owner.publicKey,
      verificationMethod: "NEAR_NEP413_FULL_ACCESS_KEY", attestationHash: "a".repeat(64), verifiedAt: now, verificationExpiresAt: new Date(now.getTime() + OWNERSHIP_VALID_MS), createdAt: now, updatedAt: now });
    h.nearKeys.set(`${owner.address}|${owner.publicKey}`, "FullAccess");
    const c = await h.grants.prepare(u.userId, agentId, { maxTransactionUsd: "100", dailyLimitUsd: "200", maxTransactions: 5, durationHours: 168, sourceNetworks: ["base"], destinationNetworks: ["arbitrum"],
      assets: [`base:${USDC_BASE}`, `arbitrum:${USDC_ARB}`], recipients: { self: false, addresses } }, "spak.test");
    const s = await owner.sign(c.message, hex.encode(base64.decode(c.nonce)), c.recipient);
    await h.grants.confirm(u.userId, agentId, { challengeId: c.challengeId, accountId: owner.address, publicKey: s.publicKey, signature: s.signature, domain: "spak.test" });
    return agentId;
  }
  it("with the Agent: it approves the quote within its signed permission; the deposit still waits for the user's wallet", async () => {
    const agentId = await agentWithGrant([{ network: "arbitrum", address: PAYEE }]);
    const s = await create({ agentId });
    at("2026-11-11T01:00:00Z"); await h.schedules.processDue();
    const [o] = await occ(s.id);
    expect(o).toMatchObject({ status: "PREPARED", executionState: "AWAITING_DEPOSIT", action: "SIGN", failureCode: null });
    const p = await h.deposits.prepare({ userId: u.userId, executionId: o.executionId!, wallets: await u.wallets() });
    expect(p.transaction.family).toBe("evm"); // built for the user's wallet to sign; SPak signs nothing
    expect(p.deposit.state).not.toBe("CONFIRMED");
  });
  it("with the Agent but outside its permission: prepared for the user to approve, with the reason", async () => {
    const agentId = await agentWithGrant([{ network: "arbitrum", address: "0x3333333333333333333333333333333333333333" }]);
    const s = await create({ agentId });
    at("2026-11-11T01:00:00Z"); await h.schedules.processDue();
    const [o] = await occ(s.id);
    expect(o).toMatchObject({ status: "PREPARED", executionState: "AWAITING_APPROVAL", action: "SIGN", failureCode: "AGENT_APPROVAL_REQUIRED" });
  });
});

describe("expiry, recovery and receipts", () => {
  it("an attempt that expires unsigned can be prepared again: a new execution and quote, the old attempt kept in history", async () => {
    const s = await create();
    at("2026-11-11T01:00:00Z"); await h.schedules.processDue();
    const [o] = await occ(s.id);
    await h.svc.cancel({ userId: u.userId, executionId: o.executionId! });
    expect((await occ(s.id))[0]).toMatchObject({ executionState: "CANCELLED", action: "RECOVER" });
    await h.schedules.retry(u.userId, o.id);
    const [again] = await occ(s.id);
    expect(again.executionId).not.toBe(o.executionId);
    expect(again).toMatchObject({ attempt: 2, status: "PREPARED", action: "SIGN" });
    const [row] = await h.db.select().from(paymentOccurrences).where(eq(paymentOccurrences.id, o.id));
    expect(row.attempts).toEqual([expect.objectContaining({ attempt: 1, executionId: o.executionId, executionState: "CANCELLED" })]);
  });
  it("a scheduled payment completes only after verified delivery, then has a payment receipt", async () => {
    const s = await create();
    at("2026-11-11T01:00:00Z"); await h.schedules.processDue();
    const [o] = await occ(s.id);
    const wallets = await u.wallets();
    const x = await h.svc.details(o.executionId!, u.userId);
    const f = await h.svc.firmQuote({ userId: u.userId, executionId: x.id, quoteId: x.currentQuoteId!, wallets });
    const a = await h.svc.approve({ userId: u.userId, executionId: x.id, quoteId: f.quote.id, approval: approval(x.plan.planHash, h.now(), true, x.plan.revision), wallets });
    const ex = a.execution;
    const p = await h.deposits.prepare({ userId: u.userId, executionId: ex.id, wallets });
    const tx = `0x${"d".repeat(63)}1`;
    h.chain.evmTx(tx, { network: "base", from: u.evm.address, to: USDC_BASE, logs: [{ address: USDC_BASE, from: u.evm.address, to: ex.depositAddress!, amount: BigInt(ex.amountIn) }] });
    await h.deposits.submit({ userId: u.userId, depositId: p.deposit.id, txHash: tx });
    const min = BigInt((await h.records.getQuote(ex.firmQuoteId!))!.minAmountOut!);
    const out = `0x${"e".repeat(63)}1`;
    h.chain.evmTx(out, { network: "arbitrum", from: "0x55f2c8044d790e1b8369508c31c756c0c2ca0e93", to: VAULT, logs: [{ address: USDC_ARB, from: VAULT, to: PAYEE, amount: min }] });
    h.fake.statuses.set(ex.depositAddress!, statusPayload("SUCCESS", { amountOut: String(min), destinationChainTxHashes: [{ hash: out, explorerUrl: "x" }] }, a.quote!.providerSignature!));
    for (let i = 0; i < 3; i++) { h.clock.now += 60_000; await h.monitor.run({ trigger: "test" }); }
    expect((await occ(s.id))[0]).toMatchObject({ executionState: "COMPLETED", action: "TRACK" });
    const r = buildReceipt(await h.svc.details(ex.id, u.userId), await h.trackingService.view(u.userId, ex.id), await h.svc.approvalFor(ex.id, u.userId));
    expect(r).toMatchObject({ kind: "PAYMENT", destination: { recipient: PAYEE, amountReceived: String(min), transactions: [{ hash: out }] } });
  });
});

describe("ownership", () => {
  it("another user cannot see, change, retry or skip a schedule or its payments", async () => {
    const s = await create();
    at("2026-11-18T09:00:00Z"); await h.schedules.processDue();
    const [, missed] = await occ(s.id);
    const other = await h.newUser();
    expect(await code(h.schedules.view(other.userId, s.id))).toBe("SCHEDULE_NOT_FOUND");
    expect(await code(h.schedules.pause(other.userId, s.id))).toBe("SCHEDULE_NOT_FOUND");
    expect(await code(h.schedules.cancel(other.userId, s.id))).toBe("SCHEDULE_NOT_FOUND");
    expect(await code(h.schedules.retry(other.userId, missed.id))).toBe("OCCURRENCE_NOT_FOUND");
    expect(await code(h.schedules.skip(other.userId, missed.id))).toBe("OCCURRENCE_NOT_RETRYABLE");
    expect(await h.schedules.list(other.userId)).toEqual([]);
    expect((await h.schedules.processDue({ userId: other.userId })).created).toBe(0);
  });
});

describe("time", () => {
  it("due dates follow the owner's timezone", async () => {
    const s = await create({ timezone: "Pacific/Auckland", startDate: "2026-11-12" });
    at("2026-11-11T10:59:00Z"); await h.schedules.processDue(); // 23:59 on the 11th in Auckland
    expect(await occ(s.id)).toHaveLength(0);
    at("2026-11-11T11:00:30Z"); await h.schedules.processDue(); // 00:00 on the 12th in Auckland
    expect((await occ(s.id)).map((x) => x.dueDate)).toEqual(["2026-11-12"]);
    void DAY;
  });
});
