import { readFileSync } from "node:fs";
import { Client } from "pg";

process.loadEnvFile(new URL("../.env.local", import.meta.url));
const databaseUrl = process.env.SUPABASE_DB_URL;
if (databaseUrl === undefined) {
  throw new Error("Migration 015 deployment requires SUPABASE_DB_URL");
}
const migration = readFileSync(
  new URL(
    "../supabase/migrations/015_durable_source_normalization_acceptance.sql",
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
    "001", "002", "003", "004", "005", "006", "007",
    "008", "009", "010", "011", "012", "013", "014",
  ];
  if (
    JSON.stringify(versions.rows.map(({ version }) => version)) !==
    JSON.stringify(expected)
  ) {
    throw new Error("Migration 015 requires the exact deployed 001-014 baseline");
  }
  const activeWork = await client.query(
    `select count(*)::integer as count
     from public.af_research_jobs where status = 'RUNNING'`,
  );
  if (activeWork.rows[0]?.count !== 0) {
    throw new Error("Migration 015 deployment requires zero active research jobs");
  }

  await client.query(migration);
  await client.query(
    `insert into supabase_migrations.schema_migrations(version, statements, name)
     values ($1, $2::text[], $3)`,
    ["015", [migration], "durable_source_normalization_acceptance"],
  );

  const installed = await client.query(
    `select
       to_regclass('public.af_source_normalization_records') is not null as normalization_table,
       coalesce((
         select relation.relrowsecurity and relation.relforcerowsecurity
         from pg_catalog.pg_class relation
         join pg_catalog.pg_namespace namespace
           on namespace.oid = relation.relnamespace
         where namespace.nspname = 'public'
           and relation.relname = 'af_source_normalization_records'
       ), false) as forced_rls,
       to_regprocedure(
         'public.af_get_source_normalization_records_v1(uuid,uuid,uuid,uuid)'
       ) is not null as record_reader,
       to_regprocedure(
         'public.af_accept_source_normalization_v1(uuid,jsonb,jsonb,integer)'
       ) is not null as acceptance_boundary,
       exists (
         select 1 from pg_catalog.pg_constraint constraint_record
         where constraint_record.conrelid =
           'public.af_source_normalization_records'::regclass
           and constraint_record.conname = 'af_source_normalization_content_fk'
       ) as content_lineage,
       not has_table_privilege('anon', 'public.af_source_normalization_records', 'select')
         and not has_table_privilege('authenticated', 'public.af_source_normalization_records', 'select')
         as client_table_denied`,
  );
  const postcondition = installed.rows[0];
  if (
    postcondition?.normalization_table !== true ||
    postcondition.forced_rls !== true ||
    postcondition.record_reader !== true ||
    postcondition.acceptance_boundary !== true ||
    postcondition.content_lineage !== true ||
    postcondition.client_table_denied !== true
  ) {
    throw new Error("Migration 015 postcondition failed");
  }
  await client.query("commit");
  console.log("Migration 015 deployed and recorded successfully");
} catch (error) {
  await client.query("rollback");
  throw error;
} finally {
  await client.end();
}
