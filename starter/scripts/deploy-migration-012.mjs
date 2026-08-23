import { readFileSync } from "node:fs";
import { Client } from "pg";

process.loadEnvFile(new URL("../.env.local", import.meta.url));
const databaseUrl = process.env.SUPABASE_DB_URL;
if (databaseUrl === undefined) {
  throw new Error("Migration 012 deployment requires SUPABASE_DB_URL");
}
const migration = readFileSync(
  new URL(
    "../supabase/migrations/012_candidate_axis_bindings.sql",
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
  const expected = [
    "001", "002", "003", "004", "005", "006",
    "007", "008", "009", "010", "011",
  ];
  if (
    JSON.stringify(versions.rows.map(({ version }) => version)) !==
    JSON.stringify(expected)
  ) {
    throw new Error("Migration 012 requires the exact deployed 001-011 baseline");
  }
  const counts = await client.query(
    `select
       (select count(*)::integer from public.af_research_runs) as runs,
       (select count(*)::integer from public.af_source_candidates) as candidates`,
  );
  if (counts.rows[0]?.runs !== 0 || counts.rows[0]?.candidates !== 0) {
    throw new Error("Migration 012 deployment requires an empty research baseline");
  }
  await client.query(migration);
  await client.query(
    `insert into supabase_migrations.schema_migrations(version, statements, name)
     values ($1, $2::text[], $3)`,
    ["012", [migration], "candidate_axis_bindings"],
  );
  const installed = await client.query(
    `select
       exists (
         select 1 from information_schema.columns
         where table_schema = 'public'
           and table_name = 'af_source_candidates'
           and column_name = 'axis_ids'
       ) as axis_column,
       to_regprocedure(
         'public.af_persist_research_stage_result(uuid,uuid,uuid,public.af_research_stage,public.af_sha256,uuid,jsonb,timestamp with time zone)'
       ) is not null as persistence_boundary,
       to_regprocedure(
         'public.af_research_stage_result_valid(jsonb,uuid,uuid,uuid,public.af_research_stage)'
       ) is not null as validation_boundary`,
  );
  if (
    installed.rows[0]?.axis_column !== true ||
    installed.rows[0]?.persistence_boundary !== true ||
    installed.rows[0]?.validation_boundary !== true
  ) {
    throw new Error("Migration 012 postcondition failed");
  }
  await client.query("commit");
  console.log("Migration 012 deployed and recorded successfully");
} catch (error) {
  await client.query("rollback");
  throw error;
} finally {
  await client.end();
}

