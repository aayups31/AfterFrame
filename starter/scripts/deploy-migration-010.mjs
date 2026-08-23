import { readFileSync } from "node:fs";
import { Client } from "pg";

process.loadEnvFile(new URL("../.env.local", import.meta.url));
const databaseUrl = process.env.SUPABASE_DB_URL;
if (databaseUrl === undefined) {
  throw new Error("Migration 010 deployment requires SUPABASE_DB_URL");
}
const migration = readFileSync(
  new URL(
    "../supabase/migrations/010_discovery_provider_takeover_reader.sql",
    import.meta.url,
  ),
  "utf8",
);
const client = new Client({ connectionString: databaseUrl });
await client.connect();
try {
  await client.query("begin");
  await client.query(
    "select pg_catalog.pg_advisory_xact_lock(hashtext('afterframe-schema-migration'))",
  );
  const versions = await client.query(
    "select version::text as version from supabase_migrations.schema_migrations order by version",
  );
  const expected = ["001", "002", "003", "004", "005", "006", "007", "008", "009"];
  if (JSON.stringify(versions.rows.map(({ version }) => version)) !== JSON.stringify(expected)) {
    throw new Error("Migration 010 requires the exact deployed 001-009 baseline");
  }
  const counts = await client.query(
    `select
       (select count(*)::integer from public.af_research_runs) as runs,
       (select count(*)::integer from public.af_research_provider_runs) as provider_runs`,
  );
  if (counts.rows[0]?.runs !== 0 || counts.rows[0]?.provider_runs !== 0) {
    throw new Error("Migration 010 deployment requires an empty research baseline");
  }
  await client.query(migration);
  await client.query(
    `insert into supabase_migrations.schema_migrations(version, statements, name)
     values ($1, $2::text[], $3)`,
    ["010", [migration], "discovery_provider_takeover_reader"],
  );
  const result = await client.query(
    `select to_regprocedure(
       'public.af_get_research_provider_run_v1(uuid,uuid,uuid,uuid)'
     ) is not null as installed`,
  );
  if (result.rows[0]?.installed !== true) {
    throw new Error("Migration 010 postcondition failed");
  }
  await client.query("commit");
  console.log("Migration 010 deployed and recorded successfully");
} catch (error) {
  await client.query("rollback");
  throw error;
} finally {
  await client.end();
}
