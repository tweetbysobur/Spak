/**
 * Migration upgrade: a database at the pre-sprint schema (0000-0014, the last migration on main before this branch)
 * with existing data is upgraded with 0015-0019. Real SQL: PGlite by default, PostgreSQL 16 with SPAK_TEST_PG_URL.
 * Checks: every migration applies in journal order, existing rows survive unchanged, new columns default safely,
 * new constraints hold for old rows, and a second run applies nothing.
 */
import { describe, expect, it } from "vitest";
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { sql } from "drizzle-orm";
import { Client, Pool } from "pg";
import { PGlite } from "@electric-sql/pglite";
import { drizzle as pgDrizzle } from "drizzle-orm/node-postgres";
import { migrate as pgMigrate } from "drizzle-orm/node-postgres/migrator";
import { drizzle as liteDrizzle } from "drizzle-orm/pglite";
import { migrate as liteMigrate } from "drizzle-orm/pglite/migrator";

const FOLDER = "src/database/migrations";
const journal = JSON.parse(readFileSync(`${FOLDER}/meta/_journal.json`, "utf8")) as { entries: { idx: number; tag: string; when: number }[] };

function folderUpTo(idx: number) {
  const dir = mkdtempSync(join(tmpdir(), "spak-mig-"));
  cpSync(FOLDER, dir, { recursive: true });
  const j = structuredClone(journal);
  j.entries = j.entries.filter((e) => e.idx <= idx);
  writeFileSync(join(dir, "meta/_journal.json"), JSON.stringify(j));
  return dir;
}

async function database() {
  const admin = process.env.SPAK_TEST_PG_URL;
  if (admin) {
    const name = `spak_t_${randomBytes(6).toString("hex")}`;
    const c = new Client({ connectionString: admin }); await c.connect(); await c.query(`create database ${name}`); await c.end();
    const u = new URL(admin); u.pathname = `/${name}`;
    const d = pgDrizzle(new Pool({ connectionString: u.toString(), max: 3 }));
    return { db: d, migrate: (folder: string) => pgMigrate(d, { migrationsFolder: folder }) };
  }
  const d = liteDrizzle(new PGlite());
  return { db: d, migrate: (folder: string) => liteMigrate(d, { migrationsFolder: folder }) };
}
const rows = <T>(r: unknown) => ((r as { rows?: T[] }).rows ?? (r as T[]));

