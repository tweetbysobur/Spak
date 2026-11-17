import { randomBytes } from "node:crypto";
import { and, desc, eq, inArray, lt, sql } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "../database/repositories";
import { executions, paymentRequestAttempts, paymentRequests } from "../database/schema";
import type { ExecutionService } from "../execution/service";
import type { VerifiedWallet } from "../execution/plan-validator";
import type { AssetResolver } from "../execution/asset-resolver";
import type { OneClickClient } from "../integrations/near-intents/client";
import type { SpakIn } from "../spak-in/engine";
import type { GuardService } from "../guard/service";
import { getAsset } from "../spak-in/registries/assets";
import { getNetwork } from "../spak-in/registries/networks";
import { compareDecimal, fractionDigits, fromBaseUnits, isDecimal, toBaseUnits } from "../spak-in/lib/decimal";

/**
 * SPak Payments: payment requests.
 *
 * A payee asks for at least `amount` of a token on a network, delivered to one of their own verified wallets, and shares
 * an unguessable link. A payer opens it, picks what to pay with, and pays through the normal payment path: SPak-in plans
 * a PAYMENT with a minimum output equal to the requested amount, the payer's SPak Guard checks it, the quote is a normal
 * signature-checked EXACT_INPUT quote that is rejected if its worst case delivers less than requested, and the payer's
 * wallet signs. The request is PAID only when SPak has verified, on the destination chain, delivery of at least the
 * requested amount to the payee's wallet.
 *
 * Double payment: one payer at a time. Preparing takes a short claim on the request row (under FOR UPDATE), and no
 * new payment is prepared while an earlier attempt is still live. An attempt abandoned before approval for longer than
 * ABANDONED_MS is cancelled before the request opens to anyone else.
 */

export class RequestError extends Error {
  constructor(readonly code: "REQUEST_BAD_REQUEST" | "REQUEST_NOT_FOUND" | "REQUEST_NOT_OPEN" | "REQUEST_IN_PROGRESS" | "REQUEST_OWN" | "REQUEST_PLAN_INVALID" | "REQUEST_LIMIT", message: string, readonly details?: Record<string, unknown>) {
    super(message); this.name = "RequestError";
  }
}
export const REQUEST_ERROR_STATUS: Record<RequestError["code"], number> = {
  REQUEST_BAD_REQUEST: 400, REQUEST_NOT_FOUND: 404, REQUEST_NOT_OPEN: 409, REQUEST_IN_PROGRESS: 409, REQUEST_OWN: 409, REQUEST_PLAN_INVALID: 422, REQUEST_LIMIT: 409,
};

export const MAX_OPEN_REQUESTS = 50;
export const MAX_EXPIRY_DAYS = 90;
export const CLAIM_MS = 2 * 60_000;
export const ABANDONED_MS = 30 * 60_000;
/** Slippage for request payments, and the extra input that keeps the worst case at or above the requested amount. */
export const REQUEST_SLIPPAGE_BPS = 50;
const SIZING_HEADROOM_BPS = 30n;
const PRE_DEPOSIT_STATES = ["QUOTED", "AWAITING_APPROVAL", "DRAFT"];

export const createRequestSchema = z.object({
  destinationNetwork: z.string().min(1).max(40),
  destinationAssetId: z.string().min(1).max(200),
  amount: z.string().trim().max(40),
  recipient: z.string().trim().min(2).max(200),
  note: z.string().trim().max(140).optional(),
  expiresInDays: z.number().int().min(1).max(MAX_EXPIRY_DAYS),
}).strict();
export const payRequestSchema = z.object({
  sourceNetwork: z.string().min(1).max(40),
  sourceAssetId: z.string().min(1).max(200),
}).strict();
export const TOKEN_RE = /^[A-Za-z0-9_-]{32}$/;

