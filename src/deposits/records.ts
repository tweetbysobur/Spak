import { and, desc, eq, inArray } from "drizzle-orm";
import type { Db } from "../database/repositories";
import { depositEvents, deposits } from "../database/schema";
import { isUniqueViolation } from "../execution/records";
import { canMove, type DepositState } from "./types";

export type DepositRow = typeof deposits.$inferSelect;
export type DepositInsert = typeof deposits.$inferInsert;

export class DuplicateTxError extends Error {}

/** Deposit records. State changes are compare-and-set with an event per change. */
export class DepositRecords {
  constructor(private readonly db: Db, private readonly clock: () => Date = () => new Date()) {}

  async insert(row: DepositInsert) {
    try {
      await this.db.transaction(async (tx) => {
        await tx.insert(deposits).values(row);
        await tx.insert(depositEvents).values({ depositId: row.id, at: row.createdAt, fromState: null, toState: row.state, reason: "Deposit prepared.", data: {} });
      });
    } catch (e) {
      if (isUniqueViolation(e)) throw new DuplicateTxError("transaction already used");
      throw e;
    }
    return (await this.get(row.id))!;
  }
  async get(id: string) {
    const [r] = await this.db.select().from(deposits).where(eq(deposits.id, id)).limit(1);
    return r ?? null;
  }
  async getForUser(id: string, userId: string) {
    const [r] = await this.db.select().from(deposits).where(and(eq(deposits.id, id), eq(deposits.userId, userId))).limit(1);
    return r ?? null;
  }
  async forExecution(executionId: string) {
    return this.db.select().from(deposits).where(eq(deposits.executionId, executionId)).orderBy(desc(deposits.createdAt));
  }
  async byTx(network: string, txHash: string) {
    const [r] = await this.db.select().from(deposits).where(and(eq(deposits.network, network), eq(deposits.txHash, txHash))).limit(1);
    return r ?? null;
  }
  async inStates(executionId: string, states: DepositState[]) {
    return this.db.select().from(deposits).where(and(eq(deposits.executionId, executionId), inArray(deposits.state, states)));
  }
  async list(userId: string, opts: { limit: number; executionId?: string }) {
    return this.db.select().from(deposits)
      .where(and(eq(deposits.userId, userId), ...(opts.executionId ? [eq(deposits.executionId, opts.executionId)] : [])))
      .orderBy(desc(deposits.createdAt)).limit(opts.limit);
  }
  async events(id: string) {
    return this.db.select().from(depositEvents).where(eq(depositEvents.depositId, id)).orderBy(depositEvents.at, depositEvents.id);
  }

  /** Atomic transition. Returns null if the state changed underneath. Throws DuplicateTxError on a reused tx. */
  async transition(id: string, from: DepositState, to: DepositState, reason: string, patch: Partial<DepositInsert> = {}, data: Record<string, unknown> = {}) {
    if (!canMove(from, to)) throw new Error(`Deposit cannot move from ${from} to ${to}.`);
    const now = this.clock();
    try {
      return await this.db.transaction(async (tx) => {
        const [r] = await tx.update(deposits).set({ ...patch, state: to, updatedAt: now }).where(and(eq(deposits.id, id), eq(deposits.state, from))).returning();
        if (!r) return null;
        if (from !== to || Object.keys(data).length) await tx.insert(depositEvents).values({ depositId: id, at: now, fromState: from, toState: to, reason, data });
        return r;
      });
    } catch (e) {
      if (isUniqueViolation(e)) throw new DuplicateTxError("transaction already used");
      throw e;
    }
  }
  async touch(id: string, patch: Partial<DepositInsert>) {
    await this.db.update(deposits).set({ ...patch, updatedAt: this.clock() }).where(eq(deposits.id, id));
  }
}