describe("migration upgrade 0014 to latest", () => {
  it("journal is ordered, contiguous and matches the SQL files", () => {
    expect(journal.entries.map((e) => e.idx)).toEqual(journal.entries.map((_, i) => i));
    for (let i = 1; i < journal.entries.length; i++) expect(journal.entries[i].when).toBeGreaterThan(journal.entries[i - 1].when);
    for (const e of journal.entries) expect(() => readFileSync(`${FOLDER}/${e.tag}.sql`, "utf8")).not.toThrow();
    expect(journal.entries.at(-1)!.idx).toBeGreaterThanOrEqual(19);
  });

  it("upgrades a populated 0014 database without data loss; new constraints hold; re-running applies nothing", async () => {
    const { db, migrate } = await database();
    await migrate(folderUpTo(14));
    const t = "2026-11-01T10:00:00Z";
    const seed = `
      insert into spak_users (id, created_at) values ('usr_old', '${t}');
      insert into spak_agents (id, user_id, display_name, status, created_at, updated_at) values ('agt_old', 'usr_old', 'Old agent', 'CREATED', '${t}', '${t}');
      insert into spak_executions (id, user_id, intent_id, plan_revision, plan_id, plan_hash, plan, idempotency_key, fingerprint, state, provider, source_network, destination_network,
        source_asset_id, destination_asset_id, amount_in, recipient, recipient_kind, refund_address, amount_out_verified, created_at, updated_at)
        values ('exe_old', 'usr_old', 'int_1', 0, 'plan_1', '${"a".repeat(64)}', '{}', 'idem-old-1', 'fp', 'COMPLETED', 'near-intents', 'base', 'arbitrum',
        'base:native', 'arbitrum:native', '1000', '0x1111111111111111111111111111111111111111', 'SELF', '0x1111111111111111111111111111111111111111', '990', '${t}', '${t}');
      insert into spak_quotes (id, execution_id, user_id, plan_id, plan_hash, plan_revision, kind, status, source_network, destination_network, source_asset_id, destination_asset_id,
        provider_origin_asset, provider_destination_asset, amount_in, amount_in_usd, slippage_bps, expires_at, request, created_at)
        values ('qte_old', 'exe_old', 'usr_old', 'plan_1', '${"a".repeat(64)}', 0, 'FIRM', 'USED', 'base', 'arbitrum', 'base:native', 'arbitrum:native', 'p1', 'p2', '1000', '50.0', 100, '${t}', '{}', '${t}');
      insert into spak_approvals (id, execution_id, user_id, quote_id, plan_hash, plan_revision, approved_at, created_at)
        values ('apv_old', 'exe_old', 'usr_old', 'qte_old', '${"a".repeat(64)}', 0, '${t}', '${t}');
      insert into spak_guard_reservations (id, user_id, execution_id, quote_id, decision_id, amount_usd, status, reserved_at)
        values ('grs_old', 'usr_old', 'exe_old', 'qte_old', 'gdc_old', '50.0', 'CONSUMED', '${t}');
      insert into spak_destination_verifications (id, execution_id, network, tx_hash, outcome, recipient, asset_id, first_checked_at, last_checked_at)
        values ('dvf_old', 'exe_old', 'arbitrum', 'not-an-evm-hash', 'PENDING', '0x1111111111111111111111111111111111111111', 'arbitrum:native', '${t}', '${t}');
    `;
    for (const stmt of seed.split(";").map((x) => x.trim()).filter(Boolean)) await db.execute(sql.raw(stmt));
    const before = rows<Record<string, unknown>>(await db.execute(sql`select e.state, e.amount_out_verified, q.amount_in_usd, r.amount_usd, d.outcome from spak_executions e join spak_quotes q on q.execution_id = e.id join spak_guard_reservations r on r.execution_id = e.id join spak_destination_verifications d on d.execution_id = e.id`));
    await migrate(FOLDER);
    const after = rows<Record<string, unknown>>(await db.execute(sql`select e.state, e.amount_out_verified, q.amount_in_usd, r.amount_usd, d.outcome from spak_executions e join spak_quotes q on q.execution_id = e.id join spak_guard_reservations r on r.execution_id = e.id join spak_destination_verifications d on d.execution_id = e.id`));
    expect(after).toEqual(before); // existing data untouched, including the stale destination record (reclassified only by the app)
    const [n] = rows<Record<string, unknown>>(await db.execute(sql`select
      (select agent_id from spak_executions where id = 'exe_old') as agent_id,
      (select approved_by from spak_approvals where id = 'apv_old') as approved_by,
      (select grant_id from spak_approvals where id = 'apv_old') as grant_id,
      (select valuation_usd from spak_quotes where id = 'qte_old') as valuation_usd,
      (select count(*)::int from spak_environment) as env_rows,
      (select count(*)::int from spak_agent_grants) as grants,
      (select count(*)::int from spak_rate_limits) as limits,
      (select count(*)::int from spak_alerts) as alerts`));
    expect(n).toEqual({ agent_id: null, approved_by: "USER", grant_id: null, valuation_usd: null, env_rows: 0, grants: 0, limits: 0, alerts: 0 });
    // Every constraint is validated against the old rows (none left NOT VALID except the documented 0013 one).
    const invalid = rows<{ conname: string }>(await db.execute(sql`select conname from pg_constraint where not convalidated and connamespace = 'public'::regnamespace`)).map((r) => r.conname);
    expect(invalid).toEqual(["spak_agent_accounts_active_evidence_ck"]);
    // New constraints reject bad data.
    await expect(db.execute(sql`update spak_approvals set approved_by = 'AGENT_GRANT' where id = 'apv_old'`)).rejects.toThrow();
    await expect(db.execute(sql`update spak_quotes set valuation_usd = '1e3' where id = 'qte_old'`)).rejects.toThrow();
    await expect(db.execute(sql`insert into spak_environment (id, network_env, created_at) values (2, 'mainnet', now())`)).rejects.toThrow();
    // Re-running is a no-op.
    const count = async () => rows<{ n: number }>(await db.execute(sql`select count(*)::int as n from drizzle.__drizzle_migrations`))[0].n;
    const applied = await count();
    expect(applied).toBe(journal.entries.length);
    await migrate(FOLDER);
    expect(await count()).toBe(applied);
  }, 120_000);
});
