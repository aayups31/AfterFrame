import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Client } from "pg";
import { describe, expect, it } from "vitest";

const enabled = process.env.AFTERFRAME_DB_MIGRATION_010_PREFLIGHT === "1";
const describeDatabase = enabled ? describe : describe.skip;
const starterRoot = fileURLToPath(new URL("../../../../", import.meta.url));
const migration = readFileSync(
  fileURLToPath(
    new URL(
      "../../../../supabase/migrations/010_discovery_provider_takeover_reader.sql",
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
  if (value === undefined) throw new Error("Migration 010 requires SUPABASE_DB_URL");
  return value;
}

describeDatabase("migration 010 production rollback preflight", () => {
  it("applies over exactly 001-009 and exposes only a service-role reader", async () => {
    const client = new Client({ connectionString: databaseUrl() });
    await client.connect();
    try {
      const versions = await client.query<{ version: string }>(
        "select version::text as version from supabase_migrations.schema_migrations order by version",
      );
      expect(versions.rows.map(({ version }) => version)).toEqual([
        "001", "002", "003", "004", "005", "006", "007", "008", "009",
      ]);
      await client.query("begin");
      await client.query(migration);
      const privileges = await client.query<{
        service: boolean;
        authenticated: boolean;
        anonymous: boolean;
        publicRole: boolean;
      }>(
        `select
           has_function_privilege('service_role', $1, 'EXECUTE') as service,
           has_function_privilege('authenticated', $1, 'EXECUTE') as authenticated,
           has_function_privilege('anon', $1, 'EXECUTE') as anonymous,
           has_function_privilege('public', $1, 'EXECUTE') as "publicRole"`,
        ["public.af_get_research_provider_run_v1(uuid,uuid,uuid,uuid)"],
      );
      expect(privileges.rows[0]).toEqual({
        service: true,
        authenticated: false,
        anonymous: false,
        publicRole: false,
      });
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