type RequestRow = typeof paymentRequests.$inferSelect;
const newId = (p: string) => `${p}_${randomBytes(12).toString("hex")}`;
const sameAddress = (network: string, a: string, b: string) => (getNetwork(network)?.family === "evm" ? a.toLowerCase() === b.toLowerCase() : a === b);

export interface RequestDeps {
  db: Db;
  engine: Pick<SpakIn, "interpretManual">;
  guard: Pick<GuardService, "interpretContext">;
  execution: Pick<ExecutionService, "create" | "cancel">;
  client: Pick<OneClickClient, "estimateInput">;
  resolver: Pick<AssetResolver, "resolve">;
  wallets: (userId: string) => Promise<{ context: Record<string, string>; verified: VerifiedWallet[] }>;
  clock?: () => Date;
  log?: (event: string, data: Record<string, unknown>) => void;
}

export class PaymentRequestService {
  private readonly clock: () => Date;
  constructor(private readonly d: RequestDeps) { this.clock = d.clock ?? (() => new Date()); }

  /* ------------------------------------------------------------------ create ---------------------------------------------------------------- */

  async create(userId: string, input: unknown) {
    const p = createRequestSchema.safeParse(input);
    if (!p.success) { const i = p.error.issues[0]; throw new RequestError("REQUEST_BAD_REQUEST", `${i.path.join(".") || "input"}: ${i.message}`); }
    const b = p.data;
    const asset = getAsset(b.destinationAssetId);
    if (!getNetwork(b.destinationNetwork) || !asset || asset.network !== b.destinationNetwork) throw new RequestError("REQUEST_BAD_REQUEST", "That token is not supported on that network.");
    if (!isDecimal(b.amount) || compareDecimal(b.amount, "0") <= 0) throw new RequestError("REQUEST_BAD_REQUEST", "Enter a positive amount, like 25 or 12.5.");
    if (fractionDigits(b.amount) > asset.decimals) throw new RequestError("REQUEST_BAD_REQUEST", `${asset.symbol} supports ${asset.decimals} decimal places.`);
    // The payee is paid only to a wallet they proved they own, on the requested network.
    const own = (await this.d.wallets(userId)).verified.find((w) => sameAddress(b.destinationNetwork, w.address, b.recipient) && w.networks.some((n) => n.id === b.destinationNetwork && n.enabled));
    if (!own) throw new RequestError("REQUEST_BAD_REQUEST", "Requests are paid to one of your own verified wallets on that network. Link the wallet in Settings first.");
    const [{ n }] = await this.d.db.select({ n: sql<number>`count(*)::int` }).from(paymentRequests).where(and(eq(paymentRequests.userId, userId), eq(paymentRequests.status, "OPEN")));
    if (n >= MAX_OPEN_REQUESTS) throw new RequestError("REQUEST_LIMIT", `You can have up to ${MAX_OPEN_REQUESTS} open requests.`);
    const now = this.clock();
    const row: typeof paymentRequests.$inferInsert = {
      id: newId("prq"), userId, publicToken: randomBytes(24).toString("base64url"), status: "OPEN", destinationNetwork: b.destinationNetwork, destinationAssetId: b.destinationAssetId,
      amount: b.amount.replace(/^0+(?=\d)/, ""), recipient: own.address, note: b.note || null, expiresAt: new Date(now.getTime() + b.expiresInDays * 86_400_000), createdAt: now, updatedAt: now,
    };
    await this.d.db.insert(paymentRequests).values(row);
    this.d.log?.("payment_request.created", { requestId: row.id, userId });
    return this.ownerView(userId, row.id);
  }

  /* ------------------------------------------------------------------ reads ----------------------------------------------------------------- */

