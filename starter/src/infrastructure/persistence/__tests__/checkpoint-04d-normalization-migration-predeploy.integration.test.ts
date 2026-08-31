import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Client } from "pg";
import { describe, expect, it } from "vitest";

const enabled = process.env.AFTERFRAME_DB_MIGRATION_015_PREFLIGHT === "1";
const describeDatabase = enabled ? describe : describe.skip;
const starterRoot = fileURLToPath(new URL("../../../../", import.meta.url));
const migration = readFileSync(
  fileURLToPath(
    new URL(
      "../../../../supabase/migrations/015_durable_source_normalization_acceptance.sql",
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
    throw new Error("Migration 015 preflight requires SUPABASE_DB_URL");
  }
  const parsed = new URL(value);
  if (
    !["postgres:", "postgresql:"].includes(parsed.protocol) ||
    parsed.username.length === 0 ||
    parsed.password.length === 0 ||
    parsed.hostname.length === 0
  ) {
    throw new Error("Migration 015 preflight requires a credentialed PostgreSQL URL");
  }
  return value;
}

describeDatabase("migration 015 production rollback preflight", () => {
  it("applies atomically over 001-014 with a default-deny text-free boundary", async () => {
    const client = new Client({ connectionString: databaseUrl() });
    await client.connect();
    try {
      const versions = await client.query<{ version: string }>(
        `select version::text as version
         from supabase_migrations.schema_migrations order by version`,
      );
      expect(versions.rows.map(({ version }) => version)).toEqual([
        "001", "002", "003", "004", "005", "006", "007", "008",
        "009", "010", "011", "012", "013", "014",
      ]);

      await client.query("begin");
      await client.query(migration);
      const relation = await client.query<{
        row_security: boolean;
        force_row_security: boolean;
        acl: string;
      }>(
        `select relation.relrowsecurity as row_security,
           relation.relforcerowsecurity as force_row_security,
           coalesce(relation.relacl::text, '') as acl
         from pg_catalog.pg_class relation
         join pg_catalog.pg_namespace namespace
           on namespace.oid = relation.relnamespace
         where namespace.nspname = 'public'
           and relation.relname = 'af_source_normalization_records'`,
      );
      expect(relation.rows).toHaveLength(1);
      expect(relation.rows[0]).toMatchObject({
        row_security: true,
        force_row_security: true,
      });
      expect(relation.rows[0]?.acl).not.toContain("anon=");
      expect(relation.rows[0]?.acl).not.toContain("authenticated=");

      const functions = await client.query<{ name: string; service_execute: boolean }>(
        `select routine.proname as name,
           has_function_privilege('service_role', routine.oid, 'EXECUTE') as service_execute
         from pg_catalog.pg_proc routine
         join pg_catalog.pg_namespace namespace on namespace.oid = routine.pronamespace
         where namespace.nspname = 'public'
           and routine.proname in (
             'af_get_source_normalization_records_v1',
             'af_accept_source_normalization_v1'
           ) order by routine.proname`,
      );
      expect(functions.rows).toEqual([
        { name: "af_accept_source_normalization_v1", service_execute: true },
        { name: "af_get_source_normalization_records_v1", service_execute: true },
      ]);

      await client.query("rollback");
      const absent = await client.query<{ relation: string | null }>(
        "select to_regclass('public.af_source_normalization_records')::text as relation",
      );
      expect(absent.rows[0]?.relation).toBeNull();
    } finally {
      await client.query("rollback").catch(() => undefined);
      await client.end().catch(() => undefined);
    }
  }, 60_000);
});
