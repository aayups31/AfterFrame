-- AFTERFRAME checkpoint 04D.4: lease-fenced, text-free PDF normalization ledger.
-- PDF provenance uses page objects and text-item ranges, never fabricated byte spans.

create table public.af_pdf_normalization_records (
  schema_version smallint not null check (schema_version = 1),
  id uuid primary key,
  run_id uuid not null,
  job_id uuid not null,
  attempt_id uuid not null,
  case_id uuid not null,
  manifest_fingerprint public.af_sha256 not null,
  retrieval_record_id uuid not null,
  candidate_id uuid not null,
  source_id uuid not null,
  source_locator_id uuid not null,
  snapshot_id uuid,
  content_id uuid,
  idempotency_key public.af_opaque_reference not null,
  normalizer_id public.af_slug not null,
  normalizer_version public.af_version_tag not null,
  library_version public.af_version_tag,
  status text not null check (status in ('NORMALIZED', 'UNAVAILABLE')),
  failure_code text,
  document_fingerprint public.af_sha256,
  source_byte_length public.af_safe_nonnegative_integer,
  page_count integer check (page_count between 1 and 2000),
  normalized_text_length public.af_safe_nonnegative_integer,
  page_manifest jsonb,
  block_manifest jsonb,
  hostile_signals jsonb,
  retention text check (retention in ('TRANSIENT_ONLY', 'RETAINABLE')),
  storage_ref public.af_opaque_reference,
  access_state public.af_access_state,
  rights_state public.af_rights_state,
  normalization_fingerprint public.af_sha256 not null,
  trust_boundary text not null check (trust_boundary = 'UNTRUSTED_SOURCE_DATA'),
  instruction_authority text not null check (instruction_authority = 'NONE'),
  screening_state public.af_screening_state not null,
  evidence_status text not null check (evidence_status = 'NOT_EVIDENCE'),
  review_state public.af_review_state not null check (review_state = 'PROPOSED'),
  publication_authority text not null check (publication_authority = 'NONE'),
  record_json jsonb not null check (jsonb_typeof(record_json) = 'object'),
  created_at timestamptz not null,
  accepted_at timestamptz not null,
  constraint af_pdf_normalization_attempt_fk foreign key (run_id, job_id, attempt_id)
    references public.af_research_attempts(run_id, job_id, id) on delete cascade,
  constraint af_pdf_normalization_run_case_fk foreign key (run_id, case_id)
    references public.af_research_runs(id, case_id) on delete cascade,
  constraint af_pdf_normalization_retrieval_fk foreign key (retrieval_record_id)
    references public.af_source_retrieval_records(id) on delete cascade,
  constraint af_pdf_normalization_candidate_fk foreign key (run_id, candidate_id)
    references public.af_source_candidates(run_id, id) on delete cascade,
  constraint af_pdf_normalization_source_locator_fk foreign key (source_id, source_locator_id)
    references public.af_source_locators(source_id, id),
  constraint af_pdf_normalization_snapshot_fk foreign key (source_id, snapshot_id)
    references public.af_source_snapshots(source_id, id),
  constraint af_pdf_normalization_content_fk foreign key (run_id, content_id)
    references public.af_untrusted_research_content(run_id, id),
  constraint af_pdf_normalization_partition_check check (
    (status = 'NORMALIZED' and failure_code is null and snapshot_id is not null
      and content_id is not null and library_version is not null
      and document_fingerprint is not null and source_byte_length > 0
      and page_count is not null and normalized_text_length is not null
      and jsonb_typeof(page_manifest) = 'array'
      and jsonb_array_length(page_manifest) = page_count
      and jsonb_typeof(block_manifest) = 'array'
      and jsonb_typeof(hostile_signals) = 'array'
      and retention is not null and access_state is not null and rights_state is not null
      and ((retention = 'TRANSIENT_ONLY' and storage_ref is null)
        or (retention = 'RETAINABLE' and storage_ref is not null)))
    or
    (status = 'UNAVAILABLE' and failure_code in (
      'pdf-unsupported-media', 'pdf-empty', 'pdf-size-exceeded',
      'pdf-page-limit-exceeded', 'pdf-item-limit-exceeded',
      'pdf-text-limit-exceeded', 'pdf-encrypted', 'pdf-malformed',
      'pdf-timeout', 'pdf-contract-invalid'
    ) and snapshot_id is null and content_id is null and library_version is null
      and document_fingerprint is null and source_byte_length is null
      and page_count is null and normalized_text_length is null
      and page_manifest is null and block_manifest is null and hostile_signals is null
      and retention is null and storage_ref is null and access_state is null
      and rights_state is null and screening_state = 'UNSCREENED')
  ),
  constraint af_pdf_normalization_time_check check (accepted_at >= created_at),
  constraint af_pdf_normalization_receipt_unique unique (attempt_id, retrieval_record_id),
  constraint af_pdf_normalization_idempotency_unique unique (attempt_id, idempotency_key)
);

