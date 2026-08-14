-- AFTERFRAME durable research worker persistence (checkpoint 03).
--
-- This migration is additive to the checkpoint-02 `af_*` spine. It makes
-- research-run creation and every worker transition transactional, actor
-- scoped, idempotent, lease-fenced, optimistic-versioned, and outbox backed.
-- Source or model bodies are never accepted by the operational envelopes.

-- ---------------------------------------------------------------------------
-- Repair the cross-stage candidate relationship from checkpoint 02
-- ---------------------------------------------------------------------------

-- A candidate is discovered by DISCOVERY and may later be inspected by
-- RESOLUTION or NORMALIZATION. The checkpoint-02 FK incorrectly required the
-- content record and candidate to share a job and attempt, which makes that
-- valid cross-stage handoff impossible.
alter table public.af_source_candidates
  add constraint af_source_candidates_run_id_id_key unique (run_id, id);

alter table public.af_untrusted_research_content
  drop constraint af_untrusted_content_candidate_fk;

alter table public.af_untrusted_research_content
  add constraint af_untrusted_content_candidate_fk
  foreign key (run_id, candidate_id)
  references public.af_source_candidates(run_id, id)
  on delete cascade;

-- Only one non-terminal run may own a case/branch scope. The sentinel is used
-- solely to make a root (NULL branch) participate in uniqueness.
create unique index af_research_runs_one_active_scope_idx
  on public.af_research_runs (
    case_id,
    coalesce(branch_id, '00000000-0000-0000-0000-000000000000'::uuid)
  )
  where status not in ('SUCCEEDED', 'DEGRADED', 'FAILED', 'CANCELLED');

-- ---------------------------------------------------------------------------
-- Durable reservation, claim, checkpoint, and redacted failure records
-- ---------------------------------------------------------------------------

create type public.af_research_failure_category as enum (
  'TRANSIENT_UPSTREAM', 'RATE_LIMITED', 'TIMEOUT', 'INVALID_OUTPUT',
  'POLICY', 'RIGHTS', 'NOT_FOUND', 'AUTH_CONFIGURATION', 'WORKER_INTERNAL'
);
create type public.af_research_failure_phase as enum (
  'PREPARATION', 'EXTERNAL_CALL', 'VALIDATION', 'CHECKPOINT', 'COMMIT'
);
create type public.af_research_retry_directive as enum (
  'RETRY_WITH_BACKOFF', 'DO_NOT_RETRY'
);
create type public.af_research_checkpoint_kind as enum (
  'PROGRESS', 'PROVIDER_ACCEPTED', 'OUTPUT_VALIDATED'
);

create table public.af_research_start_commit_results (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid not null references auth.users(id) on delete cascade,
  case_id uuid not null,
  request_fingerprint public.af_sha256 not null,
  result_json jsonb not null check (jsonb_typeof(result_json) = 'object'),
  committed_at timestamptz not null,
  constraint af_research_start_results_case_owner_fk
    foreign key (case_id, actor_id)
    references public.af_cases(id, owner_id) on delete cascade,
  unique (actor_id, request_fingerprint, id)
);

comment on table public.af_research_start_commit_results is
  'Private immutable start-run replay snapshot. It is server-only operational state and never analytics input.';

create table public.af_research_start_idempotency (
  actor_id uuid not null references auth.users(id) on delete cascade,
  command_name text not null check (command_name = 'start_research_run'),
  idempotency_key text not null,
  request_fingerprint public.af_sha256 not null,
  state public.af_idempotency_state not null,
  reservation_token uuid,
  lease_expires_at timestamptz,
  result_id uuid unique
    references public.af_research_start_commit_results(id) on delete restrict,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  completed_at timestamptz,
  constraint af_research_start_idempotency_key_check check (
    char_length(idempotency_key) between 8 and 200
    and idempotency_key ~ '^[A-Za-z0-9][A-Za-z0-9._:-]*$'
  ),
  constraint af_research_start_idempotency_state_check check (
    (
      state = 'IN_PROGRESS'
      and reservation_token is not null
      and lease_expires_at is not null
      and result_id is null
      and completed_at is null
    )
    or (
      state = 'COMPLETED'
      and reservation_token is null
      and lease_expires_at is null
      and result_id is not null
      and completed_at is not null
    )
  ),
  constraint af_research_start_idempotency_time_check check (
    updated_at >= created_at
    and (completed_at is null or completed_at >= created_at)
  ),
  primary key (actor_id, command_name, idempotency_key)
);

create table public.af_research_job_leases (
  attempt_id uuid primary key,
  run_id uuid not null,
  job_id uuid not null,
  case_id uuid not null,
  actor_id uuid not null references auth.users(id) on delete cascade,
  worker_id public.af_opaque_reference not null,
  lease_token uuid not null unique,
  lease_epoch public.af_safe_positive_integer not null,
  execution_plan jsonb not null check (jsonb_typeof(execution_plan) = 'object'),
  lease_expires_at timestamptz not null,
  last_heartbeat_at timestamptz not null,
  claimed_at timestamptz not null,
  released_at timestamptz,
  constraint af_research_job_leases_attempt_fk
    foreign key (run_id, job_id, attempt_id)
    references public.af_research_attempts(run_id, job_id, id)
    on delete cascade,
  constraint af_research_job_leases_run_case_fk
    foreign key (run_id, case_id)
    references public.af_research_runs(id, case_id) on delete cascade,
  constraint af_research_job_leases_case_owner_fk
    foreign key (case_id, actor_id)
    references public.af_cases(id, owner_id) on delete cascade,
  constraint af_research_job_leases_time_check check (
    last_heartbeat_at >= claimed_at
    and lease_expires_at > last_heartbeat_at
    and (released_at is null or released_at >= claimed_at)
  )
);

create unique index af_research_job_leases_one_active_job_idx
  on public.af_research_job_leases(run_id, job_id)
  where released_at is null;

create index af_research_job_leases_expiry_idx
  on public.af_research_job_leases(lease_expires_at)
  where released_at is null;

-- The core attempt record stores the derived request fingerprint. The
-- operational key is retained separately so reuse with a different
-- fingerprint is detectable instead of looking like unrelated work.
alter table public.af_research_attempts
  add column claim_idempotency_key text;

alter table public.af_research_attempts
  add column telemetry_state text check (
    telemetry_state in ('COMPLETE', 'PARTIAL', 'UNAVAILABLE')
  );

alter table public.af_research_attempts
  add column terminal_idempotency_key public.af_opaque_reference;

alter table public.af_research_attempts
  add column terminal_mutation_kind text check (
    terminal_mutation_kind is null
    or terminal_mutation_kind in ('COMPLETE', 'FAIL', 'RELEASE')
  );

alter table public.af_research_attempts
  alter column usage_input_tokens drop not null,
  alter column usage_output_tokens drop not null,
  alter column usage_tool_calls drop not null,
  alter column usage_input_bytes drop not null,
  alter column usage_output_bytes drop not null,
  alter column cost_currency drop not null,
  alter column cost_pricing_state drop not null;

alter table public.af_research_attempts
  drop constraint af_research_attempts_cost_check;

-- A live checkpoint-02 attempt has ambiguous placeholder telemetry and cannot
-- be losslessly upgraded. Refuse deployment until workers are drained. All
-- terminal checkpoint-02 rows already carry a non-null execution envelope.
-- Preserve every value: successful rows are COMPLETE as required by the core
-- contract; failed/cancelled rows remain conservatively PARTIAL.
do $telemetry_upgrade$
begin
  if exists (
    select 1 from public.af_research_attempts where status = 'RUNNING'
  ) then
    raise exception using
      errcode = '55000',
      message = 'Drain RUNNING research attempts before applying checkpoint 03';
  end if;
  update public.af_research_attempts
  set telemetry_state = case
    when status in ('SUCCEEDED', 'DEGRADED') then 'COMPLETE'
    else 'PARTIAL'
  end
  where telemetry_state is null;
end;
$telemetry_upgrade$;

alter table public.af_research_attempts
  alter column telemetry_state set not null;

alter table public.af_research_attempts
  add constraint af_research_attempts_telemetry_truth_check check (
    (
      telemetry_state = 'COMPLETE'
      and usage_input_tokens is not null
      and usage_output_tokens is not null
      and usage_tool_calls is not null
      and usage_input_bytes is not null
      and usage_output_bytes is not null
      and cost_currency = 'USD'
      and (
        (cost_pricing_state = 'PRICED' and cost_amount_micros is not null)
        or (cost_pricing_state = 'UNPRICED' and cost_amount_micros is null)
      )
    )
    or (
      telemetry_state = 'PARTIAL'
      and (
        provider_run_id is not null
        or usage_input_tokens is not null
        or cost_pricing_state is not null
      )
      and (
        (usage_input_tokens is null and usage_output_tokens is null
          and usage_tool_calls is null and usage_input_bytes is null
          and usage_output_bytes is null)
        or (usage_input_tokens is not null and usage_output_tokens is not null
          and usage_tool_calls is not null and usage_input_bytes is not null
          and usage_output_bytes is not null)
      )
      and (
        (cost_currency is null and cost_pricing_state is null and cost_amount_micros is null)
        or (cost_currency = 'USD' and cost_pricing_state = 'PRICED'
          and cost_amount_micros is not null)
        or (cost_currency = 'USD' and cost_pricing_state = 'UNPRICED'
          and cost_amount_micros is null)
      )
    )
    or (
      telemetry_state = 'UNAVAILABLE'
      and usage_input_tokens is null
      and usage_output_tokens is null
      and usage_tool_calls is null
      and usage_input_bytes is null
      and usage_output_bytes is null
      and cost_currency is null
      and cost_pricing_state is null
      and cost_amount_micros is null
    )
  );

alter table public.af_research_attempts
  add constraint af_research_attempts_claim_idempotency_key_check check (
    claim_idempotency_key is null
    or (
      char_length(claim_idempotency_key) between 8 and 200
      and claim_idempotency_key ~ '^[A-Za-z0-9][A-Za-z0-9._:-]*$'
    )
  );

create unique index af_research_attempts_claim_idempotency_idx
  on public.af_research_attempts(run_id, job_id, claim_idempotency_key)
  where claim_idempotency_key is not null;

create table public.af_research_attempt_checkpoints (
  schema_version smallint not null check (schema_version = 1),
  id uuid primary key,
  run_id uuid not null,
  job_id uuid not null,
  attempt_id uuid not null,
  checkpoint_sequence public.af_safe_positive_integer not null,
  idempotency_key public.af_opaque_reference not null,
  kind public.af_research_checkpoint_kind not null,
  completed_units public.af_safe_nonnegative_integer not null,
  total_units public.af_safe_nonnegative_integer,
  provider_run_id public.af_opaque_reference,
  resume_token_fingerprint public.af_sha256,
  output_fingerprint public.af_sha256,
  publication_authority text not null check (publication_authority = 'NONE'),
  created_at timestamptz not null,
  constraint af_research_checkpoints_attempt_fk
    foreign key (run_id, job_id, attempt_id)
    references public.af_research_attempts(run_id, job_id, id)
    on delete cascade,
  constraint af_research_checkpoints_progress_check check (
    (total_units is null or (total_units > 0 and completed_units <= total_units))
    and (kind <> 'PROVIDER_ACCEPTED' or provider_run_id is not null)
    and (kind <> 'OUTPUT_VALIDATED' or output_fingerprint is not null)
  ),
  unique (attempt_id, checkpoint_sequence),
  unique (attempt_id, idempotency_key)
);

comment on table public.af_research_attempt_checkpoints is
  'Body-free durable progress and provider resume references. Only fingerprints are retained for opaque resume tokens and validated outputs.';

create table public.af_research_attempt_failures (
  schema_version smallint not null check (schema_version = 1),
  attempt_id uuid primary key,
  run_id uuid not null,
  job_id uuid not null,
  mutation_idempotency_key public.af_opaque_reference not null,
  code public.af_slug not null,
  category public.af_research_failure_category not null,
  phase public.af_research_failure_phase not null,
  retry_directive public.af_research_retry_directive not null,
  retry_after_ms public.af_safe_nonnegative_integer,
  retry_at timestamptz,
  provider_status_code smallint,
  diagnostic_fingerprint public.af_sha256,
  redaction_state text not null check (redaction_state = 'BODY_FREE'),
  recorded_at timestamptz not null,
  constraint af_research_attempt_failures_attempt_fk
    foreign key (run_id, job_id, attempt_id)
    references public.af_research_attempts(run_id, job_id, id)
    on delete cascade,
  constraint af_research_attempt_failures_status_check check (
    provider_status_code is null
    or provider_status_code between 100 and 599
  ),
  constraint af_research_attempt_failures_retry_check check (
    (
      retry_directive = 'RETRY_WITH_BACKOFF'
      and retry_after_ms between 100 and 86400000
      and retry_at is not null
    )
    or (
      retry_directive = 'DO_NOT_RETRY'
      and retry_after_ms is null
      and retry_at is null
    )
  ),
  constraint af_research_attempt_failures_terminal_category_check check (
    retry_directive <> 'RETRY_WITH_BACKOFF'
    or category not in ('POLICY', 'RIGHTS', 'AUTH_CONFIGURATION')
  )
);

comment on table public.af_research_attempt_failures is
  'Strict redacted failure envelope. It stores no exception message, response body, prompt, source excerpt, or private case text.';

create table public.af_research_attempt_handoffs (
  id uuid primary key default gen_random_uuid(),
  schema_version smallint not null check (schema_version = 1),
  run_id uuid not null,
  job_id uuid not null,
  attempt_id uuid not null,
  case_id uuid not null,
  actor_id uuid not null references auth.users(id) on delete cascade,
  lease_epoch public.af_safe_positive_integer not null,
  mutation_kind text not null check (mutation_kind in ('FAIL', 'RELEASE')),
  mutation_idempotency_key public.af_opaque_reference not null,
  code public.af_slug not null,
  category public.af_research_failure_category not null,
  phase public.af_research_failure_phase not null,
  retry_after_ms public.af_safe_positive_integer not null
    check (retry_after_ms <= 86400000),
  provider_status_code smallint check (
    provider_status_code is null or provider_status_code between 100 and 599
  ),
  diagnostic_fingerprint public.af_sha256,
  redaction_state text not null check (redaction_state = 'BODY_FREE'),
  telemetry_state text not null check (
    telemetry_state in ('COMPLETE', 'PARTIAL', 'UNAVAILABLE')
  ),
  provider_run_id public.af_opaque_reference,
  usage_input_tokens public.af_safe_nonnegative_integer,
  usage_output_tokens public.af_safe_nonnegative_integer,
  usage_tool_calls public.af_safe_nonnegative_integer,
  usage_input_bytes public.af_safe_nonnegative_integer,
  usage_output_bytes public.af_safe_nonnegative_integer,
  cost_currency text check (cost_currency is null or cost_currency = 'USD'),
  cost_pricing_state public.af_pricing_state,
  cost_amount_micros public.af_safe_nonnegative_integer,
  latency_ms public.af_safe_nonnegative_integer not null,
  completed_at timestamptz not null,
  retry_at timestamptz not null,
  recorded_at timestamptz not null,
  constraint af_research_handoffs_attempt_fk
    foreign key (run_id, job_id, attempt_id)
    references public.af_research_attempts(run_id, job_id, id) on delete cascade,
  constraint af_research_handoffs_case_owner_fk
    foreign key (case_id, actor_id)
    references public.af_cases(id, owner_id) on delete cascade,
  constraint af_research_handoffs_time_check check (
    retry_at >= completed_at and recorded_at = completed_at
  ),
  constraint af_research_handoffs_telemetry_check check (
    (
      telemetry_state = 'COMPLETE'
      and usage_input_tokens is not null and usage_output_tokens is not null
      and usage_tool_calls is not null and usage_input_bytes is not null
      and usage_output_bytes is not null and cost_currency = 'USD'
      and (
        (cost_pricing_state = 'PRICED' and cost_amount_micros is not null)
        or (cost_pricing_state = 'UNPRICED' and cost_amount_micros is null)
      )
    )
    or (
      telemetry_state = 'PARTIAL'
      and (provider_run_id is not null or usage_input_tokens is not null
        or cost_pricing_state is not null)
      and ((usage_input_tokens is null and usage_output_tokens is null
        and usage_tool_calls is null and usage_input_bytes is null
        and usage_output_bytes is null) or
        (usage_input_tokens is not null and usage_output_tokens is not null
        and usage_tool_calls is not null and usage_input_bytes is not null
        and usage_output_bytes is not null))
      and ((cost_currency is null and cost_pricing_state is null
        and cost_amount_micros is null) or
        (cost_currency = 'USD' and cost_pricing_state = 'PRICED'
          and cost_amount_micros is not null) or
        (cost_currency = 'USD' and cost_pricing_state = 'UNPRICED'
          and cost_amount_micros is null))
    )
    or (
      telemetry_state = 'UNAVAILABLE'
      and usage_input_tokens is null and usage_output_tokens is null
      and usage_tool_calls is null and usage_input_bytes is null
      and usage_output_bytes is null and cost_currency is null
      and cost_pricing_state is null and cost_amount_micros is null
    )
  ),
  unique (attempt_id, mutation_idempotency_key),
  unique (attempt_id, lease_epoch)
);

comment on table public.af_research_attempt_handoffs is
  'Body-free audit of same-attempt retry/release handoffs. Provider checkpoints remain attached to the RUNNING attempt.';

alter table public.af_research_jobs
  add column retry_not_before timestamptz;

-- ---------------------------------------------------------------------------
-- Strict operational JSON envelopes
-- ---------------------------------------------------------------------------


create function public.af_research_start_result_shape_valid(value_to_check jsonb)
returns boolean
language plpgsql
immutable
set search_path = pg_catalog, public
as $function$
declare
  bundle_json jsonb;
  run_json jsonb;
  plan_json jsonb;
  job_json jsonb;
  outbox_json jsonb;
  event_json jsonb;