  /** OPEN becomes PAID when an attempt delivered at least the requested amount to the payee's wallet, verified on chain. */
  private async refresh(r: RequestRow): Promise<RequestRow> {
    if (r.status !== "OPEN") return r;
    const atts = await this.d.db.select({ x: executions }).from(paymentRequestAttempts).innerJoin(executions, eq(executions.id, paymentRequestAttempts.executionId))
      .where(eq(paymentRequestAttempts.requestId, r.id));
    const asset = getAsset(r.destinationAssetId);
    const need = asset ? BigInt(toBaseUnits(r.amount, asset.decimals)) : null;
    const paid = atts.map((a) => a.x).find((x) => x.state === "COMPLETED" && need !== null && x.amountOutVerified && BigInt(x.amountOutVerified) >= need
      && x.destinationAssetId === r.destinationAssetId && x.destinationNetwork === r.destinationNetwork && sameAddress(r.destinationNetwork, x.recipient, r.recipient));
    if (!paid) return r;
    const now = this.clock();
    const [u] = await this.d.db.update(paymentRequests).set({ status: "PAID", paidExecutionId: paid.id, paidAt: paid.destinationVerifiedAt ?? now, claimUserId: null, claimUntil: null, updatedAt: now })
      .where(and(eq(paymentRequests.id, r.id), eq(paymentRequests.status, "OPEN"))).returning();
    this.d.log?.("payment_request.paid", { requestId: r.id, executionId: paid.id });
    return u ?? r;
  }
  private status(r: RequestRow): "OPEN" | "PAID" | "CANCELLED" | "EXPIRED" {
    return r.status === "OPEN" && r.expiresAt.getTime() <= this.clock().getTime() ? "EXPIRED" : (r.status as "OPEN" | "PAID" | "CANCELLED");
  }
  private base(r: RequestRow) {
    const asset = getAsset(r.destinationAssetId);
    return {
      status: this.status(r), amount: r.amount, symbol: asset?.symbol ?? null, decimals: asset?.decimals ?? null,
      destinationNetwork: r.destinationNetwork, networkName: getNetwork(r.destinationNetwork)?.name ?? r.destinationNetwork, destinationAssetId: r.destinationAssetId,
      recipient: r.recipient, note: r.note, expiresAt: r.expiresAt.toISOString(), paidAt: r.paidAt?.toISOString() ?? null, createdAt: r.createdAt.toISOString(),
    };
  }
  private async owned(userId: string, id: string) {
    const [r] = await this.d.db.select().from(paymentRequests).where(and(eq(paymentRequests.id, id), eq(paymentRequests.userId, userId))).limit(1);
    if (!r) throw new RequestError("REQUEST_NOT_FOUND", "No such request.");
    return r;
  }
  async ownerView(userId: string, id: string) {
    const r = await this.refresh(await this.owned(userId, id));
    return { id: r.id, token: r.publicToken, ...this.base(r), paidExecutionId: r.paidExecutionId };
  }
  async list(userId: string) {
    const rows = await this.d.db.select().from(paymentRequests).where(eq(paymentRequests.userId, userId)).orderBy(desc(paymentRequests.createdAt)).limit(100);
    const out = [];
    for (const r0 of rows) { const r = await this.refresh(r0); out.push({ id: r.id, token: r.publicToken, ...this.base(r), paidExecutionId: r.paidExecutionId }); }
    return out;
  }
  /** What anyone with the link sees: the request itself, never who made it. */
  async publicView(token: string) {
    if (!TOKEN_RE.test(token)) throw new RequestError("REQUEST_NOT_FOUND", "This payment link is not valid.");
    const [r0] = await this.d.db.select().from(paymentRequests).where(eq(paymentRequests.publicToken, token)).limit(1);
    if (!r0) throw new RequestError("REQUEST_NOT_FOUND", "This payment link is not valid.");
    return this.base(await this.refresh(r0));
  }

