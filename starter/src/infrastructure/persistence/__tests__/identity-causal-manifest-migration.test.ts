import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const migrationPath = fileURLToPath(
  new URL(
    "../../../../supabase/migrations/008_identity_causal_manifests.sql",
    import.meta.url,
  ),
);
const migration = readFileSync(migrationPath, "utf8");

function functionBody(name: string) {
  const plain = migration.indexOf(`create function public.${name}(`);
  const replacement = migration.indexOf(
    `create or replace function public.${name}(`,
  );
  const start = plain === -1 ? replacement : plain;
  expect(start).toBeGreaterThan(-1);
  const bodyEnd = migration.indexOf("$function$;", start);
  expect(bodyEnd).toBeGreaterThan(start);
  return migration.slice(start, bodyEnd);
}

describe("identity and causal input manifest migration", () => {
  it("adds domain-neutral immutable identity and attempt-manifest records", () => {
    expect(migration).toContain(
      "create table public.af_resolved_subject_identities (",
    );
    expect(migration).toContain(
      "create table public.af_research_attempt_input_manifests (",
    );
    expect(migration).toMatch(
      /evidence_status text not null\s+constraint af_resolved_identities_evidence_status_check\s+check \(evidence_status = 'NOT_EVIDENCE'\)/,
    );
    expect(migration).toMatch(
      /publication_authority text not null\s+constraint af_(?:resolved_identities|attempt_manifests)_publication_authority_check\s+check \(publication_authority = 'NONE'\)/,
    );
    expect(migration).toContain("af_resolved_identities_immutable_trigger");
    expect(migration).toContain("af_attempt_manifests_immutable_trigger");
    expect(migration).toContain(
      "before update on public.af_resolved_subject_identities",
    );
    expect(migration).toContain(
      "before update on public.af_research_attempt_input_manifests",
    );
    expect(migration).not.toMatch(
      /before update or delete on public\.af_(?:resolved_subject_identities|research_attempt_input_manifests)/,
    );
    expect(migration).not.toMatch(/\b(tmdb|movie|film|youtube)\b/i);
    expect(migration).not.toMatch(/drop\s+(?:table|column)|truncate\s+table/i);
  });

  it("fails closed instead of fabricating legacy identity provenance or stranding v1 work", () => {
    const preflight = migration.slice(
      migration.indexOf("do $preflight$"),
      migration.indexOf("$preflight$;") + "$preflight$;".length,
    );
    expect(preflight).toContain("select 1 from public.af_research_runs");
    expect(preflight).toContain(
      "select 1 from public.af_research_start_commit_results",
    );
    expect(preflight).toContain(
      "select 1 from public.af_research_start_idempotency",
    );
    expect(preflight).not.toContain("where status = 'RUNNING'");
    expect(preflight).toContain(
      "Backfill legacy research runs, start replay state, and causal manifests",
    );
    expect(preflight).not.toMatch(/update|delete|truncate/i);
  });

  it("fences case identity and preserves one exactly linked output per attempt", () => {
    for (const field of [
      "specialist_id",
      "specialist_version",
      "subject_type",
      "subject_id",
      "subject_version_id",
      "exact_curiosity",
    ]) {
      expect(
        functionBody("af_enforce_case_research_identity_immutability_v1"),
      ).toContain(`new.${field} is distinct from old.${field}`);
    }
    expect(migration).toContain(
      "af_research_outputs_one_per_attempt_key unique (attempt_id)",
    );
    expect(migration).toContain(
      "references public.af_research_stage_outputs(run_id, job_id, attempt_id, id)",
    );
    expect(migration).toContain(
      "references public.af_resolved_subject_identities(run_id, attempt_id, id)",
    );
    expect(migration).toContain("deferrable initially deferred");
    expect(functionBody("af_assert_identity_output_link_v1")).toContain(
      "current_output.subject_identity_id is null",
    );
  });

  it("accepts the new exact start bundle only with an empty identity collection", () => {
    const validator = functionBody("af_research_start_result_shape_valid");
    const requirementIds = functionBody(
      "af_identity_requirement_ids_valid_v1",
    );
    expect(validator).toContain("'outputs', 'subjectIdentities'");
    expect(validator).toContain(
      "jsonb_typeof(bundle_json->'subjectIdentities') is distinct from 'array'",
    );
    expect(validator).toContain(
      "jsonb_array_length(bundle_json->'subjectIdentities') <> 0",
    );
    expect(validator).toContain(
      "plan_json#>'{plan,identityRequirements}'",
    );
    expect(requirementIds).toContain(
      "jsonb_array_length(requirements_to_check) > 50",
    );
    expect(requirementIds).toContain(
      "requirement_id = any(seen_requirement_ids)",
    );
    expect(validator).toContain("create or replace function");
  });

  it("authors the v2 claim fingerprint and exact body-free causal manifest in Postgres", () => {
    const claim = functionBody("af_claim_research_job_v2");
    const signature = claim.slice(0, claim.indexOf("returns jsonb"));
    expect(signature).toContain("p_idempotency_key text");
    expect(signature).not.toContain("p_request_fingerprint");
    expect(claim).toContain("for update of stored_run");
    expect(claim).toContain("where id = run_row.case_id for share");
    expect(claim).toContain("where id = run_row.plan_id and run_id = run_row.id for share");
    expect(claim).toContain("prior_job_row.stage_ordinal <> job_row.stage_ordinal - 1");
    expect(claim).toContain("prior_attempt_row.output_fingerprint is null");
    expect(claim).toContain("identity_output.subject_identity_id = stored_identity.id");
    expect(claim).toContain(
      "p_execution->>'executionKind' is distinct from 'RESOLVER'",
    );
    expect(claim).toContain(
      "(p_execution->>'privateContentIncluded')::boolean is distinct from false",
    );
    expect(claim).toContain(
      "is distinct from 'IDEMPOTENT_PROVIDER_REQUEST'",
    );
    expect(claim).toContain(
      "Identity execution must be body-free and provider-idempotent",
    );
    for (const key of [
      "runId",
      "caseId",
      "branchId",
      "planId",
      "jobId",
      "stage",
      "subjectRefFingerprint",
      "objectiveFingerprint",
      "runRequestFingerprint",
      "planFingerprint",
      "stageSeedFingerprint",
      "dependency",
      "subjectIdentity",
    ]) {
      expect(claim).toContain(`'${key}'`);
    }
    expect(claim).toContain("jsonb_build_object('state', 'ROOT')");
    expect(claim).toContain("jsonb_build_object('state', 'UNBOUND')");
    expect(claim).toContain("'predecessorOutputFingerprint', prior_attempt_row.output_fingerprint");
    expect(claim).toContain("'identityFingerprint', identity_row.identity_fingerprint");
    expect(claim).toContain("public.af_canonical_jsonb_sha256_v1(");
    expect(claim).toContain("'research-attempt-request'");
    expect(claim).toContain("public.af_claim_research_job_v1(");
    expect(claim).toContain("insert into public.af_research_attempt_input_manifests");
    expect(claim).toContain("'{claim,inputManifest}'");
    expect(claim.indexOf("public.af_claim_research_job_v1(")).toBeLessThan(
      claim.indexOf("insert into public.af_research_attempt_input_manifests"),
    );
  });

  it("replays only the exact stored manifest for the same durable attempt", () => {
    const claim = functionBody("af_claim_research_job_v2");
    for (const comparison of [
      "stored_manifest_row.manifest is distinct from manifest_json",
      "stored_manifest_row.manifest_fingerprint is distinct from manifest_fingerprint_value",
      "stored_manifest_row.request_fingerprint is distinct from request_fingerprint_value",
      "stored_manifest_row.subject_identity_id is distinct from identity_row.id",
      "stored_manifest_row.predecessor_attempt_id is distinct from prior_attempt_row.id",
      "stored_manifest_row.predecessor_output_fingerprint",
    ]) {
      expect(claim).toContain(comparison);
    }
    expect(claim).toContain("Existing research attempt lacks its causal manifest");
    expect(claim).toContain("Claim replay selected a different research attempt");
    expect(migration).toContain("unique (attempt_id)");
    expect(migration).toContain("unique (run_id, request_fingerprint)");
  });

  it("validates and atomically links exactly one resolver-produced identity", () => {
    const validator = functionBody("af_research_stage_result_v2_valid");
    const partition = functionBody(
      "af_identity_resolution_partition_valid_v1",
    );
    const completion = functionBody("af_complete_research_job_v2");
    expect(validator).toContain("'output', 'subjectIdentities'");
    expect(validator).toContain(
      "jsonb_array_length(value_to_check->'subjectIdentities') <> 1",
    );
    expect(validator).toContain(
      "jsonb_array_length(value_to_check->'subjectIdentities') <> 0",
    );
    expect(validator).toContain("output_json - 'subjectIdentityId'");
    expect(completion).toContain("Research completion requires its exact causal manifest");
    expect(completion).toContain(
      "'research-attempt-input-manifest', manifest_row.manifest",
    );
    expect(completion).toContain("attempt_row.claim_idempotency_key");
    expect(completion).toContain(
      "Research completion causal manifest no longer matches authoritative input",
    );
    expect(completion).toContain("attempt_row.execution_kind <> 'RESOLVER'");
    expect(completion).toContain("attempt_row.private_content_included");
    expect(completion).toContain(
      "lease_row.execution_plan->>'automaticRetrySafety'",
    );
    expect(completion).toContain("attempt_row.tool_id::text");
    expect(completion).toContain("attempt_row.tool_version::text");
    expect(partition).toContain("identifier_value = any(requirement_ids)");
    expect(partition).toContain("identifier_value = any(resolved_ids)");
    expect(partition).toContain("identifier_value = any(unresolved_ids)");
    expect(partition).toContain(
      "requirement_ids <@ (resolved_ids || unresolved_ids)",
    );
    expect(partition).toContain("outcome_to_check = 'SUCCEEDED'");
    expect(partition).toContain("outcome_to_check = 'DEGRADED'");
    expect(partition).toContain(
      `bounded_reasons_to_check = '["identity-requirements-unresolved"]'::jsonb`,
    );
    expect(completion).toContain(
      "plan_row.plan->'identityRequirements'",
    );
    expect(completion).toContain(
      "Identity result must exactly partition authoritative requirements",
    );
    expect(completion).toContain("public.af_complete_research_job_v1(");
    expect(completion).toContain(
      "'research-stage-result', p_result",
    );
    expect(completion).toContain(
      "p_output_fingerprint => derived_output_fingerprint",
    );
    expect(completion).not.toContain(
      "p_output_fingerprint => p_output_fingerprint",
    );
    expect(completion).not.toContain(
      "perform p_output_fingerprint::public.af_sha256",
    );
    expect(completion).toContain("insert into public.af_resolved_subject_identities");
    expect(completion).toContain("set subject_identity_id = identity_id");
    expect(completion.indexOf("public.af_complete_research_job_v1(")).toBeLessThan(
      completion.indexOf("insert into public.af_resolved_subject_identities"),
    );
    expect(completion).toContain("Only IDENTITY may create or link subject identity");
  });

  it("exposes only actor-owned body-minimal identity reads", () => {
    const context = functionBody("af_get_research_identity_context_v1");
    const identity = functionBody("af_get_resolved_subject_identity_v1");
    for (const body of [context, identity]) {
      expect(body).toContain("p_actor_id uuid");
      expect(body).toContain("security definer");
      expect(body).toContain("perform public.af_assert_actor_scope(p_actor_id)");
      expect(body).toContain("stored_case.owner_id = p_actor_id");
      expect(body).not.toContain("exact_curiosity");
    }
    expect(context).toContain("plan_row.plan->'identityRequirements'");
    expect(context).toContain("'subjectRefFingerprint', subject_fingerprint");
    expect(identity).toContain(
      "public.af_resolved_subject_identity_record_json_v1(identity_row)",
    );
  });

  it("forces RLS, denies direct rows/helpers, and cuts service callers over from v1", () => {
    const boundary = migration.indexOf("-- Checkpoint 04A default-deny cutover");
    expect(boundary).toBeGreaterThan(migration.lastIndexOf("create function public.af_"));
    for (const table of [
      "af_resolved_subject_identities",
      "af_research_attempt_input_manifests",
    ]) {
      expect(migration).toContain(`alter table public.${table} enable row level security`);
      expect(migration).toContain(`alter table public.${table} force row level security`);
      expect(migration).toMatch(
        new RegExp(`revoke all on table public\\.${table}\\s+from public, anon, authenticated, service_role`),
      );
    }
    expect(migration).toContain("grant execute on function public.af_claim_research_job_v2(");
    expect(migration).toContain("grant execute on function public.af_complete_research_job_v2(");
    expect(migration).toContain("grant execute on function public.af_get_research_identity_context_v1(");
    expect(migration).toContain("grant execute on function public.af_get_resolved_subject_identity_v1(");
    expect(migration).toMatch(
      /revoke all on function public\.af_claim_research_job_v1\([\s\S]*?\) from public, anon, authenticated, service_role;/,
    );
    expect(migration).toMatch(
      /revoke all on function public\.af_complete_research_job_v1\([\s\S]*?\) from public, anon, authenticated, service_role;/,
    );
  });

  it("has unique PL/pgSQL declarations and no ambiguous runtime clock variable", () => {
    for (const functionMatch of migration.matchAll(
      /(?:create|create or replace) function public\.(af_[a-z0-9_]+)\([\s\S]*?\$function\$;/g,
    )) {
      const declaration = functionMatch[0].match(/declare\s+([\s\S]*?)\bbegin\b/);
      if (declaration === null) continue;
      const names = [...declaration[1].matchAll(/^\s*([a-z][a-z0-9_]*)\s+/gm)].map(
        (match) => match[1],
      );
      expect(new Set(names).size, functionMatch[1]).toBe(names.length);
    }
    expect(migration).not.toMatch(/\bcurrent_time\s+timestamptz\b/i);
    expect(migration).not.toMatch(
      /(?:source|model|prompt|private|response|content)_(?:body|excerpt|text|message)\s/i,
    );
  });
});
