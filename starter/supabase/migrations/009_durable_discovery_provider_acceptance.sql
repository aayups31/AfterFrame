-- AFTERFRAME checkpoint 04B: durable discovery provider acceptance.
--
-- The exact private research objective is released only through an
-- actor-scoped service RPC. Accepted background provider work and its
-- PROVIDER_ACCEPTED checkpoint commit in one token-fenced transaction.

create table public.af_research_provider_runs (
  schema_version smallint not null
    constraint af_provider_runs_schema_version_check check (schema_version = 1),
  run_id uuid not null,
  job_id uuid not null,
  attempt_id uuid not null,
  case_id uuid not null,
  provider public.af_slug not null
    constraint af_provider_runs_provider_check check (provider = 'openai'),
  provider_response_id public.af_opaque_reference not null,
  state text not null
    constraint af_provider_runs_state_check check (state in ('QUEUED', 'IN_PROGRESS')),
  requested_model text not null,
  provider_model text not null,
  trace_id public.af_opaque_reference not null,
  manifest_fingerprint public.af_sha256 not null,
  external_idempotency_key public.af_sha256 not null,
  started_at timestamptz not null,
  accepted_at timestamptz not null,
  last_observed_at timestamptz not null,
  input_bytes public.af_safe_nonnegative_integer not null,
  data_control_mode text not null
    constraint af_provider_runs_data_control_check
      check (data_control_mode = 'MODIFIED_ABUSE_MONITORING'),
  project_id_fingerprint public.af_sha256 not null,
  private_content_included boolean not null
    constraint af_provider_runs_private_content_check
      check (private_content_included),
  publication_authority text not null
    constraint af_provider_runs_publication_authority_check
      check (publication_authority = 'NONE'),
  constraint af_provider_runs_pkey primary key (provider, provider_response_id),
  constraint af_provider_runs_attempt_fk
    foreign key (run_id, job_id, attempt_id)
    references public.af_research_attempts(run_id, job_id, id) on delete cascade,
  constraint af_provider_runs_run_case_fk
    foreign key (run_id, case_id)
    references public.af_research_runs(id, case_id) on delete cascade,
  constraint af_provider_runs_model_check check (
    requested_model = btrim(requested_model)
    and provider_model = btrim(provider_model)
    and char_length(requested_model) between 1 and 200
    and char_length(provider_model) between 1 and 200
  ),
  constraint af_provider_runs_time_check check (
    accepted_at >= started_at and last_observed_at >= started_at
  ),
  constraint af_provider_runs_attempt_key unique (attempt_id),
  constraint af_provider_runs_attempt_response_key
    unique (run_id, job_id, attempt_id, provider_response_id)
);

comment on table public.af_research_provider_runs is
  'Body-free recovery metadata for accepted paid provider work. Private questions, prompts, source bodies, and raw provider responses are forbidden.';

create function public.af_research_provider_run_record_valid_v1(value_to_check jsonb)
returns boolean
language plpgsql
immutable
set search_path = pg_catalog, public
as $function$
begin
  if public.af_jsonb_has_exact_keys(
    value_to_check,
    array[
      'schemaVersion', 'runId', 'jobId', 'attemptId', 'caseId', 'provider',
      'providerResponseId', 'state', 'requestedModel', 'providerModel',
      'traceId', 'manifestFingerprint', 'externalIdempotencyKey', 'startedAt',
      'acceptedAt', 'lastObservedAt', 'inputBytes', 'dataControlMode',
      'projectIdFingerprint', 'privateContentIncluded',
      'publicationAuthority'
    ]
  ) is not true then return false; end if;
  perform (value_to_check->>'runId')::uuid;
  perform (value_to_check->>'jobId')::uuid;
  perform (value_to_check->>'attemptId')::uuid;
  perform (value_to_check->>'caseId')::uuid;
  perform (value_to_check->>'provider')::public.af_slug;
  perform (value_to_check->>'providerResponseId')::public.af_opaque_reference;
  perform (value_to_check->>'traceId')::public.af_opaque_reference;
  perform (value_to_check->>'manifestFingerprint')::public.af_sha256;
  perform (value_to_check->>'externalIdempotencyKey')::public.af_sha256;
  perform (value_to_check->>'projectIdFingerprint')::public.af_sha256;
  perform (value_to_check->>'startedAt')::timestamptz;
  perform (value_to_check->>'acceptedAt')::timestamptz;
  perform (value_to_check->>'lastObservedAt')::timestamptz;
  perform (value_to_check->>'inputBytes')::bigint;
  return (value_to_check->>'schemaVersion')::integer = 1
    and value_to_check->>'provider' = 'openai'
    and value_to_check->>'state' in ('QUEUED', 'IN_PROGRESS')
    and value_to_check->>'requestedModel' = btrim(value_to_check->>'requestedModel')
    and value_to_check->>'providerModel' = btrim(value_to_check->>'providerModel')
    and char_length(value_to_check->>'requestedModel') between 1 and 200
    and char_length(value_to_check->>'providerModel') between 1 and 200
    and (value_to_check->>'inputBytes')::bigint between 0 and 9007199254740991
    and value_to_check->>'dataControlMode' = 'MODIFIED_ABUSE_MONITORING'
    and value_to_check->'privateContentIncluded' = 'true'::jsonb
    and value_to_check->>'publicationAuthority' = 'NONE'
    and (value_to_check->>'acceptedAt')::timestamptz >=
      (value_to_check->>'startedAt')::timestamptz
    and (value_to_check->>'lastObservedAt')::timestamptz >=
      (value_to_check->>'startedAt')::timestamptz;
