import { readFileSync } from "node:fs";
import { Client } from "pg";

process.loadEnvFile(new URL("../.env.local", import.meta.url));
const databaseUrl = process.env.SUPABASE_DB_URL;
if (!databaseUrl) throw new Error("Migration 018 requires SUPABASE_DB_URL");
const migration = readFileSync(new URL("../supabase/migrations/018_exact_locator_coordinate_guard.sql", import.meta.url), "utf8");
const client = new Client({ connectionString: databaseUrl, connectionTimeoutMillis: 15_000 });
await client.connect();
try {
  await client.query("begin");
  await client.query("set local statement_timeout = '30s'");
  await client.query("select pg_catalog.pg_advisory_xact_lock(hashtext('afterframe-schema-migration'))");
  const versions = await client.query("select version::text as version from supabase_migrations.schema_migrations order by version");
  const expected = Array.from({ length: 17 }, (_, index) => String(index + 1).padStart(3, "0"));
  if (JSON.stringify(versions.rows.map(({ version }) => version)) !== JSON.stringify(expected)) {
    throw new Error("Migration 018 requires the exact 001-017 baseline");
  }
  const active = await client.query("select count(*)::integer as count from public.af_research_jobs where status='RUNNING'");
  if (active.rows[0]?.count !== 0) throw new Error("Migration 018 requires zero active research jobs");
  await client.query(migration);
  const check = await client.query(`select
    exists(select 1 from pg_catalog.pg_trigger
      where tgrelid='public.af_exact_locator_verification_records'::regclass
        and tgname='af_exact_locator_coordinate_guard' and tgenabled='O'
        and tgfoid='public.af_guard_exact_locator_coordinates_v1()'::regprocedure) as guard_installed,
    not has_function_privilege('anon','public.af_exact_locator_coordinates_valid_v1(public.af_exact_locator_verification_records)','execute')
      and not has_function_privilege('authenticated','public.af_exact_locator_coordinates_valid_v1(public.af_exact_locator_verification_records)','execute') as client_denied,
    not exists(select 1 from public.af_exact_locator_verification_records verification
      where public.af_exact_locator_coordinates_valid_v1(verification) is distinct from true) as existing_valid`);
  if (!check.rows[0]?.guard_installed || !check.rows[0]?.client_denied || !check.rows[0]?.existing_valid) {
    throw new Error("Migration 018 postconditions failed");
  }
  await client.query("insert into supabase_migrations.schema_migrations(version,statements,name) values($1,$2::text[],$3)",
    ["018", [migration], "exact_locator_coordinate_guard"]);
  await client.query("commit");
  console.log("Migration 018 deployed and recorded successfully");
} catch (error) {
  await client.query("rollback");
  throw error;
} finally {
  await client.end();
}