  async cancel(userId: string, id: string) {
    const r = await this.refresh(await this.owned(userId, id));
    if (r.status !== "OPEN") throw new RequestError("REQUEST_NOT_OPEN", `This request is already ${r.status.toLowerCase()}.`);
    const now = this.clock();
    await this.d.db.update(paymentRequests).set({ status: "CANCELLED", cancelledAt: now, claimUserId: null, claimUntil: null, updatedAt: now }).where(and(eq(paymentRequests.id, id), eq(paymentRequests.status, "OPEN")));
    return this.ownerView(userId, id);
  }

  /* ------------------------------------------------------------------ pay ------------------------------------------------------------------- */

  /**
   * Prepare a payment of this request for the signed-in payer. Returns the plan, execution and quote for the normal
   * review; nothing is approved or signed here.
   */
  async preparePayment(payerUserId: string, token: string, input: unknown) {
    const p = payRequestSchema.safeParse(input);
    if (!p.success) { const i = p.error.issues[0]; throw new RequestError("REQUEST_BAD_REQUEST", `${i.path.join(".") || "input"}: ${i.message}`); }
    if (!TOKEN_RE.test(token)) throw new RequestError("REQUEST_NOT_FOUND", "This payment link is not valid.");
    const [r0] = await this.d.db.select().from(paymentRequests).where(eq(paymentRequests.publicToken, token)).limit(1);
    if (!r0) throw new RequestError("REQUEST_NOT_FOUND", "This payment link is not valid.");
    if (r0.userId === payerUserId) throw new RequestError("REQUEST_OWN", "This is your own request. Share the link with the person paying you.");
    await this.releaseAbandoned(r0.id);

    // 1. Claim the request (row lock): open, in date, nobody else preparing, no live attempt.
    const req = await this.d.db.transaction(async (tx) => {
      const [r] = await tx.select().from(paymentRequests).where(eq(paymentRequests.id, r0.id)).limit(1).for("update");
      const now = this.clock();
      if (!r || r.status !== "OPEN" || r.expiresAt.getTime() <= now.getTime()) throw new RequestError("REQUEST_NOT_OPEN", r?.status === "PAID" ? "This request is already paid." : r?.status === "CANCELLED" ? "This request was cancelled." : "This request has expired.");
      if (r.claimUserId && r.claimUntil && r.claimUntil.getTime() > now.getTime()) throw new RequestError("REQUEST_IN_PROGRESS", "Someone is paying this request right now. Try again in a few minutes.");
      const live = await tx.select({ state: executions.state, payer: paymentRequestAttempts.payerUserId }).from(paymentRequestAttempts).innerJoin(executions, eq(executions.id, paymentRequestAttempts.executionId))
        .where(and(eq(paymentRequestAttempts.requestId, r.id), sql`${executions.state} not in ('COMPLETED','EXPIRED','CANCELLED','REFUNDED','FAILED')`));
      if (live.length) throw new RequestError("REQUEST_IN_PROGRESS", live.some((l) => l.payer === payerUserId) ? "You already have a payment for this request in progress. Open it in Activity to finish or cancel it." : "Someone is paying this request right now. Try again later.");
      await tx.update(paymentRequests).set({ claimUserId: payerUserId, claimUntil: new Date(now.getTime() + CLAIM_MS), updatedAt: now }).where(eq(paymentRequests.id, r.id));
      return r;
    });

    const release = () => this.d.db.update(paymentRequests).set({ claimUserId: null, claimUntil: null }).where(and(eq(paymentRequests.id, req.id), eq(paymentRequests.claimUserId, payerUserId)));
    try {
      // 2. Size it: how much of the payer's token delivers the requested amount, plus slippage headroom.
      const src = await this.d.resolver.resolve(p.data.sourceAssetId, p.data.sourceNetwork);
      const dst = await this.d.resolver.resolve(req.destinationAssetId, req.destinationNetwork);
      const w = await this.d.wallets(payerUserId);
      const refund = w.context[p.data.sourceNetwork];
      if (!refund) throw new RequestError("REQUEST_PLAN_INVALID", `Connect a wallet on ${getNetwork(p.data.sourceNetwork)?.name ?? p.data.sourceNetwork} to pay from it.`);
      const est = await this.d.client.estimateInput({
        slippageTolerance: REQUEST_SLIPPAGE_BPS, originAsset: src.providerAssetId, depositType: "ORIGIN_CHAIN", destinationAsset: dst.providerAssetId,
        amount: toBaseUnits(req.amount, dst.decimals), refundTo: refund, refundType: "ORIGIN_CHAIN", recipient: req.recipient, recipientType: "DESTINATION_CHAIN",
        deadline: new Date(this.clock().getTime() + 30 * 60_000).toISOString(),
      });
      const units = (BigInt(est.amountIn) * (10_000n + BigInt(REQUEST_SLIPPAGE_BPS) + SIZING_HEADROOM_BPS) + 9_999n) / 10_000n;
      const amount = fromBaseUnits(units.toString(), src.decimals);

      // 3. Plan it as a normal payment with the requested amount as the minimum output, under the payer's Guard.
      const g = await this.d.guard.interpretContext(payerUserId);
      const plan = await this.d.engine.interpretManual({
        text: "", userId: payerUserId, sessionId: `req-${randomBytes(8).toString("hex")}`, wallets: w.context, mode: "MANUAL", policy: g.policy, runtime: g.runtime, now: this.clock().toISOString(),
        intent: { type: "PAYMENT", sourceNetwork: p.data.sourceNetwork, sourceAsset: p.data.sourceAssetId, amount, destinationNetwork: req.destinationNetwork, destinationAsset: req.destinationAssetId,
          recipient: req.recipient, slippageBps: REQUEST_SLIPPAGE_BPS, minOutput: req.amount },
      } as never);
      if (plan.policy?.outcome === "DENY") throw new RequestError("REQUEST_PLAN_INVALID", `SPak Guard blocked this payment: ${[...plan.policy.violations.map((v) => v.message), ...plan.policy.reasons][0] ?? "it is outside your Guard settings."}`);
      if (plan.status !== "VALIDATED" || !plan.plan) {
        const why = [...(plan.errors ?? []).map((e) => e.message), ...(plan.clarifications ?? []).map((c) => c.question)];
        throw new RequestError("REQUEST_PLAN_INVALID", why[0] ?? "SPak could not plan this payment.", { reasons: why });
      }

      // 4. A normal execution with a fresh, signature-checked quote; rejected if its worst case is below the request.
      const x = await this.d.execution.create({ userId: payerUserId, planHash: plan.plan.hash, idempotencyKey: `req:${req.id}:${randomBytes(6).toString("hex")}`, wallets: w.verified });
      await this.d.db.insert(paymentRequestAttempts).values({ id: newId("pra"), requestId: req.id, payerUserId, executionId: x.execution.id, createdAt: this.clock() });
      this.d.log?.("payment_request.prepared", { requestId: req.id, executionId: x.execution.id });
      return { intent: plan, execution: x.execution, quote: x.quote, sizing: { amountIn: amount, minimumReceived: req.amount } };
    } finally {
      await release();
    }
  }

  /** Cancel attempts that stalled before approval for longer than ABANDONED_MS, so the request can be paid by someone else. */
  private async releaseAbandoned(requestId: string) {
    const cutoff = new Date(this.clock().getTime() - ABANDONED_MS);
    const stale = await this.d.db.select({ executionId: executions.id, payer: paymentRequestAttempts.payerUserId }).from(paymentRequestAttempts).innerJoin(executions, eq(executions.id, paymentRequestAttempts.executionId))
      .where(and(eq(paymentRequestAttempts.requestId, requestId), inArray(executions.state, PRE_DEPOSIT_STATES), lt(paymentRequestAttempts.createdAt, cutoff)));
    for (const s of stale) await this.d.execution.cancel({ userId: s.payer, executionId: s.executionId }).catch(() => undefined); // approved meanwhile: it stays live
  }
}

