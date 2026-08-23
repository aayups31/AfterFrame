import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Client } from "pg";
import { describe, expect, it } from "vitest";

const enabled = process.env.AFTERFRAME_DB_MIGRATION_011_PREFLIGHT === "1";
const describeDatabase = enabled ? describe : describe.skip;
const starterRoot = fileURLToPath(new URL("../../../../", import.meta.url));
const migration = readFileSync(
  fileURLToPath(
    new URL(
      "../../../../supabase/migrations/011_terminal_provider_acceptance.sql",
      import.meta.url,
    ),
  ),
  "utf8",
);

function databaseUrl() {
  if (process.env.SUPABASE_DB_URL === undefined) {
    process.loadEnvFile(`${starterRoot}/.env.local`);
  }
  const value = process.env.SUPABASE_DB_URL;
  if (value === undefined) throw new Error("Migration 011 requires SUPABASE_DB_URL");
  return value;
}

describeDatabase("migration 011 production rollback preflight", () => {
  it("applies over exactly 001-010 and accepts bounded terminal recovery state", async () => {
    const client = new Client({ connectionString: databaseUrl() });
    await client.connect();
    try {
      const versions = await client.query<{ version: string }>(
        "select version::text as version from supabase_migrations.schema_migrations order by version",
      );
      expect(versions.rows.map(({ version }) => version)).toEqual([
        "001", "002", "003", "004", "005", "006",
        "007", "008", "009", "010",
      ]);
      await client.query("begin");
      await client.query(migration);

      const constraint = await client.query<{ definition: string }>(
        `select pg_get_constraintdef(oid) as definition
         from pg_constraint
         where conname = 'af_provider_runs_state_check'
           and conrelid = 'public.af_research_provider_runs'::regclass`,
      );
      expect(constraint.rows).toHaveLength(1);
      for (const state of [
        "QUEUED", "IN_PROGRESS", "COMPLETED",
        "FAILED", "INCOMPLETE", "CANCELLED",
      ]) {
        expect(constraint.rows[0]?.definition).toContain(state);
      }

      const valid = await client.query<{ state: string; valid: boolean }>(
        `select candidate.state,
                public.af_research_provider_run_record_valid_v1(
                  jsonb_build_object(
                    'schemaVersion', 1,
                    'runId', '81000000-0000-4000-8000-000000000001',
                    'jobId', '81000000-0000-4000-8000-000000000002',
                    'attemptId', '81000000-0000-4000-8000-000000000003',
                    'caseId', '81000000-0000-4000-8000-000000000004',
                    'provider', 'openai',
                    'providerResponseId', 'resp_terminal_preflight',
                    'state', candidate.state,
                    'requestedModel', 'gpt-test',
                    'providerModel', 'gpt-test-snapshot',
                    'traceId', 'trace-terminal-preflight',
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
                ) as valid
         from unnest(array[
           'COMPLETED', 'FAILED', 'INCOMPLETE', 'CANCELLED'
         ]) as candidate(state)`,
      );
      expect(valid.rows).toEqual([
        { state: "COMPLETED", valid: true },
        { state: "FAILED", valid: true },
        { state: "INCOMPLETE", valid: true },
        { state: "CANCELLED", valid: true },
      ]);

      const rows = await client.query<{ runs: number; providerRuns: number }>(
        `select
           (select count(*)::integer from public.af_research_runs) as runs,
           (select count(*)::integer from public.af_research_provider_runs) as "providerRuns"`,
      );
      expect(rows.rows[0]).toEqual({ runs: 0, providerRuns: 0 });
    } finally {
      try {
        await client.query("rollback");
      } finally {
        await client.end();
      }
    }
  }, 60_000);
});