exception
  when invalid_text_representation or check_violation
    or numeric_value_out_of_range then return false;
end;
$function$;

create function public.af_research_provider_run_record_json_v1(
  provider_row public.af_research_provider_runs
)
returns jsonb
language sql
stable
set search_path = pg_catalog
as $function$
  select jsonb_build_object(
    'schemaVersion', provider_row.schema_version,
    'runId', provider_row.run_id,
    'jobId', provider_row.job_id,
    'attemptId', provider_row.attempt_id,
    'caseId', provider_row.case_id,
    'provider', provider_row.provider,
    'providerResponseId', provider_row.provider_response_id,
    'state', provider_row.state,
    'requestedModel', provider_row.requested_model,
    'providerModel', provider_row.provider_model,
    'traceId', provider_row.trace_id,
    'manifestFingerprint', provider_row.manifest_fingerprint,
    'externalIdempotencyKey', provider_row.external_idempotency_key,
    'startedAt', provider_row.started_at,
    'acceptedAt', provider_row.accepted_at,
    'lastObservedAt', provider_row.last_observed_at,
    'inputBytes', provider_row.input_bytes,
    'dataControlMode', provider_row.data_control_mode,
    'projectIdFingerprint', provider_row.project_id_fingerprint,
    'privateContentIncluded', provider_row.private_content_included,
    'publicationAuthority', provider_row.publication_authority
  );
$function$;