comment on table public.af_pdf_normalization_records is
  'Text-free PDF parser ledger using page-object and text-item provenance; never evidence.';

create function public.af_pdf_text_anchor_valid_v1(anchor_json jsonb, expected_pages integer)
returns boolean language plpgsql immutable set search_path = pg_catalog, public
as $function$
declare page_object jsonb; box jsonb;
begin
  if not public.af_jsonb_has_exact_keys(anchor_json, array[
    'schemaVersion','pageNumber','pageObject','itemStart','itemEnd','boundingBox',
    'pageTextFingerprint','anchorFingerprint'
  ]) or (anchor_json->>'schemaVersion')::integer <> 1
    or (anchor_json->>'pageNumber')::integer not between 1 and expected_pages
    or (anchor_json->>'itemStart')::integer < 0
    or (anchor_json->>'itemEnd')::integer <= (anchor_json->>'itemStart')::integer
    or (anchor_json->>'pageTextFingerprint')::public.af_sha256 is null
    or (anchor_json->>'anchorFingerprint')::public.af_sha256 is null then return false; end if;
  page_object := anchor_json->'pageObject';
  if page_object <> 'null'::jsonb and (
    not public.af_jsonb_has_exact_keys(page_object, array['objectNumber','generation'])
    or (page_object->>'objectNumber')::integer <= 0
    or (page_object->>'generation')::integer < 0
  ) then return false; end if;
  box := anchor_json->'boundingBox';
  return public.af_jsonb_has_exact_keys(box, array['x','y','width','height'])
    and (box->>'x')::numeric between -1000000 and 1000000
    and (box->>'y')::numeric between -1000000 and 1000000
    and (box->>'width')::numeric between 0 and 1000000
    and (box->>'height')::numeric between 0 and 1000000;
exception when invalid_text_representation or numeric_value_out_of_range then return false;
end;
$function$;

create function public.af_pdf_page_manifest_valid_v1(
  page_json jsonb, expected_page integer, total_blocks integer
) returns boolean language plpgsql immutable set search_path = pg_catalog, public
as $function$
declare page_object jsonb;
begin
  if not public.af_jsonb_has_exact_keys(page_json, array[
    'schemaVersion','pageNumber','pageObject','rotation','width','height',
    'textItemCount','blockStart','blockEnd','pageTextFingerprint','pageStructureFingerprint'
  ]) or (page_json->>'schemaVersion')::integer <> 1
    or (page_json->>'pageNumber')::integer <> expected_page
    or (page_json->>'rotation')::integer not between 0 and 359
    or (page_json->>'width')::numeric <= 0 or (page_json->>'width')::numeric > 1000000
    or (page_json->>'height')::numeric <= 0 or (page_json->>'height')::numeric > 1000000
    or (page_json->>'textItemCount')::integer not between 0 and 100000
    or (page_json->>'blockStart')::integer < 0
    or (page_json->>'blockEnd')::integer < (page_json->>'blockStart')::integer
    or (page_json->>'blockEnd')::integer > total_blocks
    or (page_json->>'pageTextFingerprint')::public.af_sha256 is null
    or (page_json->>'pageStructureFingerprint')::public.af_sha256 is null then return false; end if;
  page_object := page_json->'pageObject';
  return page_object = 'null'::jsonb or (
    public.af_jsonb_has_exact_keys(page_object, array['objectNumber','generation'])
    and (page_object->>'objectNumber')::integer > 0
    and (page_object->>'generation')::integer >= 0
  );
exception when invalid_text_representation or numeric_value_out_of_range then return false;
end;
$function$;

