import { readFileSync } from "node:fs";
import { Client } from "pg";

process.loadEnvFile(new URL("../.env.local", import.meta.url));
const databaseUrl = process.env.SUPABASE_DB_URL;
if (databaseUrl === undefined) {
  throw new Error("Migration 009 deployment requires SUPABASE_DB_URL");
}
const parsed = new URL(databaseUrl);
if (
  !["postgres:", "postgresql:"].includes(parsed.protocol) ||
  parsed.username.length === 0 ||
  parsed.password.length === 0 ||
  parsed.hostname.length === 0
) {
  throw new Error("Migration 009 deployment requires a credentialed PostgreSQL URL");
}

const migration = readFileSync(
  new URL(
    "../supabase/migrations/009_durable_discovery_provider_acceptance.sql",
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
    `select version::text as version
     from supabase_migrations.schema_migrations order by version`,
  );
  const expected = ["001", "002", "003", "004", "005", "006", "007", "008"];
  if (JSON.stringify(versions.rows.map(({ version }) => version)) !== JSON.stringify(expected)) {
    throw new Error("Migration 009 requires the exact deployed 001-008 baseline");
  }
  const runCount = await client.query(
    "select count(*)::integer as count from public.af_research_runs",
  );
  if (runCount.rows[0]?.count !== 0) {
    throw new Error("Migration 009 deployment requires zero live research runs");
  }

  await client.query(migration);
  await client.query(
    `insert into supabase_migrations.schema_migrations(version, statements, name)
     values ($1, $2::text[], $3)`,
    ["009", [migration], "durable_discovery_provider_acceptance"],
  );
  const posture = await client.query(
    `select
       to_regclass('public.af_research_provider_runs') is not null as provider_table,
       to_regprocedure('public.af_get_research_discovery_context_v1(uuid,uuid,uuid)') is not null as context_rpc,
       to_regprocedure('public.af_accept_research_provider_run_v1(uuid,jsonb,jsonb,jsonb,integer)') is not null as acceptance_rpc`,
  );
  if (
    posture.rows[0]?.provider_table !== true ||
    posture.rows[0]?.context_rpc !== true ||
    posture.rows[0]?.acceptance_rpc !== true
  ) {
    throw new Error("Migration 009 postcondition failed");
  }
  await client.query("commit");
  console.log("Migration 009 deployed and recorded successfully");
} catch (error) {
  await client.query("rollback");
  throw error;
} finally {
  await client.end();
}
