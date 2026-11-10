import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import type { Db } from "@/database/repositories";

/** Fresh in-process Postgres with the real migrations applied. */
export async function freshDb(): Promise<Db> {
  const d = drizzle(new PGlite());
  await migrate(d, { migrationsFolder: "src/database/migrations" });
  return d as unknown as Db;
}