create function public.af_pdf_block_manifest_valid_v1(
  block_json jsonb, expected_ordinal integer, expected_pages integer
) returns boolean language plpgsql immutable set search_path = pg_catalog, public
as $function$
begin
  return public.af_jsonb_has_exact_keys(block_json, array[
    'schemaVersion','ordinal','kind','textFingerprint','anchor','instructionAuthority',
    'evidenceStatus','publicationAuthority','textLength'
  ]) and (block_json->>'schemaVersion')::integer = 1
    and (block_json->>'ordinal')::integer = expected_ordinal
    and block_json->>'kind' = 'PARAGRAPH'
    and (block_json->>'textLength')::integer between 1 and 20000
    and (block_json->>'textFingerprint')::public.af_sha256 is not null
    and public.af_pdf_text_anchor_valid_v1(block_json->'anchor', expected_pages)
    and block_json->>'instructionAuthority' = 'NONE'
    and block_json->>'evidenceStatus' = 'NOT_EVIDENCE'
    and block_json->>'publicationAuthority' = 'NONE';
exception when invalid_text_representation or numeric_value_out_of_range then return false;
end;
$function$;

create function public.af_pdf_hostile_signal_valid_v1(signal_json jsonb, expected_pages integer)
returns boolean language plpgsql immutable set search_path = pg_catalog, public
as $function$
begin
  return public.af_jsonb_has_exact_keys(signal_json, array[
    'schemaVersion','code','severity','anchorScope','anchor','detectorId',
    'detectorVersion','instructionAuthority','publicationAuthority'
  ]) and (signal_json->>'schemaVersion')::integer = 1
    and signal_json->>'code' in (
      'INSTRUCTION_OVERRIDE','ROLE_IMPERSONATION','TOOL_COMMAND',
      'SECRET_EXFILTRATION','ENCODED_INSTRUCTION','ACTIVE_CONTENT','CREDENTIAL_FORM'
    ) and signal_json->>'severity' in ('MEDIUM','HIGH')
    and ((signal_json->>'anchorScope' = 'DOCUMENT' and signal_json->'anchor' = 'null'::jsonb)
      or (signal_json->>'anchorScope' = 'PAGE_TEXT'
        and public.af_pdf_text_anchor_valid_v1(signal_json->'anchor', expected_pages)))
    and (signal_json->>'detectorId')::public.af_slug is not null
    and (signal_json->>'detectorVersion')::public.af_version_tag is not null
    and signal_json->>'instructionAuthority' = 'NONE'
    and signal_json->>'publicationAuthority' = 'NONE';
exception when invalid_text_representation or numeric_value_out_of_range then return false;
end;
$function$;

