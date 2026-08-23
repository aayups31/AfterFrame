-- Candidate axis bindings are part of discovery provenance. Migration 006
-- predates the axis-tagged discovery contract, so completion must now preserve
-- and validate those tags rather than dropping or rejecting them.

alter table public.af_source_candidates
  add column axis_ids text[];

create function public.af_candidate_axis_ids_valid_v1(values_to_check text[])
returns boolean
language sql
immutable
set search_path = pg_catalog, public
as $function$
  select public.af_slug_array_valid(values_to_check, 1, 30)
    and cardinality(values_to_check) = (
      select count(distinct axis_id) from unnest(values_to_check) axis_id
    );
$function$;

create function public.af_enforce_candidate_axis_ids_v1()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $function$
declare
  current_axis_ids text[];
begin
  select candidate.axis_ids into current_axis_ids
  from public.af_source_candidates candidate
  where candidate.id = new.id;
  if found and not public.af_candidate_axis_ids_valid_v1(current_axis_ids) then
    raise exception using errcode = 'AFR04',
      message = 'Source candidate requires unique validated axis bindings';
  end if;
  return new;
end;
$function$;

create constraint trigger af_source_candidates_axis_ids_trigger
after insert or update of axis_ids on public.af_source_candidates
deferrable initially deferred
for each row execute function public.af_enforce_candidate_axis_ids_v1();

alter function public.af_research_stage_result_valid(
  jsonb, uuid, uuid, uuid, public.af_research_stage
) rename to af_research_stage_result_without_candidate_axes_v1;

create function public.af_research_stage_result_valid(
  value_to_check jsonb,
  expected_run_id uuid,
  expected_job_id uuid,
  expected_attempt_id uuid,
  expected_stage public.af_research_stage
)
returns boolean
language plpgsql
immutable
set search_path = pg_catalog, public
as $function$
declare
  candidate_json jsonb;
  stripped_candidates jsonb := '[]'::jsonb;
  axis_values text[];
  stripped_result jsonb;
begin
  if jsonb_typeof(value_to_check->'sourceCandidates') is distinct from 'array'
    or jsonb_array_length(value_to_check->'sourceCandidates') > 500 then
    return false;
  end if;
  for candidate_json in
    select value from jsonb_array_elements(value_to_check->'sourceCandidates')
  loop
    if not public.af_jsonb_has_exact_keys(
      candidate_json,
      array['schemaVersion', 'id', 'runId', 'jobId', 'attemptId',
        'candidateKey', 'title', 'canonicalUrl', 'medium', 'sourceClass',
        'axisIds', 'accessState', 'rightsState',
        'discoveryInputFingerprint', 'contentTrust', 'evidenceStatus',
        'reviewState', 'publicationAuthority', 'createdAt']
    ) or jsonb_typeof(candidate_json->'axisIds') is distinct from 'array' then
      return false;
    end if;
    axis_values := array(
      select jsonb_array_elements_text(candidate_json->'axisIds')
    );
    if not public.af_candidate_axis_ids_valid_v1(axis_values) then
      return false;
    end if;
    stripped_candidates := stripped_candidates ||
      jsonb_build_array(candidate_json - 'axisIds');
  end loop;
  stripped_result := jsonb_set(
    value_to_check,
    '{sourceCandidates}',
    stripped_candidates,
    false
  );
  return public.af_research_stage_result_without_candidate_axes_v1(
    stripped_result,
    expected_run_id,
    expected_job_id,
    expected_attempt_id,
    expected_stage
  );
exception
  when invalid_text_representation or check_violation
    or numeric_value_out_of_range then return false;
end;
$function$;

alter function public.af_persist_research_stage_result(
  uuid, uuid, uuid, public.af_research_stage, public.af_sha256,
  uuid, jsonb, timestamptz
) rename to af_persist_research_stage_result_without_candidate_axes_v1;

create function public.af_persist_research_stage_result(
  p_run_id uuid,
  p_job_id uuid,
  p_attempt_id uuid,
  p_stage public.af_research_stage,
  p_stage_input_fingerprint public.af_sha256,
  p_plan_id uuid,
  p_result jsonb,
  p_completed_at timestamptz
)
returns void
language plpgsql
volatile
set search_path = pg_catalog, public
as $function$
declare
  candidate_json jsonb;
  axis_values text[];
  authoritative_plan jsonb;
  authoritative_manifest_fingerprint public.af_sha256;
  candidate_id uuid;
