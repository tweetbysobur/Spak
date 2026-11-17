/**
 * SPak Payments, payment requests. Real SQL (PGlite, or PostgreSQL 16 with SPAK_TEST_PG_URL for real row locks);
 * MOCKED NEAR Intents provider and chains. Paying a request is a normal payment: SPak-in plan with a minimum output,
 * the payer's Guard, a signature-checked quote, and the payer's wallet signs.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { paymentRequestAttempts, paymentRequests } from "@/database/schema";
import { approval, harness } from "../execution/harness";
import { statusPayload } from "../execution/fake-1click";

const USDC_BASE = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
const USDC_ARB = "0xaf88d065e77c8cc2239327c5edb3a432268e5831";
const VAULT = "0x2e6ad9e6d59bb4585ea0e6762c3b637dde29dad2";

let h: Awaited<ReturnType<typeof harness>>;
type U = Awaited<ReturnType<Awaited<ReturnType<typeof harness>>["newUser"]>>;
let payee: U, payer: U;
beforeEach(async () => {
  h = await harness(); payee = await h.newUser(); payer = await h.newUser();
  h.chain.setBalance("base", payer.evm.address, 10_000_000_000n, USDC_BASE);
});
const code = async (p: Promise<unknown>) => { try { await p; return "OK"; } catch (e) { return (e as { code?: string }).code ?? (e as Error).message; } };
const make = (o: Record<string, unknown> = {}, who = payee) => h.requests.create(who.userId, { destinationNetwork: "arbitrum", destinationAssetId: `arbitrum:${USDC_ARB}`, amount: "25", recipient: who.evm.address, note: "Invoice 14", expiresInDays: 7, ...o });
const pay = (token: string, who = payer) => h.requests.preparePayment(who.userId, token, { sourceNetwork: "base", sourceAssetId: `base:${USDC_BASE}` });
const units = (n: string) => BigInt(Math.round(Number(n) * 1e6));

describe("creating a request", () => {
  it("open, with an unguessable 32-character link token, paid to the payee's own verified wallet", async () => {
    const r = await make();
    expect(r).toMatchObject({ status: "OPEN", amount: "25", symbol: "USDC", destinationNetwork: "arbitrum", note: "Invoice 14" });
    expect(r.recipient.toLowerCase()).toBe(payee.evm.address.toLowerCase());
    expect(r.token).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect((await make()).token).not.toBe(r.token);
  });
  it.each([
    ["an address that is not the payee's wallet", { recipient: "0x1111111111111111111111111111111111111111" }],
    ["a token on another network", { destinationAssetId: `base:${USDC_BASE}` }],
    ["too many decimals", { amount: "1.1234567" }],
    ["zero", { amount: "0" }],
    ["text", { amount: "ten" }],
    ["no expiry", { expiresInDays: 0 }],
    ["expiry past 90 days", { expiresInDays: 91 }],
    ["a long note", { note: "x".repeat(141) }],
    ["an unknown field", { extra: true }],
  ])("refuses %s", async (_n, patch) => expect(await code(make(patch))).toBe("REQUEST_BAD_REQUEST"));
});

describe("the public link", () => {
  it("shows the request, never who made it; an unknown or malformed token is not found", async () => {
    const r = await make();
    const v = await h.requests.publicView(r.token);
    expect(v).toMatchObject({ status: "OPEN", amount: "25", symbol: "USDC", networkName: "Arbitrum", note: "Invoice 14" });
    expect(JSON.stringify(v)).not.toMatch(/usr_|prq_|userId/);
    expect(await code(h.requests.publicView("A".repeat(32)))).toBe("REQUEST_NOT_FOUND");
    expect(await code(h.requests.publicView("../../etc"))).toBe("REQUEST_NOT_FOUND");
  });
});

describe("paying a request", () => {
  it("prepares a normal payment to the payee with the requested amount as the guaranteed minimum; nothing is approved or signed", async () => {
    const r = await make();
    const out = await pay(r.token);
    expect(out.intent).toMatchObject({ status: "VALIDATED", intentType: "PAYMENT", recipient: { kind: "EXTERNAL" } });
    expect(out.execution).toMatchObject({ state: "AWAITING_APPROVAL", destinationNetwork: "arbitrum", destinationAssetId: `arbitrum:${USDC_ARB}` });
    expect(out.execution.recipient.toLowerCase()).toBe(payee.evm.address.toLowerCase());
    expect(BigInt(out.quote!.minAmountOut!)).toBeGreaterThanOrEqual(units("25"));
    expect(out.quote!.providerSignature).toBeTruthy();
    expect(await h.records.activeApproval(out.execution.id)).toBeNull();
    expect(await h.db.select().from(paymentRequestAttempts).where(eq(paymentRequestAttempts.requestId, r.id))).toHaveLength(1);
  });
  it("a plan whose quote cannot guarantee the minimum is refused (the existing minimum-output check)", async () => {
    const plan = await h.spakIn.interpretManual({ text: "", userId: payer.userId, sessionId: "s", wallets: await h.auth.walletContext(payer.userId), mode: "MANUAL", now: h.now().toISOString(),
      intent: { type: "PAYMENT", sourceNetwork: "base", sourceAsset: `base:${USDC_BASE}`, amount: "1", destinationNetwork: "arbitrum", destinationAsset: `arbitrum:${USDC_ARB}`, recipient: payee.evm.address, minOutput: "1000000" } } as never);
    expect(plan.status).toBe("VALIDATED");
    expect(plan.plan!.constraints.minOutput).toEqual({ value: "1000000", symbol: "USDC" });
    expect(await code(h.svc.create({ userId: payer.userId, planHash: plan.plan!.hash, idempotencyKey: "k-min-1", wallets: await payer.wallets() }))).not.toBe("OK");
  });
  it("the payee cannot pay their own request", async () => {
    const r = await make();
    expect(await code(pay(r.token, payee))).toBe("REQUEST_OWN");
  });
  it("one payer at a time: while a payment is live, nobody else (or the same payer again) can prepare another", async () => {
    const r = await make();
    await pay(r.token);
    const other = await h.newUser();
    h.chain.setBalance("base", other.evm.address, 10_000_000_000n, USDC_BASE);
    expect(await code(pay(r.token, other))).toBe("REQUEST_IN_PROGRESS");
    expect(await code(pay(r.token))).toBe("REQUEST_IN_PROGRESS");
  });
  it("concurrent payers: exactly one payment is prepared", async () => {
    const r = await make();
    const others = [payer, ...(await Promise.all([1, 2, 3].map(() => h.newUser())))];
    const out = await Promise.all(others.map((o) => code(pay(r.token, o))));
    expect(out.filter((x) => x === "OK")).toHaveLength(1);
    expect(out.every((x) => x === "OK" || x === "REQUEST_IN_PROGRESS")).toBe(true);
    expect(await h.db.select().from(paymentRequestAttempts).where(eq(paymentRequestAttempts.requestId, r.id))).toHaveLength(1);
  });
  it("an attempt abandoned before approval for 30 minutes is cancelled, and someone else can then pay", async () => {
    const r = await make();
    const first = await pay(r.token);
    h.clock.now += 31 * 60_000;
    const other = await h.newUser();
    h.chain.setBalance("base", other.evm.address, 10_000_000_000n, USDC_BASE);
    const second = await pay(r.token, other);
    expect((await h.records.get(first.execution.id))!.state).toBe("CANCELLED");
    expect(second.execution.id).not.toBe(first.execution.id);
  });
  it("cancelled and expired requests cannot be paid", async () => {
    const a = await make();
    await h.requests.cancel(payee.userId, a.id);
    expect(await code(pay(a.token))).toBe("REQUEST_NOT_OPEN");
    const b = await make({ expiresInDays: 1 });
    h.clock.now += 86_400_000 + 1000;
    expect(await code(pay(b.token))).toBe("REQUEST_NOT_OPEN");
    expect((await h.requests.publicView(b.token)).status).toBe("EXPIRED");
  });
  it("the payer's own SPak Guard applies", async () => {
    const r = await make();
    const v = (await h.guard.view(payer.userId)).policy;
    await h.guard.update(payer.userId, { version: v.version, recipientMode: "APPROVED_ONLY" });
    expect(await code(pay(r.token))).toMatch(/REQUEST_PLAN_INVALID|GUARD_BLOCKED/);
    const [row] = await h.db.select().from(paymentRequests).where(eq(paymentRequests.id, r.id));
    expect(row.claimUserId).toBeNull(); // the claim is always released
  });
});

describe("paid only after verified delivery", () => {
  async function complete(token: string, o: { to?: string; amount?: bigint } = {}) {
    const p = await pay(token);
    const wallets = await payer.wallets();
    const f = await h.svc.firmQuote({ userId: payer.userId, executionId: p.execution.id, quoteId: p.quote!.id, wallets });
    const a = await h.svc.approve({ userId: payer.userId, executionId: p.execution.id, quoteId: f.quote.id, approval: approval(p.execution.planHash, h.now(), true, p.execution.planRevision), wallets });
    const ex = a.execution;
    const d = await h.deposits.prepare({ userId: payer.userId, executionId: ex.id, wallets });
    const tx = `0x${"d".repeat(62)}${Math.floor(Math.random() * 99).toString().padStart(2, "0")}`;
    h.chain.evmTx(tx, { network: "base", from: payer.evm.address, to: USDC_BASE, logs: [{ address: USDC_BASE, from: payer.evm.address, to: ex.depositAddress!, amount: BigInt(ex.amountIn) }] });
    await h.deposits.submit({ userId: payer.userId, depositId: d.deposit.id, txHash: tx });
    const min = BigInt((await h.records.getQuote(ex.firmQuoteId!))!.minAmountOut!);
    const out = `0x${"e".repeat(62)}${Math.floor(Math.random() * 99).toString().padStart(2, "0")}`;
    h.chain.evmTx(out, { network: "arbitrum", from: "0x55f2c8044d790e1b8369508c31c756c0c2ca0e93", to: VAULT, logs: [{ address: USDC_ARB, from: VAULT, to: o.to ?? payee.evm.address, amount: o.amount ?? min }] });
    h.fake.statuses.set(ex.depositAddress!, statusPayload("SUCCESS", { amountOut: String(o.amount ?? min), destinationChainTxHashes: [{ hash: out, explorerUrl: "x" }] }, a.quote!.providerSignature!));
    for (let i = 0; i < 3; i++) { h.clock.now += 60_000; await h.monitor.run({ trigger: "test" }); }
    return ex;
  }
  it("delivery of at least the requested amount to the payee marks it PAID; it then cannot be paid again", async () => {
    const r = await make();
    const ex = await complete(r.token);
    expect((await h.records.get(ex.id))!.state).toBe("COMPLETED");
    expect((await h.requests.publicView(r.token)).status).toBe("PAID");
    expect(await h.requests.ownerView(payee.userId, r.id)).toMatchObject({ status: "PAID", paidExecutionId: ex.id });
    expect(await code(pay(r.token))).toBe("REQUEST_NOT_OPEN");
  });
  it("a payout to another address is never counted as payment", async () => {
    const r = await make();
    await complete(r.token, { to: "0x3333333333333333333333333333333333333333" });
    expect((await h.requests.publicView(r.token)).status).toBe("OPEN");
  });
});

describe("ownership", () => {
  it("only the payee can view privately or cancel", async () => {
    const r = await make();
    expect(await code(h.requests.ownerView(payer.userId, r.id))).toBe("REQUEST_NOT_FOUND");
    expect(await code(h.requests.cancel(payer.userId, r.id))).toBe("REQUEST_NOT_FOUND");
    expect(await h.requests.list(payer.userId)).toEqual([]);
  });
});
