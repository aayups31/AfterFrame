-- AFTERFRAME checkpoint 04E: lease-fenced exact locator verification.
-- A verified locator is still untrusted source metadata and never evidence.

create table public.af_exact_locator_verification_records (
  schema_version smallint not null check (schema_version = 1),
  id uuid primary key,
  run_id uuid not null,
  job_id uuid not null,
  attempt_id uuid not null,
  case_id uuid not null,
  manifest_fingerprint public.af_sha256 not null,
  normalization_kind text not null check (normalization_kind in ('BYTE_DOCUMENT','PDF')),
  normalization_record_id uuid not null,
  target_block_ordinal integer not null check (target_block_ordinal between 0 and 99999),
  retrieval_record_id uuid not null,
  source_id uuid not null,
  previous_locator_id uuid not null,
  verified_locator_id uuid,
  idempotency_key public.af_opaque_reference not null,
  verifier_id public.af_slug not null,
  verifier_version public.af_version_tag not null,
  status public.af_locator_status not null check (status in ('VERIFIED_EXACT','UNAVAILABLE')),
  failure_code text,
  target_fingerprint public.af_sha256,
  verification_fingerprint public.af_sha256 not null,
  trust_boundary text not null check (trust_boundary = 'UNTRUSTED_SOURCE_DATA'),
  instruction_authority text not null check (instruction_authority = 'NONE'),
  evidence_status text not null check (evidence_status = 'NOT_EVIDENCE'),
  review_state public.af_review_state not null check (review_state = 'PROPOSED'),
  publication_authority text not null check (publication_authority = 'NONE'),
  record_json jsonb not null check (jsonb_typeof(record_json) = 'object'),
  created_at timestamptz not null,
  accepted_at timestamptz not null,
  constraint af_exact_locator_attempt_fk foreign key (run_id,job_id,attempt_id)
    references public.af_research_attempts(run_id,job_id,id) on delete cascade,
  constraint af_exact_locator_run_case_fk foreign key (run_id,case_id)
    references public.af_research_runs(id,case_id) on delete cascade,
  constraint af_exact_locator_retrieval_fk foreign key (retrieval_record_id)
    references public.af_source_retrieval_records(id) on delete cascade,
  constraint af_exact_locator_previous_fk foreign key (source_id,previous_locator_id)
    references public.af_source_locators(source_id,id),
  constraint af_exact_locator_verified_fk foreign key (source_id,verified_locator_id)
    references public.af_source_locators(source_id,id),
  constraint af_exact_locator_partition_check check (
    (status = 'VERIFIED_EXACT' and failure_code is null and verified_locator_id is not null
      and target_fingerprint is not null)
    or
    (status = 'UNAVAILABLE' and verified_locator_id is null and target_fingerprint is null
      and failure_code in (
        'locator-unsupported-medium','locator-source-mismatch','locator-normalization-mismatch',
        'locator-target-not-found','locator-target-mismatch','locator-document-quarantined',
        'locator-open-target-invalid','locator-reparse-failed','locator-contract-invalid'
      ))
  ),
  constraint af_exact_locator_time_check check (accepted_at >= created_at),
  constraint af_exact_locator_target_unique unique (
    attempt_id,normalization_kind,normalization_record_id,target_block_ordinal
  ),
  constraint af_exact_locator_idempotency_unique unique (attempt_id,idempotency_key)
);

comment on table public.af_exact_locator_verification_records is
  'Text-free exact-locator verification ledger. Verification does not grant evidence authority.';