begin
  if not public.af_jsonb_has_exact_keys(
    value_to_check, array['bundle', 'outboxEvents']
  ) then return false; end if;
  bundle_json := value_to_check->'bundle';
  if not public.af_jsonb_has_exact_keys(
    bundle_json,
    array['run', 'plan', 'jobs', 'attempts', 'outputs', 'sourceCandidates',
      'untrustedContent']
  ) then return false; end if;
  if jsonb_typeof(bundle_json->'attempts') <> 'array'
    or jsonb_array_length(bundle_json->'attempts') <> 0
    or jsonb_typeof(bundle_json->'outputs') <> 'array'
    or jsonb_array_length(bundle_json->'outputs') <> 0
    or jsonb_typeof(bundle_json->'sourceCandidates') <> 'array'
    or jsonb_array_length(bundle_json->'sourceCandidates') <> 0
    or jsonb_typeof(bundle_json->'untrustedContent') <> 'array'
    or jsonb_array_length(bundle_json->'untrustedContent') <> 0 then
    return false;
  end if;

  run_json := bundle_json->'run';
  if not public.af_jsonb_has_exact_keys(
    run_json,
    array['schemaVersion', 'id', 'caseId', 'branchId', 'planId',
      'specialistId', 'specialistVersion', 'objectiveFingerprint',
      'requestFingerprint', 'traceId', 'status', 'health', 'currentStage',
      'publicationAuthority', 'aggregateVersion', 'createdAt', 'updatedAt',
      'startedAt', 'completedAt']
  ) then return false; end if;

  plan_json := bundle_json->'plan';
  if not public.af_jsonb_has_exact_keys(
    plan_json,
    array['id', 'runId', 'specialistId', 'specialistVersion',
      'inputFingerprint', 'planFingerprint', 'plan',
      'publicationAuthority', 'createdAt']
  ) or jsonb_typeof(plan_json->'plan') <> 'object' then return false; end if;

  if jsonb_typeof(bundle_json->'jobs') <> 'array'
    or jsonb_array_length(bundle_json->'jobs') <> 7 then return false; end if;
  for job_json in select value from jsonb_array_elements(bundle_json->'jobs') loop
    if not public.af_jsonb_has_exact_keys(
      job_json,
      array['schemaVersion', 'id', 'runId', 'caseId', 'stage',
        'stageOrdinal', 'dependsOnJobId', 'logicalJobKey',
        'stageInputFingerprint', 'status', 'attemptCount', 'maxAttempts',
        'checkpointCount', 'activeAttemptId', 'firstStartedAt', 'terminalAt',
        'publicationAuthority', 'aggregateVersion', 'createdAt', 'updatedAt']
    ) then return false; end if;
  end loop;

  if jsonb_typeof(value_to_check->'outboxEvents') <> 'array'
    or jsonb_array_length(value_to_check->'outboxEvents') <> 2 then
    return false;
  end if;
  for outbox_json in select value from jsonb_array_elements(value_to_check->'outboxEvents') loop
    if not public.af_jsonb_has_exact_keys(
      outbox_json,
      array['id', 'event', 'recordedAt', 'deliveryAttempts', 'deliveredAt']
    ) then return false; end if;
    event_json := outbox_json->'event';
    if not public.af_jsonb_has_exact_keys(
      event_json,
      array['id', 'type', 'schemaVersion', 'aggregateType', 'aggregateId',
        'sequence', 'aggregateVersion', 'occurredAt',
        'publicationAuthority', 'payload']
    ) then return false; end if;
  end loop;
  return true;
end;
$function$;

-- All callers lock the run before appending. This helper deliberately emits
-- reference-only semantic events; it never accepts prose or source bodies.
create function public.af_append_research_event_v1(
  p_run_id uuid,
  p_event_type public.af_research_domain_event_type,
  p_aggregate_version bigint,
  p_occurred_at timestamptz,
  p_payload jsonb
)
returns jsonb
language plpgsql
volatile
set search_path = pg_catalog, public
as $function$
declare
  new_event_id uuid := gen_random_uuid();
  new_outbox_id uuid := gen_random_uuid();
  new_sequence bigint;
begin
  select coalesce(max(event_record.sequence), 0) + 1
    into new_sequence
  from public.af_research_domain_events event_record
  where event_record.aggregate_id = p_run_id;

  insert into public.af_research_domain_events (
    id, event_type, schema_version, aggregate_type, aggregate_id, sequence,
    aggregate_version, occurred_at, publication_authority, payload
  ) values (
    new_event_id, p_event_type, 1, 'research_run', p_run_id, new_sequence,
    p_aggregate_version, p_occurred_at, 'NONE', p_payload
  );
  insert into public.af_research_outbox_events (
    id, domain_event_id, recorded_at, delivery_attempts, delivered_at
  ) values (new_outbox_id, new_event_id, p_occurred_at, 0, null);

  return jsonb_build_object(
    'id', new_outbox_id,
    'event', jsonb_build_object(
      'id', new_event_id,
      'type', p_event_type,
      'schemaVersion', 1,
      'aggregateType', 'research_run',
      'aggregateId', p_run_id,
      'sequence', new_sequence,
      'aggregateVersion', p_aggregate_version,
      'occurredAt', p_occurred_at,
      'publicationAuthority', 'NONE',
      'payload', p_payload
    ),
    'recordedAt', p_occurred_at,
    'deliveryAttempts', 0,
    'deliveredAt', null
  );
end;
$function$;

-- ---------------------------------------------------------------------------
-- Atomic research-run start reservation and commit
-- ---------------------------------------------------------------------------

create function public.af_reserve_research_run_start_v1(
  p_actor_id uuid,
  p_idempotency_key text,
  p_request_fingerprint text,
  p_lease_seconds integer default 120
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, public, auth
as $function$
declare
  lease_row public.af_research_start_idempotency%rowtype;
  replay_json jsonb;
  observed_at timestamptz := clock_timestamp();
  new_token uuid := gen_random_uuid();
begin
  perform public.af_assert_actor_scope(p_actor_id);
  perform p_request_fingerprint::public.af_sha256;
  if p_idempotency_key !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,199}$'
    or p_lease_seconds not between 5 and 900 then
    raise exception using errcode = 'AFR04', message = 'Invalid research-start reservation input';
  end if;

  insert into public.af_research_start_idempotency (
    actor_id, command_name, idempotency_key, request_fingerprint, state,
    reservation_token, lease_expires_at, created_at, updated_at
  ) values (
    p_actor_id, 'start_research_run', p_idempotency_key,
    p_request_fingerprint::public.af_sha256, 'IN_PROGRESS', new_token,
    observed_at + make_interval(secs => p_lease_seconds),
    observed_at, observed_at
  ) on conflict (actor_id, command_name, idempotency_key) do nothing;

  select * into strict lease_row
  from public.af_research_start_idempotency
  where actor_id = p_actor_id
    and command_name = 'start_research_run'
    and idempotency_key = p_idempotency_key
  for update;

  if lease_row.request_fingerprint <> p_request_fingerprint then
    raise exception using errcode = 'AFR02', message = 'Idempotency key identifies a different research-start request';
  end if;
  if lease_row.state = 'COMPLETED' then
    select result_json into strict replay_json
    from public.af_research_start_commit_results
    where id = lease_row.result_id and actor_id = p_actor_id;
    return jsonb_build_object(
      'status', 'REPLAY',
      'requestFingerprint', lease_row.request_fingerprint,
      'result', replay_json
    );
  end if;
  if lease_row.reservation_token = new_token then
    return jsonb_build_object(
      'status', 'ACQUIRED', 'reservationToken', new_token
    );
  end if;
  if lease_row.lease_expires_at > observed_at then
    return jsonb_build_object('status', 'IN_PROGRESS');
  end if;

  update public.af_research_start_idempotency
  set reservation_token = new_token,
      lease_expires_at = observed_at + make_interval(secs => p_lease_seconds),
      updated_at = observed_at
  where actor_id = p_actor_id
    and command_name = 'start_research_run'
    and idempotency_key = p_idempotency_key;
  return jsonb_build_object(
    'status', 'ACQUIRED', 'reservationToken', new_token
  );
end;
$function$;

create function public.af_release_research_run_start_reservation_v1(
  p_actor_id uuid,
  p_idempotency_key text,
  p_request_fingerprint text,
  p_reservation_token uuid
)
returns boolean
language plpgsql
volatile
security definer
set search_path = pg_catalog, public, auth
as $function$
declare
  deleted_count integer;
begin
  perform public.af_assert_actor_scope(p_actor_id);
  delete from public.af_research_start_idempotency
  where actor_id = p_actor_id
    and command_name = 'start_research_run'
    and idempotency_key = p_idempotency_key
    and request_fingerprint = p_request_fingerprint
    and state = 'IN_PROGRESS'
    and reservation_token = p_reservation_token;
  get diagnostics deleted_count = row_count;
  return deleted_count = 1;
end;
$function$;

