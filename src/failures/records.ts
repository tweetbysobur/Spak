import { and, asc, desc, eq, ne, sql } from "drizzle-orm";
import type { Db } from "../database/repositories";
import { executions, failureEvents, recoveryAttempts, refundTxs, refunds, reviewNotes, reviews } from "../database/schema";

export type RefundRow = typeof refunds.$inferSelect;
export type RefundTxRow = typeof refundTxs.$inferSelect;
export type ReviewRow = typeof reviews.$inferSelect;

/** Refund lifecycle (SPak's view; separate from execution and deposit states). */
export const REFUND_STATES = ["PENDING_PROVIDER", "INITIATED", "TX_DETECTED", "VERIFICATION_PENDING", "COMPLETED", "FAILED", "DELAYED", "UNKNOWN"] as const;
export type RefundState = (typeof REFUND_STATES)[number];

export class FailureRecords {
  constructor(private readonly db: Db, private readonly clock: () => Date = () => new Date()) {}

  // ------------------------------------------------------------------ refunds
  async openRefund(r: { executionId: string; userId: string; state: RefundState; network: string; assetId: string; refundTo: string; refundType: string; depositedAmount: string | null }) {
    const now = this.clock();
    await this.db.insert(refunds).values({ ...r, openedAt: now, updatedAt: now }).onConflictDoNothing();
    return (await this.refund(r.executionId))!;
  }
  async refund(executionId: string) {
    const [r] = await this.db.select().from(refunds).where(eq(refunds.executionId, executionId)).limit(1);
    return r ?? null;
  }
  /** Change refund state (compare-and-set on the state read) and log it. Returns null if another writer moved first. */
  async setRefund(executionId: string, from: string, patch: Partial<typeof refunds.$inferInsert>, event?: { code: string; detail?: Record<string, unknown> }) {
    const now = this.clock();
    return this.db.transaction(async (tx) => {
      const [r] = await tx.update(refunds).set({ ...patch, updatedAt: now }).where(and(eq(refunds.executionId, executionId), eq(refunds.state, from))).returning();
      if (r && event && (patch.state && patch.state !== from)) {
        await tx.insert(failureEvents).values({ executionId, at: now, category: "REFUND", code: event.code, temporary: 0, detail: { from, to: patch.state, ...(event.detail ?? {}) } });
      }
      return r ?? null;
    });
  }

  async registerRefundTx(v: { id: string; executionId: string; network: string; txHash: string; source: string; recipient: string; assetId: string; tokenContract: string | null }) {
    const now = this.clock();
    await this.db.insert(refundTxs).values({ ...v, outcome: "PENDING", firstCheckedAt: now, lastCheckedAt: now }).onConflictDoNothing();
    const [r] = await this.db.select().from(refundTxs).where(and(eq(refundTxs.network, v.network), eq(refundTxs.txHash, v.txHash))).limit(1);
    return r!;
  }
  async updateRefundTx(id: string, patch: Partial<typeof refundTxs.$inferInsert>) {
    await this.db.update(refundTxs).set({ ...patch, attempts: sql`${refundTxs.attempts} + 1`, lastCheckedAt: this.clock() }).where(eq(refundTxs.id, id));
  }
  async refundTxsFor(executionId: string) {
    return this.db.select().from(refundTxs).where(eq(refundTxs.executionId, executionId)).orderBy(asc(refundTxs.firstCheckedAt));
  }

  // ------------------------------------------------------------------ classification history
  async recordClassification(executionId: string, cls: { category: string; code: string; temporary: boolean } & Record<string, unknown>) {
    const now = this.clock();
    await this.db.transaction(async (tx) => {
      const [row] = await tx.select({ failure: executions.failure }).from(executions).where(eq(executions.id, executionId)).limit(1);
      if ((row?.failure as { code?: string } | null)?.code === cls.code) return; // idempotent: only changes are logged
      await tx.update(executions).set({ failure: { ...cls, at: now.toISOString() } }).where(eq(executions.id, executionId));
      await tx.insert(failureEvents).values({ executionId, at: now, category: cls.category, code: cls.code, temporary: cls.temporary ? 1 : 0, detail: { title: cls.title, message: cls.message } });
    });
  }
  async failureEvents(executionId: string) {
    return this.db.select().from(failureEvents).where(eq(failureEvents.executionId, executionId)).orderBy(asc(failureEvents.at), asc(failureEvents.id));
  }

  async recovery(a: { executionId: string; actor: string; action: string; outcome: string; detail?: Record<string, unknown> }) {
    await this.db.insert(recoveryAttempts).values({ ...a, detail: a.detail ?? {}, at: this.clock() });
  }
  async recentRecoveries(executionId: string, since: Date) {
    const rows = await this.db.select().from(recoveryAttempts).where(eq(recoveryAttempts.executionId, executionId)).orderBy(desc(recoveryAttempts.at)).limit(50);
    return rows.filter((r) => r.at >= since);
  }

  // ------------------------------------------------------------------ manual review
  /** Open a review case, or return the open one. Never duplicates. */
  async openReview(v: { id: string; executionId: string; reason: string; openedBy: string }) {
    const now = this.clock();
    await this.db.insert(reviews).values({ ...v, status: "OPEN", openedAt: now, updatedAt: now }).onConflictDoNothing();
    return (await this.openReviewFor(v.executionId))!;
  }
  async openReviewFor(executionId: string) {
    const [r] = await this.db.select().from(reviews).where(and(eq(reviews.executionId, executionId), ne(reviews.status, "RESOLVED"))).limit(1);
    return r ?? null;
  }
  async review(id: string) {
    const [r] = await this.db.select().from(reviews).where(eq(reviews.id, id)).limit(1);
    return r ?? null;
  }
  async reviewsFor(executionId: string) {
    return this.db.select().from(reviews).where(eq(reviews.executionId, executionId)).orderBy(desc(reviews.openedAt));
  }
  async listReviews(status: string | null, limit: number) {
    const q = this.db.select().from(reviews);
    return (status ? q.where(eq(reviews.status, status)) : q).orderBy(desc(reviews.openedAt)).limit(limit);
  }
  async addNote(reviewId: string, author: string, note: string, evidence: Record<string, unknown>) {
    const now = this.clock();
    await this.db.transaction(async (tx) => {
      await tx.insert(reviewNotes).values({ reviewId, at: now, author, note, evidence });
      await tx.update(reviews).set({ status: sql`case when ${reviews.status} = 'OPEN' then 'IN_REVIEW' else ${reviews.status} end`, updatedAt: now }).where(eq(reviews.id, reviewId));
    });
  }
  async notes(reviewId: string) {
    return this.db.select().from(reviewNotes).where(eq(reviewNotes.reviewId, reviewId)).orderBy(asc(reviewNotes.at), asc(reviewNotes.id));
  }
  async resolveReview(id: string, resolution: string) {
    const now = this.clock();
    const [r] = await this.db.update(reviews).set({ status: "RESOLVED", resolution, resolvedAt: now, updatedAt: now }).where(and(eq(reviews.id, id), ne(reviews.status, "RESOLVED"))).returning();
    return r ?? null;
  }
}
