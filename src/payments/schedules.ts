import { randomBytes } from "node:crypto";
import { and, asc, desc, eq, inArray, isNull, lt, lte, or, sql } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "../database/repositories";
import { agents, executions, paymentOccurrences, paymentSchedules } from "../database/schema";
import type { ExecutionService } from "../execution/service";
import type { VerifiedWallet } from "../execution/plan-validator";
import type { SpakIn } from "../spak-in/engine";
import type { IntentResult } from "../spak-in/schemas/result";
import type { GuardService } from "../guard/service";
import { getAsset } from "../spak-in/registries/assets";
import { getNetwork } from "../spak-in/registries/networks";
import { compareDecimal, isDecimal } from "../spak-in/lib/decimal";
import { describe as describeRecurrence, dueNow, firstSeqOnOrAfter, isTimezone, localDate, occurrenceDate, validateRecurrence, type Recurrence } from "./recurrence";

/**
 * SPak Payments: recurring schedules.
 *
 * A schedule PREPARES payments. When an occurrence is due, SPak re-reads the schedule, re-plans the payment through
 * SPak-in (recipient, network, token), lets SPak Guard check it, and creates a new execution with a fresh NEAR Intents
 * quote. If the schedule names the user's Agent, the Agent may approve the quote within its own signed permission.
 * Nothing else is authorized: the user's wallet signs every deposit. A schedule is never a signing permission.
 *
 * Concurrency: due schedules are claimed row by row with FOR UPDATE SKIP LOCKED; occurrences are unique per
 * (schedule, seq); preparation holds a short lease; each attempt uses its own idempotency key, so a retried or
 * concurrent run reuses the same execution instead of creating a second one.
 */

export class ScheduleError extends Error {
  constructor(readonly code: "SCHEDULE_BAD_REQUEST" | "SCHEDULE_NOT_FOUND" | "SCHEDULE_INVALID_STATE" | "OCCURRENCE_NOT_FOUND" | "OCCURRENCE_NOT_RETRYABLE" | "SCHEDULE_PLAN_INVALID" | "SCHEDULE_LIMIT" | "GUARD_BLOCKED", message: string, readonly details?: Record<string, unknown>) {
    super(message); this.name = "ScheduleError";
  }
}
export const SCHEDULE_ERROR_STATUS: Record<ScheduleError["code"], number> = {
  SCHEDULE_BAD_REQUEST: 400, SCHEDULE_NOT_FOUND: 404, OCCURRENCE_NOT_FOUND: 404, SCHEDULE_INVALID_STATE: 409, OCCURRENCE_NOT_RETRYABLE: 409, SCHEDULE_PLAN_INVALID: 422, SCHEDULE_LIMIT: 409, GUARD_BLOCKED: 403,
};

export const MAX_ACTIVE_SCHEDULES = 20;
export const PREPARE_LEASE_MS = 2 * 60_000;
/** Execution states in which an occurrence's attempt is over without any funds having moved (a new attempt is safe). */
const RETRYABLE_EXECUTION_STATES = ["EXPIRED", "CANCELLED", "REFUNDED"];

export const createScheduleSchema = z.object({
  name: z.string().trim().min(1).max(80),
  sourceNetwork: z.string().min(1).max(40),
  sourceAssetId: z.string().min(1).max(200),
  destinationNetwork: z.string().min(1).max(40),
  destinationAssetId: z.string().min(1).max(200),
  amount: z.string().trim().max(40),
  recipient: z.string().trim().min(2).max(200),
  frequency: z.string(),
  intervalDays: z.number().int().nullable().optional(),
  startDate: z.string(),
  endDate: z.string().nullable().optional(),
  maxOccurrences: z.number().int().nullable().optional(),
  timezone: z.string().min(1).max(64),
  agentId: z.string().regex(/^agt_[0-9a-f]{24}$/).nullable().optional(),
}).strict();

type ScheduleRow = typeof paymentSchedules.$inferSelect;
type OccurrenceRow = typeof paymentOccurrences.$inferSelect;
const newId = (p: string) => `${p}_${randomBytes(12).toString("hex")}`;
const recurrenceOf = (s: Pick<ScheduleRow, "frequency" | "intervalDays" | "startDate" | "endDate" | "maxOccurrences">): Recurrence =>
  ({ frequency: s.frequency as Recurrence["frequency"], intervalDays: s.intervalDays, startDate: s.startDate, endDate: s.endDate, maxOccurrences: s.maxOccurrences });