create function public.af_get_research_discovery_context_v1(
  p_actor_id uuid,
  p_run_id uuid,
  p_job_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, auth
as $function$
declare
  run_row public.af_research_runs%rowtype;
  case_row public.af_cases%rowtype;
  branch_row public.af_branches%rowtype;
  plan_row public.af_research_plans%rowtype;
  job_row public.af_research_jobs%rowtype;
  identity_row public.af_resolved_subject_identities%rowtype;
  exact_question text;
begin
  perform public.af_assert_actor_scope(p_actor_id);
  select stored_run.* into run_row
  from public.af_research_runs stored_run
  join public.af_cases stored_case on stored_case.id = stored_run.case_id
  where stored_run.id = p_run_id and stored_case.owner_id = p_actor_id;
  if not found then return null; end if;
  select * into strict case_row from public.af_cases where id = run_row.case_id;
  select * into job_row from public.af_research_jobs
  where id = p_job_id and run_id = run_row.id and stage = 'DISCOVERY';
  if not found then return null; end if;
  select * into plan_row from public.af_research_plans
  where id = run_row.plan_id and run_id = run_row.id;
  if not found then
    raise exception using errcode = 'AFR07', message = 'Research run is missing its authoritative plan';
  end if;
  select * into identity_row from public.af_resolved_subject_identities
  where run_id = run_row.id;
  if not found then
    raise exception using errcode = 'AFR07', message = 'Discovery requires resolver-verified public identity';
  end if;
  if run_row.branch_id is null then
    exact_question := case_row.exact_curiosity;
  else
    select * into branch_row from public.af_branches
    where id = run_row.branch_id and case_id = case_row.id;
    if not found then
      raise exception using errcode = 'AFR07', message = 'Research run is missing its bound branch';
    end if;
    exact_question := case_row.exact_curiosity
      || E'\n\nBranch objective: ' || branch_row.normalized_objective;
  end if;
  return jsonb_build_object(
    'schemaVersion', 1,
    'runId', run_row.id,
    'jobId', job_row.id,
    'caseId', case_row.id,
    'subjectRef', jsonb_build_object(
      'type', case_row.subject_type,
      'id', case_row.subject_id,
      'versionId', case_row.subject_version_id
    ),
    'publicSubjectIdentity',
      public.af_resolved_subject_identity_record_json_v1(identity_row)->'publicIdentity',
    'exactQuestion', exact_question,
    'axes', plan_row.plan->'axes',
    'sourceClassIds', plan_row.plan->'sourceClassIds'
  );
end;
$function$;

create function public.af_accept_research_provider_run_v1(
  p_actor_id uuid,
  p_lease jsonb,
  p_checkpoint jsonb,
  p_provider_run jsonb,
  p_lease_seconds integer
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, public, auth
as $function$
declare
  checkpoint_result jsonb;
  authoritative_attempt public.af_research_attempts%rowtype;
  authoritative_job public.af_research_jobs%rowtype;
  authoritative_run public.af_research_runs%rowtype;
  authoritative_manifest public.af_research_attempt_input_manifests%rowtype;
  stored_provider_row public.af_research_provider_runs%rowtype;
  candidate_provider_row public.af_research_provider_runs%rowtype;
begin
  perform public.af_assert_actor_scope(p_actor_id);
  if not public.af_research_provider_run_record_valid_v1(p_provider_run)
    or not public.af_research_checkpoint_record_valid(p_checkpoint)
    or p_checkpoint->>'kind' <> 'PROVIDER_ACCEPTED'
    or p_checkpoint->>'providerRunId' is distinct from
      p_provider_run->>'providerResponseId'
    or p_checkpoint->>'runId' is distinct from p_provider_run->>'runId'
    or p_checkpoint->>'jobId' is distinct from p_provider_run->>'jobId'
    or p_checkpoint->>'attemptId' is distinct from p_provider_run->>'attemptId'
    or p_lease->>'runId' is distinct from p_provider_run->>'runId'
    or p_lease->>'jobId' is distinct from p_provider_run->>'jobId'
    or p_lease->>'attemptId' is distinct from p_provider_run->>'attemptId'
    or p_lease->>'externalIdempotencyKey' is distinct from
      p_provider_run->>'externalIdempotencyKey' then
    raise exception using errcode = 'AFR04', message = 'Invalid provider acceptance input';
  end if;

  select stored_run.* into authoritative_run
  from public.af_research_runs stored_run
  join public.af_cases stored_case on stored_case.id = stored_run.case_id
  where stored_run.id = (p_provider_run->>'runId')::uuid
    and stored_case.owner_id = p_actor_id;
  if not found then
    raise exception using errcode = 'AFR05', message = 'Actor scope mismatch or record not found';
  end if;
  select * into authoritative_job from public.af_research_jobs
  where id = (p_provider_run->>'jobId')::uuid
    and run_id = authoritative_run.id;
  select * into authoritative_attempt from public.af_research_attempts
  where id = (p_provider_run->>'attemptId')::uuid
    and run_id = authoritative_run.id
    and job_id = authoritative_job.id;
  select * into authoritative_manifest
  from public.af_research_attempt_input_manifests
  where attempt_id = authoritative_attempt.id;
  if authoritative_job.id is null or authoritative_attempt.id is null
    or authoritative_manifest.id is null
    or authoritative_job.stage <> 'DISCOVERY'
    or authoritative_run.case_id <> (p_provider_run->>'caseId')::uuid
    or authoritative_manifest.manifest_fingerprint is distinct from
      p_provider_run->>'manifestFingerprint'
    or authoritative_attempt.request_fingerprint is distinct from
      p_provider_run->>'externalIdempotencyKey'
    or authoritative_attempt.execution_kind <> 'MODEL_TOOL'
    or authoritative_attempt.model_provider <> 'openai'
    or authoritative_attempt.model_name is distinct from
      p_provider_run->>'requestedModel'
    or authoritative_attempt.private_content_included is distinct from true then
    raise exception using errcode = 'AFR07', message = 'Provider recovery state does not match authoritative discovery input';
  end if;

  checkpoint_result := public.af_checkpoint_research_job_v1(
    p_actor_id, p_lease, p_checkpoint, p_lease_seconds
  );
  if checkpoint_result->>'status' not in ('COMMITTED', 'REPLAY') then
    return checkpoint_result;
  end if;

  select * into stored_provider_row
  from public.af_research_provider_runs
  where attempt_id = (p_provider_run->>'attemptId')::uuid
  for update;
  if found then
    if public.af_research_provider_run_record_json_v1(stored_provider_row)
      is distinct from p_provider_run then
      raise exception using errcode = 'AFR02', message = 'Attempt identifies different provider recovery state';
    end if;
    return checkpoint_result || jsonb_build_object(
      'providerRun', public.af_research_provider_run_record_json_v1(stored_provider_row)
    );
  end if;
  if checkpoint_result->>'status' = 'REPLAY' then
    raise exception using errcode = 'AFR07', message = 'Provider checkpoint lacks durable recovery state';
  end if;

  insert into public.af_research_provider_runs (
    schema_version, run_id, job_id, attempt_id, case_id, provider,
    provider_response_id, state, requested_model, provider_model, trace_id,
    manifest_fingerprint, external_idempotency_key, started_at, accepted_at,
    last_observed_at, input_bytes, data_control_mode, project_id_fingerprint,
    private_content_included, publication_authority
  ) values (
    1,
    (p_provider_run->>'runId')::uuid,
    (p_provider_run->>'jobId')::uuid,
    (p_provider_run->>'attemptId')::uuid,
    (p_provider_run->>'caseId')::uuid,
    p_provider_run->>'provider',
    p_provider_run->>'providerResponseId',
    p_provider_run->>'state',
    p_provider_run->>'requestedModel',
    p_provider_run->>'providerModel',
    p_provider_run->>'traceId',
    p_provider_run->>'manifestFingerprint',
    p_provider_run->>'externalIdempotencyKey',
    (p_provider_run->>'startedAt')::timestamptz,
    (p_provider_run->>'acceptedAt')::timestamptz,
    (p_provider_run->>'lastObservedAt')::timestamptz,
    (p_provider_run->>'inputBytes')::bigint,
    p_provider_run->>'dataControlMode',
    p_provider_run->>'projectIdFingerprint',
    true,
    'NONE'
  ) returning * into candidate_provider_row;
  return checkpoint_result || jsonb_build_object(
    'providerRun', public.af_research_provider_run_record_json_v1(candidate_provider_row)
  );
exception
  when unique_violation then
    raise exception using errcode = 'AFR03', message = 'Provider recovery identifier already exists';
  when foreign_key_violation or check_violation or not_null_violation
    or invalid_text_representation or numeric_value_out_of_range then
    raise exception using errcode = 'AFR04', message = 'Provider acceptance failed schema invariants';
end;
$function$;

alter table public.af_research_provider_runs enable row level security;
alter table public.af_research_provider_runs force row level security;
revoke all on table public.af_research_provider_runs
  from public, anon, authenticated;
grant all on table public.af_research_provider_runs to service_role;

revoke all on function public.af_research_provider_run_record_valid_v1(jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.af_research_provider_run_record_json_v1(
  public.af_research_provider_runs
) from public, anon, authenticated, service_role;
revoke all on function public.af_get_research_discovery_context_v1(
  uuid, uuid, uuid
) from public, anon, authenticated, service_role;
revoke all on function public.af_accept_research_provider_run_v1(
  uuid, jsonb, jsonb, jsonb, integer
) from public, anon, authenticated, service_role;

grant execute on function public.af_get_research_discovery_context_v1(
  uuid, uuid, uuid
) to service_role;
grant execute on function public.af_accept_research_provider_run_v1(
  uuid, jsonb, jsonb, jsonb, integer
) to service_role;

comment on function public.af_get_research_discovery_context_v1(
  uuid, uuid, uuid
) is
  'Service-only actor-scoped DISCOVERY input. Exact private objective is returned only to the authorized worker boundary.';
comment on function public.af_accept_research_provider_run_v1(
  uuid, jsonb, jsonb, jsonb, integer
) is
  'Atomically commits body-free provider recovery state and its token-fenced PROVIDER_ACCEPTED checkpoint.';
