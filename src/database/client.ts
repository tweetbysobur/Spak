import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import * as schema from "./schema";
import type { Db } from "./repositories";

export const MIGRATIONS_FOLDER = "src/database/migrations";
export const LOCAL_PGLITE_DIR = ".data/pglite";

let pending: Promise<Db> | undefined;

/**
 * The database for this process.
 * - DATABASE_URL set: Postgres through node-postgres. Run `npm run db:migrate` on deploy.
 * - Not set: an embedded PGlite database in .data/pglite, migrated on first use. Local development only.
 */
export function getDb(url = process.env.DATABASE_URL): Promise<Db> {
  pending ??= (async () => {
    if (url) return drizzle(new Pool({ connectionString: url, max: 5 }), { schema }) as unknown as Db;
    if (process.env.NODE_ENV === "production" && !process.env.SPAK_ALLOW_EMBEDDED_DB) {
      throw new Error("DATABASE_URL is required in production.");
    }
    const { PGlite } = await import("@electric-sql/pglite");
    const { drizzle: pgliteDrizzle } = await import("drizzle-orm/pglite");
    const { migrate: pgliteMigrate } = await import("drizzle-orm/pglite/migrator");
    // SPAK_PGLITE_DIR=memory:// gives a throwaway database (tests).
    const db = pgliteDrizzle(new PGlite(process.env.SPAK_PGLITE_DIR ?? LOCAL_PGLITE_DIR), { schema });
    await pgliteMigrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
    return db as unknown as Db;
  })();
  return pending;
}

export async function runMigrations(url = process.env.DATABASE_URL): Promise<void> {
  if (!url) throw new Error("DATABASE_URL is not set.");
  const pool = new Pool({ connectionString: url, max: 1 });
  try { await migrate(drizzle(pool), { migrationsFolder: MIGRATIONS_FOLDER }); } finally { await pool.end(); }
}
