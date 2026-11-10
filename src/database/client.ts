import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import * as schema from "./schema";
import type { Db } from "./repositories";

export const MIGRATIONS_FOLDER = "src/database/migrations";

let cached: { db: Db; pool: Pool } | undefined;

/** Postgres connection from DATABASE_URL. Returns null when no database is configured. */
export function getDatabase(url = process.env.DATABASE_URL): Db | null {
  if (!url) return null;
  if (!cached) {
    const pool = new Pool({ connectionString: url, max: 5 });
    cached = { db: drizzle(pool, { schema }) as unknown as Db, pool };
  }
  return cached.db;
}

export async function runMigrations(url = process.env.DATABASE_URL): Promise<void> {
  if (!url) throw new Error("DATABASE_URL is not set.");
  const pool = new Pool({ connectionString: url, max: 1 });
  try { await migrate(drizzle(pool), { migrationsFolder: MIGRATIONS_FOLDER }); } finally { await pool.end(); }
}
