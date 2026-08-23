-- AFTERFRAME checkpoint 04B: actor-scoped provider takeover recovery.

create function public.af_get_research_provider_run_v1(
  p_actor_id uuid,
  p_run_id uuid,
  p_job_id uuid,
  p_attempt_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, auth
as $function$
declare
  provider_row public.af_research_provider_runs%rowtype;
  checkpoint_row public.af_research_attempt_checkpoints%rowtype;
begin
  perform public.af_assert_actor_scope(p_actor_id);
  select stored_provider.* into provider_row
  from public.af_research_provider_runs stored_provider
  join public.af_research_runs stored_run
    on stored_run.id = stored_provider.run_id
  join public.af_cases stored_case
    on stored_case.id = stored_run.case_id
  join public.af_research_jobs stored_job
    on stored_job.id = stored_provider.job_id
    and stored_job.run_id = stored_provider.run_id
  join public.af_research_attempts stored_attempt
    on stored_attempt.id = stored_provider.attempt_id
    and stored_attempt.run_id = stored_provider.run_id
    and stored_attempt.job_id = stored_provider.job_id
  where stored_provider.run_id = p_run_id
    and stored_provider.job_id = p_job_id
    and stored_provider.attempt_id = p_attempt_id
    and stored_case.owner_id = p_actor_id
    and stored_job.stage = 'DISCOVERY'
    and stored_job.status = 'RUNNING'
    and stored_job.active_attempt_id = stored_attempt.id
    and stored_attempt.status = 'RUNNING';
  if not found then return null; end if;

  select stored_checkpoint.* into checkpoint_row
  from public.af_research_attempt_checkpoints stored_checkpoint
  where stored_checkpoint.run_id = provider_row.run_id
    and stored_checkpoint.job_id = provider_row.job_id
    and stored_checkpoint.attempt_id = provider_row.attempt_id
    and stored_checkpoint.kind = 'PROVIDER_ACCEPTED'
    and stored_checkpoint.provider_run_id = provider_row.provider_response_id;
  if not found then
    raise exception using errcode = 'AFR07', message = 'Accepted provider recovery state lacks its durable checkpoint';
  end if;
  return public.af_research_provider_run_record_json_v1(provider_row);
end;
$function$;

revoke all on function public.af_get_research_provider_run_v1(
  uuid, uuid, uuid, uuid
) from public, anon, authenticated, service_role;
grant execute on function public.af_get_research_provider_run_v1(
  uuid, uuid, uuid, uuid
) to service_role;

comment on function public.af_get_research_provider_run_v1(
  uuid, uuid, uuid, uuid
) is
  'Service-only actor-scoped recovery reader for one active DISCOVERY attempt with an exact PROVIDER_ACCEPTED checkpoint.';