export interface ScheduleDeps {
  db: Db;
  engine: Pick<SpakIn, "interpretManual">;
  guard: Pick<GuardService, "interpretContext">;
  execution: Pick<ExecutionService, "create" | "firmQuote" | "approveByAgent">;
  /** The user's verified wallets, read from SPak's own records (never from a browser). */
  wallets: (userId: string) => Promise<{ context: Record<string, string>; verified: VerifiedWallet[] }>;
  clock?: () => Date;
  log?: (event: string, data: Record<string, unknown>) => void;
}

export class PaymentScheduleService {
  private readonly clock: () => Date;
  constructor(private readonly d: ScheduleDeps) { this.clock = d.clock ?? (() => new Date()); }

  /* ------------------------------------------------------------------ planning ------------------------------------------------------------ */

  /** Plan one payment of this schedule now, through SPak-in with the user's Guard policy. Throws unless VALIDATED. */
  private async plan(s: Pick<ScheduleRow, "userId" | "sourceNetwork" | "sourceAssetId" | "destinationNetwork" | "destinationAssetId" | "amount" | "recipient">): Promise<IntentResult> {
    const w = await this.d.wallets(s.userId);
    const g = await this.d.guard.interpretContext(s.userId);
    const r = await this.d.engine.interpretManual({
      text: "", userId: s.userId, sessionId: `sched-${randomBytes(8).toString("hex")}`, wallets: w.context, mode: "MANUAL", policy: g.policy, runtime: g.runtime, now: this.clock().toISOString(),
      intent: { type: "PAYMENT", sourceNetwork: s.sourceNetwork, sourceAsset: s.sourceAssetId, amount: s.amount, destinationNetwork: s.destinationNetwork, destinationAsset: s.destinationAssetId, recipient: s.recipient, slippageBps: 100 },
    } as never);
    if (r.policy?.outcome === "DENY") {
      const why = [...r.policy.violations.map((v) => v.message), ...r.policy.reasons].filter(Boolean);
      throw new ScheduleError("GUARD_BLOCKED", `SPak Guard blocked this payment: ${why[0] ?? "it is outside your Guard settings."}`, { reasons: why });
    }
    if (r.status !== "VALIDATED" || !r.plan) {
      const why = [...(r.errors ?? []).map((e) => e.message), ...(r.clarifications ?? []).map((c) => c.question)].filter(Boolean);
      throw new ScheduleError("SCHEDULE_PLAN_INVALID", why[0] ?? "SPak could not plan this payment.", { reasons: why });
    }
    return r;
  }

  /* ------------------------------------------------------------------ create --------------------------------------------------------------- */

