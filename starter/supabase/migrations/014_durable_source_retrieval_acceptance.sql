-- AFTERFRAME checkpoint 04D.2: lease-fenced hostile-source retrieval ledger.
--
-- Retrieval receipts retain exact DISCOVERY candidate and RESOLUTION lineage.
-- Bytes remain untrusted with no instruction/publication authority. LINK_ONLY
-- content may be fingerprinted transiently but can never receive storage_ref.

-- NORMALIZATION content must reference the original DISCOVERY candidate; it
-- must not pretend that candidate was created by the normalization attempt.
alter table public.af_source_candidates
  add constraint af_source_candidates_run_id_unique unique (run_id, id);

alter table public.af_untrusted_research_content
  drop constraint af_untrusted_content_candidate_fk;

alter table public.af_untrusted_research_content
  add constraint af_untrusted_content_candidate_fk
  foreign key (run_id, candidate_id)
  references public.af_source_candidates(run_id, id) on delete cascade;

create table public.af_source_retrieval_records (
  schema_version smallint not null check (schema_version = 1),
  id uuid primary key,
  run_id uuid not null,
  job_id uuid not null,
  attempt_id uuid not null,
  case_id uuid not null,
  manifest_fingerprint public.af_sha256 not null,
  resolution_record_id uuid not null,
  candidate_id uuid not null,
  source_id uuid not null,
  source_locator_id uuid not null,
  snapshot_id uuid,
  idempotency_key public.af_opaque_reference not null,
  policy_id public.af_slug not null,
  policy_version public.af_version_tag not null,
  retriever_id public.af_slug not null,
  retriever_version public.af_version_tag not null,
  status text not null check (status in ('RETRIEVED', 'UNAVAILABLE')),
  failure_code text,
  retention text check (retention in ('TRANSIENT_ONLY', 'RETAINABLE')),
  storage_ref public.af_opaque_reference,
  content_fingerprint public.af_sha256,
  retrieval_fingerprint public.af_sha256 not null,
  trust_boundary text not null check (trust_boundary = 'UNTRUSTED_SOURCE_DATA'),
  instruction_authority text not null check (instruction_authority = 'NONE'),
  screening_state public.af_screening_state not null,
  publication_authority text not null check (publication_authority = 'NONE'),
  record_json jsonb not null check (jsonb_typeof(record_json) = 'object'),
  created_at timestamptz not null,
  accepted_at timestamptz not null,
  constraint af_source_retrieval_attempt_fk
    foreign key (run_id, job_id, attempt_id)
    references public.af_research_attempts(run_id, job_id, id) on delete cascade,
  constraint af_source_retrieval_run_case_fk
    foreign key (run_id, case_id)
    references public.af_research_runs(id, case_id) on delete cascade,
  constraint af_source_retrieval_candidate_fk
    foreign key (run_id, candidate_id)
    references public.af_source_candidates(run_id, id) on delete cascade,
  constraint af_source_retrieval_resolution_fk
    foreign key (resolution_record_id)
    references public.af_source_resolution_records(id) on delete cascade,
  constraint af_source_retrieval_source_locator_fk
    foreign key (source_id, source_locator_id)
    references public.af_source_locators(source_id, id),
  constraint af_source_retrieval_snapshot_fk
    foreign key (source_id, snapshot_id)
    references public.af_source_snapshots(source_id, id),
  constraint af_source_retrieval_partition_check check (
    (
      status = 'RETRIEVED' and failure_code is null and snapshot_id is not null
      and retention is not null and content_fingerprint is not null
      and (
        (retention = 'TRANSIENT_ONLY' and storage_ref is null)
        or (retention = 'RETAINABLE' and storage_ref is not null)
      )
    ) or (
      status = 'UNAVAILABLE' and failure_code in (
        'retrieval-disabled', 'retrieval-aborted', 'retrieval-timeout',
        'retrieval-network-rejected', 'retrieval-redirect-invalid',
        'retrieval-access-changed', 'retrieval-content-encoding-rejected',
        'retrieval-content-type-rejected', 'retrieval-size-exceeded',
        'retrieval-content-signature-mismatch',
        'retrieval-upstream-unavailable', 'retrieval-contract-invalid'
      ) and snapshot_id is null and retention is null and storage_ref is null
        and content_fingerprint is null
    )
  ),
  constraint af_source_retrieval_time_check check (accepted_at >= created_at),
  unique (attempt_id, candidate_id),
  unique (attempt_id, idempotency_key)
);

