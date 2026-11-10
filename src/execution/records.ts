import { and, asc, desc, eq, gte, inArray, isNull, lt, max, ne } from "drizzle-orm";
import type { Db } from "../database/repositories";
import { approvals, executionEvents, executions, intents, quotes } from "../database/schema";
import type { IntentResult } from "../spak-in/schemas/result";
import type { ExecutionPlan } from "../spak-in/schemas/plan";
import type { IssuedPlan, PlanStore } from "./plan-validator";
import type { ExecutionState } from "./state";
import { assertTransition } from "./state";

export type ExecutionRow = typeof executions.$inferSelect;
export type ExecutionInsert = typeof executions.$inferInsert;
export type QuoteRow = typeof quotes.$inferSelect;
export type QuoteInsert = typeof quotes.$inferInsert;
export type ApprovalRow = typeof approvals.$inferSelect;
export type QuoteStatus = "VALID" | "EXPIRED" | "REJECTED" | "SUPERSEDED" | "USED";

export function isUniqueViolation(e: unknown): boolean {
  const c = (e as { code?: string; cause?: { code?: string } }) ?? {};
  return c.code === "23505" || c.cause?.code === "23505";
}

/** Plans SPak-in issued, read from the intent log: plan, owner, intent id, revision and latest revision. */
export class IntentLogPlanStore implements PlanStore {
  constructor(private readonly db: Db) {}
  async findIssued(hash: string): Promise<IssuedPlan | null> {
    const [row] = await this.db.select().from(intents).where(eq(intents.planHash, hash)).orderBy(desc(intents.revision)).limit(1);
    if (!row) return null;
    const result = row.result as IntentResult;
    if (!result.plan) return null;
    const [latest] = await this.db.select({ r: max(intents.revision) }).from(intents).where(eq(intents.intentId, row.intentId));
    return {
      plan: result.plan as ExecutionPlan, userId: row.userId, intentId: row.intentId, revision: row.revision,
      latestRevision: latest?.r ?? row.revision, recipientKind: result.recipient?.kind ?? null,
    };
  }
}

/** Execution Record Manager. All writes that change state are compare-and-set on the current state. */
export class ExecutionRecords {
  constructor(private readonly db: Db, private readonly clock: () => Date = () => new Date()) {}

  /** Insert, or return the existing row when the idempotency key or the plan was already used by this user. */
  async createOrGet(row: ExecutionInsert): Promise<{ row: ExecutionRow; created: boolean }> {
    try {
      await this.db.transaction(async (tx) => {
        await tx.insert(executions).values(row);
        await tx.insert(executionEvents).values({ executionId: row.id, at: row.createdAt, fromState: null, toState: row.state, reason: "Execution created.", data: {} });
      });
      return { row: (await this.get(row.id))!, created: true };
    } catch (e) {
      if (!isUniqueViolation(e)) throw e;
      const existing = (await this.byIdempotencyKey(row.userId, row.idempotencyKey)) ?? (await this.byPlan(row.userId, row.planHash));
      if (!existing) throw e;
      return { row: existing, created: false };
    }
  }

  async get(id: string) {
    const [r] = await this.db.select().from(executions).where(eq(executions.id, id)).limit(1);
    return r ?? null;
  }
  async getForUser(id: string, userId: string) {
    const [r] = await this.db.select().from(executions).where(and(eq(executions.id, id), eq(executions.userId, userId))).limit(1);
    return r ?? null;
  }
  async byIdempotencyKey(userId: string, key: string) {
    const [r] = await this.db.select().from(executions).where(and(eq(executions.userId, userId), eq(executions.idempotencyKey, key))).limit(1);
    return r ?? null;
  }
  async byPlan(userId: string, planHash: string) {
    const [r] = await this.db.select().from(executions).where(and(eq(executions.userId, userId), eq(executions.planHash, planHash))).limit(1);
    return r ?? null;
  }
  async list(userId: string, opts: { limit: number; before?: Date }) {
    return this.db.select().from(executions)
      .where(and(eq(executions.userId, userId), ...(opts.before ? [lt(executions.createdAt, opts.before)] : [])))
      .orderBy(desc(executions.createdAt)).limit(opts.limit);
  }
  /** Same leg submitted for deposit recently, in a live state. */
  async recentSameTransfer(userId: string, fingerprint: string, since: Date, excludeId: string) {
    return this.db.select({ id: executions.id }).from(executions).where(and(
      eq(executions.userId, userId), eq(executions.fingerprint, fingerprint), gte(executions.createdAt, since), ne(executions.id, excludeId),
      inArray(executions.state, ["AWAITING_DEPOSIT", "PROCESSING", "COMPLETED"]),
    ));
  }