create function public.af_pdf_document_receipt_valid_v1(receipt_json jsonb)
returns boolean language plpgsql immutable set search_path = pg_catalog, public
as $function$
declare page_total integer; block_total integer; signal_total integer; index_value integer;
declare length_total bigint := 0; page_json jsonb; block_json jsonb; signal_json jsonb;
begin
  if not public.af_jsonb_has_exact_keys(receipt_json, array[
    'schemaVersion','id','runId','candidateId','retrievalRecordId','snapshotId',
    'sourceId','sourceLocatorId','contentFingerprint','documentFingerprint',
    'documentKind','verifiedMediaType','sourceByteLength','pageCount',
    'normalizedTextLength','pageManifests','blockManifests','screeningState',
    'hostileSignals','retention','storageRef','accessState','rightsState',
    'normalizer','libraryVersion','normalizedAt','trustBoundary',
    'instructionAuthority','evidenceStatus','reviewState','publicationAuthority'
  ]) or (receipt_json->>'schemaVersion')::integer <> 1
    or (receipt_json->>'id')::uuid is null or (receipt_json->>'runId')::uuid is null
    or (receipt_json->>'candidateId')::uuid is null or (receipt_json->>'retrievalRecordId')::uuid is null
    or (receipt_json->>'snapshotId')::uuid is null or (receipt_json->>'sourceId')::uuid is null
    or (receipt_json->>'sourceLocatorId')::uuid is null
    or (receipt_json->>'contentFingerprint')::public.af_sha256 is null
    or (receipt_json->>'documentFingerprint')::public.af_sha256 is null
    or receipt_json->>'documentKind' <> 'PDF'
    or receipt_json->>'verifiedMediaType' <> 'application/pdf'
    or (receipt_json->>'sourceByteLength')::bigint not between 1 and 50000000
    or (receipt_json->>'pageCount')::integer not between 1 and 2000
    or (receipt_json->>'normalizedTextLength')::bigint not between 0 and 5000000
    or jsonb_typeof(receipt_json->'pageManifests') <> 'array'
    or jsonb_typeof(receipt_json->'blockManifests') <> 'array'
    or jsonb_typeof(receipt_json->'hostileSignals') <> 'array'
    or not public.af_jsonb_has_exact_keys(receipt_json->'normalizer', array['id','version'])
    or (receipt_json#>>'{normalizer,id}')::public.af_slug is null
    or (receipt_json#>>'{normalizer,version}')::public.af_version_tag is null
    or (receipt_json->>'libraryVersion')::public.af_version_tag is null
    or (receipt_json->>'normalizedAt')::timestamptz is null
    or receipt_json->>'trustBoundary' <> 'UNTRUSTED_SOURCE_DATA'
    or receipt_json->>'instructionAuthority' <> 'NONE'
    or receipt_json->>'evidenceStatus' <> 'NOT_EVIDENCE'
    or receipt_json->>'reviewState' <> 'PROPOSED'
    or receipt_json->>'publicationAuthority' <> 'NONE' then return false; end if;
  page_total := jsonb_array_length(receipt_json->'pageManifests');
  block_total := jsonb_array_length(receipt_json->'blockManifests');
  signal_total := jsonb_array_length(receipt_json->'hostileSignals');
  if page_total <> (receipt_json->>'pageCount')::integer or block_total > 100000 or signal_total > 100
    or receipt_json->>'screeningState' not in ('PASSED','QUARANTINED')
    or ((receipt_json->>'screeningState' = 'PASSED') <> (signal_total = 0))
    or receipt_json->>'retention' not in ('TRANSIENT_ONLY','RETAINABLE')
    or (receipt_json->>'accessState')::public.af_access_state is null
    or (receipt_json->>'rightsState')::public.af_rights_state is null
    or (receipt_json->>'rightsState' = 'LINK_ONLY' and receipt_json->>'retention' <> 'TRANSIENT_ONLY')
    or (receipt_json->>'retention' = 'TRANSIENT_ONLY' and receipt_json->'storageRef' <> 'null'::jsonb)
    or (receipt_json->>'retention' = 'RETAINABLE' and (
      receipt_json->'storageRef' = 'null'::jsonb or receipt_json->>'rightsState' not in ('PERMITTED','USER_OWNED','PUBLIC_DOMAIN','LICENSED')))
    or (receipt_json->>'screeningState' = 'QUARANTINED' and (
      receipt_json->>'retention' <> 'TRANSIENT_ONLY' or receipt_json->'storageRef' <> 'null'::jsonb))
  then return false; end if;
  for index_value in 0..page_total - 1 loop
    page_json := receipt_json->'pageManifests'->index_value;
    if not public.af_pdf_page_manifest_valid_v1(page_json, index_value + 1, block_total) then return false; end if;
    if index_value = 0 and (page_json->>'blockStart')::integer <> 0 then return false; end if;
    if index_value > 0 and (page_json->>'blockStart')::integer <
      (receipt_json->'pageManifests'->(index_value - 1)->>'blockEnd')::integer then return false; end if;
  end loop;
  if (receipt_json->'pageManifests'->(page_total - 1)->>'blockEnd')::integer <> block_total then return false; end if;
  for index_value in 0..block_total - 1 loop
    block_json := receipt_json->'blockManifests'->index_value;
    if not public.af_pdf_block_manifest_valid_v1(block_json, index_value, page_total) then return false; end if;
    page_json := receipt_json->'pageManifests'->((block_json#>>'{anchor,pageNumber}')::integer - 1);
    if block_json#>>'{anchor,pageTextFingerprint}' is distinct from page_json->>'pageTextFingerprint'
      or index_value < (page_json->>'blockStart')::integer
      or index_value >= (page_json->>'blockEnd')::integer then return false; end if;
    length_total := length_total + (block_json->>'textLength')::integer;
  end loop;
  if length_total <> (receipt_json->>'normalizedTextLength')::bigint then return false; end if;
  for index_value in 0..signal_total - 1 loop
    signal_json := receipt_json->'hostileSignals'->index_value;
    if not public.af_pdf_hostile_signal_valid_v1(signal_json, page_total) then return false; end if;
  end loop;
  return true;
exception when invalid_text_representation or check_violation
  or numeric_value_out_of_range or datetime_field_overflow then return false;
end;
$function$;

create function public.af_pdf_normalization_record_valid_v1(value_to_check jsonb)
returns boolean language plpgsql immutable set search_path = pg_catalog, public
as $function$
declare result_json jsonb;
begin
  if not public.af_jsonb_has_exact_keys(value_to_check, array[
    'schemaVersion','id','runId','jobId','attemptId','caseId','manifestFingerprint',
    'retrievalRecordId','idempotencyKey','normalizer','result','createdAt'
  ]) or (value_to_check->>'schemaVersion')::integer <> 1
    or (value_to_check->>'id')::uuid is null or (value_to_check->>'runId')::uuid is null
    or (value_to_check->>'jobId')::uuid is null or (value_to_check->>'attemptId')::uuid is null
    or (value_to_check->>'caseId')::uuid is null or (value_to_check->>'retrievalRecordId')::uuid is null
    or (value_to_check->>'manifestFingerprint')::public.af_sha256 is null
    or (value_to_check->>'idempotencyKey')::public.af_opaque_reference is null
    or not public.af_jsonb_has_exact_keys(value_to_check->'normalizer', array['id','version'])
    or (value_to_check#>>'{normalizer,id}')::public.af_slug is null
    or (value_to_check#>>'{normalizer,version}')::public.af_version_tag is null
    or (value_to_check->>'createdAt')::timestamptz is null then return false; end if;
  result_json := value_to_check->'result';
  if result_json->>'status' = 'NORMALIZED' then
    return public.af_jsonb_has_exact_keys(result_json, array['status','receipt'])
      and public.af_pdf_document_receipt_valid_v1(result_json->'receipt')
      and result_json#>>'{receipt,runId}' = value_to_check->>'runId'
      and result_json#>>'{receipt,retrievalRecordId}' = value_to_check->>'retrievalRecordId'
      and result_json#>>'{receipt,normalizer,id}' = value_to_check#>>'{normalizer,id}'
      and result_json#>>'{receipt,normalizer,version}' = value_to_check#>>'{normalizer,version}';
  end if;
  return result_json->>'status' = 'UNAVAILABLE'
    and public.af_jsonb_has_exact_keys(result_json, array[
      'status','candidateId','retrievalRecordId','sourceId','sourceLocatorId',
      'code','instructionAuthority','publicationAuthority'
    ]) and result_json->>'code' in (
      'pdf-unsupported-media','pdf-empty','pdf-size-exceeded','pdf-page-limit-exceeded',
      'pdf-item-limit-exceeded','pdf-text-limit-exceeded','pdf-encrypted',
      'pdf-malformed','pdf-timeout','pdf-contract-invalid'
    ) and (result_json->>'candidateId')::uuid is not null
    and (result_json->>'retrievalRecordId')::uuid = (value_to_check->>'retrievalRecordId')::uuid
    and (result_json->>'sourceId')::uuid is not null
    and (result_json->>'sourceLocatorId')::uuid is not null
    and result_json->>'instructionAuthority' = 'NONE'
    and result_json->>'publicationAuthority' = 'NONE';
exception when invalid_text_representation or check_violation
  or numeric_value_out_of_range or datetime_field_overflow then return false;
end;
$function$;

create function public.af_pdf_normalization_record_json_v1(record_row public.af_pdf_normalization_records)
returns jsonb language sql stable set search_path = pg_catalog
as $function$
  select record_row.record_json || jsonb_build_object(
    'normalizationFingerprint', record_row.normalization_fingerprint,
    'acceptedAt', record_row.accepted_at
  );
$function$;

create function public.af_get_pdf_normalization_records_v1(
  p_actor_id uuid, p_run_id uuid, p_job_id uuid, p_attempt_id uuid
) returns jsonb language plpgsql stable security definer
set search_path = pg_catalog, public, auth
as $function$
declare records_json jsonb;
begin
  perform public.af_assert_actor_scope(p_actor_id);
  if not exists (
    select 1 from public.af_research_runs run
    join public.af_cases stored_case on stored_case.id = run.case_id
    join public.af_research_jobs job on job.run_id = run.id
    join public.af_research_attempts attempt on attempt.run_id = run.id and attempt.job_id = job.id
    where run.id = p_run_id and stored_case.owner_id = p_actor_id
      and job.id = p_job_id and attempt.id = p_attempt_id and job.stage = 'NORMALIZATION'
  ) then return null; end if;
  select coalesce(jsonb_agg(public.af_pdf_normalization_record_json_v1(record)
    order by record.accepted_at, record.id), '[]'::jsonb) into records_json
  from public.af_pdf_normalization_records record
  where record.run_id = p_run_id and record.job_id = p_job_id and record.attempt_id = p_attempt_id;
  return records_json;
end;
$function$;

create function public.af_accept_pdf_normalization_v1(
  p_actor_id uuid, p_lease jsonb, p_record jsonb, p_lease_seconds integer
) returns jsonb language plpgsql volatile security definer
set search_path = pg_catalog, public, auth
as $function$
declare
  observed_at timestamptz := clock_timestamp(); mutation_time timestamptz;
  run_row public.af_research_runs%rowtype; job_row public.af_research_jobs%rowtype;
  attempt_row public.af_research_attempts%rowtype; lease_row public.af_research_job_leases%rowtype;
  manifest_row public.af_research_attempt_input_manifests%rowtype;
  retrieval_row public.af_source_retrieval_records%rowtype;
  stored_record public.af_pdf_normalization_records%rowtype;
  result_json jsonb := p_record->'result'; receipt_json jsonb;
  candidate_id_value uuid; source_id_value uuid; locator_id_value uuid;
  fingerprint_value public.af_sha256;
begin
  perform public.af_assert_actor_scope(p_actor_id);
  if p_lease_seconds not between 5 and 900
    or not public.af_research_lease_cursor_valid(p_lease)
    or not public.af_pdf_normalization_record_valid_v1(p_record) then
    raise exception using errcode = 'AFR04', message = 'Invalid PDF-normalization acceptance input';
  end if;
  receipt_json := case when result_json->>'status' = 'NORMALIZED' then result_json->'receipt' else null end;
  candidate_id_value := (case when receipt_json is null then result_json->>'candidateId' else receipt_json->>'candidateId' end)::uuid;
  source_id_value := (case when receipt_json is null then result_json->>'sourceId' else receipt_json->>'sourceId' end)::uuid;
  locator_id_value := (case when receipt_json is null then result_json->>'sourceLocatorId' else receipt_json->>'sourceLocatorId' end)::uuid;
  if p_lease->>'runId' is distinct from p_record->>'runId'
    or p_lease->>'jobId' is distinct from p_record->>'jobId'
    or p_lease->>'attemptId' is distinct from p_record->>'attemptId' then
    raise exception using errcode = 'AFR04', message = 'PDF normalization does not match the active lease';
  end if;
  select stored_run.* into run_row from public.af_research_runs stored_run
  join public.af_cases stored_case on stored_case.id = stored_run.case_id
  where stored_run.id = (p_record->>'runId')::uuid and stored_case.owner_id = p_actor_id for update of stored_run;
  if not found then raise exception using errcode = 'AFR05', message = 'Actor scope mismatch or record not found'; end if;
  select * into job_row from public.af_research_jobs where id = (p_record->>'jobId')::uuid and run_id = run_row.id for update;
  select * into attempt_row from public.af_research_attempts where id = (p_record->>'attemptId')::uuid
    and run_id = run_row.id and job_id = job_row.id for update;
  select * into lease_row from public.af_research_job_leases where attempt_id = attempt_row.id for update;
  select * into manifest_row from public.af_research_attempt_input_manifests where attempt_id = attempt_row.id for share;
  select * into retrieval_row from public.af_source_retrieval_records
  where id = (p_record->>'retrievalRecordId')::uuid and run_id = run_row.id
    and attempt_id = attempt_row.id and candidate_id = candidate_id_value
    and source_id = source_id_value and source_locator_id = locator_id_value for share;
  if job_row.id is null or attempt_row.id is null or lease_row.attempt_id is null
    or manifest_row.id is null or retrieval_row.id is null then
    raise exception using errcode = 'AFR05', message = 'Actor scope mismatch or record not found';
  end if;
  if run_row.status = 'CANCELLED' or job_row.status = 'CANCELLED' or attempt_row.status = 'CANCELLED'
    then return jsonb_build_object('status','CANCELLED'); end if;
  if not public.af_research_lease_cursor_matches(p_lease, lease_row, run_row, job_row, attempt_row)
    or lease_row.released_at is not null or lease_row.lease_expires_at <= observed_at
    or job_row.status <> 'RUNNING' or job_row.stage <> 'NORMALIZATION'
    or job_row.active_attempt_id <> attempt_row.id or attempt_row.status <> 'RUNNING'
    then return jsonb_build_object('status','LEASE_LOST'); end if;
  if run_row.case_id <> (p_record->>'caseId')::uuid
    or manifest_row.manifest_fingerprint::text is distinct from p_record->>'manifestFingerprint'
    or not attempt_row.private_content_included
    or (p_record->>'createdAt')::timestamptz < attempt_row.started_at
    or (p_record->>'createdAt')::timestamptz > observed_at + interval '5 minutes' then
    raise exception using errcode = 'AFR07', message = 'PDF normalization does not match authoritative attempt input';
  end if;
  fingerprint_value := public.af_canonical_jsonb_sha256_v1('pdf-normalization-record', p_record);
  select * into stored_record from public.af_pdf_normalization_records
  where attempt_id = attempt_row.id and retrieval_record_id = retrieval_row.id for update;
  if found then
    if stored_record.normalization_fingerprint is distinct from fingerprint_value
      or stored_record.record_json is distinct from p_record then
      raise exception using errcode = 'AFR02', message = 'Retrieved PDF already identifies a different normalization';
    end if;
    mutation_time := greatest(observed_at, stored_record.accepted_at);
    update public.af_research_job_leases set last_heartbeat_at = mutation_time,
      lease_expires_at = mutation_time + make_interval(secs => p_lease_seconds)
    where attempt_id = attempt_row.id and lease_token = lease_row.lease_token returning * into lease_row;
    return jsonb_build_object('status','REPLAY','lease',public.af_research_lease_cursor_json(
      lease_row,run_row.aggregate_version,job_row.aggregate_version,attempt_row.aggregate_version,
      attempt_row.request_fingerprint),'record',public.af_pdf_normalization_record_json_v1(stored_record));
  end if;
  if receipt_json is not null then
    if retrieval_row.status <> 'RETRIEVED'
      or receipt_json->>'snapshotId' is distinct from retrieval_row.snapshot_id::text
      or receipt_json->>'contentFingerprint' is distinct from retrieval_row.content_fingerprint::text
      or receipt_json->>'sourceId' is distinct from retrieval_row.source_id::text
      or receipt_json->>'sourceLocatorId' is distinct from retrieval_row.source_locator_id::text
      or receipt_json->>'accessState' is distinct from retrieval_row.record_json#>>'{result,receipt,accessState}'
      or receipt_json->>'rightsState' is distinct from retrieval_row.record_json#>>'{result,receipt,rightsState}'
      or receipt_json->>'verifiedMediaType' is distinct from
        retrieval_row.record_json#>>'{result,receipt,verifiedMediaType}'
      or (receipt_json->>'sourceByteLength')::bigint is distinct from
        (retrieval_row.record_json#>>'{result,receipt,decodedContentLength}')::bigint
      or (receipt_json->>'normalizedAt')::timestamptz < attempt_row.started_at
      or (receipt_json->>'normalizedAt')::timestamptz > observed_at + interval '5 minutes' then
      raise exception using errcode = 'AFR07', message = 'PDF receipt violates accepted retrieval authority';
    end if;
    insert into public.af_untrusted_research_content (
      schema_version,id,run_id,job_id,attempt_id,candidate_id,content_kind,
      content_fingerprint,content_length,storage_ref,access_state,rights_state,
      trust_boundary,instruction_authority,screening_state,publication_authority,created_at
    ) values (1,(receipt_json->>'id')::uuid,run_row.id,job_row.id,attempt_row.id,
      retrieval_row.candidate_id,'DOCUMENT',receipt_json->>'documentFingerprint',
      (receipt_json->>'normalizedTextLength')::bigint,receipt_json->>'storageRef',
      (receipt_json->>'accessState')::public.af_access_state,
      (receipt_json->>'rightsState')::public.af_rights_state,'UNTRUSTED_SOURCE_DATA','NONE',
      (receipt_json->>'screeningState')::public.af_screening_state,'NONE',
      (receipt_json->>'normalizedAt')::timestamptz);
  end if;
  insert into public.af_pdf_normalization_records (
    schema_version,id,run_id,job_id,attempt_id,case_id,manifest_fingerprint,
    retrieval_record_id,candidate_id,source_id,source_locator_id,snapshot_id,content_id,
    idempotency_key,normalizer_id,normalizer_version,library_version,status,failure_code,
    document_fingerprint,source_byte_length,page_count,normalized_text_length,page_manifest,
    block_manifest,hostile_signals,retention,storage_ref,access_state,rights_state,
    normalization_fingerprint,trust_boundary,instruction_authority,screening_state,
    evidence_status,review_state,publication_authority,record_json,created_at,accepted_at
  ) values (1,(p_record->>'id')::uuid,run_row.id,job_row.id,attempt_row.id,run_row.case_id,
    manifest_row.manifest_fingerprint,retrieval_row.id,retrieval_row.candidate_id,
    retrieval_row.source_id,retrieval_row.source_locator_id,
    case when receipt_json is null then null else retrieval_row.snapshot_id end,
    case when receipt_json is null then null else (receipt_json->>'id')::uuid end,
    p_record->>'idempotencyKey',p_record#>>'{normalizer,id}',p_record#>>'{normalizer,version}',
    receipt_json->>'libraryVersion',result_json->>'status',
    case when receipt_json is null then result_json->>'code' else null end,
    receipt_json->>'documentFingerprint',
    case when receipt_json is null then null else (receipt_json->>'sourceByteLength')::bigint end,
    case when receipt_json is null then null else (receipt_json->>'pageCount')::integer end,
    case when receipt_json is null then null else (receipt_json->>'normalizedTextLength')::bigint end,
    receipt_json->'pageManifests',receipt_json->'blockManifests',receipt_json->'hostileSignals',
    receipt_json->>'retention',receipt_json->>'storageRef',
    case when receipt_json is null then null else (receipt_json->>'accessState')::public.af_access_state end,
    case when receipt_json is null then null else (receipt_json->>'rightsState')::public.af_rights_state end,
    fingerprint_value,'UNTRUSTED_SOURCE_DATA','NONE',
    case when receipt_json is null then 'UNSCREENED' else (receipt_json->>'screeningState')::public.af_screening_state end,
    'NOT_EVIDENCE','PROPOSED','NONE',p_record,(p_record->>'createdAt')::timestamptz,
    greatest(observed_at,(p_record->>'createdAt')::timestamptz)) returning * into stored_record;
  mutation_time := greatest(observed_at,(p_record->>'createdAt')::timestamptz);
  update public.af_research_job_leases set last_heartbeat_at = mutation_time,
    lease_expires_at = mutation_time + make_interval(secs => p_lease_seconds)
  where attempt_id = attempt_row.id and lease_token = lease_row.lease_token returning * into lease_row;
  return jsonb_build_object('status','COMMITTED','lease',public.af_research_lease_cursor_json(
    lease_row,run_row.aggregate_version,job_row.aggregate_version,attempt_row.aggregate_version,
    attempt_row.request_fingerprint),'record',public.af_pdf_normalization_record_json_v1(stored_record));
exception
  when unique_violation then raise exception using errcode = 'AFR03', message = 'PDF normalization conflicts with an existing identifier or idempotency key';
  when foreign_key_violation or check_violation or not_null_violation
    or invalid_text_representation or numeric_value_out_of_range then
    raise exception using errcode = 'AFR04', message = 'PDF normalization failed schema or reference invariants';
end;
$function$;

alter table public.af_pdf_normalization_records enable row level security;
alter table public.af_pdf_normalization_records force row level security;
revoke all on table public.af_pdf_normalization_records from public, anon, authenticated;
grant all on table public.af_pdf_normalization_records to service_role;

revoke all on function public.af_pdf_text_anchor_valid_v1(jsonb,integer) from public,anon,authenticated;
revoke all on function public.af_pdf_page_manifest_valid_v1(jsonb,integer,integer) from public,anon,authenticated;
revoke all on function public.af_pdf_block_manifest_valid_v1(jsonb,integer,integer) from public,anon,authenticated;
revoke all on function public.af_pdf_hostile_signal_valid_v1(jsonb,integer) from public,anon,authenticated;
revoke all on function public.af_pdf_document_receipt_valid_v1(jsonb) from public,anon,authenticated;
revoke all on function public.af_pdf_normalization_record_valid_v1(jsonb) from public,anon,authenticated;
revoke all on function public.af_pdf_normalization_record_json_v1(public.af_pdf_normalization_records) from public,anon,authenticated;
revoke all on function public.af_get_pdf_normalization_records_v1(uuid,uuid,uuid,uuid) from public,anon,authenticated;
revoke all on function public.af_accept_pdf_normalization_v1(uuid,jsonb,jsonb,integer) from public,anon,authenticated;
grant execute on function public.af_get_pdf_normalization_records_v1(uuid,uuid,uuid,uuid) to service_role;
grant execute on function public.af_accept_pdf_normalization_v1(uuid,jsonb,jsonb,integer) to service_role;

comment on function public.af_accept_pdf_normalization_v1(uuid,jsonb,jsonb,integer) is
  'Actor-scoped active-lease acceptance for text-free PDF page/object normalization receipts.';
