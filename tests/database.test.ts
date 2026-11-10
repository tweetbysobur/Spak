import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeAll, describe, expect, it } from "vitest";
import { PgAuditLog, PgIntentLog, PgSessionStore, PgSubmissionRepository, type Db } from "@/database/repositories";
import { DuplicateKeyError, type Submission } from "@/spak-in/coordinator/types";
import { SpakIn, sequentialIds } from "@/spak-in";

let db: Db;
beforeAll(async () => {
  const pg = new PGlite();
  const d = drizzle(pg);
  await migrate(d, { migrationsFolder: "src/database/migrations" });
  db = d as unknown as Db;
});

const sub = (over: Partial<Submission> = {}): Submission => ({
  id: "spak_sub_1", userId: "u1", intentId: "spak_int_1", planId: "spak_plan_1", planHash: "h".repeat(64),
  fingerprint: "fp", idempotencyKey: "key-12345", provider: "near-intents", state: "PREPARING", providerRef: null,
  deposit: null, quote: null, error: null, createdAt: "2026-11-10T10:00:00.000Z", updatedAt: "2026-11-10T10:00:00.000Z", ...over,
});

describe("Postgres repositories (PGlite, real SQL migration)", () => {
  it("enforces one submission per plan hash and per idempotency key", async () => {
    const repo = new PgSubmissionRepository(db);
    await repo.create(sub());
    await expect(repo.create(sub({ id: "spak_sub_2", idempotencyKey: "other-key" }))).rejects.toBeInstanceOf(DuplicateKeyError);
    await expect(repo.create(sub({ id: "spak_sub_3", planHash: "x".repeat(64) }))).rejects.toBeInstanceOf(DuplicateKeyError);
    await repo.update("spak_sub_1", { state: "AWAITING_DEPOSIT", providerRef: "0xdep", updatedAt: "2026-11-10T10:01:00.000Z" });
    expect((await repo.get("spak_sub_1"))?.state).toBe("AWAITING_DEPOSIT");
    expect((await repo.findByIdempotencyKey("u1", "key-12345"))?.id).toBe("spak_sub_1");
    expect(await repo.findRecentByFingerprint("u1", "fp", "2026-11-10T09:59:00.000Z")).toHaveLength(1);
    expect(await repo.findRecentByFingerprint("u1", "fp", "2026-11-10T10:00:01.000Z")).toHaveLength(0);
  });

  it("persists session context so follow-ups survive restarts", async () => {
    const store = new PgSessionStore(db);
    const log = new PgIntentLog(db);
    const a = new SpakIn({ sessions: store, ids: sequentialIds(), onResult: (r) => log.record(r, "u1") });
    const wallets = { base: "0x1111111111111111111111111111111111111111", solana: "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU" };
    await a.interpret({ text: "Swap 50 USDC on Base to SOL on Solana", sessionId: "ses-db", wallets });
    const b = new SpakIn({ sessions: new PgSessionStore(db), ids: sequentialIds() });
    const r = await b.interpret({ text: "make it 100 instead", sessionId: "ses-db", wallets });
    expect(r.status).toBe("VALIDATED");
    expect(r.source.amount).toEqual({ kind: "EXACT", value: "100" });
    expect(r.revision).toBe(1);
  });

  it("appends audit events", async () => {
    await new PgAuditLog(db).record({ at: "2026-11-10T10:00:00.000Z", actor: "user:u1", event: "PLAN_APPROVED", ref: "spak_sub_1", data: { a: 1 } });
  });
});