  /** Validate everything on the server, plan one payment as a check, then store the schedule. */
  async create(userId: string, input: unknown) {
    const p = createScheduleSchema.safeParse(input);
    if (!p.success) { const i = p.error.issues[0]; throw new ScheduleError("SCHEDULE_BAD_REQUEST", `${i.path.join(".") || "input"}: ${i.message}`); }
    const b = p.data;
    if (!isTimezone(b.timezone)) throw new ScheduleError("SCHEDULE_BAD_REQUEST", "Unknown timezone.");
    if (!isDecimal(b.amount) || compareDecimal(b.amount, "0") <= 0) throw new ScheduleError("SCHEDULE_BAD_REQUEST", "Enter a positive amount, like 50 or 12.5.");
    const src = getAsset(b.sourceAssetId), dst = getAsset(b.destinationAssetId);
    if (!getNetwork(b.sourceNetwork) || !getNetwork(b.destinationNetwork)) throw new ScheduleError("SCHEDULE_BAD_REQUEST", "Unknown network.");
    if (!src || !dst || !b.sourceAssetId.startsWith(`${b.sourceNetwork}:`) || !b.destinationAssetId.startsWith(`${b.destinationNetwork}:`)) throw new ScheduleError("SCHEDULE_BAD_REQUEST", "That token is not supported on that network.");
    const now = this.clock();
    const v = validateRecurrence({ frequency: b.frequency, intervalDays: b.intervalDays ?? null, startDate: b.startDate, endDate: b.endDate ?? null, maxOccurrences: b.maxOccurrences ?? null }, localDate(now, b.timezone));
    if (!v.ok) throw new ScheduleError("SCHEDULE_BAD_REQUEST", v.error);
    const [{ n }] = await this.d.db.select({ n: sql<number>`count(*)::int` }).from(paymentSchedules).where(and(eq(paymentSchedules.userId, userId), inArray(paymentSchedules.status, ["ACTIVE", "PAUSED"])));
    if (n >= MAX_ACTIVE_SCHEDULES) throw new ScheduleError("SCHEDULE_LIMIT", `You can have up to ${MAX_ACTIVE_SCHEDULES} active or paused schedules.`);
    if (b.agentId) {
      const [a] = await this.d.db.select({ id: agents.id }).from(agents).where(and(eq(agents.id, b.agentId), eq(agents.userId, userId))).limit(1);
      if (!a) throw new ScheduleError("SCHEDULE_BAD_REQUEST", "No such Agent.");
    }
    const plan = await this.plan({ userId, ...b });
    const own = (await this.d.wallets(userId)).verified.some((w) => (w.family === "evm" ? w.address.toLowerCase() === b.recipient.toLowerCase() : w.address === b.recipient));
    if (own || plan.recipient?.kind !== "EXTERNAL") throw new ScheduleError("SCHEDULE_PLAN_INVALID", "A recurring payment must go to someone else's address.");
    const row: typeof paymentSchedules.$inferInsert = {
      id: newId("sch"), userId, name: b.name, status: "ACTIVE", sourceNetwork: b.sourceNetwork, sourceAssetId: b.sourceAssetId, destinationNetwork: b.destinationNetwork, destinationAssetId: b.destinationAssetId,
      amount: b.amount, recipient: plan.recipient.address ?? b.recipient, agentId: b.agentId ?? null, frequency: v.value.frequency, intervalDays: v.value.intervalDays, startDate: v.value.startDate, endDate: v.value.endDate,
      maxOccurrences: v.value.maxOccurrences, timezone: b.timezone, nextSeq: 0, nextDueDate: occurrenceDate(v.value, 0), createdAt: now, updatedAt: now,
    };
    await this.d.db.insert(paymentSchedules).values(row);
    this.d.log?.("payment_schedule.created", { scheduleId: row.id, userId, frequency: row.frequency });
    return this.view(userId, row.id);
  }

  /* ------------------------------------------------------------------ reads ---------------------------------------------------------------- */

  private async owned(userId: string, id: string, q: Db = this.d.db, lock = false): Promise<ScheduleRow> {
    const base = q.select().from(paymentSchedules).where(and(eq(paymentSchedules.id, id), eq(paymentSchedules.userId, userId))).limit(1);
    const [s] = lock ? await base.for("update") : await base;
    if (!s) throw new ScheduleError("SCHEDULE_NOT_FOUND", "No such schedule.");
    return s;
  }

  async list(userId: string) {
    const rows = await this.d.db.select().from(paymentSchedules).where(eq(paymentSchedules.userId, userId)).orderBy(desc(paymentSchedules.createdAt)).limit(100);
    return Promise.all(rows.map((s) => this.toView(s)));
  }
  async view(userId: string, id: string) { return this.toView(await this.owned(userId, id)); }

  private async toView(s: ScheduleRow) {
    const occ = await this.d.db.select({ o: paymentOccurrences, state: executions.state }).from(paymentOccurrences)
      .leftJoin(executions, eq(executions.id, paymentOccurrences.executionId)).where(eq(paymentOccurrences.scheduleId, s.id)).orderBy(desc(paymentOccurrences.seq)).limit(60);
    const r = recurrenceOf(s);
    return {
      id: s.id, name: s.name, status: s.status, amount: s.amount, sourceNetwork: s.sourceNetwork, sourceAssetId: s.sourceAssetId, destinationNetwork: s.destinationNetwork, destinationAssetId: s.destinationAssetId,
      recipient: s.recipient, agentId: s.agentId, recurrence: r, description: describeRecurrence(r), timezone: s.timezone,
      nextDueDate: s.status === "ACTIVE" ? s.nextDueDate : null, pausedAt: s.pausedAt?.toISOString() ?? null, cancelledAt: s.cancelledAt?.toISOString() ?? null, createdAt: s.createdAt.toISOString(),
      occurrences: occ.map(({ o, state }) => ({
        id: o.id, seq: o.seq, dueDate: o.dueDate, status: o.status, executionId: o.executionId, executionState: state ?? null, attempt: o.attempt,
        failureCode: o.failureCode, failureMessage: o.failureMessage, preparedAt: o.preparedAt?.toISOString() ?? null,
        /** What the user should do next, in one word. */
        action: occurrenceAction(o.status, state ?? null, s.status),
      })),
    };
  }

