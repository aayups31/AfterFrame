import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const migrationPath = fileURLToPath(
  new URL(
    "../../../../supabase/migrations/005_production_persistence_foundation.sql",
    import.meta.url,
  ),
);
const migration = readFileSync(migrationPath, "utf8");

describe("production persistence migration security posture", () => {
  it("places the default-deny boundary after every af table and function", () => {
    const tables = [...migration.matchAll(/^create table public\.(af_[a-z_]+)/gm)]
      .map((match) => match[1]);
    expect(new Set(tables).size).toBe(24);

    const securityBoundary = migration.indexOf(
      "-- Default-deny production boundary",
    );
    expect(securityBoundary).toBeGreaterThan(
      migration.lastIndexOf("create table public.af_"),
    );
    expect(securityBoundary).toBeGreaterThan(
      migration.lastIndexOf("create function public.af_"),
    );
  });

  it("forces RLS and removes implicit client table/function capabilities", () => {
    expect(migration).toContain(
      "'alter table %I.%I enable row level security'",
    );
    expect(migration).toContain(
      "'alter table %I.%I force row level security'",
    );
    expect(migration).toContain(
      "'revoke all on table %I.%I from public, anon, authenticated'",
    );
    expect(migration).toContain(
      "'revoke all on function %I.%I(%s) from public, anon, authenticated'",
    );
    expect(migration).toContain(
      "'grant execute on function %I.%I(%s) to service_role'",
    );
    expect(migration).not.toMatch(/grant\s+[^;]+\s+to\s+(anon|authenticated)/i);
  });

  it("keeps all state-changing RPCs actor-scoped and SECURITY DEFINER", () => {
    for (const rpc of [
      "af_reserve_direction_v1",
      "af_release_direction_reservation_v1",
      "af_commit_direction_v1",
    ]) {
      const start = migration.indexOf(`create function public.${rpc}(`);
      expect(start).toBeGreaterThan(-1);
      const body = migration.slice(start, migration.indexOf("$function$;", start));
      expect(body).toContain("p_actor_id uuid");
      expect(body).toContain("security definer");
      expect(body).toContain("perform public.af_assert_actor_scope(p_actor_id)");
      expect(body).toContain("set search_path = pg_catalog, public, auth");
    }
  });

  it("records private-input presence as a flag without storing a telemetry body", () => {
    expect(migration).toContain("private_content_included boolean not null");
    expect(migration).not.toContain("private_content_included = false");
    expect(migration).not.toContain("private_content_body");
  });
});
