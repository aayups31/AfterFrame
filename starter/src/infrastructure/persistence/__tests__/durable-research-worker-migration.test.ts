import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const migrationPath = fileURLToPath(
  new URL(
    "../../../../supabase/migrations/006_durable_research_worker.sql",
    import.meta.url,
  ),
);
const migration = readFileSync(migrationPath, "utf8");
const runtimeFixPath = fileURLToPath(
  new URL(
    "../../../../supabase/migrations/007_worker_runtime_identifier_fix.sql",
    import.meta.url,
  ),
);
const runtimeFix = readFileSync(runtimeFixPath, "utf8");

const rpcNames = [
  "af_reserve_research_run_start_v1",
  "af_release_research_run_start_reservation_v1",
  "af_commit_research_run_start_v1",
  "af_claim_research_job_v1",
  "af_heartbeat_research_job_v1",
  "af_checkpoint_research_job_v1",
  "af_complete_research_job_v1",
  "af_fail_research_job_v1",
  "af_release_research_job_v1",
] as const;

function functionBody(name: string) {
  const start = migration.indexOf(`create function public.${name}(`);
  expect(start).toBeGreaterThan(-1);
  const bodyEnd = migration.indexOf("$function$;", start);
  expect(bodyEnd).toBeGreaterThan(start);
  return migration.slice(start, bodyEnd);
}

function replacementFunctionBody(name: string) {
  const start = runtimeFix.indexOf(
    `create or replace function public.${name}(`,
  );
  expect(start).toBeGreaterThan(-1);
  const bodyEnd = runtimeFix.indexOf("$function$;", start);
  expect(bodyEnd).toBeGreaterThan(start);
  return runtimeFix.slice(start, bodyEnd);
}

