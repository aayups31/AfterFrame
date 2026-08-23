import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const migrationPath = fileURLToPath(
  new URL(
    "../../../../supabase/migrations/009_durable_discovery_provider_acceptance.sql",
    import.meta.url,
  ),
);
const migration = readFileSync(migrationPath, "utf8");

function functionBody(name: string) {
  const start = migration.indexOf(`create function public.${name}(`);
  expect(start).toBeGreaterThan(-1);
  const bodyEnd = migration.indexOf("$function$;", start);
  expect(bodyEnd).toBeGreaterThan(start);
  return migration.slice(start, bodyEnd);
}

describe("durable discovery provider migration", () => {
  it("persists complete body-free provider recovery truth", () => {
    expect(migration).toContain(
      "create table public.af_research_provider_runs (",
    );
    for (const column of [
      "provider_response_id",
      "requested_model",
      "provider_model",
      "trace_id",
      "manifest_fingerprint",
      "external_idempotency_key",
      "started_at",
      "accepted_at",
      "last_observed_at",
      "input_bytes",
      "data_control_mode",
      "project_id_fingerprint",
      "private_content_included",
      "publication_authority",
    ]) {
      expect(migration).toContain(column);
    }
    expect(migration).toContain(
      "check (data_control_mode = 'MODIFIED_ABUSE_MONITORING')",
    );
    expect(migration).toContain("check (private_content_included)");
    expect(migration).toContain("check (publication_authority = 'NONE')");
    expect(migration).not.toMatch(
      /(?:question|prompt|source|response|provider)_(?:body|excerpt|message|text)\s/i,
    );
  });

  it("releases exact private research context only through actor scope", () => {
    const body = functionBody("af_get_research_discovery_context_v1");
    expect(body).toContain("security definer");
    expect(body).toContain("perform public.af_assert_actor_scope(p_actor_id)");
    expect(body).toContain("stored_case.owner_id = p_actor_id");
    expect(body).toContain("and stage = 'DISCOVERY'");
    expect(body).toContain(
      "public.af_resolved_subject_identity_record_json_v1(identity_row)->'publicIdentity'",
    );
    expect(body).toContain("case_row.exact_curiosity");
    expect(body).toContain("branch_row.normalized_objective");
    expect(body).toContain("plan_row.plan->'axes'");
    expect(body).toContain("plan_row.plan->'sourceClassIds'");
  });

  it("commits checkpoint before provider state so either both persist or neither does", () => {
    const body = functionBody("af_accept_research_provider_run_v1");
    const checkpoint = body.indexOf("public.af_checkpoint_research_job_v1(");
    const insert = body.indexOf(
      "insert into public.af_research_provider_runs",
    );
    expect(checkpoint).toBeGreaterThan(-1);
    expect(insert).toBeGreaterThan(checkpoint);
    expect(body).toContain("p_checkpoint->>'kind' <> 'PROVIDER_ACCEPTED'");
    expect(body).toContain(
      "p_checkpoint->>'providerRunId' is distinct from",
    );
    expect(body).toContain(
      "authoritative_manifest.manifest_fingerprint is distinct from",
    );
    expect(body).toContain(
      "authoritative_attempt.request_fingerprint is distinct from",
    );
    expect(body).toContain(
      "authoritative_attempt.execution_kind <> 'MODEL_TOOL'",
    );
    expect(body).toContain("authoritative_attempt.model_provider <> 'openai'");
    expect(body).toContain("checkpoint_result->>'status' = 'REPLAY'");
    expect(body).toContain(
      "Provider checkpoint lacks durable recovery state",
    );
  });

  it("uses exact idempotent replay and immutable one-run-per-attempt identity", () => {
    const body = functionBody("af_accept_research_provider_run_v1");
    expect(migration).toContain(
      "constraint af_provider_runs_attempt_key unique (attempt_id)",
    );
    expect(migration).toContain(
      "constraint af_provider_runs_pkey primary key (provider, provider_response_id)",
    );
    expect(body).toContain(
      "public.af_research_provider_run_record_json_v1(stored_provider_row)",
    );
    expect(body).toContain("is distinct from p_provider_run");
    expect(body).toContain("errcode = 'AFR02'");
  });

  it("forces default-deny RLS and exposes only the two service RPCs", () => {
    expect(migration).toContain(
      "alter table public.af_research_provider_runs enable row level security",
    );
    expect(migration).toContain(
      "alter table public.af_research_provider_runs force row level security",
    );
    expect(migration).toMatch(
      /revoke all on table public\.af_research_provider_runs\s+from public, anon, authenticated;/,
    );
    expect(migration).toContain(
      "grant execute on function public.af_get_research_discovery_context_v1(",
    );
    expect(migration).toContain(
      "grant execute on function public.af_accept_research_provider_run_v1(",
    );
    expect(migration).not.toMatch(/grant execute[\s\S]*to authenticated/);
  });

  it("names every table constraint and remains additive", () => {
    const table = migration.slice(
      migration.indexOf("create table public.af_research_provider_runs ("),
      migration.indexOf("comment on table public.af_research_provider_runs"),
    );
    expect(table).not.toMatch(/^ {2}(?:primary key|unique|check|foreign key)\b/gm);
    const names = [...table.matchAll(/^\s*constraint ([a-z0-9_]+)/gm)].map(
      (match) => match[1],
    );
    expect(new Set(names).size).toBe(names.length);
    expect(migration).not.toMatch(/drop\s+(?:table|column)|truncate\s+table/i);
  });
});