create function public.af_exact_locator_target_valid_v1(target_json jsonb)
returns boolean language plpgsql immutable set search_path = pg_catalog, public
as $function$
declare anchor_json jsonb; page_object jsonb; box jsonb;
begin
  if target_json->>'kind' in ('ARTICLE','WEBPAGE') then
    return public.af_jsonb_has_exact_keys(target_json,array[
      'kind','documentFingerprint','blockOrdinal','paragraphIndex','textFingerprint',
      'sourceByteStart','sourceByteEnd','sourceRangeFingerprint','headingPathFingerprints'
    ]) and (target_json->>'documentFingerprint')::public.af_sha256 is not null
      and (target_json->>'blockOrdinal')::integer between 0 and 9999
      and (target_json->>'paragraphIndex')::integer >= 0
      and (target_json->>'textFingerprint')::public.af_sha256 is not null
      and (target_json->>'sourceByteStart')::bigint >= 0
      and (target_json->>'sourceByteEnd')::bigint > (target_json->>'sourceByteStart')::bigint
      and (target_json->>'sourceRangeFingerprint')::public.af_sha256 is not null
      and jsonb_typeof(target_json->'headingPathFingerprints') = 'array'
      and jsonb_array_length(target_json->'headingPathFingerprints') <= 20
      and not exists (select 1 from jsonb_array_elements_text(target_json->'headingPathFingerprints') value
        where value::public.af_sha256 is null);
  end if;
  if target_json->>'kind' <> 'PDF' or not public.af_jsonb_has_exact_keys(target_json,array[
    'kind','documentFingerprint','blockOrdinal','textFingerprint','pageStructureFingerprint','anchor'
  ]) or (target_json->>'documentFingerprint')::public.af_sha256 is null
    or (target_json->>'blockOrdinal')::integer not between 0 and 99999
    or (target_json->>'textFingerprint')::public.af_sha256 is null
    or (target_json->>'pageStructureFingerprint')::public.af_sha256 is null then return false; end if;
  anchor_json := target_json->'anchor';
  if not public.af_jsonb_has_exact_keys(anchor_json,array[
    'schemaVersion','pageNumber','pageObject','itemStart','itemEnd','boundingBox',
    'pageTextFingerprint','anchorFingerprint'
  ]) or (anchor_json->>'schemaVersion')::integer <> 1
    or (anchor_json->>'pageNumber')::integer <= 0
    or (anchor_json->>'itemStart')::integer < 0
    or (anchor_json->>'itemEnd')::integer <= (anchor_json->>'itemStart')::integer
    or (anchor_json->>'pageTextFingerprint')::public.af_sha256 is null
    or (anchor_json->>'anchorFingerprint')::public.af_sha256 is null then return false; end if;
  page_object := anchor_json->'pageObject';
  if page_object <> 'null'::jsonb and (not public.af_jsonb_has_exact_keys(page_object,array['objectNumber','generation'])
    or (page_object->>'objectNumber')::integer <= 0 or (page_object->>'generation')::integer < 0) then return false; end if;
  box := anchor_json->'boundingBox';
  return public.af_jsonb_has_exact_keys(box,array['x','y','width','height'])
    and (box->>'x')::numeric between -1000000 and 1000000
    and (box->>'y')::numeric between -1000000 and 1000000
    and (box->>'width')::numeric between 0 and 1000000
    and (box->>'height')::numeric between 0 and 1000000;
exception when invalid_text_representation or numeric_value_out_of_range then return false;
end;
$function$;

