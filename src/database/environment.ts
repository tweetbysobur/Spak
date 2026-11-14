import { eq } from "drizzle-orm";
import type { Db } from "./repositories";
import { environmentMarker, users } from "./schema";
import type { SpakNetworkEnv } from "../environment";
import { EnvironmentConfigError } from "../integrations/near-intents/provider";

/** SPAK_EXECUTION_ENV (server) must name the same environment as the build. Checked before the database is used. */
export function assertServerEnvironment(build: SpakNetworkEnv, env: Record<string, string | undefined> = process.env) {
  const exec = env.SPAK_EXECUTION_ENV || "mainnet";
  if (exec !== build) throw new EnvironmentConfigError(`SPAK_EXECUTION_ENV is "${exec}" but this build is "${build}". Both must name the same environment.`);
}

/**
 * The database must belong to this server's environment. The first server to start writes the marker; every later
 * start compares. A mismatch throws, so a testnet build pointed at a mainnet database (or the reverse) serves nothing.
 */
export async function assertDatabaseEnvironment(db: Db, env: SpakNetworkEnv, now: Date = new Date()) {
  const [existing] = await db.select().from(environmentMarker).where(eq(environmentMarker.id, 1)).limit(1);
  // A testnet server never claims a database that already has users: an unmarked database with data is presumed mainnet.
  if (!existing && env === "tidepool-testnet" && (await db.select({ id: users.id }).from(users).limit(1)).length) {
    throw new EnvironmentConfigError("This database already has users and no environment marker. The testnet build only starts on a new, empty database.");
  }
  await db.insert(environmentMarker).values({ id: 1, networkEnv: env, createdAt: now }).onConflictDoNothing();
  const [row] = await db.select().from(environmentMarker).where(eq(environmentMarker.id, 1)).limit(1);
  if (!row || row.networkEnv !== env) {
    throw new EnvironmentConfigError(`This database belongs to the "${row?.networkEnv ?? "unknown"}" environment and this server is "${env}". Use a separate database for each environment.`);
  }
}