  /* ------------------------------------------------------------------ lifecycle ------------------------------------------------------------ */

  async pause(userId: string, id: string) {
    return this.d.db.transaction(async (tx) => {
      const s = await this.owned(userId, id, tx, true);
      if (s.status !== "ACTIVE") throw new ScheduleError("SCHEDULE_INVALID_STATE", `Only an active schedule can be paused (this one is ${s.status.toLowerCase()}).`);
      const now = this.clock();
      await tx.update(paymentSchedules).set({ status: "PAUSED", pausedAt: now, updatedAt: now, rowVersion: sql`${paymentSchedules.rowVersion} + 1` }).where(eq(paymentSchedules.id, id));
    }).then(() => this.view(userId, id));
  }

  /** Resume with the original configuration. Dates that passed while paused are not created: the next date is the first one from today. */
  async resume(userId: string, id: string) {
    return this.d.db.transaction(async (tx) => {
      const s = await this.owned(userId, id, tx, true);
      if (s.status !== "PAUSED") throw new ScheduleError("SCHEDULE_INVALID_STATE", `Only a paused schedule can be resumed (this one is ${s.status.toLowerCase()}).`);
      const now = this.clock();
      const r = recurrenceOf(s);
      const seq = firstSeqOnOrAfter(r, s.nextSeq, localDate(now, s.timezone));
      const next = occurrenceDate(r, seq);
      await tx.update(paymentSchedules).set({ status: next ? "ACTIVE" : "FINISHED", nextSeq: seq, nextDueDate: next, pausedAt: null, updatedAt: now, rowVersion: sql`${paymentSchedules.rowVersion} + 1` }).where(eq(paymentSchedules.id, id));
    }).then(() => this.view(userId, id));
  }

  /** Final. Stops all future preparation; occurrences not yet prepared are cancelled. Payments already prepared stay as they are (the user can cancel each). */
  async cancel(userId: string, id: string) {
    return this.d.db.transaction(async (tx) => {
      const s = await this.owned(userId, id, tx, true);
      if (s.status === "CANCELLED") return;
      const now = this.clock();
      await tx.update(paymentSchedules).set({ status: "CANCELLED", cancelledAt: now, nextDueDate: null, updatedAt: now, rowVersion: sql`${paymentSchedules.rowVersion} + 1` }).where(eq(paymentSchedules.id, id));
      await tx.update(paymentOccurrences).set({ status: "CANCELLED", leaseUntil: null, updatedAt: now })
        .where(and(eq(paymentOccurrences.scheduleId, id), inArray(paymentOccurrences.status, ["PREPARING", "FAILED", "MISSED"])));
    }).then(() => this.view(userId, id));
  }

  /* ------------------------------------------------------------------ due processing ------------------------------------------------------- */

