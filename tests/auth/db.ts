import { randomBytes } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { drizzle as pgDrizzle } from "drizzle-orm/node-postgres";
import { migrate as pgMigrate } from "drizzle-orm/node-postgres/migrator";
import { Client, Pool } from "pg";
import type { Db } from "@/database/repositories";

/**
 * Fresh database with the real migrations applied.
 * - Default: in-process PGlite (one connection; concurrent requests are serialised).
 * - SPAK_TEST_PG_URL set (an admin URL to an isolated PostgreSQL server, never production): a brand-new PostgreSQL
 *   database per call, reached through a real connection pool, so concurrent transactions run on separate
 *   connections and row locks are exercised for real. Databases are named spak_t_<random> and dropped afterwards
 *   by scripts/pg-test-cleanup.ts.
 */
export async function freshDb(): Promise<Db> {
  const admin = process.env.SPAK_TEST_PG_URL;
  if (admin) {
    const name = `spak_t_${randomBytes(6).toString("hex")}`;
    const c = new Client({ connectionString: admin });
    await c.connect();
    try { await c.query(`create database ${name}`); } finally { await c.end(); }
    const u = new URL(admin); u.pathname = `/${name}`;
    const d = pgDrizzle(new Pool({ connectionString: u.toString(), max: 6, idleTimeoutMillis: 2000 }));
    await pgMigrate(d, { migrationsFolder: "src/database/migrations" });
    return d as unknown as Db;
  }
  const d = drizzle(new PGlite());
  await migrate(d, { migrationsFolder: "src/database/migrations" });
  return d as unknown as Db;
}