create function public.af_commit_research_run_start_v1(
  p_actor_id uuid,
  p_idempotency_key text,
  p_request_fingerprint text,
  p_reservation_token uuid,
  p_expected_case_version bigint,
  p_result jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, public, auth
as $function$
declare
  lease_row public.af_research_start_idempotency%rowtype;
  case_row public.af_cases%rowtype;
  branch_row public.af_branches%rowtype;
  bundle_json jsonb := p_result->'bundle';
  run_json jsonb;
  plan_json jsonb;
  jobs_json jsonb;
  job_json jsonb;
  outbox_json jsonb;
  event_json jsonb;
  first_event jsonb;
  second_event jsonb;
  run_id_value uuid;
  case_id_value uuid;
  branch_id_value uuid;
  plan_id_value uuid;
  created_time timestamptz;
  previous_job_id uuid;
  committed_result_id uuid;
  replay_json jsonb;
  job_index integer;
  active_count integer;
  distinct_generated_id_count integer;
  commit_time timestamptz;
begin
  perform public.af_assert_actor_scope(p_actor_id);
  perform p_request_fingerprint::public.af_sha256;

  select * into lease_row
  from public.af_research_start_idempotency
  where actor_id = p_actor_id
    and command_name = 'start_research_run'
    and idempotency_key = p_idempotency_key
  for update;
  if not found then
    raise exception using errcode = 'AFR04', message = 'Matching active research-start reservation required';
  end if;
  if lease_row.request_fingerprint <> p_request_fingerprint then
    raise exception using errcode = 'AFR02', message = 'Idempotency key identifies a different research-start request';
  end if;
  if lease_row.state = 'COMPLETED' then
    select result_json into strict replay_json
    from public.af_research_start_commit_results
    where id = lease_row.result_id and actor_id = p_actor_id;
    return jsonb_build_object('replayed', true, 'result', replay_json);
  end if;
  if lease_row.reservation_token <> p_reservation_token
    or lease_row.lease_expires_at <= clock_timestamp() then
    raise exception using errcode = 'AFR06', message = 'Research-start reservation is stale or does not match';
  end if;
  if not public.af_research_start_result_shape_valid(p_result) then
    raise exception using errcode = 'AFR04', message = 'Research-start result has an invalid or lossy JSON shape';
  end if;

  run_json := bundle_json->'run';
  plan_json := bundle_json->'plan';
  jobs_json := bundle_json->'jobs';
  first_event := p_result#>'{outboxEvents,0,event}';
  second_event := p_result#>'{outboxEvents,1,event}';
  run_id_value := (run_json->>'id')::uuid;
  case_id_value := (run_json->>'caseId')::uuid;
  branch_id_value := case
    when run_json->'branchId' = 'null'::jsonb then null
    else (run_json->>'branchId')::uuid end;
  plan_id_value := (run_json->>'planId')::uuid;
  created_time := (run_json->>'createdAt')::timestamptz;
  commit_time := greatest(clock_timestamp(), lease_row.updated_at);

  select * into case_row
  from public.af_cases stored_case
  where stored_case.id = case_id_value and stored_case.owner_id = p_actor_id
  for update;
  if not found then
    raise exception using errcode = 'AFR05', message = 'Actor scope mismatch or record not found';
  end if;
  if case_row.aggregate_version <> p_expected_case_version then
    raise exception using errcode = 'AFR01', message = 'Case aggregate version conflict';
  end if;
  if case_row.status <> 'ACTIVE' then
    raise exception using errcode = 'AFR07', message = 'Research requires an active case';
  end if;

  if branch_id_value is not null then
    select * into branch_row
    from public.af_branches stored_branch
    where stored_branch.id = branch_id_value
      and stored_branch.case_id = case_id_value
    for share;
    if not found then
      raise exception using errcode = 'AFR05', message = 'Actor scope mismatch or record not found';
    end if;
    if branch_row.status not in ('PROPOSED', 'PLANNED', 'OPEN', 'PAUSED') then
      raise exception using errcode = 'AFR07', message = 'Branch is not researchable';
    end if;
  end if;

  select count(*) into active_count
  from public.af_research_runs existing_run
  where existing_run.case_id = case_id_value
    and existing_run.branch_id is not distinct from branch_id_value
    and existing_run.status not in ('SUCCEEDED', 'DEGRADED', 'FAILED', 'CANCELLED');
  if active_count <> 0 then
    raise exception using errcode = 'AFR08', message = 'A research run is already active for this scope';
  end if;

  if (run_json->>'schemaVersion')::smallint <> 1
    or run_json->>'requestFingerprint' <> p_request_fingerprint
    or run_json->>'specialistId' <> case_row.specialist_id::text
    or run_json->>'specialistVersion' <> case_row.specialist_version::text
    or run_json->>'status' <> 'QUEUED'
    or run_json->>'health' <> 'HEALTHY'
    or run_json->'currentStage' <> 'null'::jsonb
    or run_json->>'publicationAuthority' <> 'NONE'
    or (run_json->>'aggregateVersion')::bigint <> 0
    or (run_json->>'updatedAt')::timestamptz <> created_time
    or run_json->'startedAt' <> 'null'::jsonb
    or run_json->'completedAt' <> 'null'::jsonb
    or (plan_json->>'id')::uuid <> plan_id_value
    or (plan_json->>'runId')::uuid <> run_id_value
    or plan_json->>'specialistId' <> run_json->>'specialistId'
    or plan_json->>'specialistVersion' <> run_json->>'specialistVersion'
    or plan_json->>'inputFingerprint' <> run_json->>'objectiveFingerprint'
    or plan_json->>'publicationAuthority' <> 'NONE'
    or (plan_json->>'createdAt')::timestamptz <> created_time then
    raise exception using errcode = 'AFR04', message = 'Research run or plan violates start invariants';
  end if;

  job_index := 0;
  previous_job_id := null;
  for job_json in select value from jsonb_array_elements(jobs_json) loop
    if (job_json->>'schemaVersion')::smallint <> 1
      or (job_json->>'runId')::uuid <> run_id_value
      or (job_json->>'caseId')::uuid <> case_id_value
      or (job_json->>'stageOrdinal')::integer <> job_index
      or job_json->>'stage' <> (array[
        'IDENTITY', 'SCOPING', 'DISCOVERY', 'RESOLUTION', 'NORMALIZATION',
        'CORROBORATION', 'SEQUENCING'
      ])[job_index + 1]
      or (case
        when previous_job_id is null then job_json->'dependsOnJobId' <> 'null'::jsonb
        else (job_json->>'dependsOnJobId')::uuid <> previous_job_id end)
      or job_json->>'status' <> 'QUEUED'
      or (job_json->>'attemptCount')::bigint <> 0
      or (job_json->>'checkpointCount')::bigint <> 0
      or job_json->'activeAttemptId' <> 'null'::jsonb
      or job_json->'firstStartedAt' <> 'null'::jsonb
      or job_json->'terminalAt' <> 'null'::jsonb
      or job_json->>'publicationAuthority' <> 'NONE'
      or (job_json->>'aggregateVersion')::bigint <> 0
      or (job_json->>'createdAt')::timestamptz <> created_time
      or (job_json->>'updatedAt')::timestamptz <> created_time then
      raise exception using errcode = 'AFR04', message = 'Research jobs violate canonical start invariants';
    end if;
    previous_job_id := (job_json->>'id')::uuid;
    job_index := job_index + 1;
  end loop;

  if first_event->>'type' <> 'research.run_created'
    or second_event->>'type' <> 'research.jobs_staged'
    or (first_event->>'schemaVersion')::smallint <> 1
    or (second_event->>'schemaVersion')::smallint <> 1
    or first_event->>'aggregateType' <> 'research_run'
    or second_event->>'aggregateType' <> 'research_run'
    or (first_event->>'aggregateId')::uuid <> run_id_value
    or (second_event->>'aggregateId')::uuid <> run_id_value
    or (first_event->>'sequence')::bigint <> 1
    or (second_event->>'sequence')::bigint <> 2
    or (first_event->>'aggregateVersion')::bigint <> 0
    or (second_event->>'aggregateVersion')::bigint <> 0
    or (first_event->>'occurredAt')::timestamptz <> created_time
    or (second_event->>'occurredAt')::timestamptz <> created_time
    or first_event->>'publicationAuthority' <> 'NONE'
    or second_event->>'publicationAuthority' <> 'NONE'
    or (first_event#>>'{payload,caseId}')::uuid <> case_id_value
    or (first_event#>>'{payload,planId}')::uuid <> plan_id_value
    or first_event#>>'{payload,specialistId}' <> run_json->>'specialistId'
    or first_event#>>'{payload,specialistVersion}' <> run_json->>'specialistVersion'
    or (first_event#>'{payload,branchId}') is distinct from (run_json->'branchId')
    or second_event#>'{payload,jobs}' <> (
      select jsonb_agg(jsonb_build_object(
        'jobId', item->>'id',
        'stage', item->>'stage',
        'dependsOnJobId', item->'dependsOnJobId'
      ) order by ordinal)
      from jsonb_array_elements(jobs_json) with ordinality as staged(item, ordinal)
    ) then
    raise exception using errcode = 'AFR04', message = 'Research start semantic events are inconsistent';
  end if;

  if exists (
    select 1 from jsonb_array_elements(p_result->'outboxEvents') item
    where (item->>'recordedAt')::timestamptz <> created_time
      or (item->>'deliveryAttempts')::bigint <> 0
      or item->'deliveredAt' <> 'null'::jsonb
  ) then
    raise exception using errcode = 'AFR04', message = 'Research outbox envelope contains mutable delivery state';
  end if;
  select count(distinct generated_id) into distinct_generated_id_count
  from (
    select (item->>'id')::uuid generated_id
    from jsonb_array_elements(p_result->'outboxEvents') item
    union all
    select (item#>>'{event,id}')::uuid
    from jsonb_array_elements(p_result->'outboxEvents') item
  ) generated;
  if distinct_generated_id_count <> 4 then
    raise exception using errcode = 'AFR03', message = 'Generated research event and outbox identifiers must be distinct';
  end if;

  insert into public.af_research_runs (
    schema_version, id, case_id, branch_id, plan_id, specialist_id,
    specialist_version, objective_fingerprint, request_fingerprint, trace_id,
    status, health, current_stage, publication_authority, aggregate_version,
    created_at, updated_at, started_at, completed_at
  ) values (
    1, run_id_value, case_id_value, branch_id_value, plan_id_value,
    run_json->>'specialistId', run_json->>'specialistVersion',
    run_json->>'objectiveFingerprint', run_json->>'requestFingerprint',
    run_json->>'traceId', 'QUEUED', 'HEALTHY', null, 'NONE', 0,
    created_time, created_time, null, null
  );

  insert into public.af_research_plans (
    id, run_id, specialist_id, specialist_version, input_fingerprint,
    plan_fingerprint, plan, publication_authority, created_at
  ) values (
    plan_id_value, run_id_value, plan_json->>'specialistId',
    plan_json->>'specialistVersion', plan_json->>'inputFingerprint',
    plan_json->>'planFingerprint', plan_json->'plan', 'NONE', created_time
  );

  for job_json in select value from jsonb_array_elements(jobs_json) loop
    insert into public.af_research_jobs (
      schema_version, id, run_id, case_id, stage, stage_ordinal,
      depends_on_job_id, logical_job_key, stage_input_fingerprint, status,
      attempt_count, max_attempts, checkpoint_count, active_attempt_id,
      first_started_at, terminal_at, publication_authority, aggregate_version,
      created_at, updated_at
    ) values (
      1, (job_json->>'id')::uuid, run_id_value, case_id_value,
      (job_json->>'stage')::public.af_research_stage,
      (job_json->>'stageOrdinal')::smallint,
      case when job_json->'dependsOnJobId' = 'null'::jsonb then null
        else (job_json->>'dependsOnJobId')::uuid end,
      job_json->>'logicalJobKey', job_json->>'stageInputFingerprint',
      'QUEUED', 0, (job_json->>'maxAttempts')::smallint, 0, null,
      null, null, 'NONE', 0, created_time, created_time
    );
  end loop;

  for outbox_json in select value from jsonb_array_elements(p_result->'outboxEvents') loop
    event_json := outbox_json->'event';
    insert into public.af_research_domain_events (
      id, event_type, schema_version, aggregate_type, aggregate_id, sequence,
      aggregate_version, occurred_at, publication_authority, payload
    ) values (
      (event_json->>'id')::uuid,
      (event_json->>'type')::public.af_research_domain_event_type,
      1, 'research_run', run_id_value, (event_json->>'sequence')::bigint,
      0, created_time, 'NONE', event_json->'payload'
    );
    insert into public.af_research_outbox_events (
      id, domain_event_id, recorded_at, delivery_attempts, delivered_at
    ) values (
      (outbox_json->>'id')::uuid, (event_json->>'id')::uuid,
      created_time, 0, null
    );
  end loop;

  insert into public.af_research_start_commit_results (
    actor_id, case_id, request_fingerprint, result_json, committed_at
  ) values (
    p_actor_id, case_id_value, p_request_fingerprint::public.af_sha256,
    p_result, commit_time
  ) returning id into committed_result_id;

  update public.af_research_start_idempotency
  set state = 'COMPLETED', reservation_token = null, lease_expires_at = null,
      result_id = committed_result_id, updated_at = commit_time,
      completed_at = commit_time
  where actor_id = p_actor_id
    and command_name = 'start_research_run'
    and idempotency_key = p_idempotency_key
    and reservation_token = p_reservation_token;

  return jsonb_build_object('replayed', false, 'result', p_result);
exception
  when unique_violation then
    raise exception using errcode = 'AFR03', message = 'Research start conflicts with an existing identifier or active scope';
  when foreign_key_violation or check_violation or not_null_violation
    or invalid_text_representation or numeric_value_out_of_range then
    raise exception using errcode = 'AFR04', message = 'Research start failed schema or reference invariants';
end;
$function$;

-- Checkpoint-03 live-worker envelopes. These mirror the strict TypeScript
-- schemas in core/research-runs/worker-schemas.ts exactly.
create function public.af_research_execution_plan_valid(value_to_check jsonb)
returns boolean
language plpgsql
immutable
set search_path = pg_catalog, public
as $function$
declare
  execution_kind public.af_execution_kind;
  model_json jsonb;
  prompt_json jsonb;
  schema_json jsonb;
  tool_json jsonb;
begin
  if not public.af_jsonb_has_exact_keys(
    value_to_check,
    array['executorId', 'executorVersion', 'configurationFingerprint',
      'executionKind', 'model', 'prompt', 'schema', 'tool',
      'privateContentIncluded', 'automaticRetrySafety']
  ) then return false; end if;
  perform (value_to_check->>'executorId')::public.af_slug;
  perform (value_to_check->>'executorVersion')::public.af_version_tag;
  perform (value_to_check->>'configurationFingerprint')::public.af_sha256;
  execution_kind := (value_to_check->>'executionKind')::public.af_execution_kind;
  if jsonb_typeof(value_to_check->'privateContentIncluded') <> 'boolean'
    or value_to_check->>'automaticRetrySafety' not in (
      'IDEMPOTENT_PROVIDER_REQUEST', 'RESUMABLE_PROVIDER_RUN', 'NOT_GUARANTEED'
    ) then return false; end if;
  model_json := value_to_check->'model';
  prompt_json := value_to_check->'prompt';
  if execution_kind in ('MODEL', 'MODEL_TOOL') then
    if model_json = 'null'::jsonb or prompt_json = 'null'::jsonb
      or not public.af_jsonb_has_exact_keys(model_json, array['provider', 'model', 'snapshot'])
      or not public.af_jsonb_has_exact_keys(prompt_json, array['id', 'version', 'templateFingerprint']) then
      return false;
    end if;
    perform (model_json->>'provider')::public.af_slug;
    if model_json->>'model' is null
      or model_json->>'model' <> btrim(model_json->>'model')
      or char_length(model_json->>'model') not between 1 and 200 then return false; end if;
    perform (model_json->>'snapshot')::public.af_version_tag;
    perform (prompt_json->>'id')::public.af_slug;
    perform (prompt_json->>'version')::public.af_version_tag;
    perform (prompt_json->>'templateFingerprint')::public.af_sha256;
  elsif model_json <> 'null'::jsonb or prompt_json <> 'null'::jsonb then
    return false;
  end if;
  schema_json := value_to_check->'schema';
  if not public.af_jsonb_has_exact_keys(schema_json, array['id', 'version', 'schemaFingerprint']) then
    return false;
  end if;
  perform (schema_json->>'id')::public.af_slug;
  perform (schema_json->>'version')::public.af_version_tag;
  perform (schema_json->>'schemaFingerprint')::public.af_sha256;
  tool_json := value_to_check->'tool';
  if execution_kind in ('MODEL_TOOL', 'TOOL', 'RESOLVER', 'IMPORTER') then
    if tool_json = 'null'::jsonb
      or not public.af_jsonb_has_exact_keys(tool_json, array['id', 'version']) then return false; end if;
    perform (tool_json->>'id')::public.af_slug;
    perform (tool_json->>'version')::public.af_version_tag;
  elsif tool_json <> 'null'::jsonb then return false;
  end if;
  return true;
exception
  when invalid_text_representation or check_violation then return false;
end;
$function$;

create function public.af_research_lease_cursor_valid(value_to_check jsonb)
returns boolean
language plpgsql
immutable
set search_path = pg_catalog, public
as $function$
declare
  claimed_time timestamptz;
  heartbeat_time timestamptz;
  expires_time timestamptz;
begin
  if not public.af_jsonb_has_exact_keys(
    value_to_check,
    array['schemaVersion', 'runId', 'jobId', 'attemptId', 'workerId',
      'leaseToken', 'leaseEpoch', 'runVersion', 'jobVersion',
      'attemptVersion', 'claimedAt', 'heartbeatAt', 'expiresAt',
      'externalIdempotencyKey']
  ) or (value_to_check->>'schemaVersion')::smallint <> 1 then return false; end if;
  perform (value_to_check->>'runId')::uuid;
  perform (value_to_check->>'jobId')::uuid;
  perform (value_to_check->>'attemptId')::uuid;
  perform (value_to_check->>'workerId')::public.af_opaque_reference;
  perform (value_to_check->>'leaseToken')::uuid;
  if (value_to_check->>'leaseEpoch')::bigint <= 0
    or (value_to_check->>'runVersion')::bigint < 0
    or (value_to_check->>'jobVersion')::bigint < 0
    or (value_to_check->>'attemptVersion')::bigint < 0 then return false; end if;
  perform (value_to_check->>'externalIdempotencyKey')::public.af_sha256;
  claimed_time := (value_to_check->>'claimedAt')::timestamptz;
  heartbeat_time := (value_to_check->>'heartbeatAt')::timestamptz;
  expires_time := (value_to_check->>'expiresAt')::timestamptz;
  return heartbeat_time >= claimed_time and expires_time > heartbeat_time;
exception
  when invalid_text_representation or check_violation
    or numeric_value_out_of_range then return false;
end;
$function$;

create function public.af_research_worker_completion_valid(value_to_check jsonb)
returns boolean
language plpgsql
immutable
set search_path = pg_catalog, public
as $function$
declare
  telemetry_state text;
  usage_json jsonb;
  cost_json jsonb;
  pricing_state public.af_pricing_state;
begin
  if not public.af_jsonb_has_exact_keys(
    value_to_check,
    array['telemetryState', 'providerRunId', 'usage', 'cost', 'latencyMs',
      'completedAt']
  ) then return false; end if;
  telemetry_state := value_to_check->>'telemetryState';
  if telemetry_state not in ('COMPLETE', 'PARTIAL', 'UNAVAILABLE')
    or (value_to_check->>'latencyMs')::bigint < 0 then return false; end if;
  perform (value_to_check->>'completedAt')::timestamptz;
  if value_to_check->'providerRunId' <> 'null'::jsonb then
    perform (value_to_check->>'providerRunId')::public.af_opaque_reference;
  end if;
  usage_json := value_to_check->'usage';
  cost_json := value_to_check->'cost';
  if telemetry_state = 'COMPLETE' and (usage_json = 'null'::jsonb or cost_json = 'null'::jsonb) then
    return false;
  end if;
  if telemetry_state = 'UNAVAILABLE' and (usage_json <> 'null'::jsonb or cost_json <> 'null'::jsonb) then
    return false;
  end if;
  if telemetry_state = 'PARTIAL'
    and value_to_check->'providerRunId' = 'null'::jsonb
    and usage_json = 'null'::jsonb and cost_json = 'null'::jsonb then
    return false;
  end if;
  if usage_json <> 'null'::jsonb then
    if not public.af_jsonb_has_exact_keys(
      usage_json, array['inputTokens', 'outputTokens', 'toolCalls', 'inputBytes', 'outputBytes']
    ) or (usage_json->>'inputTokens')::bigint < 0
      or (usage_json->>'outputTokens')::bigint < 0
      or (usage_json->>'toolCalls')::bigint < 0
      or (usage_json->>'inputBytes')::bigint < 0
      or (usage_json->>'outputBytes')::bigint < 0 then return false; end if;
  end if;
  if cost_json <> 'null'::jsonb then
    if not public.af_jsonb_has_exact_keys(cost_json, array['currency', 'pricingState', 'amountMicros'])
      or cost_json->>'currency' <> 'USD' then return false; end if;
    pricing_state := (cost_json->>'pricingState')::public.af_pricing_state;
    if (pricing_state = 'PRICED' and cost_json->'amountMicros' = 'null'::jsonb)
      or (pricing_state = 'UNPRICED' and cost_json->'amountMicros' <> 'null'::jsonb)
      or (cost_json->'amountMicros' <> 'null'::jsonb
        and (cost_json->>'amountMicros')::bigint < 0) then return false; end if;
  end if;
  return true;
exception
  when invalid_text_representation or check_violation
    or numeric_value_out_of_range then return false;
end;
$function$;

create function public.af_research_checkpoint_record_valid(value_to_check jsonb)
returns boolean
language plpgsql
immutable
set search_path = pg_catalog, public
as $function$
declare
  kind_value public.af_research_checkpoint_kind;
  completed_value bigint;
  total_value bigint;
begin
  if not public.af_jsonb_has_exact_keys(
    value_to_check,
    array['schemaVersion', 'id', 'runId', 'jobId', 'attemptId',
      'idempotencyKey', 'sequence', 'kind', 'completedUnits', 'totalUnits',
      'providerRunId', 'resumeTokenFingerprint', 'outputFingerprint',
      'publicationAuthority', 'createdAt']
  ) or (value_to_check->>'schemaVersion')::smallint <> 1
    or value_to_check->>'publicationAuthority' <> 'NONE' then return false; end if;
  perform (value_to_check->>'id')::uuid;
  perform (value_to_check->>'runId')::uuid;
  perform (value_to_check->>'jobId')::uuid;
  perform (value_to_check->>'attemptId')::uuid;
  perform (value_to_check->>'idempotencyKey')::public.af_opaque_reference;
  if (value_to_check->>'sequence')::bigint <= 0 then return false; end if;
  kind_value := (value_to_check->>'kind')::public.af_research_checkpoint_kind;
  completed_value := (value_to_check->>'completedUnits')::bigint;
  if completed_value < 0 then return false; end if;
  if value_to_check->'totalUnits' <> 'null'::jsonb then
    total_value := (value_to_check->>'totalUnits')::bigint;
    if total_value <= 0 or completed_value > total_value then return false; end if;
  end if;
  if value_to_check->'providerRunId' <> 'null'::jsonb then
    perform (value_to_check->>'providerRunId')::public.af_opaque_reference;
  end if;
  if value_to_check->'resumeTokenFingerprint' <> 'null'::jsonb then
    perform (value_to_check->>'resumeTokenFingerprint')::public.af_sha256;
  end if;
  if value_to_check->'outputFingerprint' <> 'null'::jsonb then
    perform (value_to_check->>'outputFingerprint')::public.af_sha256;
  end if;
  if kind_value = 'PROVIDER_ACCEPTED' and value_to_check->'providerRunId' = 'null'::jsonb then return false; end if;
  if kind_value = 'OUTPUT_VALIDATED' and value_to_check->'outputFingerprint' = 'null'::jsonb then return false; end if;
  perform (value_to_check->>'createdAt')::timestamptz;
  return true;
exception
  when invalid_text_representation or check_violation
    or numeric_value_out_of_range then return false;
end;
$function$;

create function public.af_research_worker_failure_valid(value_to_check jsonb)
returns boolean
language plpgsql
immutable
set search_path = pg_catalog, public
as $function$
declare
  category_value public.af_research_failure_category;
  retry_value public.af_research_retry_directive;
begin
  if not public.af_jsonb_has_exact_keys(
    value_to_check,
    array['schemaVersion', 'code', 'category', 'phase', 'retryDirective',
      'retryAfterMs', 'providerStatusCode', 'diagnosticFingerprint',
      'redactionState']
  ) or (value_to_check->>'schemaVersion')::smallint <> 1
    or value_to_check->>'redactionState' <> 'BODY_FREE' then return false; end if;
  perform (value_to_check->>'code')::public.af_slug;
  category_value := (value_to_check->>'category')::public.af_research_failure_category;
  perform (value_to_check->>'phase')::public.af_research_failure_phase;
  retry_value := (value_to_check->>'retryDirective')::public.af_research_retry_directive;
  if retry_value = 'RETRY_WITH_BACKOFF' then
    if value_to_check->'retryAfterMs' = 'null'::jsonb
      or (value_to_check->>'retryAfterMs')::bigint not between 100 and 86400000
      or category_value in ('POLICY', 'RIGHTS', 'AUTH_CONFIGURATION') then return false; end if;
  elsif value_to_check->'retryAfterMs' <> 'null'::jsonb then return false;
  end if;
  if value_to_check->'providerStatusCode' <> 'null'::jsonb then
    if (value_to_check->>'providerStatusCode')::integer not between 100 and 599 then return false; end if;
    if category_value = 'RATE_LIMITED'
      and (value_to_check->>'providerStatusCode')::integer <> 429 then return false; end if;
  end if;
  if value_to_check->'diagnosticFingerprint' <> 'null'::jsonb then
    perform (value_to_check->>'diagnosticFingerprint')::public.af_sha256;
  end if;
  return true;
exception
  when invalid_text_representation or check_violation
    or numeric_value_out_of_range then return false;
end;
$function$;

create function public.af_research_checkpoint_record_json(
  checkpoint_row public.af_research_attempt_checkpoints
)
returns jsonb
language sql
stable
set search_path = pg_catalog, public
as $function$
  select jsonb_build_object(
    'schemaVersion', checkpoint_row.schema_version,
    'id', checkpoint_row.id,
    'runId', checkpoint_row.run_id,
    'jobId', checkpoint_row.job_id,
    'attemptId', checkpoint_row.attempt_id,
    'idempotencyKey', checkpoint_row.idempotency_key,
    'sequence', checkpoint_row.checkpoint_sequence,
    'kind', checkpoint_row.kind,
    'completedUnits', checkpoint_row.completed_units,
    'totalUnits', checkpoint_row.total_units,
    'providerRunId', checkpoint_row.provider_run_id,
    'resumeTokenFingerprint', checkpoint_row.resume_token_fingerprint,
    'outputFingerprint', checkpoint_row.output_fingerprint,
    'publicationAuthority', checkpoint_row.publication_authority,
    'createdAt', checkpoint_row.created_at
  );
$function$;

create function public.af_research_run_record_json(
  run_row public.af_research_runs
)
returns jsonb
language sql
stable
set search_path = pg_catalog
as $function$
  select jsonb_build_object(
    'schemaVersion', run_row.schema_version, 'id', run_row.id,
    'caseId', run_row.case_id, 'branchId', run_row.branch_id,
    'planId', run_row.plan_id, 'specialistId', run_row.specialist_id,
    'specialistVersion', run_row.specialist_version,
    'objectiveFingerprint', run_row.objective_fingerprint,
    'requestFingerprint', run_row.request_fingerprint,
    'traceId', run_row.trace_id, 'status', run_row.status,
    'health', run_row.health, 'currentStage', run_row.current_stage,
    'publicationAuthority', run_row.publication_authority,
    'aggregateVersion', run_row.aggregate_version,
    'createdAt', run_row.created_at, 'updatedAt', run_row.updated_at,
    'startedAt', run_row.started_at, 'completedAt', run_row.completed_at
  );
$function$;

create function public.af_research_plan_record_json(
  plan_row public.af_research_plans
)
returns jsonb
language sql
stable
set search_path = pg_catalog
as $function$
  select jsonb_build_object(
    'id', plan_row.id, 'runId', plan_row.run_id,
    'specialistId', plan_row.specialist_id,
    'specialistVersion', plan_row.specialist_version,
    'inputFingerprint', plan_row.input_fingerprint,
    'planFingerprint', plan_row.plan_fingerprint, 'plan', plan_row.plan,
    'publicationAuthority', plan_row.publication_authority,
    'createdAt', plan_row.created_at
  );
$function$;

create function public.af_research_job_record_json(
  job_row public.af_research_jobs
)
returns jsonb
language sql
stable
set search_path = pg_catalog
as $function$
  select jsonb_build_object(
    'schemaVersion', job_row.schema_version, 'id', job_row.id,
    'runId', job_row.run_id, 'caseId', job_row.case_id,
    'stage', job_row.stage, 'stageOrdinal', job_row.stage_ordinal,
    'dependsOnJobId', job_row.depends_on_job_id,
    'logicalJobKey', job_row.logical_job_key,
    'stageInputFingerprint', job_row.stage_input_fingerprint,
    'status', job_row.status, 'attemptCount', job_row.attempt_count,
    'maxAttempts', job_row.max_attempts,
    'checkpointCount', job_row.checkpoint_count,
    'activeAttemptId', job_row.active_attempt_id,
    'firstStartedAt', job_row.first_started_at,
    'terminalAt', job_row.terminal_at,
    'publicationAuthority', job_row.publication_authority,
    'aggregateVersion', job_row.aggregate_version,
    'createdAt', job_row.created_at, 'updatedAt', job_row.updated_at
  );
$function$;

create function public.af_research_attempt_record_json(
  attempt_row public.af_research_attempts
)
returns jsonb
language sql
stable
set search_path = pg_catalog
as $function$
  select jsonb_build_object(
    'schemaVersion', attempt_row.schema_version, 'id', attempt_row.id,
    'runId', attempt_row.run_id, 'jobId', attempt_row.job_id,
    'attemptNumber', attempt_row.attempt_number,
    'requestFingerprint', attempt_row.request_fingerprint,
    'status', attempt_row.status,
    'execution', jsonb_build_object(
      'executionKind', attempt_row.execution_kind,
      'traceId', attempt_row.execution_trace_id,
      'providerRunId', attempt_row.provider_run_id,
      'telemetryState', attempt_row.telemetry_state,
      'model', case when attempt_row.model_provider is null then null else
        jsonb_build_object('provider', attempt_row.model_provider,
          'model', attempt_row.model_name, 'snapshot', attempt_row.model_snapshot) end,
      'prompt', case when attempt_row.prompt_id is null then null else
        jsonb_build_object('id', attempt_row.prompt_id,
          'version', attempt_row.prompt_version,
          'templateFingerprint', attempt_row.prompt_template_fingerprint) end,
      'schema', jsonb_build_object('id', attempt_row.execution_schema_id,
        'version', attempt_row.execution_schema_version,
        'schemaFingerprint', attempt_row.execution_schema_fingerprint),
      'tool', case when attempt_row.tool_id is null then null else
        jsonb_build_object('id', attempt_row.tool_id,
          'version', attempt_row.tool_version) end,
      'usage', case when attempt_row.usage_input_tokens is null then null else
        jsonb_build_object('inputTokens', attempt_row.usage_input_tokens,
          'outputTokens', attempt_row.usage_output_tokens,
          'toolCalls', attempt_row.usage_tool_calls,
          'inputBytes', attempt_row.usage_input_bytes,
          'outputBytes', attempt_row.usage_output_bytes) end,
      'cost', case when attempt_row.cost_pricing_state is null then null else
        jsonb_build_object('currency', attempt_row.cost_currency,
          'pricingState', attempt_row.cost_pricing_state,
          'amountMicros', attempt_row.cost_amount_micros) end,
      'latencyMs', attempt_row.latency_ms,
      'provenanceInputs', attempt_row.provenance_inputs,
      'privateContentIncluded', attempt_row.private_content_included
    ),
    'outputFingerprint', attempt_row.output_fingerprint,
    'errorCode', attempt_row.error_code,
    'publicationAuthority', attempt_row.publication_authority,
    'aggregateVersion', attempt_row.aggregate_version,
    'startedAt', attempt_row.started_at, 'completedAt', attempt_row.completed_at
  );
$function$;

create function public.af_research_lease_cursor_json(
  lease_row public.af_research_job_leases,
  run_version bigint,
  job_version bigint,
  attempt_version bigint,
  external_idempotency_key public.af_sha256
)
returns jsonb
language sql
stable
set search_path = pg_catalog
as $function$
  select jsonb_build_object(
    'schemaVersion', 1, 'runId', lease_row.run_id,
    'jobId', lease_row.job_id, 'attemptId', lease_row.attempt_id,
    'workerId', lease_row.worker_id, 'leaseToken', lease_row.lease_token,
    'leaseEpoch', lease_row.lease_epoch, 'runVersion', run_version,
    'jobVersion', job_version, 'attemptVersion', attempt_version,
    'claimedAt', lease_row.claimed_at,
    'heartbeatAt', lease_row.last_heartbeat_at,
    'expiresAt', lease_row.lease_expires_at,
    'externalIdempotencyKey', external_idempotency_key
  );
$function$;

create function public.af_claimed_research_job_json(
  run_row public.af_research_runs,
  job_row public.af_research_jobs,
  plan_row public.af_research_plans,
  attempt_row public.af_research_attempts,
  lease_row public.af_research_job_leases,
  latest_checkpoint jsonb,
  provider_checkpoint jsonb,
  resumed_value boolean,
  replayed_value boolean
)
returns jsonb
language sql
stable
set search_path = pg_catalog, public
as $function$
  select jsonb_build_object(
    'run', public.af_research_run_record_json(run_row),
    'job', public.af_research_job_record_json(job_row),
    'plan', public.af_research_plan_record_json(plan_row),
    'attempt', public.af_research_attempt_record_json(attempt_row),
    'lease', public.af_research_lease_cursor_json(
      lease_row, run_row.aggregate_version, job_row.aggregate_version,
      attempt_row.aggregate_version, attempt_row.request_fingerprint
    ),
    'execution', lease_row.execution_plan,
    'latestCheckpoint', latest_checkpoint,
    'providerCheckpoint', provider_checkpoint,
    'resumed', resumed_value,
    'replayed', replayed_value
  );
$function$;

-- ---------------------------------------------------------------------------
-- Durable worker claim and lease renewal
-- ---------------------------------------------------------------------------

create function public.af_claim_research_job_v1(
  p_actor_id uuid,
  p_run_id uuid,
  p_job_id uuid,
  p_stage public.af_research_stage,
  p_expected_run_version bigint,
  p_expected_job_version bigint,
  p_idempotency_key text,
  p_request_fingerprint text,
  p_attempt_id uuid,
  p_worker_id text,
  p_execution jsonb,
  p_lease_seconds integer default 120
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, public, auth
as $function$
declare
  run_row public.af_research_runs%rowtype;
  job_row public.af_research_jobs%rowtype;
  dependency_row public.af_research_jobs%rowtype;
  plan_row public.af_research_plans%rowtype;
  attempt_row public.af_research_attempts%rowtype;
  lease_row public.af_research_job_leases%rowtype;
  checkpoint_row public.af_research_attempt_checkpoints%rowtype;
  observed_at timestamptz := clock_timestamp();
  new_lease_token uuid := gen_random_uuid();
  desired_run_status public.af_research_run_status;
  previous_run_status public.af_research_run_status;
  previous_job_status public.af_research_job_status;
  new_run_version bigint;
  new_job_version bigint;
  run_changed boolean := false;
  retry_requeue boolean := false;
  latest_checkpoint_json jsonb := null;
  provider_checkpoint_json jsonb := null;
  lease_json jsonb;
begin
  perform public.af_assert_actor_scope(p_actor_id);
  perform p_request_fingerprint::public.af_sha256;
  perform p_worker_id::public.af_opaque_reference;
  if p_idempotency_key !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,199}$'
    or p_lease_seconds not between 5 and 900
    or not public.af_research_execution_plan_valid(p_execution) then
    raise exception using errcode = 'AFR04', message = 'Invalid research-job claim input';
  end if;

  select stored_run.* into run_row
  from public.af_research_runs stored_run
  join public.af_cases stored_case on stored_case.id = stored_run.case_id
  where stored_run.id = p_run_id and stored_case.owner_id = p_actor_id
  for update of stored_run;
  if not found then
    raise exception using errcode = 'AFR05', message = 'Actor scope mismatch or record not found';
  end if;
  select * into strict plan_row from public.af_research_plans
  where id = run_row.plan_id and run_id = p_run_id;
  select * into job_row
  from public.af_research_jobs stored_job
  where stored_job.id = p_job_id and stored_job.run_id = p_run_id
  for update;
  if not found then
    raise exception using errcode = 'AFR05', message = 'Actor scope mismatch or record not found';
  end if;
  if job_row.stage <> p_stage then
    raise exception using errcode = 'AFR07', message = 'Claim stage does not match the durable job';
  end if;

  -- Idempotency is evaluated before optimistic versions, matching the core
  -- command contract. A retry may recover its own expired attempt lease but
  -- can never create a second attempt for the same key.
  select * into attempt_row
  from public.af_research_attempts stored_attempt
  where stored_attempt.run_id = p_run_id
    and stored_attempt.job_id = p_job_id
    and stored_attempt.claim_idempotency_key = p_idempotency_key
  for update;
  if found then
    if attempt_row.request_fingerprint <> p_request_fingerprint then
      raise exception using errcode = 'AFR02', message = 'Job idempotency key identifies a different request';
    end if;
    if attempt_row.status <> 'RUNNING' then
      if job_row.status in ('SUCCEEDED', 'DEGRADED', 'FAILED_TERMINAL', 'CANCELLED') then
        if job_row.status = 'CANCELLED' then
          return jsonb_build_object('status', 'CANCELLED');
        end if;
        return jsonb_build_object(
          'status', 'TERMINAL',
          'terminal', jsonb_build_object(
            'runId', p_run_id, 'jobId', p_job_id,
            'attemptId', attempt_row.id, 'jobStatus', job_row.status
          ),
          'replayed', true
        );
      end if;
      return jsonb_build_object(
        'status', 'IN_PROGRESS',
        'retryAfterMs', greatest(
          100,
          least(900000, coalesce(
            floor(extract(epoch from (job_row.retry_not_before - observed_at)) * 1000)::integer,
            100
          ))
        )
      );
    end if;
    select * into lease_row
    from public.af_research_job_leases stored_lease
    where stored_lease.attempt_id = attempt_row.id
    for update;
    if not found or job_row.status <> 'RUNNING'
      or job_row.active_attempt_id <> attempt_row.id then
      return jsonb_build_object('status', 'IN_PROGRESS', 'retryAfterMs', 100);
    end if;
    if lease_row.execution_plan <> p_execution then
      raise exception using errcode = 'AFR02', message = 'Job idempotency key identifies a different executor plan';
    end if;
    select * into checkpoint_row
    from public.af_research_attempt_checkpoints stored_checkpoint
    where stored_checkpoint.attempt_id = attempt_row.id
    order by stored_checkpoint.checkpoint_sequence desc
    limit 1;
    if found then
      latest_checkpoint_json := public.af_research_checkpoint_record_json(checkpoint_row);
    end if;
    select * into checkpoint_row
    from public.af_research_attempt_checkpoints stored_checkpoint
    where stored_checkpoint.attempt_id = attempt_row.id
      and stored_checkpoint.kind = 'PROVIDER_ACCEPTED'
      and stored_checkpoint.provider_run_id is not null
    order by stored_checkpoint.checkpoint_sequence desc
    limit 1;
    if found then
      provider_checkpoint_json := public.af_research_checkpoint_record_json(checkpoint_row);
    end if;
    if lease_row.released_at is not null then
      if job_row.retry_not_before is not null
        and job_row.retry_not_before > observed_at then
        return jsonb_build_object(
          'status', 'IN_PROGRESS', 'retryAfterMs', greatest(
            100,
            least(900000,
              floor(extract(epoch from (job_row.retry_not_before - observed_at)) * 1000)::integer
            )
          )
        );
      end if;
      update public.af_research_jobs
      set retry_not_before = null, aggregate_version = aggregate_version + 1,
          updated_at = observed_at
      where id = job_row.id and run_id = run_row.id
        and aggregate_version = job_row.aggregate_version
        and status = 'RUNNING' and active_attempt_id = attempt_row.id
      returning * into job_row;
      if not found then raise exception using errcode = 'AFR01', message = 'Research job aggregate version conflict'; end if;
      update public.af_research_job_leases
      set worker_id = p_worker_id, lease_token = new_lease_token,
          lease_epoch = lease_epoch + 1, claimed_at = observed_at,
          last_heartbeat_at = observed_at,
          lease_expires_at = observed_at + make_interval(secs => p_lease_seconds),
          released_at = null
      where attempt_id = attempt_row.id and released_at is not null
      returning * into lease_row;
      if not found then return jsonb_build_object('status', 'IN_PROGRESS', 'retryAfterMs', 100); end if;
      return jsonb_build_object(
        'status', 'CLAIMED',
        'claim', public.af_claimed_research_job_json(
          run_row, job_row, plan_row, attempt_row, lease_row,
          latest_checkpoint_json, provider_checkpoint_json, true, true
        )
      );
    end if;
    if lease_row.lease_expires_at > observed_at then
      return jsonb_build_object(
        'status', 'IN_PROGRESS', 'retryAfterMs', greatest(
          100,
          least(900000,
            floor(extract(epoch from (lease_row.lease_expires_at - observed_at)) * 1000)::integer
          )
        )
      );
    end if;
    if lease_row.lease_expires_at <= observed_at then
      if lease_row.lease_epoch >= job_row.max_attempts then
        insert into public.af_research_attempt_failures (
          schema_version, attempt_id, run_id, job_id,
          mutation_idempotency_key, code, category, phase,
          retry_directive, retry_after_ms, retry_at, provider_status_code,
          diagnostic_fingerprint, redaction_state, recorded_at
        ) values (
          1, attempt_row.id, run_row.id, job_row.id,
          attempt_row.id::text || ':lease-budget',
          'lease-reclaim-budget-exhausted', 'WORKER_INTERNAL', 'PREPARATION',
          'DO_NOT_RETRY', null, null, null, null, 'BODY_FREE', observed_at
        );
        update public.af_research_attempts
        set status = 'FAILED_TERMINAL',
            latency_ms = greatest(
              0,
              floor(extract(epoch from (observed_at - started_at)) * 1000)::bigint
            ),
            error_code = 'lease-reclaim-budget-exhausted',
            terminal_idempotency_key = attempt_row.id::text || ':lease-budget',
            terminal_mutation_kind = 'FAIL',
            aggregate_version = aggregate_version + 1,
            completed_at = observed_at
        where id = attempt_row.id and aggregate_version = attempt_row.aggregate_version
        returning * into attempt_row;
        if not found then raise exception using errcode = 'AFR01', message = 'Research attempt aggregate version conflict'; end if;
        update public.af_research_jobs
        set status = 'FAILED_TERMINAL', active_attempt_id = null,
            retry_not_before = null, terminal_at = observed_at,
            aggregate_version = aggregate_version + 1, updated_at = observed_at
        where id = job_row.id and run_id = run_row.id
          and aggregate_version = job_row.aggregate_version
          and active_attempt_id = attempt_row.id
        returning * into job_row;
        if not found then raise exception using errcode = 'AFR01', message = 'Research job aggregate version conflict'; end if;
        update public.af_research_job_leases set released_at = observed_at
          where attempt_id = attempt_row.id and released_at is null;
        perform public.af_append_research_event_v1(
          run_row.id, 'research.job_status_changed', run_row.aggregate_version,
          observed_at, jsonb_build_object(
            'jobId', job_row.id, 'stage', job_row.stage,
            'previousStatus', 'RUNNING', 'status', 'FAILED_TERMINAL',
            'attemptId', attempt_row.id,
            'boundedReasonCode', 'lease-reclaim-budget-exhausted'
          )
        );
        previous_run_status := run_row.status;
        update public.af_research_runs
        set status = 'FAILED', health = 'FAILED',
            aggregate_version = aggregate_version + 1,
            updated_at = observed_at, completed_at = observed_at
        where id = run_row.id and aggregate_version = run_row.aggregate_version
        returning * into run_row;
        if not found then raise exception using errcode = 'AFR01', message = 'Research run aggregate version conflict'; end if;
        perform public.af_append_research_event_v1(
          run_row.id, 'research.run_status_changed', run_row.aggregate_version,
          observed_at, jsonb_build_object(
            'previousStatus', previous_run_status, 'status', 'FAILED',
            'currentStage', run_row.current_stage,
            'boundedReasonCode', 'lease-reclaim-budget-exhausted'
          )
        );
        return jsonb_build_object(
          'status', 'TERMINAL',
          'terminal', jsonb_build_object(
            'runId', run_row.id, 'jobId', job_row.id,
            'attemptId', attempt_row.id, 'jobStatus', job_row.status
          ),
          'replayed', false
        );
      end if;
      -- Every expired lease can be fenced and recovered. The application may
      -- execute only an idempotent request, or a resumable request with the
      -- canonical provider checkpoint. Ambiguous starts are durably failed as
      -- provider-start-uncertain before an executor is invoked.
      update public.af_research_job_leases
      set worker_id = p_worker_id,
          lease_token = new_lease_token,
          lease_epoch = lease_epoch + 1,
          claimed_at = observed_at,
          last_heartbeat_at = observed_at,
          lease_expires_at = observed_at + make_interval(secs => p_lease_seconds)
      where attempt_id = attempt_row.id
      returning * into lease_row;
      return jsonb_build_object(
        'status', 'CLAIMED',
        'claim', public.af_claimed_research_job_json(
          run_row, job_row, plan_row, attempt_row, lease_row,
          latest_checkpoint_json, provider_checkpoint_json, true, true
        )
      );
    end if;
    return jsonb_build_object('status', 'IN_PROGRESS', 'retryAfterMs', 100);
  end if;

  if run_row.status = 'CANCELLED' or job_row.status = 'CANCELLED' then
    return jsonb_build_object('status', 'CANCELLED');
  end if;
  if job_row.status in ('SUCCEEDED', 'DEGRADED', 'FAILED_TERMINAL') then
    select * into attempt_row
    from public.af_research_attempts terminal_attempt
    where terminal_attempt.run_id = p_run_id and terminal_attempt.job_id = p_job_id
    order by terminal_attempt.attempt_number desc limit 1;
    return jsonb_build_object(
      'status', 'TERMINAL',
      'terminal', jsonb_build_object(
        'runId', p_run_id, 'jobId', p_job_id,
        'attemptId', attempt_row.id, 'jobStatus', job_row.status
      ),
      'replayed', false
    );
  end if;
  if run_row.aggregate_version <> p_expected_run_version
    or job_row.aggregate_version <> p_expected_job_version then
    raise exception using errcode = 'AFR01', message = 'Research run or job aggregate version conflict';
  end if;
  if run_row.status in ('SUCCEEDED', 'DEGRADED', 'FAILED', 'CANCELLED') then
    raise exception using errcode = 'AFR07', message = 'Research run is not executable';
  end if;
  if job_row.status = 'FAILED_RETRYABLE'
    and job_row.retry_not_before is not null
    and job_row.retry_not_before > observed_at then
    return jsonb_build_object(
      'status', 'IN_PROGRESS',
      'retryAfterMs', greatest(
        100,
        least(900000,
          floor(extract(epoch from (job_row.retry_not_before - observed_at)) * 1000)::integer
        )
      )
    );
  end if;
  if job_row.status not in ('QUEUED', 'FAILED_RETRYABLE')
    or job_row.attempt_count >= job_row.max_attempts then
    raise exception using errcode = 'AFR07', message = 'Research job is not claimable';
  end if;
  if job_row.depends_on_job_id is not null then
    select * into dependency_row
    from public.af_research_jobs stored_dependency
    where stored_dependency.run_id = p_run_id
      and stored_dependency.id = job_row.depends_on_job_id;
    if not found or dependency_row.status not in ('SUCCEEDED', 'DEGRADED') then
      raise exception using errcode = 'AFR07', message = 'Research job dependency is incomplete';
    end if;
  end if;

  desired_run_status := case
    when job_row.stage in ('IDENTITY', 'SCOPING') then 'PLANNING'
    when job_row.stage = 'SEQUENCING' then 'SYNTHESIZING'
    else 'RUNNING' end;
  if run_row.current_stage is null then
    if job_row.stage <> 'IDENTITY' or run_row.status <> 'QUEUED' then
      raise exception using errcode = 'AFR07', message = 'Research stage order is invalid';
    end if;
    run_changed := true;
  elsif run_row.current_stage = job_row.stage then
    if run_row.status <> desired_run_status then
      raise exception using errcode = 'AFR07', message = 'Research run phase does not match retry stage';
    end if;
  elsif job_row.depends_on_job_id is null
    or run_row.current_stage <> dependency_row.stage then
    raise exception using errcode = 'AFR07', message = 'Research stage order is invalid';
  else
    run_changed := true;
  end if;

  previous_job_status := job_row.status;
  retry_requeue := job_row.status = 'FAILED_RETRYABLE';
  new_run_version := run_row.aggregate_version + case when run_changed then 1 else 0 end;
  new_job_version := job_row.aggregate_version + case when retry_requeue then 2 else 1 end;

  if run_changed then
    update public.af_research_runs
    set status = desired_run_status,
        current_stage = job_row.stage,
        aggregate_version = new_run_version,
        updated_at = observed_at,
        started_at = coalesce(started_at, observed_at)
    where id = p_run_id and aggregate_version = p_expected_run_version;
    perform public.af_append_research_event_v1(
      p_run_id, 'research.run_status_changed', new_run_version, observed_at,
      jsonb_build_object(
        'previousStatus', run_row.status,
        'status', desired_run_status,
        'currentStage', job_row.stage,
        'boundedReasonCode', null
      )
    );
  end if;

  insert into public.af_research_attempts (
    schema_version, id, run_id, job_id, attempt_number, request_fingerprint,
    claim_idempotency_key, status, telemetry_state, execution_kind,
    execution_trace_id,
    provider_run_id, model_provider, model_name, model_snapshot, prompt_id,
    prompt_version, prompt_template_fingerprint, execution_schema_id,
    execution_schema_version, execution_schema_fingerprint, tool_id,
    tool_version, usage_input_tokens, usage_output_tokens, usage_tool_calls,
    usage_input_bytes, usage_output_bytes, cost_currency, cost_pricing_state,
    cost_amount_micros, latency_ms, provenance_inputs,
    private_content_included, output_fingerprint, error_code,
    publication_authority, aggregate_version, started_at, completed_at
  ) values (
    1, p_attempt_id, p_run_id, p_job_id, job_row.attempt_count + 1,
    p_request_fingerprint::public.af_sha256, p_idempotency_key, 'RUNNING',
    'UNAVAILABLE',
    (p_execution->>'executionKind')::public.af_execution_kind,
    run_row.trace_id, null,
    p_execution#>>'{model,provider}', p_execution#>>'{model,model}',
    p_execution#>>'{model,snapshot}', p_execution#>>'{prompt,id}',
    p_execution#>>'{prompt,version}', p_execution#>>'{prompt,templateFingerprint}',
    p_execution#>>'{schema,id}', p_execution#>>'{schema,version}',
    p_execution#>>'{schema,schemaFingerprint}', p_execution#>>'{tool,id}',
    p_execution#>>'{tool,version}', null, null, null, null, null, null,
    null, null,
    null, jsonb_build_array(
      jsonb_build_object('recordType', 'RUN', 'recordId', p_run_id),
      jsonb_build_object('recordType', 'PLAN', 'recordId', run_row.plan_id),
      jsonb_build_object('recordType', 'JOB', 'recordId', p_job_id)
    ),
    (p_execution->>'privateContentIncluded')::boolean,
    null, null, 'NONE', 0, observed_at, null
  );

  update public.af_research_jobs
  set status = 'RUNNING',
      attempt_count = attempt_count + 1,
      active_attempt_id = p_attempt_id,
      retry_not_before = null,
      first_started_at = coalesce(first_started_at, observed_at),
      aggregate_version = new_job_version,
      updated_at = observed_at
  where id = p_job_id and run_id = p_run_id
    and aggregate_version = p_expected_job_version;
  if not found then
    raise exception using errcode = 'AFR01', message = 'Research job aggregate version conflict';
  end if;

  insert into public.af_research_job_leases (
    attempt_id, run_id, job_id, case_id, actor_id, worker_id, lease_token,
    lease_epoch, execution_plan, lease_expires_at, last_heartbeat_at,
    claimed_at, released_at
  ) values (
    p_attempt_id, p_run_id, p_job_id, run_row.case_id, p_actor_id,
    p_worker_id, new_lease_token, 1, p_execution,
    observed_at + make_interval(secs => p_lease_seconds),
    observed_at, observed_at, null
  ) returning * into lease_row;

  if retry_requeue then
    perform public.af_append_research_event_v1(
      p_run_id, 'research.job_status_changed', new_run_version, observed_at,
      jsonb_build_object(
        'jobId', p_job_id, 'stage', job_row.stage,
        'previousStatus', previous_job_status, 'status', 'QUEUED',
        'attemptId', null, 'boundedReasonCode', null
      )
    );
    previous_job_status := 'QUEUED';
  end if;
  perform public.af_append_research_event_v1(
    p_run_id, 'research.job_status_changed', new_run_version, observed_at,
    jsonb_build_object(
      'jobId', p_job_id, 'stage', job_row.stage,
      'previousStatus', previous_job_status, 'status', 'RUNNING',
      'attemptId', p_attempt_id, 'boundedReasonCode', null
    )
  );

  select * into strict run_row from public.af_research_runs where id = p_run_id;
  select * into strict job_row from public.af_research_jobs
    where id = p_job_id and run_id = p_run_id;
  select * into strict attempt_row from public.af_research_attempts
    where id = p_attempt_id;
  return jsonb_build_object(
    'status', 'CLAIMED',
    'claim', public.af_claimed_research_job_json(
      run_row, job_row, plan_row, attempt_row, lease_row,
      null, null, false, false
    )
  );
exception
  when unique_violation then
    raise exception using errcode = 'AFR03', message = 'Research claim conflicts with an existing identifier or idempotency key';
  when foreign_key_violation or check_violation or not_null_violation
    or invalid_text_representation or numeric_value_out_of_range then
    raise exception using errcode = 'AFR04', message = 'Research claim failed schema or reference invariants';
end;
$function$;

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
  output_json jsonb;
  candidate_json jsonb;
  content_json jsonb;
  provenance_item jsonb;
  reason_item jsonb;
  expected_kind public.af_research_output_kind;
  expected_output_keys text[];
begin
  if not public.af_jsonb_has_exact_keys(
    value_to_check,
    array['outcome', 'boundedReasonCodes', 'output', 'sourceCandidates',
      'untrustedContent']
  ) then return false; end if;
  if value_to_check->>'outcome' not in ('SUCCEEDED', 'DEGRADED')
    or jsonb_typeof(value_to_check->'boundedReasonCodes') <> 'array'
    or jsonb_array_length(value_to_check->'boundedReasonCodes') > 20 then
    return false;
  end if;
  for reason_item in select value from jsonb_array_elements(value_to_check->'boundedReasonCodes') loop
    if jsonb_typeof(reason_item) <> 'string' then return false; end if;
    perform trim(both '"' from reason_item::text)::public.af_slug;
  end loop;
  if (value_to_check->>'outcome' = 'DEGRADED')
      <> (jsonb_array_length(value_to_check->'boundedReasonCodes') > 0) then
    return false;
  end if;

  expected_kind := case expected_stage
    when 'IDENTITY' then 'IDENTITY_RESULT'
    when 'SCOPING' then 'SCOPE_RESULT'
    when 'DISCOVERY' then 'DISCOVERY_RESULT'
    when 'RESOLUTION' then 'RESOLUTION_RESULT'
    when 'NORMALIZATION' then 'NORMALIZATION_RESULT'
    when 'CORROBORATION' then 'CORROBORATION_RESULT'
    when 'SEQUENCING' then 'SEQUENCING_RESULT' end;
  expected_output_keys := array[
    'schemaVersion', 'id', 'runId', 'jobId', 'attemptId', 'kind', 'stage',
    'reviewState', 'publicationAuthority', 'provenanceInputs', 'createdAt'
  ] || case expected_stage
    when 'IDENTITY' then array['resolvedRequirementIds', 'unresolvedRequirementIds']
    when 'SCOPING' then array['axisIds', 'sourceClassIds', 'coverageGapCodes']
    when 'DISCOVERY' then array['candidateIds']
    when 'RESOLUTION' then array['sourceIds', 'locatorIds', 'unresolvedCandidateIds']
    when 'NORMALIZATION' then array['proposedEvidenceIds', 'proposedClaimIds']
    when 'CORROBORATION' then array['assessedClaimIds', 'independenceGroupIds',
      'contradictionIds', 'unresolvedClaimIds']
    when 'SEQUENCING' then array['sequenceProposalId', 'eligibleClaimIds', 'omittedClaimIds']
  end;
  output_json := value_to_check->'output';
  if not public.af_jsonb_has_exact_keys(output_json, expected_output_keys)
    or (output_json->>'schemaVersion')::smallint <> 1
    or (output_json->>'runId')::uuid <> expected_run_id
    or (output_json->>'jobId')::uuid <> expected_job_id
    or (output_json->>'attemptId')::uuid <> expected_attempt_id
    or (output_json->>'kind')::public.af_research_output_kind <> expected_kind
    or (output_json->>'stage')::public.af_research_stage <> expected_stage
    or output_json->>'reviewState' <> 'PROPOSED'
    or output_json->>'publicationAuthority' <> 'NONE'
    or jsonb_typeof(output_json->'provenanceInputs') <> 'array'
    or jsonb_array_length(output_json->'provenanceInputs') not between 1 and 100 then
    return false;
  end if;
  perform (output_json->>'id')::uuid;
  perform (output_json->>'createdAt')::timestamptz;
  for provenance_item in select value from jsonb_array_elements(output_json->'provenanceInputs') loop
    if not public.af_jsonb_has_exact_keys(provenance_item, array['recordType', 'recordId']) then
      return false;
    end if;
    perform (provenance_item->>'recordType')::public.af_execution_record_type;
    perform (provenance_item->>'recordId')::uuid;
  end loop;
  if not exists (
    select 1 from jsonb_array_elements(output_json->'provenanceInputs') item
    where item->>'recordType' = 'JOB' and (item->>'recordId')::uuid = expected_job_id
  ) or not exists (
    select 1 from jsonb_array_elements(output_json->'provenanceInputs') item
    where item->>'recordType' = 'ATTEMPT' and (item->>'recordId')::uuid = expected_attempt_id
  ) then return false; end if;

  if jsonb_typeof(value_to_check->'sourceCandidates') <> 'array'
    or jsonb_array_length(value_to_check->'sourceCandidates') > 500
    or (expected_stage <> 'DISCOVERY' and jsonb_array_length(value_to_check->'sourceCandidates') <> 0) then
    return false;
  end if;
  for candidate_json in select value from jsonb_array_elements(value_to_check->'sourceCandidates') loop
    if not public.af_jsonb_has_exact_keys(
      candidate_json,
      array['schemaVersion', 'id', 'runId', 'jobId', 'attemptId',
        'candidateKey', 'title', 'canonicalUrl', 'medium', 'sourceClass',
        'accessState', 'rightsState', 'discoveryInputFingerprint',
        'contentTrust', 'evidenceStatus', 'reviewState',
        'publicationAuthority', 'createdAt']
    ) or (candidate_json->>'schemaVersion')::smallint <> 1
      or (candidate_json->>'runId')::uuid <> expected_run_id
      or (candidate_json->>'jobId')::uuid <> expected_job_id
      or (candidate_json->>'attemptId')::uuid <> expected_attempt_id
      or candidate_json->>'contentTrust' <> 'UNTRUSTED'
      or candidate_json->>'evidenceStatus' <> 'NOT_EVIDENCE'
      or candidate_json->>'reviewState' <> 'PROPOSED'
      or candidate_json->>'publicationAuthority' <> 'NONE' then return false; end if;
    perform (candidate_json->>'id')::uuid;
    perform (candidate_json->>'candidateKey')::public.af_opaque_reference;
    if candidate_json->'canonicalUrl' <> 'null'::jsonb then
      perform (candidate_json->>'canonicalUrl')::public.af_http_url;
    end if;
    perform (candidate_json->>'medium')::public.af_source_medium;
    perform (candidate_json->>'sourceClass')::public.af_slug;
    perform (candidate_json->>'accessState')::public.af_access_state;
    perform (candidate_json->>'rightsState')::public.af_rights_state;
    perform (candidate_json->>'discoveryInputFingerprint')::public.af_sha256;
    perform (candidate_json->>'createdAt')::timestamptz;
  end loop;
  if expected_stage = 'DISCOVERY' and exists (
    select 1 from jsonb_array_elements_text(output_json->'candidateIds') output_id
    where not exists (
      select 1 from jsonb_array_elements(value_to_check->'sourceCandidates') item
      where item->>'id' = output_id
    )
  ) then return false; end if;

  if jsonb_typeof(value_to_check->'untrustedContent') <> 'array'
    or jsonb_array_length(value_to_check->'untrustedContent') > 1000
    or (expected_stage not in ('RESOLUTION', 'NORMALIZATION')
      and jsonb_array_length(value_to_check->'untrustedContent') <> 0) then
    return false;
  end if;
  for content_json in select value from jsonb_array_elements(value_to_check->'untrustedContent') loop
    if not public.af_jsonb_has_exact_keys(
      content_json,
      array['schemaVersion', 'id', 'runId', 'jobId', 'attemptId',
        'candidateId', 'contentKind', 'contentFingerprint', 'contentLength',
        'storageRef', 'accessState', 'rightsState', 'trustBoundary',
        'instructionAuthority', 'screeningState', 'publicationAuthority',
        'createdAt']
    ) or (content_json->>'schemaVersion')::smallint <> 1
      or (content_json->>'runId')::uuid <> expected_run_id
      or (content_json->>'jobId')::uuid <> expected_job_id
      or (content_json->>'attemptId')::uuid <> expected_attempt_id
      or content_json->>'trustBoundary' <> 'UNTRUSTED_SOURCE_DATA'
      or content_json->>'instructionAuthority' <> 'NONE'
      or content_json->>'publicationAuthority' <> 'NONE' then return false; end if;
    perform (content_json->>'id')::uuid;
    perform (content_json->>'candidateId')::uuid;
    perform (content_json->>'contentKind')::public.af_untrusted_content_kind;
    perform (content_json->>'contentFingerprint')::public.af_sha256;
    if (content_json->>'contentLength')::bigint < 0 then return false; end if;
    if content_json->'storageRef' <> 'null'::jsonb then
      perform (content_json->>'storageRef')::public.af_opaque_reference;
    end if;
    perform (content_json->>'accessState')::public.af_access_state;
    perform (content_json->>'rightsState')::public.af_rights_state;
    perform (content_json->>'screeningState')::public.af_screening_state;
    perform (content_json->>'createdAt')::timestamptz;
  end loop;
  return true;
exception
  when invalid_text_representation or check_violation
    or numeric_value_out_of_range then return false;
end;
$function$;


create function public.af_research_lease_cursor_matches(
  value_to_check jsonb,
  lease_row public.af_research_job_leases,
  run_row public.af_research_runs,
  job_row public.af_research_jobs,
  attempt_row public.af_research_attempts
)
returns boolean
language sql
stable
set search_path = pg_catalog, public
as $function$
  select public.af_research_lease_cursor_valid(value_to_check)
    and (value_to_check->>'runId')::uuid = lease_row.run_id
    and (value_to_check->>'jobId')::uuid = lease_row.job_id
    and (value_to_check->>'attemptId')::uuid = lease_row.attempt_id
    and value_to_check->>'workerId' = lease_row.worker_id
    and (value_to_check->>'leaseToken')::uuid = lease_row.lease_token
    and (value_to_check->>'leaseEpoch')::bigint = lease_row.lease_epoch
    and (value_to_check->>'runVersion')::bigint = run_row.aggregate_version
    and (value_to_check->>'jobVersion')::bigint = job_row.aggregate_version
    and (value_to_check->>'attemptVersion')::bigint = attempt_row.aggregate_version
    and (value_to_check->>'claimedAt')::timestamptz = lease_row.claimed_at
    and (value_to_check->>'heartbeatAt')::timestamptz = lease_row.last_heartbeat_at
    and (value_to_check->>'expiresAt')::timestamptz = lease_row.lease_expires_at
    and value_to_check->>'externalIdempotencyKey' = attempt_row.request_fingerprint::text;
$function$;

create function public.af_heartbeat_research_job_v1(
  p_actor_id uuid,
  p_lease jsonb,
  p_lease_seconds integer,
  p_occurred_at timestamptz
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, public, auth
as $function$
declare
  run_row public.af_research_runs%rowtype;
  job_row public.af_research_jobs%rowtype;
  attempt_row public.af_research_attempts%rowtype;
  lease_row public.af_research_job_leases%rowtype;
  observed_at timestamptz := clock_timestamp();
  mutation_time timestamptz;
begin
  perform public.af_assert_actor_scope(p_actor_id);
  if not public.af_research_lease_cursor_valid(p_lease)
    or p_lease_seconds not between 5 and 900 then
    raise exception using errcode = 'AFR04', message = 'Invalid research heartbeat input';
  end if;
  select stored_run.* into run_row
  from public.af_research_runs stored_run
  join public.af_cases stored_case on stored_case.id = stored_run.case_id
  where stored_run.id = (p_lease->>'runId')::uuid
    and stored_case.owner_id = p_actor_id for update of stored_run;
  if not found then raise exception using errcode = 'AFR05', message = 'Actor scope mismatch or record not found'; end if;
  select * into job_row from public.af_research_jobs
    where id = (p_lease->>'jobId')::uuid and run_id = run_row.id for update;
  select * into attempt_row from public.af_research_attempts
    where id = (p_lease->>'attemptId')::uuid and run_id = run_row.id
      and job_id = job_row.id for update;
  select * into lease_row from public.af_research_job_leases
    where attempt_id = attempt_row.id for update;
  if job_row.id is null or attempt_row.id is null or lease_row.attempt_id is null then
    raise exception using errcode = 'AFR05', message = 'Actor scope mismatch or record not found';
  end if;
  if run_row.status = 'CANCELLED' or job_row.status = 'CANCELLED'
    or attempt_row.status = 'CANCELLED' then return jsonb_build_object('status', 'CANCELLED'); end if;
  if not public.af_research_lease_cursor_matches(p_lease, lease_row, run_row, job_row, attempt_row)
    or lease_row.released_at is not null or lease_row.lease_expires_at <= observed_at
    or job_row.status <> 'RUNNING' or job_row.active_attempt_id <> attempt_row.id
    or attempt_row.status <> 'RUNNING' then return jsonb_build_object('status', 'LEASE_LOST'); end if;
  if p_occurred_at < lease_row.last_heartbeat_at
    or p_occurred_at > observed_at + interval '5 minutes' then
    raise exception using errcode = 'AFR04', message = 'Heartbeat time is not monotonic';
  end if;
  mutation_time := greatest(observed_at, p_occurred_at);
  update public.af_research_job_leases
  set last_heartbeat_at = mutation_time,
      lease_expires_at = mutation_time + make_interval(secs => p_lease_seconds)
  where attempt_id = attempt_row.id and lease_token = lease_row.lease_token
  returning * into lease_row;
  return jsonb_build_object(
    'status', 'RENEWED',
    'lease', public.af_research_lease_cursor_json(
      lease_row, run_row.aggregate_version, job_row.aggregate_version,
      attempt_row.aggregate_version, attempt_row.request_fingerprint
    )
  );
end;
$function$;

create function public.af_checkpoint_research_job_v1(
  p_actor_id uuid,
  p_lease jsonb,
  p_checkpoint jsonb,
  p_lease_seconds integer
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, public, auth
as $function$
declare
  run_row public.af_research_runs%rowtype;
  job_row public.af_research_jobs%rowtype;
  attempt_row public.af_research_attempts%rowtype;
  lease_row public.af_research_job_leases%rowtype;
  checkpoint_row public.af_research_attempt_checkpoints%rowtype;
  observed_at timestamptz := clock_timestamp();
  mutation_time timestamptz;
begin
  perform public.af_assert_actor_scope(p_actor_id);
  if not public.af_research_lease_cursor_valid(p_lease)
    or not public.af_research_checkpoint_record_valid(p_checkpoint)
    or p_lease_seconds not between 5 and 900 then
    raise exception using errcode = 'AFR04', message = 'Invalid research checkpoint input';
  end if;
  select stored_run.* into run_row
  from public.af_research_runs stored_run
  join public.af_cases stored_case on stored_case.id = stored_run.case_id
  where stored_run.id = (p_lease->>'runId')::uuid
    and stored_case.owner_id = p_actor_id for update of stored_run;
  if not found then raise exception using errcode = 'AFR05', message = 'Actor scope mismatch or record not found'; end if;
  select * into job_row from public.af_research_jobs
    where id = (p_lease->>'jobId')::uuid and run_id = run_row.id for update;
  select * into attempt_row from public.af_research_attempts
    where id = (p_lease->>'attemptId')::uuid and run_id = run_row.id
      and job_id = job_row.id for update;
  select * into lease_row from public.af_research_job_leases
    where attempt_id = attempt_row.id for update;
  if job_row.id is null or attempt_row.id is null or lease_row.attempt_id is null then
    raise exception using errcode = 'AFR05', message = 'Actor scope mismatch or record not found';
  end if;
  if run_row.status = 'CANCELLED' or job_row.status = 'CANCELLED'
    or attempt_row.status = 'CANCELLED' then return jsonb_build_object('status', 'CANCELLED'); end if;

  select * into checkpoint_row
  from public.af_research_attempt_checkpoints stored_checkpoint
  where stored_checkpoint.attempt_id = attempt_row.id
    and stored_checkpoint.idempotency_key = p_checkpoint->>'idempotencyKey'
  for update;
  if found then
    if checkpoint_row.checkpoint_sequence is distinct from (p_checkpoint->>'sequence')::bigint
      or checkpoint_row.kind is distinct from (p_checkpoint->>'kind')::public.af_research_checkpoint_kind
      or checkpoint_row.completed_units is distinct from (p_checkpoint->>'completedUnits')::bigint
      or checkpoint_row.total_units is distinct from (case
        when p_checkpoint->'totalUnits' = 'null'::jsonb then null
        else (p_checkpoint->>'totalUnits')::bigint end)
      or checkpoint_row.provider_run_id is distinct from (p_checkpoint->>'providerRunId')
      or checkpoint_row.resume_token_fingerprint is distinct from (p_checkpoint->>'resumeTokenFingerprint')
      or checkpoint_row.output_fingerprint is distinct from (p_checkpoint->>'outputFingerprint') then
      raise exception using errcode = 'AFR02', message = 'Checkpoint idempotency key identifies different progress';
    end if;
    if lease_row.worker_id <> p_lease->>'workerId'
      or lease_row.lease_token <> (p_lease->>'leaseToken')::uuid
      or lease_row.lease_epoch <> (p_lease->>'leaseEpoch')::bigint
      or attempt_row.request_fingerprint <> p_lease->>'externalIdempotencyKey'
      or (p_lease->>'runVersion')::bigint > run_row.aggregate_version
      or (p_lease->>'jobVersion')::bigint > job_row.aggregate_version
      or (p_lease->>'attemptVersion')::bigint > attempt_row.aggregate_version
      or (p_lease->>'claimedAt')::timestamptz <> lease_row.claimed_at
      or (p_lease->>'heartbeatAt')::timestamptz > lease_row.last_heartbeat_at
      or lease_row.released_at is not null or lease_row.lease_expires_at <= observed_at then
      return jsonb_build_object('status', 'LEASE_LOST');
    end if;
    return jsonb_build_object(
      'status', 'REPLAY',
      'lease', public.af_research_lease_cursor_json(
        lease_row, run_row.aggregate_version, job_row.aggregate_version,
        attempt_row.aggregate_version, attempt_row.request_fingerprint
      ),
      'checkpoint', public.af_research_checkpoint_record_json(checkpoint_row)
    );
  end if;

  if not public.af_research_lease_cursor_matches(p_lease, lease_row, run_row, job_row, attempt_row)
    or lease_row.released_at is not null or lease_row.lease_expires_at <= observed_at
    or job_row.status <> 'RUNNING' or job_row.active_attempt_id <> attempt_row.id
    or attempt_row.status <> 'RUNNING' then return jsonb_build_object('status', 'LEASE_LOST'); end if;
  if (p_checkpoint->>'runId')::uuid <> run_row.id
    or (p_checkpoint->>'jobId')::uuid <> job_row.id
    or (p_checkpoint->>'attemptId')::uuid <> attempt_row.id
    or (p_checkpoint->>'sequence')::bigint <> job_row.checkpoint_count + 1
    or (p_checkpoint->>'createdAt')::timestamptz < attempt_row.started_at
    or (p_checkpoint->>'createdAt')::timestamptz > observed_at + interval '5 minutes' then
    raise exception using errcode = 'AFR04', message = 'Checkpoint identity, sequence, or time is invalid';
  end if;
  mutation_time := greatest(observed_at, (p_checkpoint->>'createdAt')::timestamptz);
  insert into public.af_research_attempt_checkpoints (
    schema_version, id, run_id, job_id, attempt_id, checkpoint_sequence,
    idempotency_key, kind, completed_units, total_units, provider_run_id,
    resume_token_fingerprint, output_fingerprint, publication_authority,
    created_at
  ) values (
    1, (p_checkpoint->>'id')::uuid, run_row.id, job_row.id, attempt_row.id,
    (p_checkpoint->>'sequence')::bigint, p_checkpoint->>'idempotencyKey',
    (p_checkpoint->>'kind')::public.af_research_checkpoint_kind,
    (p_checkpoint->>'completedUnits')::bigint,
    case when p_checkpoint->'totalUnits' = 'null'::jsonb then null
      else (p_checkpoint->>'totalUnits')::bigint end,
    p_checkpoint->>'providerRunId', p_checkpoint->>'resumeTokenFingerprint',
    p_checkpoint->>'outputFingerprint', 'NONE',
    (p_checkpoint->>'createdAt')::timestamptz
  ) returning * into checkpoint_row;
  update public.af_research_jobs
  set checkpoint_count = checkpoint_count + 1,
      aggregate_version = aggregate_version + 1, updated_at = mutation_time
  where id = job_row.id and aggregate_version = job_row.aggregate_version
  returning * into job_row;
  update public.af_research_job_leases
  set last_heartbeat_at = mutation_time,
      lease_expires_at = mutation_time + make_interval(secs => p_lease_seconds)
  where attempt_id = attempt_row.id and lease_token = lease_row.lease_token
  returning * into lease_row;
  return jsonb_build_object(
    'status', 'COMMITTED',
    'lease', public.af_research_lease_cursor_json(
      lease_row, run_row.aggregate_version, job_row.aggregate_version,
      attempt_row.aggregate_version, attempt_row.request_fingerprint
    ),
    'checkpoint', public.af_research_checkpoint_record_json(checkpoint_row)
  );
exception
  when unique_violation then raise exception using errcode = 'AFR03', message = 'Checkpoint identifier already exists';
  when foreign_key_violation or check_violation or not_null_violation
    or invalid_text_representation or numeric_value_out_of_range then
    raise exception using errcode = 'AFR04', message = 'Research checkpoint failed schema invariants';
end;
$function$;

-- Persist a validated stage result inside the caller's transaction. This is
-- deliberately not an RPC: execute is revoked from API roles below.
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
  output_json jsonb := p_result->'output';
  candidate_json jsonb;
  content_json jsonb;
begin
  if not public.af_research_stage_result_valid(
    p_result, p_run_id, p_job_id, p_attempt_id, p_stage
  ) or (output_json->>'createdAt')::timestamptz > p_completed_at then
    raise exception using errcode = 'AFR04', message = 'Stage result violates strict research output boundaries';
  end if;

  insert into public.af_research_stage_outputs (
    schema_version, id, run_id, job_id, attempt_id, kind, stage,
    review_state, publication_authority, provenance_inputs, created_at,
    resolved_requirement_ids, unresolved_requirement_ids, axis_ids,
    source_class_ids, coverage_gap_codes, candidate_ids, source_ids,
    locator_ids, unresolved_candidate_ids, proposed_evidence_ids,
    proposed_claim_ids, assessed_claim_ids, independence_group_ids,
    contradiction_ids, unresolved_claim_ids, sequence_proposal_id,
    eligible_claim_ids, omitted_claim_ids
  ) values (
    1, (output_json->>'id')::uuid, p_run_id, p_job_id, p_attempt_id,
    (output_json->>'kind')::public.af_research_output_kind,
    p_stage, 'PROPOSED', 'NONE', output_json->'provenanceInputs',
    (output_json->>'createdAt')::timestamptz,
    case when output_json ? 'resolvedRequirementIds' then
      array(select jsonb_array_elements_text(output_json->'resolvedRequirementIds')) else null end,
    case when output_json ? 'unresolvedRequirementIds' then
      array(select jsonb_array_elements_text(output_json->'unresolvedRequirementIds')) else null end,
    case when output_json ? 'axisIds' then
      array(select jsonb_array_elements_text(output_json->'axisIds')) else null end,
    case when output_json ? 'sourceClassIds' then
      array(select jsonb_array_elements_text(output_json->'sourceClassIds')) else null end,
    case when output_json ? 'coverageGapCodes' then
      array(select jsonb_array_elements_text(output_json->'coverageGapCodes')) else null end,
    case when output_json ? 'candidateIds' then
      array(select value::uuid from jsonb_array_elements_text(output_json->'candidateIds') value) else null end,
    case when output_json ? 'sourceIds' then
      array(select value::uuid from jsonb_array_elements_text(output_json->'sourceIds') value) else null end,
    case when output_json ? 'locatorIds' then
      array(select value::uuid from jsonb_array_elements_text(output_json->'locatorIds') value) else null end,
    case when output_json ? 'unresolvedCandidateIds' then
      array(select value::uuid from jsonb_array_elements_text(output_json->'unresolvedCandidateIds') value) else null end,
    case when output_json ? 'proposedEvidenceIds' then
      array(select value::uuid from jsonb_array_elements_text(output_json->'proposedEvidenceIds') value) else null end,
    case when output_json ? 'proposedClaimIds' then
      array(select value::uuid from jsonb_array_elements_text(output_json->'proposedClaimIds') value) else null end,
    case when output_json ? 'assessedClaimIds' then
      array(select value::uuid from jsonb_array_elements_text(output_json->'assessedClaimIds') value) else null end,
    case when output_json ? 'independenceGroupIds' then
      array(select jsonb_array_elements_text(output_json->'independenceGroupIds')) else null end,
    case when output_json ? 'contradictionIds' then
      array(select value::uuid from jsonb_array_elements_text(output_json->'contradictionIds') value) else null end,
    case when output_json ? 'unresolvedClaimIds' then
      array(select value::uuid from jsonb_array_elements_text(output_json->'unresolvedClaimIds') value) else null end,
    case when output_json ? 'sequenceProposalId' then
      (output_json->>'sequenceProposalId')::uuid else null end,
    case when output_json ? 'eligibleClaimIds' then
      array(select value::uuid from jsonb_array_elements_text(output_json->'eligibleClaimIds') value) else null end,
    case when output_json ? 'omittedClaimIds' then
      array(select value::uuid from jsonb_array_elements_text(output_json->'omittedClaimIds') value) else null end
  );

  for candidate_json in select value from jsonb_array_elements(p_result->'sourceCandidates') loop
    if candidate_json->>'discoveryInputFingerprint' <> p_stage_input_fingerprint::text
      or (candidate_json->>'createdAt')::timestamptz > p_completed_at
      or not exists (
        select 1
        from public.af_research_plans stored_plan,
          jsonb_array_elements_text(stored_plan.plan->'sourceClassIds') permitted(source_class)
        where stored_plan.id = p_plan_id
          and permitted.source_class = candidate_json->>'sourceClass'
      ) then
      raise exception using errcode = 'AFR04', message = 'Discovered candidate violates specialist plan or stage fingerprint';
    end if;
    insert into public.af_source_candidates (
      schema_version, id, run_id, job_id, attempt_id, candidate_key, title,
      canonical_url, medium, source_class, access_state, rights_state,
      discovery_input_fingerprint, content_trust, evidence_status,
      review_state, publication_authority, created_at
    ) values (
      1, (candidate_json->>'id')::uuid, p_run_id, p_job_id, p_attempt_id,
      candidate_json->>'candidateKey', candidate_json->>'title',
      candidate_json->>'canonicalUrl',
      (candidate_json->>'medium')::public.af_source_medium,
      candidate_json->>'sourceClass',
      (candidate_json->>'accessState')::public.af_access_state,
      (candidate_json->>'rightsState')::public.af_rights_state,
      candidate_json->>'discoveryInputFingerprint', 'UNTRUSTED',
      'NOT_EVIDENCE', 'PROPOSED', 'NONE',
      (candidate_json->>'createdAt')::timestamptz
    );
  end loop;

  for content_json in select value from jsonb_array_elements(p_result->'untrustedContent') loop
    if (content_json->>'createdAt')::timestamptz > p_completed_at then
      raise exception using errcode = 'AFR04', message = 'Untrusted content time exceeds completion time';
    end if;
    insert into public.af_untrusted_research_content (
      schema_version, id, run_id, job_id, attempt_id, candidate_id,
      content_kind, content_fingerprint, content_length, storage_ref,
      access_state, rights_state, trust_boundary, instruction_authority,
      screening_state, publication_authority, created_at
    ) values (
      1, (content_json->>'id')::uuid, p_run_id, p_job_id, p_attempt_id,
      (content_json->>'candidateId')::uuid,
      (content_json->>'contentKind')::public.af_untrusted_content_kind,
      content_json->>'contentFingerprint',
      (content_json->>'contentLength')::bigint, content_json->>'storageRef',
      (content_json->>'accessState')::public.af_access_state,
      (content_json->>'rightsState')::public.af_rights_state,
      'UNTRUSTED_SOURCE_DATA', 'NONE',
      (content_json->>'screeningState')::public.af_screening_state,
      'NONE', (content_json->>'createdAt')::timestamptz
    );
  end loop;
end;
$function$;

create function public.af_complete_research_job_v1(
  p_actor_id uuid,
  p_lease jsonb,
  p_idempotency_key text,
  p_result jsonb,
  p_output_fingerprint text,
  p_execution jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, public, auth
as $function$
declare
  run_row public.af_research_runs%rowtype;
  job_row public.af_research_jobs%rowtype;
  attempt_row public.af_research_attempts%rowtype;
  lease_row public.af_research_job_leases%rowtype;
  observed_at timestamptz := clock_timestamp();
  completed_time timestamptz;
  outcome public.af_research_job_status;
  new_run_version bigint;
  terminal_run_status public.af_research_run_status;
  terminal_run_health public.af_research_run_health;
  bounded_reason_code text;
begin
  perform public.af_assert_actor_scope(p_actor_id);
  perform p_output_fingerprint::public.af_sha256;
  if not public.af_research_lease_cursor_valid(p_lease)
    or p_idempotency_key !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,199}$'
    or not public.af_research_worker_completion_valid(p_execution)
    or p_execution->>'telemetryState' <> 'COMPLETE' then
    raise exception using errcode = 'AFR04', message = 'Invalid research completion input';
  end if;
  completed_time := (p_execution->>'completedAt')::timestamptz;

  select stored_run.* into run_row
  from public.af_research_runs stored_run
  join public.af_cases stored_case on stored_case.id = stored_run.case_id
  where stored_run.id = (p_lease->>'runId')::uuid
    and stored_case.owner_id = p_actor_id for update of stored_run;
  if not found then raise exception using errcode = 'AFR05', message = 'Actor scope mismatch or record not found'; end if;
  select * into job_row from public.af_research_jobs
    where id = (p_lease->>'jobId')::uuid and run_id = run_row.id for update;
  select * into attempt_row from public.af_research_attempts
    where id = (p_lease->>'attemptId')::uuid and run_id = run_row.id
      and job_id = job_row.id for update;
  select * into lease_row from public.af_research_job_leases
    where attempt_id = attempt_row.id for update;
  if job_row.id is null or attempt_row.id is null or lease_row.attempt_id is null then
    raise exception using errcode = 'AFR05', message = 'Actor scope mismatch or record not found';
  end if;

  if attempt_row.terminal_idempotency_key is not null then
    if attempt_row.terminal_idempotency_key is distinct from p_idempotency_key
      or attempt_row.terminal_mutation_kind is distinct from 'COMPLETE'
      or attempt_row.output_fingerprint is distinct from p_output_fingerprint
      or (p_result->>'outcome') is distinct from attempt_row.status::text
      or attempt_row.telemetry_state is distinct from (p_execution->>'telemetryState')
      or attempt_row.provider_run_id is distinct from (p_execution->>'providerRunId')
      or attempt_row.usage_input_tokens is distinct from (p_execution#>>'{usage,inputTokens}')::bigint
      or attempt_row.usage_output_tokens is distinct from (p_execution#>>'{usage,outputTokens}')::bigint
      or attempt_row.usage_tool_calls is distinct from (p_execution#>>'{usage,toolCalls}')::bigint
      or attempt_row.usage_input_bytes is distinct from (p_execution#>>'{usage,inputBytes}')::bigint
      or attempt_row.usage_output_bytes is distinct from (p_execution#>>'{usage,outputBytes}')::bigint
      or attempt_row.cost_currency is distinct from (p_execution#>>'{cost,currency}')
      or attempt_row.cost_pricing_state is distinct from
        (p_execution#>>'{cost,pricingState}')::public.af_pricing_state
      or attempt_row.cost_amount_micros is distinct from
        (p_execution#>>'{cost,amountMicros}')::bigint
      or attempt_row.latency_ms is distinct from (p_execution->>'latencyMs')::bigint
      or attempt_row.completed_at is distinct from (p_execution->>'completedAt')::timestamptz
      or attempt_row.status not in ('SUCCEEDED', 'DEGRADED') then
      raise exception using errcode = 'AFR02', message = 'Terminal idempotency key identifies a different mutation';
    end if;
    return jsonb_build_object(
      'status', 'REPLAY', 'outcome', attempt_row.status,
      'terminal', jsonb_build_object(
        'runId', run_row.id, 'jobId', job_row.id,
        'attemptId', attempt_row.id, 'jobStatus', job_row.status
      )
    );
  end if;
  if run_row.status = 'CANCELLED' or job_row.status = 'CANCELLED'
    or attempt_row.status = 'CANCELLED' then return jsonb_build_object('status', 'CANCELLED'); end if;
  if not public.af_research_lease_cursor_matches(p_lease, lease_row, run_row, job_row, attempt_row)
    or lease_row.released_at is not null or lease_row.lease_expires_at <= observed_at
    or job_row.status <> 'RUNNING' or job_row.active_attempt_id <> attempt_row.id
    or attempt_row.status <> 'RUNNING' then return jsonb_build_object('status', 'LEASE_LOST'); end if;
  if completed_time < attempt_row.started_at
    or completed_time < lease_row.last_heartbeat_at
    or completed_time > observed_at + interval '5 minutes' then
    raise exception using errcode = 'AFR04', message = 'Completion time is outside the active attempt';
  end if;

  outcome := (p_result->>'outcome')::public.af_research_job_status;
  bounded_reason_code := p_result#>>'{boundedReasonCodes,0}';
  perform public.af_persist_research_stage_result(
    run_row.id, job_row.id, attempt_row.id, job_row.stage,
    job_row.stage_input_fingerprint, run_row.plan_id, p_result, completed_time
  );

  update public.af_research_attempts
  set status = outcome::text::public.af_research_attempt_status,
      provider_run_id = p_execution->>'providerRunId',
      telemetry_state = p_execution->>'telemetryState',
      usage_input_tokens = (p_execution#>>'{usage,inputTokens}')::bigint,
      usage_output_tokens = (p_execution#>>'{usage,outputTokens}')::bigint,
      usage_tool_calls = (p_execution#>>'{usage,toolCalls}')::bigint,
      usage_input_bytes = (p_execution#>>'{usage,inputBytes}')::bigint,
      usage_output_bytes = (p_execution#>>'{usage,outputBytes}')::bigint,
      cost_currency = p_execution#>>'{cost,currency}',
      cost_pricing_state = (p_execution#>>'{cost,pricingState}')::public.af_pricing_state,
      cost_amount_micros = case when p_execution#>'{cost,amountMicros}' = 'null'::jsonb
        then null else (p_execution#>>'{cost,amountMicros}')::bigint end,
      latency_ms = (p_execution->>'latencyMs')::bigint,
      output_fingerprint = p_output_fingerprint,
      error_code = null,
      terminal_idempotency_key = p_idempotency_key,
      terminal_mutation_kind = 'COMPLETE',
      aggregate_version = aggregate_version + 1,
      completed_at = completed_time
  where id = attempt_row.id and aggregate_version = attempt_row.aggregate_version
  returning * into attempt_row;
  if not found then raise exception using errcode = 'AFR01', message = 'Research attempt aggregate version conflict'; end if;

  update public.af_research_jobs
  set status = outcome, active_attempt_id = null, terminal_at = completed_time,
      aggregate_version = aggregate_version + 1, updated_at = completed_time
  where id = job_row.id and run_id = run_row.id
    and aggregate_version = job_row.aggregate_version
    and active_attempt_id = attempt_row.id
  returning * into job_row;
  if not found then raise exception using errcode = 'AFR01', message = 'Research job aggregate version conflict'; end if;
  update public.af_research_job_leases set released_at = completed_time
    where attempt_id = attempt_row.id and lease_token = lease_row.lease_token
      and released_at is null;

  perform public.af_append_research_event_v1(
    run_row.id, 'research.job_status_changed', run_row.aggregate_version,
    completed_time, jsonb_build_object(
      'jobId', job_row.id, 'stage', job_row.stage,
      'previousStatus', 'RUNNING', 'status', outcome,
      'attemptId', attempt_row.id, 'boundedReasonCode', bounded_reason_code
    )
  );

  new_run_version := run_row.aggregate_version;
  if job_row.stage = 'SEQUENCING' then
    if exists (
      select 1 from public.af_research_jobs completed_job
      where completed_job.run_id = run_row.id and completed_job.status = 'DEGRADED'
    ) then
      terminal_run_status := 'DEGRADED'; terminal_run_health := 'DEGRADED';
    else
      terminal_run_status := 'SUCCEEDED'; terminal_run_health := 'HEALTHY';
    end if;
    update public.af_research_runs
    set status = terminal_run_status, health = terminal_run_health,
        current_stage = 'SEQUENCING', aggregate_version = aggregate_version + 1,
        updated_at = completed_time, completed_at = completed_time
    where id = run_row.id and aggregate_version = run_row.aggregate_version
    returning aggregate_version into new_run_version;
    if not found then raise exception using errcode = 'AFR01', message = 'Research run aggregate version conflict'; end if;
    perform public.af_append_research_event_v1(
      run_row.id, 'research.run_status_changed', new_run_version,
      completed_time, jsonb_build_object(
        'previousStatus', run_row.status, 'status', terminal_run_status,
        'currentStage', 'SEQUENCING',
        'boundedReasonCode', case when terminal_run_status = 'DEGRADED'
          then coalesce(bounded_reason_code, 'stage-degraded') else null end
      )
    );
  end if;

  return jsonb_build_object(
    'status', 'COMMITTED', 'outcome', outcome,
    'terminal', jsonb_build_object(
      'runId', run_row.id, 'jobId', job_row.id,
      'attemptId', attempt_row.id, 'jobStatus', job_row.status
    )
  );
exception
  when unique_violation then raise exception using errcode = 'AFR03', message = 'Research output conflicts with an existing identifier';
  when foreign_key_violation or check_violation or not_null_violation
    or invalid_text_representation or numeric_value_out_of_range then
    raise exception using errcode = 'AFR04', message = 'Research completion failed schema or reference invariants';
end;
$function$;

create function public.af_finalize_research_failure(
  p_actor_id uuid,
  p_lease jsonb,
  p_idempotency_key text,
  p_failure jsonb,
  p_execution jsonb,
  p_mutation_kind text
)
returns jsonb
language plpgsql
volatile
set search_path = pg_catalog, public, auth
as $function$
declare
  run_row public.af_research_runs%rowtype;
  job_row public.af_research_jobs%rowtype;
  attempt_row public.af_research_attempts%rowtype;
  lease_row public.af_research_job_leases%rowtype;
  failure_row public.af_research_attempt_failures%rowtype;
  handoff_row public.af_research_attempt_handoffs%rowtype;
  observed_at timestamptz := clock_timestamp();
  completed_time timestamptz;
  retry_time timestamptz;
  retry_requested boolean;
  handoff_requested boolean;
  provider_checkpoint_exists boolean;
  terminal_failure boolean;
  target_attempt_status public.af_research_attempt_status;
  target_job_status public.af_research_job_status;
  new_run_version bigint;
begin
  perform public.af_assert_actor_scope(p_actor_id);
  if p_mutation_kind not in ('FAIL', 'RELEASE')
    or not public.af_research_lease_cursor_valid(p_lease)
    or p_idempotency_key !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,199}$'
    or not public.af_research_worker_failure_valid(p_failure)
    or not public.af_research_worker_completion_valid(p_execution) then
    raise exception using errcode = 'AFR04', message = 'Invalid redacted research failure input';
  end if;
  completed_time := (p_execution->>'completedAt')::timestamptz;

  select stored_run.* into run_row
  from public.af_research_runs stored_run
  join public.af_cases stored_case on stored_case.id = stored_run.case_id
  where stored_run.id = (p_lease->>'runId')::uuid
    and stored_case.owner_id = p_actor_id for update of stored_run;
  if not found then raise exception using errcode = 'AFR05', message = 'Actor scope mismatch or record not found'; end if;
  select * into job_row from public.af_research_jobs
    where id = (p_lease->>'jobId')::uuid and run_id = run_row.id for update;
  select * into attempt_row from public.af_research_attempts
    where id = (p_lease->>'attemptId')::uuid and run_id = run_row.id
      and job_id = job_row.id for update;
  select * into lease_row from public.af_research_job_leases
    where attempt_id = attempt_row.id for update;
  if job_row.id is null or attempt_row.id is null or lease_row.attempt_id is null then
    raise exception using errcode = 'AFR05', message = 'Actor scope mismatch or record not found';
  end if;

  select * into handoff_row from public.af_research_attempt_handoffs
    where attempt_id = attempt_row.id
      and mutation_idempotency_key = p_idempotency_key for update;
  if found then
    if handoff_row.lease_epoch is distinct from (p_lease->>'leaseEpoch')::bigint
      or handoff_row.mutation_kind is distinct from p_mutation_kind
      or handoff_row.code is distinct from (p_failure->>'code')
      or handoff_row.category is distinct from
        (p_failure->>'category')::public.af_research_failure_category
      or handoff_row.phase is distinct from
        (p_failure->>'phase')::public.af_research_failure_phase
      or (p_failure->>'retryDirective') is distinct from 'RETRY_WITH_BACKOFF'
      or handoff_row.retry_after_ms is distinct from (case
        when p_failure->'retryAfterMs' = 'null'::jsonb then null
        else (p_failure->>'retryAfterMs')::bigint end)
      or handoff_row.provider_status_code is distinct from (case
        when p_failure->'providerStatusCode' = 'null'::jsonb then null
        else (p_failure->>'providerStatusCode')::smallint end)
      or handoff_row.diagnostic_fingerprint is distinct from (p_failure->>'diagnosticFingerprint')
      or handoff_row.telemetry_state is distinct from (p_execution->>'telemetryState')
      or handoff_row.provider_run_id is distinct from (p_execution->>'providerRunId')
      or handoff_row.usage_input_tokens is distinct from (p_execution#>>'{usage,inputTokens}')::bigint
      or handoff_row.usage_output_tokens is distinct from (p_execution#>>'{usage,outputTokens}')::bigint
      or handoff_row.usage_tool_calls is distinct from (p_execution#>>'{usage,toolCalls}')::bigint
      or handoff_row.usage_input_bytes is distinct from (p_execution#>>'{usage,inputBytes}')::bigint
      or handoff_row.usage_output_bytes is distinct from (p_execution#>>'{usage,outputBytes}')::bigint
      or handoff_row.cost_currency is distinct from (p_execution#>>'{cost,currency}')
      or handoff_row.cost_pricing_state is distinct from
        (p_execution#>>'{cost,pricingState}')::public.af_pricing_state
      or handoff_row.cost_amount_micros is distinct from
        (p_execution#>>'{cost,amountMicros}')::bigint
      or handoff_row.latency_ms is distinct from (p_execution->>'latencyMs')::bigint
      or handoff_row.completed_at is distinct from (p_execution->>'completedAt')::timestamptz then
      raise exception using errcode = 'AFR02', message = 'Handoff idempotency key identifies a different mutation';
    end if;
    return jsonb_build_object(
      'status', 'REPLAY', 'attemptId', attempt_row.id,
      'retryAt', handoff_row.retry_at
    );
  end if;

  select * into failure_row from public.af_research_attempt_failures
    where attempt_id = attempt_row.id for update;
  if attempt_row.terminal_idempotency_key is not null then
    if attempt_row.terminal_idempotency_key is distinct from p_idempotency_key
      or attempt_row.terminal_mutation_kind is distinct from p_mutation_kind
      or not found
      or failure_row.mutation_idempotency_key is distinct from p_idempotency_key
      or failure_row.code is distinct from (p_failure->>'code')
      or failure_row.category is distinct from (p_failure->>'category')::public.af_research_failure_category
      or failure_row.phase is distinct from (p_failure->>'phase')::public.af_research_failure_phase
      or failure_row.retry_directive is distinct from (p_failure->>'retryDirective')::public.af_research_retry_directive
      or failure_row.retry_after_ms is distinct from (case
        when p_failure->'retryAfterMs' = 'null'::jsonb then null
        else (p_failure->>'retryAfterMs')::bigint end)
      or failure_row.provider_status_code is distinct from (case
        when p_failure->'providerStatusCode' = 'null'::jsonb then null
        else (p_failure->>'providerStatusCode')::smallint end)
      or failure_row.diagnostic_fingerprint is distinct from (p_failure->>'diagnosticFingerprint')
      or attempt_row.telemetry_state is distinct from (p_execution->>'telemetryState')
      or attempt_row.provider_run_id is distinct from (p_execution->>'providerRunId')
      or attempt_row.usage_input_tokens is distinct from (p_execution#>>'{usage,inputTokens}')::bigint
      or attempt_row.usage_output_tokens is distinct from (p_execution#>>'{usage,outputTokens}')::bigint
      or attempt_row.usage_tool_calls is distinct from (p_execution#>>'{usage,toolCalls}')::bigint
      or attempt_row.usage_input_bytes is distinct from (p_execution#>>'{usage,inputBytes}')::bigint
      or attempt_row.usage_output_bytes is distinct from (p_execution#>>'{usage,outputBytes}')::bigint
      or attempt_row.cost_currency is distinct from (p_execution#>>'{cost,currency}')
      or attempt_row.cost_pricing_state is distinct from
        (p_execution#>>'{cost,pricingState}')::public.af_pricing_state
      or attempt_row.cost_amount_micros is distinct from
        (p_execution#>>'{cost,amountMicros}')::bigint
      or attempt_row.latency_ms is distinct from (p_execution->>'latencyMs')::bigint
      or attempt_row.completed_at is distinct from (p_execution->>'completedAt')::timestamptz then
      raise exception using errcode = 'AFR02', message = 'Terminal idempotency key identifies a different mutation';
    end if;
    if attempt_row.status = 'FAILED_RETRYABLE' then
      return jsonb_build_object(
        'status', 'REPLAY', 'attemptId', attempt_row.id,
        'retryAt', failure_row.retry_at
      );
    end if;
    if attempt_row.status = 'FAILED_TERMINAL' then
      return jsonb_build_object(
        'status', 'FAILED_TERMINAL',
        'terminal', jsonb_build_object(
          'runId', run_row.id, 'jobId', job_row.id,
          'attemptId', attempt_row.id, 'jobStatus', job_row.status
        ),
        'replayed', true
      );
    end if;
    raise exception using errcode = 'AFR02', message = 'Terminal replay has an incompatible outcome';
  end if;

  if run_row.status = 'CANCELLED' or job_row.status = 'CANCELLED'
    or attempt_row.status = 'CANCELLED' then return jsonb_build_object('status', 'CANCELLED'); end if;
  if not public.af_research_lease_cursor_matches(p_lease, lease_row, run_row, job_row, attempt_row)
    or lease_row.released_at is not null or lease_row.lease_expires_at <= observed_at
    or job_row.status <> 'RUNNING' or job_row.active_attempt_id <> attempt_row.id
    or attempt_row.status <> 'RUNNING' then return jsonb_build_object('status', 'LEASE_LOST'); end if;
  if completed_time < attempt_row.started_at
    or completed_time < lease_row.last_heartbeat_at
    or completed_time > observed_at + interval '5 minutes' then
    raise exception using errcode = 'AFR04', message = 'Failure time is outside the active attempt';
  end if;

  retry_requested := p_failure->>'retryDirective' = 'RETRY_WITH_BACKOFF';
  select exists (
    select 1 from public.af_research_attempt_checkpoints checkpoint
    where checkpoint.attempt_id = attempt_row.id
      and checkpoint.kind = 'PROVIDER_ACCEPTED'
      and checkpoint.provider_run_id is not null
  ) into provider_checkpoint_exists;
  handoff_requested := retry_requested and (
    p_mutation_kind = 'RELEASE'
    or (
      lease_row.execution_plan->>'automaticRetrySafety' = 'RESUMABLE_PROVIDER_RUN'
      and provider_checkpoint_exists
    )
  ) and lease_row.lease_epoch < job_row.max_attempts;
  if p_mutation_kind = 'RELEASE'
    and not retry_requested then
    raise exception using errcode = 'AFR07', message = 'A release requires a bounded retry handoff';
  end if;
  terminal_failure := not retry_requested
    or (
      retry_requested
      and not handoff_requested
      and lease_row.execution_plan->>'automaticRetrySafety' <> 'IDEMPOTENT_PROVIDER_REQUEST'
    )
    or (not handoff_requested and job_row.attempt_count >= job_row.max_attempts);
  target_attempt_status := case when terminal_failure then 'FAILED_TERMINAL'
    else 'FAILED_RETRYABLE' end;
  target_job_status := case when terminal_failure then 'FAILED_TERMINAL'
    else 'FAILED_RETRYABLE' end;
  retry_time := case when retry_requested then
    completed_time + make_interval(secs => (p_failure->>'retryAfterMs')::double precision / 1000.0)
    else null end;

  if handoff_requested then
    insert into public.af_research_attempt_handoffs (
      schema_version, run_id, job_id, attempt_id, case_id, actor_id,
      lease_epoch, mutation_kind, mutation_idempotency_key, code, category,
      phase, retry_after_ms, provider_status_code, diagnostic_fingerprint,
      redaction_state, telemetry_state, provider_run_id, usage_input_tokens,
      usage_output_tokens, usage_tool_calls, usage_input_bytes,
      usage_output_bytes, cost_currency, cost_pricing_state,
      cost_amount_micros, latency_ms, completed_at, retry_at, recorded_at
    ) values (
      1, run_row.id, job_row.id, attempt_row.id, run_row.case_id, p_actor_id,
      lease_row.lease_epoch, p_mutation_kind, p_idempotency_key,
      p_failure->>'code',
      (p_failure->>'category')::public.af_research_failure_category,
      (p_failure->>'phase')::public.af_research_failure_phase,
      (p_failure->>'retryAfterMs')::bigint,
      case when p_failure->'providerStatusCode' = 'null'::jsonb then null
        else (p_failure->>'providerStatusCode')::smallint end,
      p_failure->>'diagnosticFingerprint', 'BODY_FREE',
      p_execution->>'telemetryState', p_execution->>'providerRunId',
      (p_execution#>>'{usage,inputTokens}')::bigint,
      (p_execution#>>'{usage,outputTokens}')::bigint,
      (p_execution#>>'{usage,toolCalls}')::bigint,
      (p_execution#>>'{usage,inputBytes}')::bigint,
      (p_execution#>>'{usage,outputBytes}')::bigint,
      p_execution#>>'{cost,currency}',
      (p_execution#>>'{cost,pricingState}')::public.af_pricing_state,
      (p_execution#>>'{cost,amountMicros}')::bigint,
      (p_execution->>'latencyMs')::bigint, completed_time, retry_time,
      completed_time
    ) returning * into handoff_row;

    update public.af_research_attempts
    set aggregate_version = aggregate_version + 1
    where id = attempt_row.id and aggregate_version = attempt_row.aggregate_version
    returning * into attempt_row;
    if not found then raise exception using errcode = 'AFR01', message = 'Research attempt aggregate version conflict'; end if;
    update public.af_research_jobs
    set retry_not_before = retry_time,
        aggregate_version = aggregate_version + 1, updated_at = completed_time
    where id = job_row.id and run_id = run_row.id
      and aggregate_version = job_row.aggregate_version
      and status = 'RUNNING' and active_attempt_id = attempt_row.id
    returning * into job_row;
    if not found then raise exception using errcode = 'AFR01', message = 'Research job aggregate version conflict'; end if;
    update public.af_research_job_leases
    set released_at = completed_time
    where attempt_id = attempt_row.id and lease_token = lease_row.lease_token
      and released_at is null;
    if not found then return jsonb_build_object('status', 'LEASE_LOST'); end if;
    return jsonb_build_object(
      'status', case when p_mutation_kind = 'RELEASE' then 'RELEASED'
        else 'RETRY_SCHEDULED' end,
      'attemptId', attempt_row.id, 'retryAt', retry_time
    );
  end if;

  insert into public.af_research_attempt_failures (
    schema_version, attempt_id, run_id, job_id, mutation_idempotency_key,
    code, category, phase, retry_directive, retry_after_ms, retry_at,
    provider_status_code, diagnostic_fingerprint, redaction_state, recorded_at
  ) values (
    1, attempt_row.id, run_row.id, job_row.id, p_idempotency_key,
    p_failure->>'code',
    (p_failure->>'category')::public.af_research_failure_category,
    (p_failure->>'phase')::public.af_research_failure_phase,
    (p_failure->>'retryDirective')::public.af_research_retry_directive,
    case when p_failure->'retryAfterMs' = 'null'::jsonb then null
      else (p_failure->>'retryAfterMs')::bigint end,
    retry_time,
    case when p_failure->'providerStatusCode' = 'null'::jsonb then null
      else (p_failure->>'providerStatusCode')::smallint end,
    p_failure->>'diagnosticFingerprint', 'BODY_FREE', completed_time
  ) returning * into failure_row;

  update public.af_research_attempts
  set status = target_attempt_status,
      provider_run_id = p_execution->>'providerRunId',
      telemetry_state = p_execution->>'telemetryState',
      usage_input_tokens = (p_execution#>>'{usage,inputTokens}')::bigint,
      usage_output_tokens = (p_execution#>>'{usage,outputTokens}')::bigint,
      usage_tool_calls = (p_execution#>>'{usage,toolCalls}')::bigint,
      usage_input_bytes = (p_execution#>>'{usage,inputBytes}')::bigint,
      usage_output_bytes = (p_execution#>>'{usage,outputBytes}')::bigint,
      cost_currency = p_execution#>>'{cost,currency}',
      cost_pricing_state = (p_execution#>>'{cost,pricingState}')::public.af_pricing_state,
      cost_amount_micros = case
        when p_execution->'cost' = 'null'::jsonb
          or p_execution#>'{cost,amountMicros}' = 'null'::jsonb then null
        else (p_execution#>>'{cost,amountMicros}')::bigint end,
      latency_ms = (p_execution->>'latencyMs')::bigint,
      output_fingerprint = null,
      error_code = p_failure->>'code',
      terminal_idempotency_key = p_idempotency_key,
      terminal_mutation_kind = p_mutation_kind,
      aggregate_version = aggregate_version + 1,
      completed_at = completed_time
  where id = attempt_row.id and aggregate_version = attempt_row.aggregate_version
  returning * into attempt_row;
  if not found then raise exception using errcode = 'AFR01', message = 'Research attempt aggregate version conflict'; end if;

  update public.af_research_jobs
  set status = target_job_status, active_attempt_id = null,
      retry_not_before = case when terminal_failure then null else retry_time end,
      terminal_at = case when terminal_failure then completed_time else null end,
      aggregate_version = aggregate_version + 1, updated_at = completed_time
  where id = job_row.id and run_id = run_row.id
    and aggregate_version = job_row.aggregate_version
    and active_attempt_id = attempt_row.id
  returning * into job_row;
  if not found then raise exception using errcode = 'AFR01', message = 'Research job aggregate version conflict'; end if;
  update public.af_research_job_leases set released_at = completed_time
    where attempt_id = attempt_row.id and lease_token = lease_row.lease_token
      and released_at is null;

  perform public.af_append_research_event_v1(
    run_row.id, 'research.job_status_changed', run_row.aggregate_version,
    completed_time, jsonb_build_object(
      'jobId', job_row.id, 'stage', job_row.stage,
      'previousStatus', 'RUNNING', 'status', target_job_status,
      'attemptId', attempt_row.id, 'boundedReasonCode', p_failure->>'code'
    )
  );

  new_run_version := run_row.aggregate_version;
  if terminal_failure then
    update public.af_research_runs
    set status = 'FAILED', health = 'FAILED',
        aggregate_version = aggregate_version + 1,
        updated_at = completed_time, completed_at = completed_time
    where id = run_row.id and aggregate_version = run_row.aggregate_version
    returning aggregate_version into new_run_version;
    if not found then raise exception using errcode = 'AFR01', message = 'Research run aggregate version conflict'; end if;
    perform public.af_append_research_event_v1(
      run_row.id, 'research.run_status_changed', new_run_version,
      completed_time, jsonb_build_object(
        'previousStatus', run_row.status, 'status', 'FAILED',
        'currentStage', run_row.current_stage,
        'boundedReasonCode', p_failure->>'code'
      )
    );
  end if;

  if not terminal_failure then
    return jsonb_build_object(
      'status', case when p_mutation_kind = 'RELEASE' then 'RELEASED'
        else 'RETRY_SCHEDULED' end,
      'attemptId', attempt_row.id, 'retryAt', retry_time
    );
  end if;
  return jsonb_build_object(
    'status', 'FAILED_TERMINAL',
    'terminal', jsonb_build_object(
      'runId', run_row.id, 'jobId', job_row.id,
      'attemptId', attempt_row.id, 'jobStatus', job_row.status
    ),
    'replayed', false
  );
exception
  when unique_violation then raise exception using errcode = 'AFR03', message = 'Research failure conflicts with an existing mutation';
  when foreign_key_violation or check_violation or not_null_violation
    or invalid_text_representation or numeric_value_out_of_range then
    raise exception using errcode = 'AFR04', message = 'Research failure failed schema or reference invariants';
end;
$function$;

create function public.af_fail_research_job_v1(
  p_actor_id uuid,
  p_lease jsonb,
  p_idempotency_key text,
  p_failure jsonb,
  p_execution jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, public, auth
as $function$
begin
  perform public.af_assert_actor_scope(p_actor_id);
  return public.af_finalize_research_failure(
    p_actor_id, p_lease, p_idempotency_key, p_failure, p_execution, 'FAIL'
  );
end;
$function$;

create function public.af_release_research_job_v1(
  p_actor_id uuid,
  p_lease jsonb,
  p_idempotency_key text,
  p_failure jsonb,
  p_execution jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, public, auth
as $function$
begin
  perform public.af_assert_actor_scope(p_actor_id);
  return public.af_finalize_research_failure(
    p_actor_id, p_lease, p_idempotency_key, p_failure, p_execution, 'RELEASE'
  );
end;
$function$;

-- ---------------------------------------------------------------------------
-- Re-apply the server-only default-deny boundary after additive objects
-- ---------------------------------------------------------------------------

do $security$
declare
  table_record record;
  function_record record;
begin
  for table_record in
    select schemaname, tablename
    from pg_catalog.pg_tables
    where schemaname = 'public' and tablename like 'af\_%' escape '\'
  loop
    execute format(
      'alter table %I.%I enable row level security',
      table_record.schemaname, table_record.tablename
    );
    execute format(
      'alter table %I.%I force row level security',
      table_record.schemaname, table_record.tablename
    );
    execute format(
      'revoke all on table %I.%I from public, anon, authenticated',
      table_record.schemaname, table_record.tablename
    );
    execute format(
      'grant all on table %I.%I to service_role',
      table_record.schemaname, table_record.tablename
    );
  end loop;

  for function_record in
    select namespace.nspname as schema_name,
      procedure.proname as function_name,
      pg_catalog.pg_get_function_identity_arguments(procedure.oid) as arguments
    from pg_catalog.pg_proc procedure
    join pg_catalog.pg_namespace namespace
      on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'public'
      and procedure.proname like 'af\_%' escape '\'
  loop
    execute format(
      'revoke all on function %I.%I(%s) from public, anon, authenticated',
      function_record.schema_name, function_record.function_name,
      function_record.arguments
    );
    execute format(
      'grant execute on function %I.%I(%s) to service_role',
      function_record.schema_name, function_record.function_name,
      function_record.arguments
    );
  end loop;
end;
$security$;

-- These helpers are callable only from the SECURITY DEFINER RPCs. In
-- particular, the service role cannot bypass lease fencing to persist output
-- or choose an internal failure mutation kind directly.
revoke all on function public.af_append_research_event_v1(
  uuid, public.af_research_domain_event_type, bigint, timestamptz, jsonb
) from public, anon, authenticated, service_role;
revoke all on function public.af_persist_research_stage_result(
  uuid, uuid, uuid, public.af_research_stage, public.af_sha256, uuid, jsonb,
  timestamptz
) from public, anon, authenticated, service_role;
revoke all on function public.af_finalize_research_failure(
  uuid, jsonb, text, jsonb, jsonb, text
) from public, anon, authenticated, service_role;

comment on function public.af_reserve_research_run_start_v1(uuid, text, text, integer) is
  'Server-only actor-scoped expiring reservation acquired before specialist planning.';
comment on function public.af_release_research_run_start_reservation_v1(uuid, text, text, uuid) is
  'Server-only token-matched release for unsuccessful research-run staging.';
comment on function public.af_commit_research_run_start_v1(uuid, text, text, uuid, bigint, jsonb) is
  'Server-only atomic run, plan, seven-job, semantic-event, outbox, and immutable replay commit.';
comment on function public.af_claim_research_job_v1(
  uuid, uuid, uuid, public.af_research_stage, bigint, bigint, text, text,
  uuid, text, jsonb, integer
) is
  'Server-only actor-scoped claim that durably inserts the RUNNING attempt and lease before external work.';
comment on function public.af_heartbeat_research_job_v1(
  uuid, jsonb, integer, timestamptz
) is
  'Server-only token-fenced lease renewal with optimistic run, job, and attempt versions.';
comment on function public.af_checkpoint_research_job_v1(
  uuid, jsonb, jsonb, integer
) is
  'Server-only idempotent body-free attempt checkpoint; no source or model body is accepted.';
comment on function public.af_complete_research_job_v1(
  uuid, jsonb, text, jsonb, text, jsonb
) is
  'Server-only token-fenced transactional output, attempt, job, run, event, and outbox completion.';
comment on function public.af_fail_research_job_v1(
  uuid, jsonb, text, jsonb, jsonb
) is
  'Server-only token-fenced redacted failure, bounded retry, terminal-run, event, and outbox transition.';
comment on function public.af_release_research_job_v1(
  uuid, jsonb, text, jsonb, jsonb
) is
  'Server-only voluntary same-attempt handoff with bounded reclaim; terminal fail-closed is returned when safe handoff is exhausted.';
