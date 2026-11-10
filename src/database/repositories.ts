import { and, eq, gte } from "drizzle-orm";
import type { PgDatabase } from "drizzle-orm/pg-core";
import type { SessionState, SessionStore } from "../spak-in/context/draft";
import { DuplicateKeyError, type AuditEvent, type AuditLog, type Submission, type SubmissionRepository } from "../spak-in/coordinator/types";
import type { IntentResult } from "../spak-in/schemas/result";
import type { ExecutionPlan } from "../spak-in/schemas/plan";
import { auditLog, intents, sessions, submissions } from "./schema";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Db = PgDatabase<any, any>;

function isUniqueViolation(e: unknown): boolean {
  const c = (e as { code?: string; cause?: { code?: string } }) ?? {};
  return c.code === "23505" || c.cause?.code === "23505";
}

export class PgSessionStore implements SessionStore {
  constructor(private readonly db: Db) {}
  async get(id: string): Promise<SessionState | null> {
    const [r] = await this.db.select().from(sessions).where(eq(sessions.id, id)).limit(1);
    if (!r) return null;
    return {
      sessionId: r.id, userId: r.userId, intentId: r.intentId, revision: r.revision, draft: r.draft as SessionState["draft"],
      lastStatus: r.lastStatus, submitted: r.submitted === 1, updatedAt: r.updatedAt.toISOString(),
    };
  }
  async put(s: SessionState): Promise<void> {
    const row = {
      id: s.sessionId, userId: s.userId, intentId: s.intentId, revision: s.revision, draft: s.draft,
      lastStatus: s.lastStatus, submitted: s.submitted ? 1 : 0, updatedAt: new Date(s.updatedAt),
    };
    await this.db.insert(sessions).values(row).onConflictDoUpdate({ target: sessions.id, set: row });
  }
  async markSubmitted(id: string, intentId: string): Promise<void> {
    await this.db.update(sessions).set({ submitted: 1 }).where(and(eq(sessions.id, id), eq(sessions.intentId, intentId)));
  }
  async delete(id: string): Promise<void> {
    await this.db.delete(sessions).where(eq(sessions.id, id));
  }
}

const toRow = (s: Submission) => ({ ...s, createdAt: new Date(s.createdAt), updatedAt: new Date(s.updatedAt) });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const fromRow = (r: any): Submission => ({ ...r, createdAt: r.createdAt.toISOString(), updatedAt: r.updatedAt.toISOString() });

export class PgSubmissionRepository implements SubmissionRepository {
  constructor(private readonly db: Db) {}
  async create(s: Submission) {
    try { await this.db.insert(submissions).values(toRow(s)); }
    catch (e) { if (isUniqueViolation(e)) throw new DuplicateKeyError("submission"); throw e; }
  }
  async update(id: string, patch: Partial<Submission>) {
    const { createdAt: _c, updatedAt, ...rest } = patch;
    await this.db.update(submissions).set({ ...rest, ...(updatedAt ? { updatedAt: new Date(updatedAt) } : {}) }).where(eq(submissions.id, id));
  }
  async get(id: string) {
    const [r] = await this.db.select().from(submissions).where(eq(submissions.id, id)).limit(1);
    return r ? fromRow(r) : null;
  }
  async findByPlanHash(h: string) {
    const [r] = await this.db.select().from(submissions).where(eq(submissions.planHash, h)).limit(1);
    return r ? fromRow(r) : null;
  }
  async findByIdempotencyKey(u: string, k: string) {
    const [r] = await this.db.select().from(submissions).where(and(eq(submissions.userId, u), eq(submissions.idempotencyKey, k))).limit(1);
    return r ? fromRow(r) : null;
  }
  async findRecentByFingerprint(u: string, fp: string, since: string) {
    const rows = await this.db.select().from(submissions)
      .where(and(eq(submissions.userId, u), eq(submissions.fingerprint, fp), gte(submissions.createdAt, new Date(since))));
    return rows.map(fromRow);
  }
}

export class PgAuditLog implements AuditLog {
  constructor(private readonly db: Db) {}
  async record(e: AuditEvent) {
    await this.db.insert(auditLog).values({ ...e, at: new Date(e.at) });
  }
}

/** Stores every interpreted intent revision. Hook it into SpakIn via the onResult option. */
export class PgIntentLog {
  constructor(private readonly db: Db) {}
  async record(r: IntentResult, userId: string | null) {
    await this.db.insert(intents).values({
      intentId: r.intentId, revision: r.revision, sessionId: r.sessionId, userId, input: r.input,
      intentType: r.intentType, status: r.status, planHash: r.plan?.hash ?? null, result: r,
      processingMs: String(r.meta.processingMs),
    }).onConflictDoNothing();
  }
  /** PlanSource for the coordinator: only plans SPak-in issued are executable. */
  async get(planHash: string): Promise<ExecutionPlan | null> {
    const [row] = await this.db.select({ result: intents.result }).from(intents).where(eq(intents.planHash, planHash)).limit(1);
    return (row?.result as IntentResult | undefined)?.plan ?? null;
  }
}
