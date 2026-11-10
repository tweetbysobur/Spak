import { and, eq } from "drizzle-orm";
import type { PgDatabase } from "drizzle-orm/pg-core";
import type { SessionState, SessionStore } from "../spak-in/context/draft";
import type { AuditEvent, AuditLog } from "../execution/audit";
import type { IntentResult } from "../spak-in/schemas/result";
import { auditLog, intents, sessions } from "./schema";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Db = PgDatabase<any, any>;


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

}