comment on table public.af_source_retrieval_records is
  'Lease-fenced hostile-source retrieval decisions. Receipts and snapshots have instruction/publication authority NONE and are not evidence.';

create function public.af_source_retrieval_record_valid_v1(value_to_check jsonb)
returns boolean
language plpgsql
immutable
set search_path = pg_catalog, public
as $function$
declare
  result_json jsonb;
  receipt_json jsonb;
begin
  if not public.af_jsonb_has_exact_keys(
    value_to_check,
    array[
      'schemaVersion', 'id', 'runId', 'jobId', 'attemptId', 'caseId',
      'manifestFingerprint', 'resolutionRecordId', 'idempotencyKey',
      'policy', 'retriever', 'result', 'createdAt'
    ]
  ) or not public.af_jsonb_has_exact_keys(
    value_to_check->'policy', array['id', 'version']
  ) or not public.af_jsonb_has_exact_keys(
    value_to_check->'retriever', array['id', 'version']
  ) then return false; end if;
  perform (value_to_check->>'id')::uuid;
  perform (value_to_check->>'runId')::uuid;
  perform (value_to_check->>'jobId')::uuid;
  perform (value_to_check->>'attemptId')::uuid;
  perform (value_to_check->>'caseId')::uuid;
  perform (value_to_check->>'manifestFingerprint')::public.af_sha256;
  perform (value_to_check->>'resolutionRecordId')::uuid;
  perform (value_to_check->>'idempotencyKey')::public.af_opaque_reference;
  perform (value_to_check#>>'{policy,id}')::public.af_slug;
  perform (value_to_check#>>'{policy,version}')::public.af_version_tag;
  perform (value_to_check#>>'{retriever,id}')::public.af_slug;
  perform (value_to_check#>>'{retriever,version}')::public.af_version_tag;
  perform (value_to_check->>'createdAt')::timestamptz;
  if (value_to_check->>'schemaVersion')::integer <> 1 then return false; end if;
  result_json := value_to_check->'result';
  if result_json->>'status' = 'UNAVAILABLE' then
    return public.af_jsonb_has_exact_keys(
      result_json,
      array[
        'status', 'candidateId', 'sourceId', 'sourceLocatorId', 'code',
        'instructionAuthority', 'publicationAuthority'
      ]
    ) and (result_json->>'candidateId')::uuid is not null
      and (result_json->>'sourceId')::uuid is not null
      and (result_json->>'sourceLocatorId')::uuid is not null
      and result_json->>'code' in (
        'retrieval-disabled', 'retrieval-aborted', 'retrieval-timeout',
        'retrieval-network-rejected', 'retrieval-redirect-invalid',
        'retrieval-access-changed', 'retrieval-content-encoding-rejected',
        'retrieval-content-type-rejected', 'retrieval-size-exceeded',
        'retrieval-content-signature-mismatch',
        'retrieval-upstream-unavailable', 'retrieval-contract-invalid'
      ) and result_json->>'instructionAuthority' = 'NONE'
        and result_json->>'publicationAuthority' = 'NONE';
  end if;
  if result_json->>'status' <> 'RETRIEVED'
    or not public.af_jsonb_has_exact_keys(result_json, array['status', 'receipt'])
  then return false; end if;
  receipt_json := result_json->'receipt';
  if not public.af_jsonb_has_exact_keys(
    receipt_json,
    array[
      'schemaVersion', 'id', 'snapshotId', 'runId', 'candidateId',
      'sourceId', 'sourceLocatorId', 'requestedUrl', 'finalUrl',
      'redirectChainFingerprint', 'declaredMediaType', 'verifiedMediaType',
      'wireContentLength', 'decodedContentLength', 'contentFingerprint',
      'retention', 'storageRef', 'accessState', 'rightsState',
      'trustBoundary', 'instructionAuthority', 'screeningState',
      'publicationAuthority', 'retriever', 'capturedAt'
    ]
  ) or not public.af_jsonb_has_exact_keys(
    receipt_json->'retriever', array['id', 'version']
  ) then return false; end if;
  perform (receipt_json->>'id')::uuid;
  perform (receipt_json->>'snapshotId')::uuid;
  perform (receipt_json->>'runId')::uuid;
  perform (receipt_json->>'candidateId')::uuid;
  perform (receipt_json->>'sourceId')::uuid;
  perform (receipt_json->>'sourceLocatorId')::uuid;
  perform (receipt_json->>'requestedUrl')::public.af_http_url;
  perform (receipt_json->>'finalUrl')::public.af_http_url;
  perform (receipt_json->>'redirectChainFingerprint')::public.af_sha256;
  perform (receipt_json->>'contentFingerprint')::public.af_sha256;
  perform (receipt_json->>'accessState')::public.af_access_state;
  perform (receipt_json->>'rightsState')::public.af_rights_state;
  perform (receipt_json->>'screeningState')::public.af_screening_state;
  perform (receipt_json#>>'{retriever,id}')::public.af_slug;
  perform (receipt_json#>>'{retriever,version}')::public.af_version_tag;
  perform (receipt_json->>'capturedAt')::timestamptz;
  return (receipt_json->>'schemaVersion')::integer = 1
    and (receipt_json->>'wireContentLength')::bigint between 0 and 50000000
    and (receipt_json->>'decodedContentLength')::bigint between 0 and 100000000
    and receipt_json->>'verifiedMediaType' = btrim(receipt_json->>'verifiedMediaType')
    and char_length(receipt_json->>'verifiedMediaType') between 1 and 200
    and (receipt_json->'declaredMediaType' = 'null'::jsonb or (
      receipt_json->>'declaredMediaType' = btrim(receipt_json->>'declaredMediaType')
      and char_length(receipt_json->>'declaredMediaType') between 1 and 200
    ))
    and receipt_json->>'runId' = value_to_check->>'runId'
    and receipt_json#>>'{retriever,id}' = value_to_check#>>'{retriever,id}'
    and receipt_json#>>'{retriever,version}' = value_to_check#>>'{retriever,version}'
    and receipt_json->>'accessState' = 'OPEN'
    and receipt_json->>'rightsState' in (
      'LINK_ONLY', 'PERMITTED', 'USER_OWNED', 'PUBLIC_DOMAIN', 'LICENSED'
    )
    and receipt_json->>'trustBoundary' = 'UNTRUSTED_SOURCE_DATA'
    and receipt_json->>'instructionAuthority' = 'NONE'
    and receipt_json->>'screeningState' = 'UNSCREENED'
    and receipt_json->>'publicationAuthority' = 'NONE'
    and (
      (receipt_json->>'retention' = 'TRANSIENT_ONLY'
        and receipt_json->'storageRef' = 'null'::jsonb)
      or (receipt_json->>'retention' = 'RETAINABLE'
        and receipt_json->'storageRef' <> 'null'::jsonb
        and (receipt_json->>'storageRef')::public.af_opaque_reference is not null)
    )
    and (receipt_json->>'rightsState' <> 'LINK_ONLY'
      or receipt_json->>'retention' = 'TRANSIENT_ONLY');
exception
  when invalid_text_representation or check_violation
    or numeric_value_out_of_range or datetime_field_overflow then return false;
end;
$function$;

create function public.af_source_retrieval_record_json_v1(
  retrieval_row public.af_source_retrieval_records
)
returns jsonb
language sql
stable
set search_path = pg_catalog
as $function$
  select retrieval_row.record_json || jsonb_build_object(
    'retrievalFingerprint', retrieval_row.retrieval_fingerprint,
    'acceptedAt', retrieval_row.accepted_at
  );
$function$;

create function public.af_get_normalization_retrieval_context_v1(
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
  run_row public.af_research_runs%rowtype;
  job_row public.af_research_jobs%rowtype;
  attempt_row public.af_research_attempts%rowtype;
  manifest_row public.af_research_attempt_input_manifests%rowtype;
  sources_json jsonb;
begin
  perform public.af_assert_actor_scope(p_actor_id);
  select stored_run.* into run_row
  from public.af_research_runs stored_run
  join public.af_cases stored_case on stored_case.id = stored_run.case_id
  where stored_run.id = p_run_id and stored_case.owner_id = p_actor_id;
  if not found then return null; end if;
  select * into job_row from public.af_research_jobs
  where id = p_job_id and run_id = run_row.id and stage = 'NORMALIZATION';
  select * into attempt_row from public.af_research_attempts
  where id = p_attempt_id and run_id = run_row.id and job_id = job_row.id;
  select * into manifest_row from public.af_research_attempt_input_manifests
  where attempt_id = attempt_row.id;
  if job_row.id is null or attempt_row.id is null or manifest_row.id is null
    or job_row.status <> 'RUNNING' or job_row.active_attempt_id <> attempt_row.id
    or attempt_row.status <> 'RUNNING' then return null; end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'candidate', jsonb_build_object(
      'schemaVersion', candidate.schema_version,
      'id', candidate.id, 'runId', candidate.run_id,
      'jobId', candidate.job_id, 'attemptId', candidate.attempt_id,
      'candidateKey', candidate.candidate_key, 'title', candidate.title,
      'canonicalUrl', candidate.canonical_url, 'medium', candidate.medium,
      'sourceClass', candidate.source_class, 'axisIds', candidate.axis_ids,
      'accessState', candidate.access_state, 'rightsState', candidate.rights_state,
      'discoveryInputFingerprint', candidate.discovery_input_fingerprint,
      'contentTrust', candidate.content_trust,
      'evidenceStatus', candidate.evidence_status,
      'reviewState', candidate.review_state,
      'publicationAuthority', candidate.publication_authority,
      'createdAt', candidate.created_at
    ),
    'resolutionRecordId', resolution.id,
    'resolutionFingerprint', resolution.resolution_fingerprint,
    'source', resolution.record_json#>'{result,proposal,source}',
    'locator', resolution.record_json#>'{result,proposal,locator}'
  ) order by candidate.id), '[]'::jsonb) into sources_json
  from public.af_source_resolution_records resolution
  join public.af_source_candidates candidate
    on candidate.run_id = resolution.run_id and candidate.id = resolution.candidate_id
  join public.af_research_jobs resolution_job
    on resolution_job.run_id = resolution.run_id
    and resolution_job.id = resolution.job_id
    and resolution_job.stage = 'RESOLUTION'
    and resolution_job.active_attempt_id = resolution.attempt_id
    and resolution_job.status in ('SUCCEEDED', 'DEGRADED')
  where resolution.run_id = run_row.id and resolution.status = 'RESOLVED';

  return jsonb_build_object(
    'schemaVersion', 1, 'runId', run_row.id, 'jobId', job_row.id,
    'attemptId', attempt_row.id, 'caseId', run_row.case_id,
    'manifestFingerprint', manifest_row.manifest_fingerprint,
    'sources', sources_json
  );
end;
$function$;

create function public.af_get_source_retrieval_records_v1(
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
  records_json jsonb;
begin
  perform public.af_assert_actor_scope(p_actor_id);
  if not exists (
    select 1 from public.af_research_runs run
    join public.af_cases stored_case on stored_case.id = run.case_id
    join public.af_research_jobs job on job.run_id = run.id
    join public.af_research_attempts attempt
      on attempt.run_id = run.id and attempt.job_id = job.id
    where run.id = p_run_id and stored_case.owner_id = p_actor_id
      and job.id = p_job_id and attempt.id = p_attempt_id
      and job.stage = 'NORMALIZATION'
  ) then return null; end if;
  select coalesce(jsonb_agg(
    public.af_source_retrieval_record_json_v1(record)
    order by record.accepted_at, record.id
  ), '[]'::jsonb) into records_json
  from public.af_source_retrieval_records record
  where record.run_id = p_run_id and record.job_id = p_job_id
    and record.attempt_id = p_attempt_id;
  return records_json;
end;
$function$;

create function public.af_accept_source_retrieval_v1(
  p_actor_id uuid,
  p_lease jsonb,
  p_record jsonb,
  p_lease_seconds integer
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, public, auth
as $function$
declare
  observed_at timestamptz := clock_timestamp();
  mutation_time timestamptz;
  run_row public.af_research_runs%rowtype;
  job_row public.af_research_jobs%rowtype;
  attempt_row public.af_research_attempts%rowtype;
  lease_row public.af_research_job_leases%rowtype;
  manifest_row public.af_research_attempt_input_manifests%rowtype;
  candidate_row public.af_source_candidates%rowtype;
  resolution_row public.af_source_resolution_records%rowtype;
  source_row public.af_sources%rowtype;
  locator_row public.af_source_locators%rowtype;
  snapshot_row public.af_source_snapshots%rowtype;
  existing_snapshot public.af_source_snapshots%rowtype;
  stored_retrieval public.af_source_retrieval_records%rowtype;
  result_json jsonb := p_record->'result';
  receipt_json jsonb;
  candidate_id_value uuid;
  source_id_value uuid;
  locator_id_value uuid;
  retrieval_fingerprint_value public.af_sha256;
begin
  perform public.af_assert_actor_scope(p_actor_id);
  if p_lease_seconds not between 5 and 900
    or not public.af_research_lease_cursor_valid(p_lease)
    or not public.af_source_retrieval_record_valid_v1(p_record) then
    raise exception using errcode = 'AFR04', message = 'Invalid source-retrieval acceptance input';
  end if;
  receipt_json := case when result_json->>'status' = 'RETRIEVED'
    then result_json->'receipt' else null end;
  candidate_id_value := (case when receipt_json is null
    then result_json->>'candidateId' else receipt_json->>'candidateId' end)::uuid;
  source_id_value := (case when receipt_json is null
    then result_json->>'sourceId' else receipt_json->>'sourceId' end)::uuid;
  locator_id_value := (case when receipt_json is null
    then result_json->>'sourceLocatorId' else receipt_json->>'sourceLocatorId' end)::uuid;
  if p_lease->>'runId' is distinct from p_record->>'runId'
    or p_lease->>'jobId' is distinct from p_record->>'jobId'
    or p_lease->>'attemptId' is distinct from p_record->>'attemptId' then
    raise exception using errcode = 'AFR04', message = 'Source retrieval does not match the active lease';
  end if;

  select stored_run.* into run_row
  from public.af_research_runs stored_run
  join public.af_cases stored_case on stored_case.id = stored_run.case_id
  where stored_run.id = (p_record->>'runId')::uuid
    and stored_case.owner_id = p_actor_id for update of stored_run;
  if not found then
    raise exception using errcode = 'AFR05', message = 'Actor scope mismatch or record not found';
  end if;
  select * into job_row from public.af_research_jobs
  where id = (p_record->>'jobId')::uuid and run_id = run_row.id for update;
  select * into attempt_row from public.af_research_attempts
  where id = (p_record->>'attemptId')::uuid and run_id = run_row.id
    and job_id = job_row.id for update;
  select * into lease_row from public.af_research_job_leases
  where attempt_id = attempt_row.id for update;
  select * into manifest_row from public.af_research_attempt_input_manifests
  where attempt_id = attempt_row.id for share;
  select * into candidate_row from public.af_source_candidates
  where run_id = run_row.id and id = candidate_id_value for share;
  select * into resolution_row from public.af_source_resolution_records
  where id = (p_record->>'resolutionRecordId')::uuid
    and run_id = run_row.id and candidate_id = candidate_id_value
    and status = 'RESOLVED' and source_id = source_id_value
    and locator_id = locator_id_value for share;
  select * into source_row from public.af_sources
  where id = source_id_value for share;
  select * into locator_row from public.af_source_locators
  where id = locator_id_value and source_id = source_id_value for share;
  if job_row.id is null or attempt_row.id is null or lease_row.attempt_id is null
    or manifest_row.id is null or candidate_row.id is null
    or resolution_row.id is null or source_row.id is null or locator_row.id is null then
    raise exception using errcode = 'AFR05', message = 'Actor scope mismatch or record not found';
  end if;
  if run_row.status = 'CANCELLED' or job_row.status = 'CANCELLED'
    or attempt_row.status = 'CANCELLED' then
    return jsonb_build_object('status', 'CANCELLED');
  end if;
  if not public.af_research_lease_cursor_matches(
      p_lease, lease_row, run_row, job_row, attempt_row
    ) or lease_row.released_at is not null
    or lease_row.lease_expires_at <= observed_at
    or job_row.status <> 'RUNNING' or job_row.stage <> 'NORMALIZATION'
    or job_row.active_attempt_id <> attempt_row.id
    or attempt_row.status <> 'RUNNING' then
    return jsonb_build_object('status', 'LEASE_LOST');
  end if;
  if run_row.case_id <> (p_record->>'caseId')::uuid
    or manifest_row.manifest_fingerprint::text
      is distinct from p_record->>'manifestFingerprint'
    or not attempt_row.private_content_included
    or (p_record->>'createdAt')::timestamptz < attempt_row.started_at
    or (p_record->>'createdAt')::timestamptz > observed_at + interval '5 minutes' then
    raise exception using errcode = 'AFR07', message = 'Source retrieval does not match authoritative attempt input';
  end if;

  retrieval_fingerprint_value := public.af_canonical_jsonb_sha256_v1(
    'source-retrieval-record', p_record
  );
  select * into stored_retrieval
  from public.af_source_retrieval_records
  where attempt_id = attempt_row.id and candidate_id = candidate_row.id
  for update;
  if found then
    if stored_retrieval.retrieval_fingerprint is distinct from retrieval_fingerprint_value
      or stored_retrieval.record_json is distinct from p_record then
      raise exception using errcode = 'AFR02', message = 'Candidate retrieval already identifies a different decision';
    end if;
    mutation_time := greatest(observed_at, stored_retrieval.accepted_at);
    update public.af_research_job_leases
    set last_heartbeat_at = mutation_time,
        lease_expires_at = mutation_time + make_interval(secs => p_lease_seconds)
    where attempt_id = attempt_row.id and lease_token = lease_row.lease_token
    returning * into lease_row;
    return jsonb_build_object(
      'status', 'REPLAY',
      'lease', public.af_research_lease_cursor_json(
        lease_row, run_row.aggregate_version, job_row.aggregate_version,
        attempt_row.aggregate_version, attempt_row.request_fingerprint
      ),
      'record', public.af_source_retrieval_record_json_v1(stored_retrieval)
    );
  end if;

  if result_json->>'status' = 'RETRIEVED' then
    if receipt_json->>'runId' is distinct from run_row.id::text
      or receipt_json->>'requestedUrl' is distinct from source_row.canonical_url::text
      or receipt_json->>'sourceId' is distinct from source_row.id::text
      or receipt_json->>'sourceLocatorId' is distinct from locator_row.id::text
      or receipt_json->>'accessState' is distinct from source_row.access_state::text
      or receipt_json->>'rightsState' is distinct from source_row.rights_state::text
      or receipt_json->>'screeningState' <> 'UNSCREENED'
      or (receipt_json->>'capturedAt')::timestamptz < attempt_row.started_at
      or (receipt_json->>'capturedAt')::timestamptz > observed_at + interval '5 minutes'
      or (source_row.rights_state = 'LINK_ONLY' and (
        receipt_json->>'retention' <> 'TRANSIENT_ONLY'
        or receipt_json->'storageRef' <> 'null'::jsonb
      )) then
      raise exception using errcode = 'AFR07', message = 'Retrieval receipt violates resolved source authority';
    end if;

    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
      run_row.case_id::text || ':' || source_row.id::text || ':' ||
        receipt_json->>'contentFingerprint', 0
    ));
    select * into existing_snapshot from public.af_source_snapshots
    where case_id = run_row.case_id and source_id = source_row.id
      and content_fingerprint::text = receipt_json->>'contentFingerprint'
    for update;
    if found and existing_snapshot.id <> (receipt_json->>'snapshotId')::uuid then
      raise exception using errcode = 'AFR02', message = 'Content fingerprint already identifies another snapshot';
    end if;
    select * into snapshot_row from public.af_source_snapshots
    where id = (receipt_json->>'snapshotId')::uuid for update;
    if found then
      if snapshot_row.source_id <> source_row.id
        or snapshot_row.case_id <> run_row.case_id
        or snapshot_row.content_fingerprint::text <> receipt_json->>'contentFingerprint'
        or snapshot_row.content_length <> (receipt_json->>'decodedContentLength')::bigint
        or snapshot_row.extraction_method <> 'RESOLVER'
        or snapshot_row.storage_ref::text is distinct from receipt_json->>'storageRef'
        or snapshot_row.access_state::text <> receipt_json->>'accessState'
        or snapshot_row.rights_state::text <> receipt_json->>'rightsState'
        or snapshot_row.captured_at <> (receipt_json->>'capturedAt')::timestamptz
        or snapshot_row.created_by_run_id <> run_row.id
        or snapshot_row.origin_kind <> 'RESOLVER'
        or snapshot_row.origin_version::text <> p_record#>>'{retriever,version}' then
        raise exception using errcode = 'AFR02', message = 'Snapshot identifier conflicts with immutable content';
      end if;
    else
      insert into public.af_source_snapshots (
        id, source_id, case_id, content_fingerprint, content_length,
        extraction_method, storage_ref, access_state, rights_state,
        captured_at, created_by_run_id, origin_kind, origin_actor_id,
        origin_version
      ) values (
        (receipt_json->>'snapshotId')::uuid, source_row.id, run_row.case_id,
        receipt_json->>'contentFingerprint',
        (receipt_json->>'decodedContentLength')::bigint, 'RESOLVER',
        receipt_json->>'storageRef',
        (receipt_json->>'accessState')::public.af_access_state,
        (receipt_json->>'rightsState')::public.af_rights_state,
        (receipt_json->>'capturedAt')::timestamptz, run_row.id,
        'RESOLVER', null, p_record#>>'{retriever,version}'
      ) returning * into snapshot_row;
    end if;
  end if;

  insert into public.af_source_retrieval_records (
    schema_version, id, run_id, job_id, attempt_id, case_id,
    manifest_fingerprint, resolution_record_id, candidate_id, source_id,
    source_locator_id, snapshot_id, idempotency_key, policy_id,
    policy_version, retriever_id, retriever_version, status, failure_code,
    retention, storage_ref, content_fingerprint, retrieval_fingerprint,
    trust_boundary, instruction_authority, screening_state,
    publication_authority, record_json, created_at, accepted_at
  ) values (
    1, (p_record->>'id')::uuid, run_row.id, job_row.id, attempt_row.id,
    run_row.case_id, manifest_row.manifest_fingerprint, resolution_row.id,
    candidate_row.id, source_row.id, locator_row.id,
    case when receipt_json is null then null else (receipt_json->>'snapshotId')::uuid end,
    p_record->>'idempotencyKey', p_record#>>'{policy,id}',
    p_record#>>'{policy,version}', p_record#>>'{retriever,id}',
    p_record#>>'{retriever,version}', result_json->>'status',
    case when receipt_json is null then result_json->>'code' else null end,
    receipt_json->>'retention', receipt_json->>'storageRef',
    receipt_json->>'contentFingerprint', retrieval_fingerprint_value,
    'UNTRUSTED_SOURCE_DATA', 'NONE',
    case when receipt_json is null then 'UNSCREENED'
      else (receipt_json->>'screeningState')::public.af_screening_state end,
    'NONE', p_record, (p_record->>'createdAt')::timestamptz,
    greatest(observed_at, (p_record->>'createdAt')::timestamptz)
  ) returning * into stored_retrieval;

  mutation_time := greatest(observed_at, (p_record->>'createdAt')::timestamptz);
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
    'record', public.af_source_retrieval_record_json_v1(stored_retrieval)
  );
exception
  when unique_violation then
    raise exception using errcode = 'AFR03', message = 'Source retrieval conflicts with an existing identifier or idempotency key';
  when foreign_key_violation or check_violation or not_null_violation
    or invalid_text_representation or numeric_value_out_of_range then
    raise exception using errcode = 'AFR04', message = 'Source retrieval failed schema or reference invariants';
end;
$function$;

alter table public.af_source_retrieval_records enable row level security;
alter table public.af_source_retrieval_records force row level security;
revoke all on table public.af_source_retrieval_records
  from public, anon, authenticated;
grant all on table public.af_source_retrieval_records to service_role;

revoke all on function public.af_source_retrieval_record_valid_v1(jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.af_source_retrieval_record_json_v1(
  public.af_source_retrieval_records
) from public, anon, authenticated, service_role;
revoke all on function public.af_get_normalization_retrieval_context_v1(
  uuid, uuid, uuid, uuid
) from public, anon, authenticated, service_role;
revoke all on function public.af_get_source_retrieval_records_v1(
  uuid, uuid, uuid, uuid
) from public, anon, authenticated, service_role;
revoke all on function public.af_accept_source_retrieval_v1(
  uuid, jsonb, jsonb, integer
) from public, anon, authenticated, service_role;

grant execute on function public.af_get_normalization_retrieval_context_v1(
  uuid, uuid, uuid, uuid
) to service_role;
grant execute on function public.af_get_source_retrieval_records_v1(
  uuid, uuid, uuid, uuid
) to service_role;
grant execute on function public.af_accept_source_retrieval_v1(
  uuid, jsonb, jsonb, integer
) to service_role;

comment on function public.af_accept_source_retrieval_v1(
  uuid, jsonb, jsonb, integer
) is
  'Atomically accepts one hostile-source retrieval decision through the active NORMALIZATION lease and creates only an immutable, rights-constrained snapshot receipt with no evidence authority.';