  /**
   * Find due schedules and create their occurrences, then prepare them. Safe to run concurrently and repeatedly:
   * each schedule row is claimed with FOR UPDATE SKIP LOCKED, occurrences are unique per (schedule, seq), and
   * preparation is leased and idempotent. `userId` limits the run to one user (used when they open Payments).
   */
  async processDue(opts: { limit?: number; userId?: string } = {}) {
    const now = this.clock();
    const limit = opts.limit ?? 25;
    const created: string[] = [];
    const candidates = await this.d.db.select({ id: paymentSchedules.id }).from(paymentSchedules)
      .where(and(eq(paymentSchedules.status, "ACTIVE"), opts.userId ? eq(paymentSchedules.userId, opts.userId) : undefined)).orderBy(asc(paymentSchedules.nextDueDate)).limit(limit * 4);
    for (const { id } of candidates) {
      if (created.length >= limit) break;
      const made = await this.d.db.transaction(async (tx) => {
        const [s] = await tx.select().from(paymentSchedules).where(and(eq(paymentSchedules.id, id), eq(paymentSchedules.status, "ACTIVE"))).limit(1).for("update", { skipLocked: true });
        if (!s) return [] as string[];
        const r = recurrenceOf(s);
        const due = dueNow(r, s.nextSeq, localDate(now, s.timezone));
        const ids: string[] = [];
        for (const m of due.missed) {
          await tx.insert(paymentOccurrences).values({ id: newId("occ"), scheduleId: s.id, userId: s.userId, seq: m.seq, dueDate: m.date, status: "MISSED", failureCode: "MISSED",
            failureMessage: "This date passed before SPak could prepare it. Only the latest due payment is prepared automatically.", createdAt: now, updatedAt: now }).onConflictDoNothing();
        }
        if (due.prepare) {
          const occId = newId("occ");
          const ins = await tx.insert(paymentOccurrences).values({ id: occId, scheduleId: s.id, userId: s.userId, seq: due.prepare.seq, dueDate: due.prepare.date, status: "PREPARING", attempt: 1, createdAt: now, updatedAt: now })
            .onConflictDoNothing().returning({ id: paymentOccurrences.id });
          if (ins.length) ids.push(occId);
        }
        const finished = due.finished;
        if (due.nextSeq !== s.nextSeq || finished) {
          await tx.update(paymentSchedules).set({ nextSeq: due.nextSeq, nextDueDate: finished ? null : occurrenceDate(r, due.nextSeq), status: finished ? "FINISHED" : "ACTIVE", updatedAt: now, rowVersion: sql`${paymentSchedules.rowVersion} + 1` })
            .where(eq(paymentSchedules.id, s.id));
        }
        return ids;
      });
      created.push(...made);
    }
    // Prepare new occurrences, and any left PREPARING by a crashed run whose lease has lapsed.
    const stale = await this.d.db.select({ id: paymentOccurrences.id }).from(paymentOccurrences)
      .where(and(eq(paymentOccurrences.status, "PREPARING"), or(isNull(paymentOccurrences.leaseUntil), lt(paymentOccurrences.leaseUntil, now)), opts.userId ? eq(paymentOccurrences.userId, opts.userId) : undefined))
      .orderBy(asc(paymentOccurrences.createdAt)).limit(limit);
    const results = [];
    for (const id of [...new Set([...created, ...stale.map((x) => x.id)])].slice(0, limit)) results.push(await this.prepare(id));
    return { created: created.length, prepared: results.filter((r) => r?.status === "PREPARED").length, failed: results.filter((r) => r?.status === "FAILED").length, results };
  }

  /** Prepare one occurrence under a lease. Re-checks the schedule, re-plans, Guard, fresh quote; Agent approval only within its grant. */
  private async prepare(occId: string) {
    const now = this.clock();
    const [claimed] = await this.d.db.update(paymentOccurrences).set({ leaseUntil: new Date(now.getTime() + PREPARE_LEASE_MS), updatedAt: now })
      .where(and(eq(paymentOccurrences.id, occId), eq(paymentOccurrences.status, "PREPARING"), or(isNull(paymentOccurrences.leaseUntil), lte(paymentOccurrences.leaseUntil, now)))).returning();
    if (!claimed) return null; // another worker holds it, or it is no longer preparing
    const [s] = await this.d.db.select().from(paymentSchedules).where(eq(paymentSchedules.id, claimed.scheduleId)).limit(1);
    const finish = async (set: Partial<OccurrenceRow>) => {
      const [o] = await this.d.db.update(paymentOccurrences).set({ ...set, leaseUntil: null, updatedAt: this.clock() })
        .where(and(eq(paymentOccurrences.id, occId), eq(paymentOccurrences.status, "PREPARING"))).returning();
      return o ?? null;
    };
    if (!s || s.status === "CANCELLED") return finish({ status: "CANCELLED" });
    if (s.status === "PAUSED") return finish({ status: "FAILED", failureCode: "SCHEDULE_PAUSED", failureMessage: "The schedule was paused before this payment was prepared." });
    try {
      const plan = await this.plan(s);
      const w = await this.d.wallets(s.userId);
      const x = await this.d.execution.create({ userId: s.userId, planHash: plan.plan!.hash, idempotencyKey: `sched:${claimed.id}:${claimed.attempt}`, wallets: w.verified, agentId: s.agentId });
      let note: string | null = null;
      if (s.agentId && x.quote) {
        try {
          const f = await this.d.execution.firmQuote({ userId: s.userId, executionId: x.execution.id, quoteId: x.quote.id, wallets: w.verified });
          await this.d.execution.approveByAgent({ userId: s.userId, executionId: x.execution.id, quoteId: f.quote.id, wallets: w.verified });
        } catch (e) { note = `Your Agent could not approve this one: ${(e as Error).message} You can approve it yourself.`; }
      }
      const done = await finish({ status: "PREPARED", executionId: x.execution.id, preparedAt: this.clock(), failureCode: note ? "AGENT_APPROVAL_REQUIRED" : null, failureMessage: note });
      this.d.log?.("payment_occurrence.prepared", { occurrenceId: occId, scheduleId: s.id, executionId: x.execution.id });
      return done;
    } catch (e) {
      const code = (e as { code?: string }).code ?? "PREPARE_FAILED";
      this.d.log?.("payment_occurrence.failed", { occurrenceId: occId, scheduleId: s.id, code });
      return finish({ status: "FAILED", failureCode: code, failureMessage: (e as Error).message.slice(0, 500) });
    }
  }

