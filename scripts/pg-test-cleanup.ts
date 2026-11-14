/** Drops the throwaway spak_t_* databases created by tests on the isolated PostgreSQL server in SPAK_TEST_PG_URL. */
import { Client } from "pg";
(async () => {
  const url = process.env.SPAK_TEST_PG_URL;
  if (!url) throw new Error("SPAK_TEST_PG_URL is not set.");
  const c = new Client({ connectionString: url }); await c.connect();
  const { rows } = await c.query("select datname from pg_database where datname like 'spak\\_t\\_%'");
  for (const r of rows) await c.query(`drop database if exists ${r.datname} with (force)`);
  await c.end(); console.log(`Dropped ${rows.length} test databases.`);
})().catch((e) => { console.error(e); process.exit(1); });
