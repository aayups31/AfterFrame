import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Client } from "pg";
import { describe, expect, it } from "vitest";

const enabled = process.env.AFTERFRAME_DB_MIGRATION_009_PREFLIGHT === "1";
const describeDatabase = enabled ? describe : describe.skip;
const starterRoot = fileURLToPath(new URL("../../../../", import.meta.url));
const migration = readFileSync(
  fileURLToPath(
    new URL(
      "../../../../supabase/migrations/009_durable_discovery_provider_acceptance.sql",
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
  if (value === undefined) {
    throw new Error("Migration 009 preflight requires SUPABASE_DB_URL");
  }
  const parsed = new URL(value);
  if (
    !["postgres:", "postgresql:"].includes(parsed.protocol) ||
    parsed.username.length === 0 ||
    parsed.password.length === 0 ||
    parsed.hostname.length === 0
  ) {
    throw new Error("Migration 009 preflight requires a credentialed PostgreSQL URL");
  }
  return value;
}

const expectedConstraints = [
  ["af_provider_runs_attempt_fk", "f"],
  ["af_provider_runs_attempt_key", "u"],
  ["af_provider_runs_attempt_response_key", "u"],
  ["af_provider_runs_data_control_check", "c"],
  ["af_provider_runs_model_check", "c"],
  ["af_provider_runs_pkey", "p"],
  ["af_provider_runs_private_content_check", "c"],
  ["af_provider_runs_provider_check", "c"],
  ["af_provider_runs_publication_authority_check", "c"],
  ["af_provider_runs_run_case_fk", "f"],
  ["af_provider_runs_schema_version_check", "c"],
  ["af_provider_runs_state_check", "c"],
  ["af_provider_runs_time_check", "c"],
] as const;

describeDatabase("migration 009 production rollback preflight", () => {
  it("applies atomically over exactly 001-008 and preserves default-deny posture", async () => {
    const client = new Client({ connectionString: databaseUrl() });
    await client.connect();
    try {
      const versions = await client.query<{ version: string }>(
        `select version::text as version
         from supabase_migrations.schema_migrations order by version`,
      );
      expect(versions.rows.map(({ version }) => version)).toEqual([
        "001",
        "002",
        "003",
        "004",
        "005",
        "006",
        "007",
        "008",
      ]);
      const runCount = await client.query<{ count: string }>(
        "select count(*)::text as count from public.af_research_runs",
      );
      expect(runCount.rows[0]?.count).toBe("0");

      await client.query("begin");
      await client.query(migration);

      const relation = await client.query<{
        row_security: boolean;
        force_row_security: boolean;
        acl: string;
      }>(
        `select relrowsecurity as row_security,
           relforcerowsecurity as force_row_security,
           coalesce(relacl::text, '') as acl
         from pg_catalog.pg_class relation
         join pg_catalog.pg_namespace namespace
           on namespace.oid = relation.relnamespace
         where namespace.nspname = 'public'
           and relation.relname = 'af_research_provider_runs'`,
      );
      expect(relation.rows).toHaveLength(1);
      expect(relation.rows[0]).toMatchObject({
        row_security: true,
        force_row_security: true,
      });
      expect(relation.rows[0]?.acl).not.toContain("authenticated=");
      expect(relation.rows[0]?.acl).not.toContain("anon=");

      const constraints = await client.query<{
        name: string;
        type: string;
        validated: boolean;
      }>(
        `select constraint_record.conname as name,
           constraint_record.contype::text as type,
           constraint_record.convalidated as validated
         from pg_catalog.pg_constraint constraint_record
         join pg_catalog.pg_class relation
           on relation.oid = constraint_record.conrelid
         join pg_catalog.pg_namespace namespace
           on namespace.oid = relation.relnamespace
         where namespace.nspname = 'public'
           and relation.relname = 'af_research_provider_runs'
         order by constraint_record.conname`,
      );
      expect(
        constraints.rows.map(({ name, type }) => [name, type]),
      ).toEqual([...expectedConstraints].sort(([left], [right]) => left.localeCompare(right)));
      expect(constraints.rows.every(({ validated }) => validated)).toBe(true);

      for (const declaration of [
        "public.af_get_research_discovery_context_v1(uuid,uuid,uuid)",
        "public.af_accept_research_provider_run_v1(uuid,jsonb,jsonb,jsonb,integer)",
      ]) {
        const privileges = await client.query<{
          service: boolean;
          authenticated: boolean;
          anonymous: boolean;
          public_role: boolean;
        }>(
          `select
             has_function_privilege('service_role', $1, 'EXECUTE') as service,
             has_function_privilege('authenticated', $1, 'EXECUTE') as authenticated,
             has_function_privilege('anon', $1, 'EXECUTE') as anonymous,
             has_function_privilege('public', $1, 'EXECUTE') as public_role`,
          [declaration],
        );
        expect(privileges.rows[0]).toEqual({
          service: true,
          authenticated: false,
          anonymous: false,
          public_role: false,
        });
      }
    } finally {
      try {
        await client.query("rollback");
      } finally {
        await client.end();
      }
    }
  }, 60_000);
});