  /** Atomic state change with history. Returns null if another request changed the state first. */
  async transition(id: string, from: ExecutionState, to: ExecutionState, reason: string, patch: Partial<ExecutionInsert> = {}, data: Record<string, unknown> = {}) {
    assertTransition(from, to);
    const now = this.clock();
    return this.db.transaction(async (tx) => {
      const [r] = await tx.update(executions).set({ ...patch, state: to, updatedAt: now })
        .where(and(eq(executions.id, id), eq(executions.state, from))).returning();
      if (!r) return null;
      if (from !== to || Object.keys(data).length) {
        await tx.insert(executionEvents).values({ executionId: id, at: now, fromState: from, toState: to, reason, data });
      }
      return r;
    });
  }

  /** Field updates that do not change state (status-check bookkeeping). */
  async touch(id: string, patch: Partial<ExecutionInsert>) {
    await this.db.update(executions).set({ ...patch, updatedAt: this.clock() }).where(eq(executions.id, id));
  }

  /** Only one approval may proceed to a firm quote. */
  async claimApproval(id: string) {
    const [r] = await this.db.update(executions).set({ approvedAt: this.clock() })
      .where(and(eq(executions.id, id), isNull(executions.approvedAt), inArray(executions.state, ["QUOTED", "AWAITING_APPROVAL"]))).returning();
    return r ?? null;
  }
  async releaseApproval(id: string) {
    await this.db.update(executions).set({ approvedAt: null }).where(and(eq(executions.id, id), inArray(executions.state, ["QUOTED", "AWAITING_APPROVAL"])));
  }

  async events(id: string) {
    return this.db.select().from(executionEvents).where(eq(executionEvents.executionId, id)).orderBy(asc(executionEvents.at), asc(executionEvents.id));
  }

  // approvals
  /** Returns null if a live approval already exists for the execution (unique partial index). */
  async insertApproval(a: typeof approvals.$inferInsert): Promise<ApprovalRow | null> {
    try {
      const [r] = await this.db.insert(approvals).values(a).returning();
      return r;
    } catch (e) {
      if (isUniqueViolation(e)) return null;
      throw e;
    }
  }
  async activeApproval(executionId: string): Promise<ApprovalRow | null> {
    const [r] = await this.db.select().from(approvals).where(and(eq(approvals.executionId, executionId), isNull(approvals.invalidatedAt))).limit(1);
    return r ?? null;
  }
  async invalidateApprovals(executionId: string, reason: string) {
    await this.db.update(approvals).set({ invalidatedAt: this.clock(), invalidationReason: reason })
      .where(and(eq(approvals.executionId, executionId), isNull(approvals.invalidatedAt)));
  }

  // quotes
  async insertQuote(q: QuoteInsert) {
    await this.db.insert(quotes).values(q);
    return (await this.getQuote(q.id))!;
  }
  async getQuote(id: string) {
    const [r] = await this.db.select().from(quotes).where(eq(quotes.id, id)).limit(1);
    return r ?? null;
  }
  async getQuoteForUser(id: string, userId: string) {
    const [r] = await this.db.select().from(quotes).where(and(eq(quotes.id, id), eq(quotes.userId, userId))).limit(1);
    return r ?? null;
  }
  async setQuoteStatus(id: string, status: QuoteStatus, from?: QuoteStatus) {
    const [r] = await this.db.update(quotes).set({ status })
      .where(and(eq(quotes.id, id), ...(from ? [eq(quotes.status, from)] : []))).returning();
    return r ?? null;
  }
  async supersedeQuotes(executionId: string, keepId: string) {
    await this.db.update(quotes).set({ status: "SUPERSEDED" })
      .where(and(eq(quotes.executionId, executionId), ne(quotes.id, keepId), eq(quotes.status, "VALID")));
  }
  async quotesFor(executionId: string) {
    return this.db.select().from(quotes).where(eq(quotes.executionId, executionId)).orderBy(asc(quotes.createdAt));
  }
}