describe("durable research worker migration", () => {
  it("is additive and repairs cross-stage candidate provenance", () => {
    expect(migration).toContain(
      "alter table public.af_source_candidates\n  add constraint af_source_candidates_run_id_id_key unique (run_id, id)",
    );
    expect(migration).toContain(
      "foreign key (run_id, candidate_id)\n  references public.af_source_candidates(run_id, id)",
    );
    expect(migration).not.toMatch(/drop table|truncate table/i);
  });

  it("creates body-free reservation, lease, checkpoint, failure, and handoff state", () => {
    for (const table of [
      "af_research_start_commit_results",
      "af_research_start_idempotency",
      "af_research_job_leases",
      "af_research_attempt_checkpoints",
      "af_research_attempt_failures",
      "af_research_attempt_handoffs",
    ]) {
      expect(migration).toContain(`create table public.${table} (`);
    }
    const names = [...migration.matchAll(/^\s*constraint ([a-z0-9_]+)/gm)].map(
      (match) => match[1],
    );
    expect(new Set(names).size).toBe(names.length);
    expect(migration).not.toMatch(
      /(?:exception|response|source|model|prompt|private_content)_(?:body|text|message)\s/i,
    );
  });

  it("matches the frozen strict checkpoint and failure envelopes", () => {
    const checkpoint = functionBody("af_research_checkpoint_record_valid");
    for (const key of [
      "idempotencyKey",
      "sequence",
      "providerRunId",
      "resumeTokenFingerprint",
      "outputFingerprint",
      "publicationAuthority",
    ]) {
      expect(checkpoint).toContain(`'${key}'`);
    }
    const failure = functionBody("af_research_worker_failure_valid");
    for (const key of [
      "category",
      "phase",
      "retryDirective",
      "retryAfterMs",
      "diagnosticFingerprint",
      "redactionState",
    ]) {
      expect(failure).toContain(`'${key}'`);
    }
    expect(migration).not.toMatch(
      /checkpointKey|checkpointFingerprint|retryAfterSeconds|errorFingerprint|boundedCode/,
    );
  });

  it("persists a RUNNING attempt and lease before returning a claim", () => {
    const body = functionBody("af_claim_research_job_v1");
    const attemptInsert = body.indexOf("insert into public.af_research_attempts");
    const leaseInsert = body.indexOf("insert into public.af_research_job_leases");
    const claimedReturn = body.lastIndexOf("'status', 'CLAIMED'");
    expect(attemptInsert).toBeGreaterThan(-1);
    expect(leaseInsert).toBeGreaterThan(attemptInsert);
    expect(claimedReturn).toBeGreaterThan(leaseInsert);
    expect(body).toContain("for update");
    expect(body).toContain("lease_row.lease_expires_at > observed_at");
  });

  it("returns both latest and canonical provider checkpoints on takeover", () => {
    const claimed = functionBody("af_claimed_research_job_json");
    expect(claimed).toContain("'latestCheckpoint', latest_checkpoint");
    expect(claimed).toContain("'providerCheckpoint', provider_checkpoint");
    const claim = functionBody("af_claim_research_job_v1");
    expect(claim).toContain("stored_checkpoint.kind = 'PROVIDER_ACCEPTED'");
    expect(claim).toContain("lease_epoch = lease_epoch + 1");
    expect(claim).toContain("released_at = null");
    expect(claim).toContain("lease_row.lease_epoch >= job_row.max_attempts");
    expect(claim).toContain("'lease-reclaim-budget-exhausted'");
    expect(claim).not.toContain("'status', 'IN_PROGRESS', 'retryAfterMs', 900000");
  });

  it("keeps resumable failure and release handoffs on the same RUNNING attempt", () => {
    const finalize = functionBody("af_finalize_research_failure");
    expect(finalize).toContain("handoff_requested := retry_requested");
    expect(finalize).toContain(
      ") and lease_row.lease_epoch < job_row.max_attempts",
    );
    expect(finalize).toContain("lease_row.execution_plan->>'automaticRetrySafety' = 'RESUMABLE_PROVIDER_RUN'");
    expect(finalize).toContain("insert into public.af_research_attempt_handoffs");
    expect(finalize).toContain("set retry_not_before = retry_time");
    expect(finalize).toContain("set released_at = completed_time");
    expect(finalize).toContain(
      "(p_failure->>'retryDirective') is distinct from 'RETRY_WITH_BACKOFF'",
    );
    expect(finalize).toContain(
      "handoff_row.retry_after_ms is distinct from (case",
    );
    expect(finalize).not.toContain(
      "handoff_row.retry_after_ms <> (p_failure->>'retryAfterMs')::bigint",
    );
    expect(finalize.indexOf("if handoff_requested then")).toBeLessThan(
      finalize.indexOf("insert into public.af_research_attempt_failures"),
    );
  });

  it("preserves unavailable and partial telemetry as nullable truth", () => {
    expect(migration).toContain("alter column usage_input_tokens drop not null");
    expect(migration).toContain("where status = 'RUNNING'");
    expect(migration).toContain("Drain RUNNING research attempts");
    expect(migration).toContain("when status in ('SUCCEEDED', 'DEGRADED') then 'COMPLETE'");
    expect(migration).toContain("else 'PARTIAL'");
    expect(migration).not.toMatch(/set telemetry_state = 'UNAVAILABLE',[\s\S]{0,300}usage_input_tokens = null/);
    const finalize = functionBody("af_finalize_research_failure");
    expect(finalize).toContain(
      "usage_input_tokens = (p_execution#>>'{usage,inputTokens}')::bigint",
    );
    expect(finalize).not.toMatch(/usage_input_tokens\s*=\s*coalesce/);
  });

  it("returns the canonical persisted checkpoint on idempotent replay", () => {
    const body = functionBody("af_checkpoint_research_job_v1");
    expect(body).toContain(
      "stored_checkpoint.idempotency_key = p_checkpoint->>'idempotencyKey'",
    );
    expect(body).toContain("'status', 'REPLAY'");
    expect(body).toContain(
      "'checkpoint', public.af_research_checkpoint_record_json(checkpoint_row)",
    );
    expect(body).not.toContain("checkpoint_row.id is distinct from");
    expect(body).not.toContain("checkpoint_row.created_at is distinct from");
  });

  it("keeps every public mutation actor scoped and SECURITY DEFINER", () => {
    for (const rpc of rpcNames) {
      const body = functionBody(rpc);
      expect(body).toContain("p_actor_id uuid");
      expect(body).toContain("security definer");
      expect(body).toContain("perform public.af_assert_actor_scope(p_actor_id)");
      expect(body).toContain("set search_path = pg_catalog, public, auth");
    }
  });

  it("writes semantic transitions through the transactional research outbox", () => {
    const append = functionBody("af_append_research_event_v1");
    expect(append).toContain("insert into public.af_research_domain_events");
    expect(append).toContain("insert into public.af_research_outbox_events");
    expect(append).toContain("'publicationAuthority', 'NONE'");
    expect(functionBody("af_complete_research_job_v1")).toContain(
      "public.af_append_research_event_v1(",
    );
    expect(functionBody("af_finalize_research_failure")).toContain(
      "public.af_append_research_event_v1(",
    );
  });

  it("re-applies forced RLS, revokes API roles, and hides internal writers", () => {
    const boundary = migration.indexOf("do $security$");
    expect(boundary).toBeGreaterThan(migration.lastIndexOf("create function public.af_"));
    expect(migration).toContain("'alter table %I.%I enable row level security'");
    expect(migration).toContain("'alter table %I.%I force row level security'");
    expect(migration).toContain(
      "'revoke all on function %I.%I(%s) from public, anon, authenticated'",
    );
    expect(migration).toContain(
      "revoke all on function public.af_persist_research_stage_result(",
    );
    expect(migration).toContain(
      "revoke all on function public.af_finalize_research_failure(",
    );
    expect(migration).not.toMatch(
      /grant\s+(?:execute|select|insert|update|delete|all)[^;]+\s+to\s+(?:public|anon|authenticated)/i,
    );
  });

  it("uses the stable bounded SQLSTATE map", () => {
    for (const code of [
      "AFR01",
      "AFR02",
      "AFR03",
      "AFR04",
      "AFR05",
      "AFR06",
      "AFR07",
      "AFR08",
    ]) {
      expect(migration).toContain(`errcode = '${code}'`);
    }
  });

  it("forward-replaces every function affected by the CURRENT_TIME ambiguity", () => {
    const affectedFunctions = [
      "af_reserve_research_run_start_v1",
      "af_claim_research_job_v1",
      "af_heartbeat_research_job_v1",
      "af_checkpoint_research_job_v1",
      "af_complete_research_job_v1",
      "af_finalize_research_failure",
    ];
    expect(migration).not.toMatch(/\bcurrent_time\s+timestamptz\b/i);
    expect(runtimeFix).not.toMatch(/\bcurrent_time\s+timestamptz\b/i);
    for (const functionName of affectedFunctions) {
      expect(
        replacementFunctionBody(functionName).replace(
          "create or replace function",
          "create function",
        ),
      ).toBe(functionBody(functionName));
    }
    expect(
      runtimeFix.match(/^create or replace function public\./gm),
    ).toHaveLength(affectedFunctions.length);
    expect(runtimeFix).toContain(
      "from public, anon, authenticated, service_role;",
    );
    expect(runtimeFix).toContain(
      "grant execute on function public.af_complete_research_job_v1(",
    );
  });
});
