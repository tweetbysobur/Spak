import { and, asc, eq, inArray, isNotNull, isNull, lt, lte, or, sql } from "drizzle-orm";
import type { Db } from "../database/repositories";
import { destinationVerifications, executions, monitorAttempts, monitorRuns } from "../database/schema";

export type DestinationVerificationRow = typeof destinationVerifications.$inferSelect;
export type MonitorAttemptRow = typeof monitorAttempts.$inferSelect;

/** States the background monitor follows. Terminal states and approvals in progress are never claimed. */
/** REFUNDED is watched read-only for a while after completion (post-completion reconciliation), then stopped. */
export const MONITORED_STATES = ["AWAITING_DEPOSIT", "PROCESSING", "VERIFYING_DESTINATION", "FAILED", "REFUNDING", "UNKNOWN", "REFUNDED"] as const;

export class TrackingRecords {
  constructor(private readonly db: Db, private readonly clock: () => Date = () => new Date()) {}

  // ---------------------------------------------------------------- destination verifications
  /** Register a destination tx for an execution. Returns the row; its executionId may differ (tx already claimed). */
  async registerDestinationTx(v: { id: string; executionId: string; network: string; txHash: string; recipient: string; assetId: string; tokenContract: string | null }) {
    const now = this.clock();
    await this.db.insert(destinationVerifications).values({ ...v, outcome: "PENDING", firstCheckedAt: now, lastCheckedAt: now }).onConflictDoNothing();
    const [r] = await this.db.select().from(destinationVerifications).where(and(eq(destinationVerifications.network, v.network), eq(destinationVerifications.txHash, v.txHash))).limit(1);
    return r!;
  }
  async updateDestination(id: string, patch: Partial<typeof destinationVerifications.$inferInsert>) {
    await this.db.update(destinationVerifications).set({ ...patch, attempts: sql`${destinationVerifications.attempts} + 1`, lastCheckedAt: this.clock() }).where(eq(destinationVerifications.id, id));
  }
  async destinationsFor(executionId: string) {
    return this.db.select().from(destinationVerifications).where(eq(destinationVerifications.executionId, executionId)).orderBy(asc(destinationVerifications.firstCheckedAt));
  }

  // ---------------------------------------------------------------- monitor scheduling and atomic claims
  async candidates(limit: number) {
    const now = this.clock();
    return this.db.select({ id: executions.id }).from(executions).where(and(
      inArray(executions.state, [...MONITORED_STATES]), isNotNull(executions.depositAddress), isNull(executions.monitorGaveUpAt),
      or(isNull(executions.monitorNextAt), lte(executions.monitorNextAt, now)),
      or(isNull(executions.monitorLeaseUntil), lt(executions.monitorLeaseUntil, now)),
    )).orderBy(sql`${executions.monitorNextAt} asc nulls first`).limit(limit);
  }
  /** Atomic claim: only one worker holds an execution until the lease ends. An expired lease (crashed worker) can be taken. */
  async claim(id: string, owner: string, leaseMs: number) {
    const now = this.clock();
    const [r] = await this.db.update(executions).set({ monitorLeaseOwner: owner, monitorLeaseUntil: new Date(now.getTime() + leaseMs) })
      .where(and(eq(executions.id, id), or(isNull(executions.monitorLeaseUntil), lt(executions.monitorLeaseUntil, now)))).returning();
    return r ?? null;
  }
  async release(id: string, owner: string, patch: { monitorNextAt: Date | null; monitorFailures: number; monitorGaveUpAt?: Date | null }) {
    await this.db.update(executions).set({ ...patch, monitorLeaseOwner: null, monitorLeaseUntil: null })
      .where(and(eq(executions.id, id), eq(executions.monitorLeaseOwner, owner)));
  }
  /** A user refresh resumes monitoring that gave up. */
  async resume(id: string) {
    await this.db.update(executions).set({ monitorGaveUpAt: null, monitorFailures: 0, monitorNextAt: null }).where(eq(executions.id, id));
  }

  async startAttempt(a: { executionId: string; workerId: string; fromState: string }) {
    const [r] = await this.db.insert(monitorAttempts).values({ ...a, startedAt: this.clock() }).returning({ id: monitorAttempts.id });
    return r!.id;
  }
  async finishAttempt(id: number, f: { outcome: string; toState: string | null; detail: string | null }) {
    await this.db.update(monitorAttempts).set({ ...f, detail: f.detail?.slice(0, 1000) ?? null, finishedAt: this.clock() }).where(eq(monitorAttempts.id, id));
  }
  async attemptsFor(executionId: string, limit = 20) {
    return this.db.select().from(monitorAttempts).where(eq(monitorAttempts.executionId, executionId)).orderBy(sql`${monitorAttempts.startedAt} desc`).limit(limit);
  }

  async startRun(id: string, trigger: string) { await this.db.insert(monitorRuns).values({ id, trigger, startedAt: this.clock() }); }
  async finishRun(id: string, f: { claimed: number; processed: number; failed: number; error: string | null }) {
    await this.db.update(monitorRuns).set({ ...f, finishedAt: this.clock() }).where(eq(monitorRuns.id, id));
  }
}
