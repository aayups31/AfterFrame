import { readFileSync } from "node:fs";
import { Client } from "pg";

process.loadEnvFile(new URL("../.env.local", import.meta.url));
const databaseUrl = process.env.SUPABASE_DB_URL;
if (databaseUrl === undefined) {
  throw new Error("Migration 011 deployment requires SUPABASE_DB_URL");
}
const migration = readFileSync(
  new URL(
    "../supabase/migrations/011_terminal_provider_acceptance.sql",
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
    "007", "008", "009", "010",
  ];
  if (
    JSON.stringify(versions.rows.map(({ version }) => version)) !==
    JSON.stringify(expected)
  ) {
    throw new Error("Migration 011 requires the exact deployed 001-010 baseline");
  }
  const counts = await client.query(
    `select
       (select count(*)::integer from public.af_research_runs) as runs,
       (select count(*)::integer from public.af_research_provider_runs) as provider_runs`,
  );
  if (counts.rows[0]?.runs !== 0 || counts.rows[0]?.provider_runs !== 0) {
    throw new Error("Migration 011 deployment requires an empty research baseline");
  }
  await client.query(migration);
  await client.query(
    `insert into supabase_migrations.schema_migrations(version, statements, name)
     values ($1, $2::text[], $3)`,
    ["011", [migration], "terminal_provider_acceptance"],
  );
  const result = await client.query(
    `select public.af_research_provider_run_record_valid_v1(
       jsonb_build_object(
         'schemaVersion', 1,
         'runId', '81000000-0000-4000-8000-000000000001',
         'jobId', '81000000-0000-4000-8000-000000000002',
         'attemptId', '81000000-0000-4000-8000-000000000003',
         'caseId', '81000000-0000-4000-8000-000000000004',
         'provider', 'openai',
         'providerResponseId', 'resp_terminal_deploy_check',
         'state', 'COMPLETED',
         'requestedModel', 'gpt-test',
         'providerModel', 'gpt-test-snapshot',
         'traceId', 'trace-terminal-deploy-check',
         'manifestFingerprint', repeat('a', 64),
         'externalIdempotencyKey', repeat('b', 64),
         'startedAt', '2026-08-22T20:00:00.000Z',
         'acceptedAt', '2026-08-22T20:00:01.000Z',
         'lastObservedAt', '2026-08-22T20:00:01.000Z',
         'inputBytes', 1000,
         'dataControlMode', 'MODIFIED_ABUSE_MONITORING',
         'projectIdFingerprint', repeat('c', 64),
         'privateContentIncluded', true,
         'publicationAuthority', 'NONE'
       )
     ) as installed`,
  );
  if (result.rows[0]?.installed !== true) {
    throw new Error("Migration 011 postcondition failed");
  }
  await client.query("commit");
  console.log("Migration 011 deployed and recorded successfully");
} catch (error) {
  await client.query("rollback");
  throw error;
} finally {
  await client.end();
}
