-- AFTERFRAME checkpoint-03 deployed-runtime correction.
--
-- PostgreSQL parses CURRENT_TIME as a reserved SQL value (timetz) inside
-- embedded statements. Checkpoint 03 originally used current_time as a
-- PL/pgSQL timestamptz variable, so otherwise-valid RPCs failed at runtime.
-- This forward-only migration replaces only the six affected functions with
-- the unambiguous observed_at variable. It changes no tables or durable data.

create or replace function public.af_reserve_research_run_start_v1(
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

create or replace function public.af_claim_research_job_v1(
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

create or replace function public.af_heartbeat_research_job_v1(
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

create or replace function public.af_checkpoint_research_job_v1(
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

create or replace function public.af_complete_research_job_v1(
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

create or replace function public.af_finalize_research_failure(
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

-- Reassert the checkpoint-03 server-only execution boundary. CREATE OR
-- REPLACE normally preserves ACLs, but this is deliberately explicit so a
-- partially altered deployment cannot retain client execution.
revoke all on function public.af_reserve_research_run_start_v1(
  uuid, text, text, integer
) from public, anon, authenticated;
grant execute on function public.af_reserve_research_run_start_v1(
  uuid, text, text, integer
) to service_role;

revoke all on function public.af_claim_research_job_v1(
  uuid, uuid, uuid, public.af_research_stage, bigint, bigint, text, text,
  uuid, text, jsonb, integer
) from public, anon, authenticated;
grant execute on function public.af_claim_research_job_v1(
  uuid, uuid, uuid, public.af_research_stage, bigint, bigint, text, text,
  uuid, text, jsonb, integer
) to service_role;

revoke all on function public.af_heartbeat_research_job_v1(
  uuid, jsonb, integer, timestamptz
) from public, anon, authenticated;
grant execute on function public.af_heartbeat_research_job_v1(
  uuid, jsonb, integer, timestamptz
) to service_role;

revoke all on function public.af_checkpoint_research_job_v1(
  uuid, jsonb, jsonb, integer
) from public, anon, authenticated;
grant execute on function public.af_checkpoint_research_job_v1(
  uuid, jsonb, jsonb, integer
) to service_role;

revoke all on function public.af_complete_research_job_v1(
  uuid, jsonb, text, jsonb, text, jsonb
) from public, anon, authenticated;
grant execute on function public.af_complete_research_job_v1(
  uuid, jsonb, text, jsonb, text, jsonb
) to service_role;

-- Internal transaction helper: only its SECURITY DEFINER callers may invoke
-- it. The service role must not choose an internal mutation kind directly.
revoke all on function public.af_finalize_research_failure(
  uuid, jsonb, text, jsonb, jsonb, text
) from public, anon, authenticated, service_role;