  /* ------------------------------------------------------------------ recovery ------------------------------------------------------------- */

  /**
   * Prepare a missed or failed date now, or prepare a fresh attempt after the previous one expired, was cancelled or
   * was refunded. Refused while an attempt is still live, and for paused or cancelled schedules. One attempt at a time.
   */
  async retry(userId: string, occurrenceId: string) {
    const id = await this.d.db.transaction(async (tx) => {
      const [o] = await tx.select().from(paymentOccurrences).where(and(eq(paymentOccurrences.id, occurrenceId), eq(paymentOccurrences.userId, userId))).limit(1).for("update");
      if (!o) throw new ScheduleError("OCCURRENCE_NOT_FOUND", "No such payment.");
      const [s] = await tx.select().from(paymentSchedules).where(eq(paymentSchedules.id, o.scheduleId)).limit(1).for("update");
      if (!s || s.status === "CANCELLED") throw new ScheduleError("SCHEDULE_INVALID_STATE", "The schedule is cancelled. It will not prepare any more payments.");
      if (s.status === "PAUSED") throw new ScheduleError("SCHEDULE_INVALID_STATE", "Resume the schedule first.");
      let state: string | null = null;
      if (o.executionId) [{ state }] = await tx.select({ state: executions.state }).from(executions).where(eq(executions.id, o.executionId)).limit(1);
      const ok = o.status === "MISSED" || o.status === "FAILED" || (o.status === "PREPARED" && state !== null && RETRYABLE_EXECUTION_STATES.includes(state));
      if (!ok) throw new ScheduleError("OCCURRENCE_NOT_RETRYABLE", o.status === "PREPARED" ? "This payment is still in progress. Finish or cancel it first." : `This payment cannot be prepared again (${o.status.toLowerCase()}).`);
      const now = this.clock();
      const history = [...(o.attempts as unknown[]), ...(o.executionId || o.failureCode ? [{ attempt: o.attempt, executionId: o.executionId, executionState: state, failureCode: o.failureCode, at: o.updatedAt.toISOString() }] : [])];
      await tx.update(paymentOccurrences).set({ status: "PREPARING", attempt: o.attempt + 1, attempts: history, executionId: null, failureCode: null, failureMessage: null, leaseUntil: null, preparedAt: null, updatedAt: now })
        .where(eq(paymentOccurrences.id, o.id));
      return o.id;
    });
    await this.prepare(id);
    const [o] = await this.d.db.select().from(paymentOccurrences).where(eq(paymentOccurrences.id, id)).limit(1);
    return this.view(userId, o.scheduleId);
  }

  /** Mark a missed or failed date as skipped: it will not be paid. */
  async skip(userId: string, occurrenceId: string) {
    const [o] = await this.d.db.update(paymentOccurrences).set({ status: "SKIPPED", leaseUntil: null, updatedAt: this.clock() })
      .where(and(eq(paymentOccurrences.id, occurrenceId), eq(paymentOccurrences.userId, userId), inArray(paymentOccurrences.status, ["MISSED", "FAILED"]))).returning();
    if (!o) throw new ScheduleError("OCCURRENCE_NOT_RETRYABLE", "Only a missed or failed payment can be skipped.");
    return this.view(userId, o.scheduleId);
  }
}

/** The one next step for an occurrence, for the UI. */
export function occurrenceAction(status: string, executionState: string | null, scheduleStatus: string): "SIGN" | "TRACK" | "RECOVER" | "NONE" {
  if (status === "PREPARED") {
    if (executionState === "AWAITING_APPROVAL" || executionState === "AWAITING_DEPOSIT" || executionState === "QUOTED") return "SIGN";
    if (executionState && RETRYABLE_EXECUTION_STATES.includes(executionState)) return scheduleStatus === "ACTIVE" ? "RECOVER" : "TRACK";
    return "TRACK";
  }
  if ((status === "MISSED" || status === "FAILED") && scheduleStatus === "ACTIVE") return "RECOVER";
  return "NONE";
}
