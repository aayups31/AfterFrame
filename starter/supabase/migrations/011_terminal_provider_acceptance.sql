-- AFTERFRAME checkpoint 04B: crash-safe synchronous terminal acceptance.
--
-- A background provider may reach a terminal state before its start call
-- returns. The response identity must still commit with PROVIDER_ACCEPTED so a
-- crash cannot lose accepted paid work or authorize replacement work.

alter table public.af_research_provider_runs
  drop constraint af_provider_runs_state_check;

alter table public.af_research_provider_runs
  add constraint af_provider_runs_state_check check (
    state in (
      'QUEUED', 'IN_PROGRESS', 'COMPLETED',
      'FAILED', 'INCOMPLETE', 'CANCELLED'
    )
  );

create or replace function public.af_research_provider_run_record_valid_v1(
  value_to_check jsonb
)
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
    and value_to_check->>'state' in (
      'QUEUED', 'IN_PROGRESS', 'COMPLETED',
      'FAILED', 'INCOMPLETE', 'CANCELLED'
    )
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

comment on constraint af_provider_runs_state_check
  on public.af_research_provider_runs is
  'Accepted response identity is recoverable in pending or synchronous terminal state.';

comment on function public.af_research_provider_run_record_valid_v1(jsonb) is
  'Validates exact body-free provider recovery metadata, including synchronous terminal acceptance.';