begin
  select plan.plan, manifest.manifest_fingerprint
  into authoritative_plan, authoritative_manifest_fingerprint
  from public.af_research_attempts attempt
  join public.af_research_jobs job
    on job.run_id = attempt.run_id and job.id = attempt.job_id
  join public.af_research_runs run on run.id = attempt.run_id
  join public.af_research_plans plan on plan.id = run.plan_id
  join public.af_research_attempt_input_manifests manifest
    on manifest.attempt_id = attempt.id
  where attempt.id = p_attempt_id
    and attempt.run_id = p_run_id
    and attempt.job_id = p_job_id
    and job.stage = p_stage
    and plan.id = p_plan_id
    and job.stage_input_fingerprint = p_stage_input_fingerprint;
  if authoritative_plan is null or authoritative_manifest_fingerprint is null then
    raise exception using errcode = 'AFR07',
      message = 'Candidate persistence lacks its authoritative attempt manifest';
  end if;

  for candidate_json in
    select value from jsonb_array_elements(p_result->'sourceCandidates')
  loop
    axis_values := array(
      select jsonb_array_elements_text(candidate_json->'axisIds')
    );
    if not public.af_candidate_axis_ids_valid_v1(axis_values)
      or exists (
        select 1 from unnest(axis_values) requested(axis_id)
        where not exists (
          select 1
          from jsonb_array_elements(authoritative_plan->'axes') axis
          where axis->>'axisId' = requested.axis_id
            and exists (
              select 1
              from jsonb_array_elements_text(axis->'sourceClassIds') permitted(source_class)
              where permitted.source_class = candidate_json->>'sourceClass'
            )
        )
      ) then
      raise exception using errcode = 'AFR04',
        message = 'Candidate axis binding violates the authoritative specialist plan';
    end if;
    if candidate_json->>'discoveryInputFingerprint'
      <> authoritative_manifest_fingerprint::text then
      raise exception using errcode = 'AFR04',
        message = 'Candidate does not bind the authoritative discovery manifest';
    end if;
  end loop;

  perform public.af_persist_research_stage_result_without_candidate_axes_v1(
    p_run_id,
    p_job_id,
    p_attempt_id,
    p_stage,
    authoritative_manifest_fingerprint,
    p_plan_id,
    p_result,
    p_completed_at
  );

  for candidate_json in
    select value from jsonb_array_elements(p_result->'sourceCandidates')
  loop
    axis_values := array(
      select jsonb_array_elements_text(candidate_json->'axisIds')
    );
    candidate_id := (candidate_json->>'id')::uuid;
    update public.af_source_candidates
    set axis_ids = axis_values
    where id = candidate_id
      and run_id = p_run_id
      and job_id = p_job_id
      and attempt_id = p_attempt_id;
    if not found then
      raise exception using errcode = 'AFR04',
        message = 'Candidate axis binding target is missing';
    end if;
  end loop;
  set constraints af_source_candidates_axis_ids_trigger immediate;
  set constraints af_source_candidates_axis_ids_trigger deferred;
exception
  when invalid_text_representation or check_violation
    or not_null_violation or array_subscript_error then
    raise exception using errcode = 'AFR04',
      message = 'Candidate axis binding failed schema invariants';
end;
$function$;

revoke all on function public.af_candidate_axis_ids_valid_v1(text[])
  from public, anon, authenticated, service_role;
revoke all on function public.af_enforce_candidate_axis_ids_v1()
  from public, anon, authenticated, service_role;
revoke all on function public.af_research_stage_result_without_candidate_axes_v1(
  jsonb, uuid, uuid, uuid, public.af_research_stage
) from public, anon, authenticated, service_role;
revoke all on function public.af_persist_research_stage_result_without_candidate_axes_v1(
  uuid, uuid, uuid, public.af_research_stage, public.af_sha256,
  uuid, jsonb, timestamptz
) from public, anon, authenticated, service_role;
revoke all on function public.af_research_stage_result_valid(
  jsonb, uuid, uuid, uuid, public.af_research_stage
) from public, anon, authenticated, service_role;
revoke all on function public.af_persist_research_stage_result(
  uuid, uuid, uuid, public.af_research_stage, public.af_sha256,
  uuid, jsonb, timestamptz
) from public, anon, authenticated, service_role;

comment on column public.af_source_candidates.axis_ids is
  'Pinned Movie Investigator research axes this untrusted candidate may help investigate.';
comment on function public.af_persist_research_stage_result(
  uuid, uuid, uuid, public.af_research_stage, public.af_sha256,
  uuid, jsonb, timestamptz
) is
  'Persists DISCOVERY candidates only when their manifest and axis bindings match the authoritative attempt and specialist plan.';
