import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeAll, describe, expect, it } from "vitest";
import { PgAuditLog, PgIntentLog, PgSessionStore, type Db } from "@/database/repositories";
import { SpakIn, sequentialIds } from "@/spak-in";

let db: Db;
beforeAll(async () => {
  const pg = new PGlite();
  const d = drizzle(pg);
  await migrate(d, { migrationsFolder: "src/database/migrations" });
  db = d as unknown as Db;
});

describe("Postgres repositories (PGlite, real SQL migration)", () => {
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