create function public.af_verified_locator_json_valid_v1(locator_json jsonb, target_json jsonb)
returns boolean language plpgsql immutable set search_path = pg_catalog, public
as $function$
declare resolver_json jsonb;
begin
  if locator_json->>'kind' in ('ARTICLE','WEBPAGE') then
    if not public.af_jsonb_has_exact_keys(locator_json,array[
      'id','sourceId','status','resolver','revision','supersedesLocatorId','openUrl',
      'resolvedAt','lastVerifiedAt','createdAt','kind','headingPath','paragraphIndex',
      'textFingerprint','textFragmentUrl'
    ]) or jsonb_typeof(locator_json->'headingPath') <> 'array'
      or jsonb_array_length(locator_json->'headingPath') <> 0
      or (locator_json->>'paragraphIndex')::integer <> (target_json->>'paragraphIndex')::integer
      or locator_json->>'textFingerprint' is distinct from target_json->>'textFingerprint'
      or locator_json->'textFragmentUrl' <> 'null'::jsonb then return false; end if;
  elsif locator_json->>'kind' = 'PDF' then
    if not public.af_jsonb_has_exact_keys(locator_json,array[
      'id','sourceId','status','resolver','revision','supersedesLocatorId','openUrl',
      'resolvedAt','lastVerifiedAt','createdAt','kind','documentVersionId','pageIndex',
      'printedPageLabel','section','heading','textFingerprint'
    ]) or (locator_json->>'pageIndex')::integer <> (target_json#>>'{anchor,pageNumber}')::integer
      or locator_json->>'textFingerprint' is distinct from target_json->>'textFingerprint'
      or locator_json->>'documentVersionId' is null then return false; end if;
  else return false; end if;
  resolver_json := locator_json->'resolver';
  return locator_json->>'status' = 'VERIFIED_EXACT'
    and (locator_json->>'id')::uuid is not null and (locator_json->>'sourceId')::uuid is not null
    and (locator_json->>'supersedesLocatorId')::uuid is not null
    and (locator_json->>'revision')::integer > 1
    and (locator_json->>'openUrl')::public.af_http_url is not null
    and (locator_json->>'resolvedAt')::timestamptz is not null
    and locator_json->>'lastVerifiedAt' = locator_json->>'resolvedAt'
    and locator_json->>'createdAt' = locator_json->>'resolvedAt'
    and public.af_jsonb_has_exact_keys(resolver_json,array['id','version'])
    and (resolver_json->>'id')::public.af_slug is not null
    and (resolver_json->>'version')::public.af_version_tag is not null;
exception when invalid_text_representation or numeric_value_out_of_range
  or datetime_field_overflow then return false;
end;
$function$;

create function public.af_exact_locator_receipt_valid_v1(receipt_json jsonb)
returns boolean language plpgsql immutable set search_path = pg_catalog, public
as $function$
begin
  return public.af_jsonb_has_exact_keys(receipt_json,array[
    'schemaVersion','id','normalizationRecordId','retrievalRecordId','snapshotId',
    'sourceId','previousLocatorId','verifiedLocator','target','status','verifier',
    'verifiedAt','trustBoundary','instructionAuthority','evidenceStatus','reviewState',
    'publicationAuthority'
  ]) and (receipt_json->>'schemaVersion')::integer = 1
    and (receipt_json->>'id')::uuid is not null
    and (receipt_json->>'normalizationRecordId')::uuid is not null
    and (receipt_json->>'retrievalRecordId')::uuid is not null
    and (receipt_json->>'snapshotId')::uuid is not null
    and (receipt_json->>'sourceId')::uuid is not null
    and (receipt_json->>'previousLocatorId')::uuid is not null
    and receipt_json->>'status' = 'VERIFIED_EXACT'
    and public.af_exact_locator_target_valid_v1(receipt_json->'target')
    and public.af_verified_locator_json_valid_v1(receipt_json->'verifiedLocator',receipt_json->'target')
    and receipt_json#>>'{verifiedLocator,id}' = receipt_json->>'id'
    and receipt_json#>>'{verifiedLocator,sourceId}' = receipt_json->>'sourceId'
    and receipt_json#>>'{verifiedLocator,supersedesLocatorId}' = receipt_json->>'previousLocatorId'
    and public.af_jsonb_has_exact_keys(receipt_json->'verifier',array['id','version'])
    and receipt_json#>>'{verifier,id}' = receipt_json#>>'{verifiedLocator,resolver,id}'
    and receipt_json#>>'{verifier,version}' = receipt_json#>>'{verifiedLocator,resolver,version}'
    and receipt_json->>'verifiedAt' = receipt_json#>>'{verifiedLocator,lastVerifiedAt}'
    and (receipt_json->>'verifiedAt')::timestamptz is not null
    and receipt_json->>'trustBoundary' = 'UNTRUSTED_SOURCE_DATA'
    and receipt_json->>'instructionAuthority' = 'NONE'
    and receipt_json->>'evidenceStatus' = 'NOT_EVIDENCE'
    and receipt_json->>'reviewState' = 'PROPOSED'
    and receipt_json->>'publicationAuthority' = 'NONE';
exception when invalid_text_representation or numeric_value_out_of_range
  or datetime_field_overflow then return false;
end;
$function$;

create function public.af_exact_locator_record_valid_v1(record_json jsonb)
returns boolean language plpgsql immutable set search_path = pg_catalog, public
as $function$
declare result_json jsonb;
begin
  if not public.af_jsonb_has_exact_keys(record_json,array[
    'schemaVersion','id','runId','jobId','attemptId','caseId','manifestFingerprint',
    'normalizationRecordId','targetBlockOrdinal','idempotencyKey','verifier','result','createdAt'
  ]) or (record_json->>'schemaVersion')::integer <> 1
    or (record_json->>'id')::uuid is null or (record_json->>'runId')::uuid is null
    or (record_json->>'jobId')::uuid is null or (record_json->>'attemptId')::uuid is null
    or (record_json->>'caseId')::uuid is null or (record_json->>'normalizationRecordId')::uuid is null
    or (record_json->>'targetBlockOrdinal')::integer not between 0 and 99999
    or (record_json->>'manifestFingerprint')::public.af_sha256 is null
    or (record_json->>'idempotencyKey')::public.af_opaque_reference is null
    or not public.af_jsonb_has_exact_keys(record_json->'verifier',array['id','version'])
    or (record_json#>>'{verifier,id}')::public.af_slug is null
    or (record_json#>>'{verifier,version}')::public.af_version_tag is null
    or (record_json->>'createdAt')::timestamptz is null then return false; end if;
  result_json := record_json->'result';
  if result_json->>'status' = 'VERIFIED_EXACT' then
    return public.af_jsonb_has_exact_keys(result_json,array['status','receipt'])
      and public.af_exact_locator_receipt_valid_v1(result_json->'receipt')
      and result_json#>>'{receipt,normalizationRecordId}' = record_json->>'normalizationRecordId'
      and (result_json#>>'{receipt,target,blockOrdinal}')::integer = (record_json->>'targetBlockOrdinal')::integer
      and result_json#>>'{receipt,verifier,id}' = record_json#>>'{verifier,id}'
      and result_json#>>'{receipt,verifier,version}' = record_json#>>'{verifier,version}';
  end if;
  return result_json->>'status' = 'UNAVAILABLE'
    and public.af_jsonb_has_exact_keys(result_json,array[
      'status','normalizationRecordId','retrievalRecordId','sourceId','previousLocatorId',
      'code','instructionAuthority','publicationAuthority'
    ]) and result_json->>'normalizationRecordId' = record_json->>'normalizationRecordId'
    and (result_json->>'retrievalRecordId')::uuid is not null
    and (result_json->>'sourceId')::uuid is not null
    and (result_json->>'previousLocatorId')::uuid is not null
    and result_json->>'code' in (
      'locator-unsupported-medium','locator-source-mismatch','locator-normalization-mismatch',
      'locator-target-not-found','locator-target-mismatch','locator-document-quarantined',
      'locator-open-target-invalid','locator-reparse-failed','locator-contract-invalid'
    ) and result_json->>'instructionAuthority' = 'NONE'
    and result_json->>'publicationAuthority' = 'NONE';
exception when invalid_text_representation or numeric_value_out_of_range
  or datetime_field_overflow then return false;
end;
$function$;

create function public.af_exact_locator_record_json_v1(
  verification_row public.af_exact_locator_verification_records
) returns jsonb language sql stable set search_path = pg_catalog
as $function$
  select verification_row.record_json || jsonb_build_object(
    'verificationFingerprint',verification_row.verification_fingerprint,
    'acceptedAt',verification_row.accepted_at
  );
$function$;

create function public.af_get_exact_locator_verifications_v1(
  p_actor_id uuid,p_run_id uuid,p_job_id uuid,p_attempt_id uuid
) returns jsonb language plpgsql stable security definer
set search_path = pg_catalog,public,auth
as $function$
declare records_json jsonb;
begin
  perform public.af_assert_actor_scope(p_actor_id);
  if not exists (select 1 from public.af_research_runs run
    join public.af_cases stored_case on stored_case.id=run.case_id
    join public.af_research_jobs job on job.run_id=run.id
    join public.af_research_attempts attempt on attempt.run_id=run.id and attempt.job_id=job.id
    where run.id=p_run_id and stored_case.owner_id=p_actor_id and job.id=p_job_id
      and attempt.id=p_attempt_id and job.stage='NORMALIZATION') then return null; end if;
  select coalesce(jsonb_agg(public.af_exact_locator_record_json_v1(record)
    order by record.accepted_at,record.id),'[]'::jsonb) into records_json
  from public.af_exact_locator_verification_records record
  where record.run_id=p_run_id and record.job_id=p_job_id and record.attempt_id=p_attempt_id;
  return records_json;
end;
$function$;

create function public.af_accept_exact_locator_verification_v1(
  p_actor_id uuid,p_lease jsonb,p_record jsonb,p_lease_seconds integer
) returns jsonb language plpgsql volatile security definer
set search_path = pg_catalog,public,auth
as $function$
declare
  observed_at timestamptz := clock_timestamp(); mutation_time timestamptz;
  run_row public.af_research_runs%rowtype; job_row public.af_research_jobs%rowtype;
  attempt_row public.af_research_attempts%rowtype; lease_row public.af_research_job_leases%rowtype;
  manifest_row public.af_research_attempt_input_manifests%rowtype;
  retrieval_row public.af_source_retrieval_records%rowtype; source_row public.af_sources%rowtype;
  previous_locator public.af_source_locators%rowtype;
  byte_normalization public.af_source_normalization_records%rowtype;
  pdf_normalization public.af_pdf_normalization_records%rowtype;
  stored_record public.af_exact_locator_verification_records%rowtype;
  result_json jsonb := p_record->'result'; receipt_json jsonb; target_json jsonb; locator_json jsonb;
  normalization_json jsonb; normalization_kind_value text; fingerprint_value public.af_sha256;
  retrieval_id_value uuid; source_id_value uuid; previous_locator_id_value uuid;
begin
  perform public.af_assert_actor_scope(p_actor_id);
  if p_lease_seconds not between 5 and 900 or not public.af_research_lease_cursor_valid(p_lease)
    or not public.af_exact_locator_record_valid_v1(p_record) then
    raise exception using errcode='AFR04',message='Invalid exact-locator acceptance input'; end if;
  receipt_json := case when result_json->>'status'='VERIFIED_EXACT' then result_json->'receipt' else null end;
  retrieval_id_value := (case when receipt_json is null then result_json->>'retrievalRecordId' else receipt_json->>'retrievalRecordId' end)::uuid;
  source_id_value := (case when receipt_json is null then result_json->>'sourceId' else receipt_json->>'sourceId' end)::uuid;
  previous_locator_id_value := (case when receipt_json is null then result_json->>'previousLocatorId' else receipt_json->>'previousLocatorId' end)::uuid;
  if p_lease->>'runId' is distinct from p_record->>'runId' or p_lease->>'jobId' is distinct from p_record->>'jobId'
    or p_lease->>'attemptId' is distinct from p_record->>'attemptId' then
    raise exception using errcode='AFR04',message='Locator verification does not match active lease'; end if;
  select stored_run.* into run_row from public.af_research_runs stored_run
  join public.af_cases stored_case on stored_case.id=stored_run.case_id
  where stored_run.id=(p_record->>'runId')::uuid and stored_case.owner_id=p_actor_id for update of stored_run;
  if not found then raise exception using errcode='AFR05',message='Actor scope mismatch or record not found'; end if;
  select * into job_row from public.af_research_jobs where id=(p_record->>'jobId')::uuid and run_id=run_row.id for update;
  select * into attempt_row from public.af_research_attempts where id=(p_record->>'attemptId')::uuid
    and run_id=run_row.id and job_id=job_row.id for update;
  select * into lease_row from public.af_research_job_leases where attempt_id=attempt_row.id for update;
  select * into manifest_row from public.af_research_attempt_input_manifests where attempt_id=attempt_row.id for share;
  select * into retrieval_row from public.af_source_retrieval_records where id=retrieval_id_value
    and run_id=run_row.id and attempt_id=attempt_row.id for share;
  select * into source_row from public.af_sources where id=source_id_value for share;
  select * into previous_locator from public.af_source_locators where id=previous_locator_id_value
    and source_id=source_id_value for share;
  if job_row.id is null or attempt_row.id is null or lease_row.attempt_id is null or manifest_row.id is null
    or retrieval_row.id is null or source_row.id is null or previous_locator.id is null then
    raise exception using errcode='AFR05',message='Actor scope mismatch or record not found'; end if;
  if run_row.status='CANCELLED' or job_row.status='CANCELLED' or attempt_row.status='CANCELLED'
    then return jsonb_build_object('status','CANCELLED'); end if;
  if not public.af_research_lease_cursor_matches(p_lease,lease_row,run_row,job_row,attempt_row)
    or lease_row.released_at is not null or lease_row.lease_expires_at<=observed_at
    or job_row.status<>'RUNNING' or job_row.stage<>'NORMALIZATION'
    or job_row.active_attempt_id<>attempt_row.id or attempt_row.status<>'RUNNING'
    then return jsonb_build_object('status','LEASE_LOST'); end if;
  if run_row.case_id<>(p_record->>'caseId')::uuid
    or manifest_row.manifest_fingerprint::text is distinct from p_record->>'manifestFingerprint'
    or not attempt_row.private_content_included
    or retrieval_row.source_id<>source_row.id or retrieval_row.source_locator_id<>previous_locator.id
    or source_row.access_state<>'OPEN' or source_row.rights_state in ('UNKNOWN','PROHIBITED')
    or (p_record->>'createdAt')::timestamptz<attempt_row.started_at
    or (p_record->>'createdAt')::timestamptz>observed_at+interval '5 minutes' then
    raise exception using errcode='AFR07',message='Locator verification violates authoritative input'; end if;

  select * into byte_normalization from public.af_source_normalization_records
  where id=(p_record->>'normalizationRecordId')::uuid and run_id=run_row.id
    and attempt_id=attempt_row.id and retrieval_record_id=retrieval_row.id for share;
  select * into pdf_normalization from public.af_pdf_normalization_records
  where id=(p_record->>'normalizationRecordId')::uuid and run_id=run_row.id
    and attempt_id=attempt_row.id and retrieval_record_id=retrieval_row.id for share;
  if (byte_normalization.id is null)=(pdf_normalization.id is null) then
    raise exception using errcode='AFR07',message='Locator verification normalization lineage is ambiguous or absent'; end if;
  if byte_normalization.id is not null then
    normalization_kind_value := 'BYTE_DOCUMENT'; normalization_json := byte_normalization.record_json;
  else normalization_kind_value := 'PDF'; normalization_json := pdf_normalization.record_json; end if;

  fingerprint_value := public.af_canonical_jsonb_sha256_v1('exact-locator-verification-record',p_record);
  select * into stored_record from public.af_exact_locator_verification_records
  where attempt_id=attempt_row.id and normalization_kind=normalization_kind_value
    and normalization_record_id=(p_record->>'normalizationRecordId')::uuid
    and target_block_ordinal=(p_record->>'targetBlockOrdinal')::integer for update;
  if found then
    if stored_record.verification_fingerprint is distinct from fingerprint_value
      or stored_record.record_json is distinct from p_record then
      raise exception using errcode='AFR02',message='Locator target already identifies a different verification'; end if;
    mutation_time:=greatest(observed_at,stored_record.accepted_at);
    update public.af_research_job_leases set last_heartbeat_at=mutation_time,
      lease_expires_at=mutation_time+make_interval(secs=>p_lease_seconds)
    where attempt_id=attempt_row.id and lease_token=lease_row.lease_token returning * into lease_row;
    return jsonb_build_object('status','REPLAY','lease',public.af_research_lease_cursor_json(
      lease_row,run_row.aggregate_version,job_row.aggregate_version,attempt_row.aggregate_version,
      attempt_row.request_fingerprint),'record',public.af_exact_locator_record_json_v1(stored_record));
  end if;

  if receipt_json is not null then
    target_json:=receipt_json->'target'; locator_json:=receipt_json->'verifiedLocator';
    if receipt_json->>'normalizationRecordId' is distinct from p_record->>'normalizationRecordId'
      or (target_json->>'blockOrdinal')::integer<>(p_record->>'targetBlockOrdinal')::integer
      or receipt_json->>'retrievalRecordId' is distinct from retrieval_row.id::text
      or receipt_json->>'snapshotId' is distinct from retrieval_row.snapshot_id::text
      or receipt_json->>'sourceId' is distinct from source_row.id::text
      or receipt_json->>'previousLocatorId' is distinct from previous_locator.id::text
      or locator_json->>'sourceId' is distinct from source_row.id::text
      or locator_json->>'kind' is distinct from source_row.medium::text
      or (locator_json->>'revision')::integer<>previous_locator.revision+1
      or locator_json->>'supersedesLocatorId' is distinct from previous_locator.id::text
      or receipt_json->>'verifiedAt' is distinct from locator_json->>'lastVerifiedAt'
      or receipt_json#>>'{verifier,id}' is distinct from p_record#>>'{verifier,id}'
      or receipt_json#>>'{verifier,version}' is distinct from p_record#>>'{verifier,version}'
      or (receipt_json->>'verifiedAt')::timestamptz<attempt_row.started_at
      or (receipt_json->>'verifiedAt')::timestamptz>observed_at+interval '5 minutes'
      or normalization_json#>>'{result,receipt,screeningState}'<>'PASSED'
      or target_json->>'documentFingerprint' is distinct from normalization_json#>>'{result,receipt,documentFingerprint}'
      or target_json->>'textFingerprint' is distinct from
        normalization_json#>>array['result','receipt','blockManifests',(p_record->>'targetBlockOrdinal'),'textFingerprint'] then
      raise exception using errcode='AFR07',message='Verified locator does not match authoritative normalization'; end if;
    if normalization_kind_value='BYTE_DOCUMENT' then
      if target_json->>'kind' not in ('ARTICLE','WEBPAGE')
        or target_json->>'sourceRangeFingerprint' is distinct from
          normalization_json#>>array['result','receipt','blockManifests',(p_record->>'targetBlockOrdinal'),'sourceRangeFingerprint']
        or locator_json->>'openUrl' is distinct from source_row.canonical_url::text then
        raise exception using errcode='AFR07',message='Web locator target is not exact'; end if;
    else
      if target_json->>'kind'<>'PDF' or target_json#>>'{anchor,anchorFingerprint}' is distinct from
          normalization_json#>>array['result','receipt','blockManifests',(p_record->>'targetBlockOrdinal'),'anchor','anchorFingerprint']
        or locator_json->>'openUrl' is distinct from
          source_row.canonical_url::text||'#page='||(target_json#>>'{anchor,pageNumber}') then
        raise exception using errcode='AFR07',message='PDF locator target is not exact'; end if;
    end if;
    insert into public.af_source_locators (
      id,source_id,kind,status,resolver_id,resolver_version,revision,supersedes_locator_id,
      open_url,resolved_at,last_verified_at,created_at,heading_path,paragraph_index,
      text_fragment_url,text_fingerprint,document_version_id,page_index,printed_page_label,
      section,heading
    ) values (
      (locator_json->>'id')::uuid,source_row.id,(locator_json->>'kind')::public.af_source_medium,
      'VERIFIED_EXACT',(locator_json#>>'{resolver,id}')::public.af_slug,
      (locator_json#>>'{resolver,version}')::public.af_version_tag,
      (locator_json->>'revision')::integer,previous_locator.id,locator_json->>'openUrl',
      (locator_json->>'resolvedAt')::timestamptz,(locator_json->>'lastVerifiedAt')::timestamptz,
      (locator_json->>'createdAt')::timestamptz,
      case when target_json->>'kind' in ('ARTICLE','WEBPAGE') then array[]::text[] else null end,
      case when target_json->>'kind' in ('ARTICLE','WEBPAGE') then (locator_json->>'paragraphIndex')::integer else null end,
      case when target_json->>'kind' in ('ARTICLE','WEBPAGE') then locator_json->>'textFragmentUrl' else null end,
      locator_json->>'textFingerprint',
      case when target_json->>'kind'='PDF' then locator_json->>'documentVersionId' else null end,
      case when target_json->>'kind'='PDF' then (locator_json->>'pageIndex')::integer else null end,
      case when target_json->>'kind'='PDF' then locator_json->>'printedPageLabel' else null end,
      case when target_json->>'kind'='PDF' then locator_json->>'section' else null end,
      case when target_json->>'kind'='PDF' then locator_json->>'heading' else null end
    );
  end if;

  insert into public.af_exact_locator_verification_records (
    schema_version,id,run_id,job_id,attempt_id,case_id,manifest_fingerprint,
    normalization_kind,normalization_record_id,target_block_ordinal,retrieval_record_id,
    source_id,previous_locator_id,verified_locator_id,idempotency_key,verifier_id,
    verifier_version,status,failure_code,target_fingerprint,verification_fingerprint,
    trust_boundary,instruction_authority,evidence_status,review_state,publication_authority,
    record_json,created_at,accepted_at
  ) values (
    1,(p_record->>'id')::uuid,run_row.id,job_row.id,attempt_row.id,run_row.case_id,
    manifest_row.manifest_fingerprint,normalization_kind_value,(p_record->>'normalizationRecordId')::uuid,
    (p_record->>'targetBlockOrdinal')::integer,retrieval_row.id,source_row.id,previous_locator.id,
    case when receipt_json is null then null else (receipt_json->>'id')::uuid end,
    p_record->>'idempotencyKey',p_record#>>'{verifier,id}',p_record#>>'{verifier,version}',
    (result_json->>'status')::public.af_locator_status,
    case when receipt_json is null then result_json->>'code' else null end,
    case when receipt_json is null then null else public.af_canonical_jsonb_sha256_v1('exact-locator-target',target_json) end,
    fingerprint_value,'UNTRUSTED_SOURCE_DATA','NONE','NOT_EVIDENCE','PROPOSED','NONE',
    p_record,(p_record->>'createdAt')::timestamptz,greatest(observed_at,(p_record->>'createdAt')::timestamptz)
  ) returning * into stored_record;
  mutation_time:=greatest(observed_at,(p_record->>'createdAt')::timestamptz);
  update public.af_research_job_leases set last_heartbeat_at=mutation_time,
    lease_expires_at=mutation_time+make_interval(secs=>p_lease_seconds)
  where attempt_id=attempt_row.id and lease_token=lease_row.lease_token returning * into lease_row;
  return jsonb_build_object('status','COMMITTED','lease',public.af_research_lease_cursor_json(
    lease_row,run_row.aggregate_version,job_row.aggregate_version,attempt_row.aggregate_version,
    attempt_row.request_fingerprint),'record',public.af_exact_locator_record_json_v1(stored_record));
exception
  when unique_violation then raise exception using errcode='AFR03',message='Exact locator conflicts with an existing identifier or idempotency key';
  when foreign_key_violation or check_violation or not_null_violation
    or invalid_text_representation or numeric_value_out_of_range then
    raise exception using errcode='AFR04',message='Exact locator failed schema or reference invariants';
end;
$function$;

alter table public.af_exact_locator_verification_records enable row level security;
alter table public.af_exact_locator_verification_records force row level security;
revoke all on table public.af_exact_locator_verification_records from public,anon,authenticated;
grant all on table public.af_exact_locator_verification_records to service_role;
revoke all on function public.af_exact_locator_target_valid_v1(jsonb) from public,anon,authenticated;
revoke all on function public.af_verified_locator_json_valid_v1(jsonb,jsonb) from public,anon,authenticated;
revoke all on function public.af_exact_locator_receipt_valid_v1(jsonb) from public,anon,authenticated;
revoke all on function public.af_exact_locator_record_valid_v1(jsonb) from public,anon,authenticated;
revoke all on function public.af_exact_locator_record_json_v1(public.af_exact_locator_verification_records) from public,anon,authenticated;
revoke all on function public.af_get_exact_locator_verifications_v1(uuid,uuid,uuid,uuid) from public,anon,authenticated;
revoke all on function public.af_accept_exact_locator_verification_v1(uuid,jsonb,jsonb,integer) from public,anon,authenticated;
grant execute on function public.af_get_exact_locator_verifications_v1(uuid,uuid,uuid,uuid) to service_role;
grant execute on function public.af_accept_exact_locator_verification_v1(uuid,jsonb,jsonb,integer) to service_role;

comment on function public.af_accept_exact_locator_verification_v1(uuid,jsonb,jsonb,integer) is
  'Actor-scoped active-lease acceptance for exact, text-free locator verification; never evidence acceptance.';
