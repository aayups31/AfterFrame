-- AFTERFRAME checkpoint 04C: durable, body-free source-resolution acceptance.
--
-- A discovered candidate may become only a proposed canonical source and a
-- SOURCE_ONLY locator here. Each decision is bound to the exact RESOLUTION
-- attempt manifest and accepted through the active worker lease. It remains
-- NOT_EVIDENCE and has no publication authority.

create unique index af_sources_canonical_key_unique_idx
  on public.af_sources(canonical_key);

create table public.af_source_resolution_records (
  schema_version smallint not null
    constraint af_source_resolutions_schema_version_check check (schema_version = 1),
  id uuid primary key,
  run_id uuid not null,
  job_id uuid not null,
  attempt_id uuid not null,
  case_id uuid not null,
  candidate_id uuid not null,
  manifest_fingerprint public.af_sha256 not null,
  idempotency_key public.af_opaque_reference not null,
  resolver_id public.af_slug not null,
  resolver_version public.af_version_tag not null,
  status text not null
    constraint af_source_resolutions_status_check
      check (status in ('RESOLVED', 'UNRESOLVED')),
  failure_code text,
  source_id uuid,
  locator_id uuid,
  resolution_fingerprint public.af_sha256 not null,
  review_state public.af_review_state not null
    constraint af_source_resolutions_review_check check (review_state = 'PROPOSED'),
  metadata_trust text not null
    constraint af_source_resolutions_metadata_trust_check
      check (metadata_trust = 'UNTRUSTED_SOURCE_DATA'),
  evidence_status text not null
    constraint af_source_resolutions_evidence_check check (evidence_status = 'NOT_EVIDENCE'),
  publication_authority text not null
    constraint af_source_resolutions_publication_check check (publication_authority = 'NONE'),
  content_body_included boolean not null
    constraint af_source_resolutions_body_check check (not content_body_included),
  record_json jsonb not null
    constraint af_source_resolutions_record_object_check
      check (jsonb_typeof(record_json) = 'object'),
  created_at timestamptz not null,
  accepted_at timestamptz not null,
  constraint af_source_resolutions_attempt_fk
    foreign key (run_id, job_id, attempt_id)
    references public.af_research_attempts(run_id, job_id, id) on delete cascade,
  constraint af_source_resolutions_run_case_fk
    foreign key (run_id, case_id)
    references public.af_research_runs(id, case_id) on delete cascade,
  constraint af_source_resolutions_candidate_fk
    foreign key (run_id, candidate_id)
    references public.af_source_candidates(run_id, id) on delete cascade,
  constraint af_source_resolutions_source_locator_fk
    foreign key (source_id, locator_id)
    references public.af_source_locators(source_id, id),
  constraint af_source_resolutions_partition_check check (
    (
      status = 'RESOLVED' and failure_code is null
      and source_id is not null and locator_id is not null
    ) or (
      status = 'UNRESOLVED' and failure_code in (
        'candidate-url-missing', 'network-target-rejected',
        'probe-unavailable', 'probe-contract-invalid',
        'redirect-chain-invalid', 'source-unavailable',
        'source-medium-unsupported'
      ) and source_id is null and locator_id is null
    )
  ),
  constraint af_source_resolutions_time_check check (accepted_at >= created_at),
  unique (attempt_id, candidate_id),
  unique (attempt_id, idempotency_key)
);

comment on table public.af_source_resolution_records is
  'Body-free, lease-fenced resolution decisions. RESOLVED means proposed source identity plus SOURCE_ONLY locator; it never means evidence or publication authority.';

create function public.af_source_resolution_source_valid_v1(value_to_check jsonb)
returns boolean
language plpgsql
immutable
set search_path = pg_catalog, public
as $function$
declare
  contributor_value text[];
begin
  if not public.af_jsonb_has_exact_keys(
    value_to_check,
    array[
      'id', 'canonicalKey', 'canonicalUrl', 'title', 'contributors',
      'publisher', 'publishedAt', 'medium', 'sourceClass', 'accessState',
      'rightsState', 'independenceGroupId', 'origin', 'createdAt'
    ]
  ) or jsonb_typeof(value_to_check->'contributors') <> 'array'
    or not public.af_jsonb_has_exact_keys(
    value_to_check->'origin', array['kind', 'actorId', 'version']
  ) then return false; end if;
  contributor_value := array(
    select jsonb_array_elements_text(value_to_check->'contributors')
  );
  perform (value_to_check->>'id')::uuid;
  perform (value_to_check->>'canonicalUrl')::public.af_http_url;
  perform (value_to_check->>'medium')::public.af_source_medium;
  perform (value_to_check->>'sourceClass')::public.af_slug;
  perform (value_to_check->>'accessState')::public.af_access_state;
  perform (value_to_check->>'rightsState')::public.af_rights_state;
  perform (value_to_check#>>'{origin,kind}')::public.af_origin_kind;
  perform (value_to_check#>>'{origin,version}')::public.af_version_tag;
  perform (value_to_check->>'createdAt')::timestamptz;
  return value_to_check->>'canonicalKey' = btrim(value_to_check->>'canonicalKey')
    and char_length(value_to_check->>'canonicalKey') between 1 and 1000
    and value_to_check->>'canonicalKey' = 'url-sha256:' || encode(
      extensions.digest(
        convert_to(value_to_check->>'canonicalUrl', 'UTF8'), 'sha256'
      ),
      'hex'
    )
    and value_to_check->>'title' = btrim(value_to_check->>'title')
    and char_length(value_to_check->>'title') between 1 and 1000
    and public.af_text_array_valid(contributor_value, 30, 1, 300)
    and cardinality(contributor_value) = 0
    and value_to_check->'publisher' = 'null'::jsonb
    and value_to_check->'publishedAt' = 'null'::jsonb
    and value_to_check->'independenceGroupId' = 'null'::jsonb
    and value_to_check->>'accessState' = 'OPEN'
    and value_to_check->>'rightsState' = 'LINK_ONLY'
    and value_to_check->>'medium' not in ('USER_ASSET', 'OTHER')
    and value_to_check#>>'{origin,kind}' = 'RESOLVER'
    and value_to_check#>'{origin,actorId}' = 'null'::jsonb;
exception
  when invalid_text_representation or check_violation
    or numeric_value_out_of_range or datetime_field_overflow then return false;
end;
$function$;

create function public.af_source_resolution_locator_valid_v1(value_to_check jsonb)
returns boolean
language plpgsql
immutable
set search_path = pg_catalog, public
as $function$
declare
  kind_value public.af_source_medium;
  expected_keys text[];
  common_keys constant text[] := array[
    'id', 'sourceId', 'status', 'resolver', 'revision',
    'supersedesLocatorId', 'openUrl', 'resolvedAt', 'lastVerifiedAt',
    'createdAt', 'kind'
  ];
begin
  kind_value := (value_to_check->>'kind')::public.af_source_medium;
  expected_keys := common_keys || case kind_value
    when 'ARTICLE' then array['headingPath', 'paragraphIndex', 'textFingerprint', 'textFragmentUrl']
    when 'WEBPAGE' then array['headingPath', 'paragraphIndex', 'textFingerprint', 'textFragmentUrl']
    when 'VIDEO' then array['provider', 'providerItemId', 'timestampStartMs', 'timestampEndMs', 'transcriptCueIds', 'transcriptFingerprint']
    when 'PODCAST' then array['provider', 'providerItemId', 'timestampStartMs', 'timestampEndMs', 'transcriptCueIds', 'transcriptFingerprint']
    when 'BOOK' then array['editionId', 'isbn', 'pageStart', 'pageEnd', 'printedPageLabel', 'chapter', 'section']
    when 'PDF' then array['documentVersionId', 'pageIndex', 'printedPageLabel', 'section', 'heading', 'textFingerprint']
    when 'ARCHIVE' then array['collectionId', 'itemId', 'documentVersionId', 'pageIndex', 'printedPageLabel', 'section', 'heading', 'textFingerprint']
    when 'OFFICIAL_RECORD' then array['issuingBody', 'recordId', 'documentVersionId', 'pageIndex', 'printedPageLabel', 'section', 'heading', 'textFingerprint']
    when 'SCREENPLAY' then array['draftId', 'sceneNumber', 'sceneHeading', 'documentVersionId', 'pageIndex', 'printedPageLabel', 'section', 'heading', 'textFingerprint']
    else array[]::text[] end;
  if kind_value in ('USER_ASSET', 'OTHER')
    or not public.af_jsonb_has_exact_keys(value_to_check, expected_keys)
    or not public.af_jsonb_has_exact_keys(
      value_to_check->'resolver', array['id', 'version']
    ) then return false; end if;
  perform (value_to_check->>'id')::uuid;
  perform (value_to_check->>'sourceId')::uuid;
  perform (value_to_check#>>'{resolver,id}')::public.af_slug;
  perform (value_to_check#>>'{resolver,version}')::public.af_version_tag;
  perform (value_to_check->>'openUrl')::public.af_http_url;
  perform (value_to_check->>'resolvedAt')::timestamptz;
  perform (value_to_check->>'createdAt')::timestamptz;
  return value_to_check->>'status' = 'SOURCE_ONLY'
    and (value_to_check->>'revision')::integer = 1
    and value_to_check->'supersedesLocatorId' = 'null'::jsonb
    and value_to_check->'lastVerifiedAt' = 'null'::jsonb
    and (value_to_check->>'resolvedAt')::timestamptz >=
      (value_to_check->>'createdAt')::timestamptz;
exception
  when invalid_text_representation or check_violation
    or numeric_value_out_of_range or datetime_field_overflow then return false;
end;
$function$;

create function public.af_source_resolution_record_valid_v1(value_to_check jsonb)
returns boolean
language plpgsql
immutable
set search_path = pg_catalog, public
as $function$
declare
  result_json jsonb;
  proposal_json jsonb;
  source_json jsonb;
  locator_json jsonb;
begin
  if not public.af_jsonb_has_exact_keys(
    value_to_check,
    array[
      'schemaVersion', 'id', 'runId', 'jobId', 'attemptId', 'caseId',
      'manifestFingerprint', 'idempotencyKey', 'resolver', 'result', 'createdAt'
    ]
  ) or not public.af_jsonb_has_exact_keys(
    value_to_check->'resolver', array['id', 'version']
  ) then return false; end if;
  perform (value_to_check->>'id')::uuid;
  perform (value_to_check->>'runId')::uuid;
  perform (value_to_check->>'jobId')::uuid;
  perform (value_to_check->>'attemptId')::uuid;
  perform (value_to_check->>'caseId')::uuid;
  perform (value_to_check->>'manifestFingerprint')::public.af_sha256;
  perform (value_to_check->>'idempotencyKey')::public.af_opaque_reference;
  perform (value_to_check#>>'{resolver,id}')::public.af_slug;
  perform (value_to_check#>>'{resolver,version}')::public.af_version_tag;
  perform (value_to_check->>'createdAt')::timestamptz;
  if (value_to_check->>'schemaVersion')::integer <> 1 then return false; end if;
  result_json := value_to_check->'result';
  if result_json->>'status' = 'UNRESOLVED' then
    return public.af_jsonb_has_exact_keys(
      result_json,
      array['status', 'candidateId', 'code', 'publicationAuthority']
    ) and (result_json->>'candidateId')::uuid is not null
      and result_json->>'code' in (
        'candidate-url-missing', 'network-target-rejected',
        'probe-unavailable', 'probe-contract-invalid',
        'redirect-chain-invalid', 'source-unavailable',
        'source-medium-unsupported'
      ) and result_json->>'publicationAuthority' = 'NONE';
  end if;
  if result_json->>'status' <> 'RESOLVED'
    or not public.af_jsonb_has_exact_keys(result_json, array['status', 'proposal']) then
    return false;
  end if;
  proposal_json := result_json->'proposal';
  if not public.af_jsonb_has_exact_keys(
    proposal_json,
    array[
      'candidateId', 'source', 'locator', 'reviewState', 'metadataTrust',
      'evidenceStatus', 'publicationAuthority', 'contentBodyIncluded'
    ]
  ) then return false; end if;
  source_json := proposal_json->'source';
  locator_json := proposal_json->'locator';
  return public.af_source_resolution_source_valid_v1(source_json)
    and public.af_source_resolution_locator_valid_v1(locator_json)
    and (proposal_json->>'candidateId')::uuid is not null
    and proposal_json->>'reviewState' = 'PROPOSED'
    and proposal_json->>'metadataTrust' = 'UNTRUSTED_SOURCE_DATA'
    and proposal_json->>'evidenceStatus' = 'NOT_EVIDENCE'
    and proposal_json->>'publicationAuthority' = 'NONE'
    and proposal_json->'contentBodyIncluded' = 'false'::jsonb
    and source_json->>'id' = locator_json->>'sourceId'
    and source_json->>'canonicalUrl' = locator_json->>'openUrl'
    and source_json->>'medium' = locator_json->>'kind'
    and value_to_check#>>'{resolver,id}' = locator_json#>>'{resolver,id}'
    and value_to_check#>>'{resolver,version}' = locator_json#>>'{resolver,version}'
    and value_to_check#>>'{resolver,version}' = source_json#>>'{origin,version}';
exception
  when invalid_text_representation or check_violation
    or numeric_value_out_of_range or datetime_field_overflow then return false;
end;
$function$;

create function public.af_source_identity_matches_resolution_v1(
  source_row public.af_sources,
  source_json jsonb
)
returns boolean
language sql
stable
set search_path = pg_catalog, public
as $function$
  select source_row.id = (source_json->>'id')::uuid
    and source_row.canonical_key = source_json->>'canonicalKey'
    and source_row.canonical_url::text = source_json->>'canonicalUrl'
    and source_row.medium::text = source_json->>'medium'
    and source_row.source_class::text = source_json->>'sourceClass'
    and source_row.access_state = 'OPEN'
    and source_row.rights_state = 'LINK_ONLY'
    and source_row.independence_group_id is null
    and source_row.origin_kind = 'RESOLVER'
    and source_row.origin_actor_id is null
    and source_row.origin_version::text = source_json#>>'{origin,version}';
$function$;

create function public.af_source_locator_matches_resolution_v1(
  locator_row public.af_source_locators,
  locator_json jsonb
)
returns boolean
language sql
stable
set search_path = pg_catalog, public
as $function$
  select locator_row.id = (locator_json->>'id')::uuid
    and locator_row.source_id = (locator_json->>'sourceId')::uuid
    and locator_row.kind::text = locator_json->>'kind'
    and locator_row.status = 'SOURCE_ONLY'
    and locator_row.resolver_id::text = locator_json#>>'{resolver,id}'
    and locator_row.resolver_version::text = locator_json#>>'{resolver,version}'
    and locator_row.revision = 1
    and locator_row.supersedes_locator_id is null
    and locator_row.open_url::text = locator_json->>'openUrl'
    and locator_row.heading_path is not distinct from case
      when locator_json ? 'headingPath' then
        array(select jsonb_array_elements_text(locator_json->'headingPath'))
      else null end
    and locator_row.paragraph_index is not distinct from
      (locator_json->>'paragraphIndex')::integer
    and locator_row.text_fragment_url::text is not distinct from
      locator_json->>'textFragmentUrl'
    and locator_row.provider::text is not distinct from locator_json->>'provider'
    and locator_row.provider_item_id::text is not distinct from locator_json->>'providerItemId'
    and locator_row.timestamp_start_ms is not distinct from
      (locator_json->>'timestampStartMs')::bigint
    and locator_row.timestamp_end_ms is not distinct from
      (locator_json->>'timestampEndMs')::bigint
    and locator_row.transcript_cue_ids is not distinct from case
      when locator_json ? 'transcriptCueIds' then
        array(select jsonb_array_elements_text(locator_json->'transcriptCueIds'))
      else null end
    and locator_row.transcript_fingerprint::text is not distinct from locator_json->>'transcriptFingerprint'
    and locator_row.edition_id::text is not distinct from locator_json->>'editionId'
    and locator_row.isbn is not distinct from locator_json->>'isbn'
    and locator_row.page_start is not distinct from (locator_json->>'pageStart')::integer
    and locator_row.page_end is not distinct from (locator_json->>'pageEnd')::integer
    and locator_row.printed_page_label is not distinct from locator_json->>'printedPageLabel'
    and locator_row.chapter is not distinct from locator_json->>'chapter'
    and locator_row.section is not distinct from locator_json->>'section'
    and locator_row.text_fingerprint::text is not distinct from locator_json->>'textFingerprint'
    and locator_row.document_version_id::text is not distinct from locator_json->>'documentVersionId'
    and locator_row.page_index is not distinct from (locator_json->>'pageIndex')::integer
    and locator_row.heading is not distinct from locator_json->>'heading'
    and locator_row.collection_id::text is not distinct from locator_json->>'collectionId'
    and locator_row.item_id::text is not distinct from locator_json->>'itemId'
    and locator_row.issuing_body is not distinct from locator_json->>'issuingBody'
    and locator_row.record_id::text is not distinct from locator_json->>'recordId'
    and locator_row.draft_id::text is not distinct from locator_json->>'draftId'
    and locator_row.scene_number is not distinct from locator_json->>'sceneNumber'
    and locator_row.scene_heading is not distinct from locator_json->>'sceneHeading';
$function$;

create function public.af_source_resolution_record_json_v1(
  resolution_row public.af_source_resolution_records
)
returns jsonb
language sql
stable
set search_path = pg_catalog
as $function$
  select resolution_row.record_json || jsonb_build_object(
    'resolutionFingerprint', resolution_row.resolution_fingerprint,
    'acceptedAt', resolution_row.accepted_at
  );
$function$;

create function public.af_get_research_resolution_context_v1(
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
  candidates_json jsonb;
begin
  perform public.af_assert_actor_scope(p_actor_id);
  select stored_run.* into run_row
  from public.af_research_runs stored_run
  join public.af_cases stored_case on stored_case.id = stored_run.case_id
  where stored_run.id = p_run_id and stored_case.owner_id = p_actor_id;
  if not found then return null; end if;
  select * into job_row from public.af_research_jobs
  where id = p_job_id and run_id = run_row.id and stage = 'RESOLUTION';
  select * into attempt_row from public.af_research_attempts
  where id = p_attempt_id and run_id = run_row.id and job_id = job_row.id;
  select * into manifest_row from public.af_research_attempt_input_manifests
  where attempt_id = attempt_row.id;
  if job_row.id is null or attempt_row.id is null or manifest_row.id is null
    or job_row.status <> 'RUNNING' or job_row.active_attempt_id <> attempt_row.id
    or attempt_row.status <> 'RUNNING' then return null; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
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
  ) order by candidate.id), '[]'::jsonb) into candidates_json
  from public.af_source_candidates candidate where candidate.run_id = run_row.id;
  return jsonb_build_object(
    'schemaVersion', 1, 'runId', run_row.id, 'jobId', job_row.id,
    'attemptId', attempt_row.id, 'caseId', run_row.case_id,
    'manifestFingerprint', manifest_row.manifest_fingerprint,
    'candidates', candidates_json
  );
end;
$function$;

create function public.af_get_source_resolution_records_v1(
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
      and job.stage = 'RESOLUTION'
  ) then return null; end if;
  select coalesce(jsonb_agg(
    public.af_source_resolution_record_json_v1(record)
    order by record.accepted_at, record.id
  ), '[]'::jsonb) into records_json
  from public.af_source_resolution_records record
  where record.run_id = p_run_id and record.job_id = p_job_id
    and record.attempt_id = p_attempt_id;
  return records_json;
end;
$function$;

create function public.af_accept_source_resolution_v1(
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
  source_row public.af_sources%rowtype;
  locator_row public.af_source_locators%rowtype;
  stored_resolution public.af_source_resolution_records%rowtype;
  result_json jsonb := p_record->'result';
  proposal_json jsonb;
  source_json jsonb;
  locator_json jsonb;
  resolution_fingerprint_value public.af_sha256;
  candidate_id_value uuid;
begin
  perform public.af_assert_actor_scope(p_actor_id);
  if p_lease_seconds not between 5 and 900
    or not public.af_research_lease_cursor_valid(p_lease)
    or not public.af_source_resolution_record_valid_v1(p_record) then
    raise exception using errcode = 'AFR04', message = 'Invalid source-resolution acceptance input';
  end if;
  candidate_id_value := case when result_json->>'status' = 'RESOLVED'
    then (result_json#>>'{proposal,candidateId}')::uuid
    else (result_json->>'candidateId')::uuid end;
  if p_lease->>'runId' is distinct from p_record->>'runId'
    or p_lease->>'jobId' is distinct from p_record->>'jobId'
    or p_lease->>'attemptId' is distinct from p_record->>'attemptId' then
    raise exception using errcode = 'AFR04', message = 'Source resolution does not match the active lease';
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
  where id = candidate_id_value and run_id = run_row.id for share;
  if job_row.id is null or attempt_row.id is null or lease_row.attempt_id is null
    or manifest_row.id is null or candidate_row.id is null then
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
    or job_row.status <> 'RUNNING' or job_row.stage <> 'RESOLUTION'
    or job_row.active_attempt_id <> attempt_row.id
    or attempt_row.status <> 'RUNNING' then
    return jsonb_build_object('status', 'LEASE_LOST');
  end if;
  if run_row.case_id <> (p_record->>'caseId')::uuid
    or manifest_row.manifest_fingerprint::text
      is distinct from p_record->>'manifestFingerprint'
    or attempt_row.execution_kind <> 'RESOLVER'
    or attempt_row.tool_id::text is distinct from p_record#>>'{resolver,id}'
    or attempt_row.tool_version::text is distinct from p_record#>>'{resolver,version}'
    or attempt_row.private_content_included
    or (p_record->>'createdAt')::timestamptz < attempt_row.started_at
    or (p_record->>'createdAt')::timestamptz > observed_at + interval '5 minutes' then
    raise exception using errcode = 'AFR07', message = 'Source resolution does not match authoritative attempt input';
  end if;

  resolution_fingerprint_value := public.af_canonical_jsonb_sha256_v1(
    'source-resolution-record', p_record
  );
  select * into stored_resolution
  from public.af_source_resolution_records
  where attempt_id = attempt_row.id and candidate_id = candidate_row.id
  for update;
  if found then
    if stored_resolution.resolution_fingerprint is distinct from resolution_fingerprint_value
      or stored_resolution.record_json is distinct from p_record then
      raise exception using errcode = 'AFR02', message = 'Candidate resolution already identifies a different decision';
    end if;
    mutation_time := greatest(observed_at, stored_resolution.accepted_at);
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
      'record', public.af_source_resolution_record_json_v1(stored_resolution)
    );
  end if;

  if result_json->>'status' = 'RESOLVED' then
    proposal_json := result_json->'proposal';
    source_json := proposal_json->'source';
    locator_json := proposal_json->'locator';
    if source_json->>'medium' is distinct from candidate_row.medium::text
      or source_json->>'sourceClass' is distinct from candidate_row.source_class::text then
      raise exception using errcode = 'AFR04', message = 'Resolved source violates candidate medium or source class';
    end if;
    select * into source_row from public.af_sources
    where id = (source_json->>'id')::uuid for update;
    if found then
      if not public.af_source_identity_matches_resolution_v1(source_row, source_json) then
        raise exception using errcode = 'AFR02', message = 'Canonical source identifier conflicts with stored identity';
      end if;
    else
      if exists (
        select 1 from public.af_sources
        where canonical_key = source_json->>'canonicalKey'
      ) then
        raise exception using errcode = 'AFR02', message = 'Canonical source key identifies another source';
      end if;
      insert into public.af_sources (
        id, canonical_key, canonical_url, title, contributors, publisher,
        published_at, medium, source_class, access_state, rights_state,
        independence_group_id, origin_kind, origin_actor_id, origin_version,
        created_at
      ) values (
        (source_json->>'id')::uuid, source_json->>'canonicalKey',
        source_json->>'canonicalUrl', source_json->>'title',
        array(select jsonb_array_elements_text(source_json->'contributors')),
        null, null, (source_json->>'medium')::public.af_source_medium,
        source_json->>'sourceClass', 'OPEN', 'LINK_ONLY', null,
        'RESOLVER', null, source_json#>>'{origin,version}',
        (source_json->>'createdAt')::timestamptz
      ) returning * into source_row;
    end if;
    insert into public.af_case_sources(case_id, source_id, created_at)
    values (run_row.case_id, source_row.id, observed_at)
    on conflict (case_id, source_id) do nothing;

    select * into locator_row from public.af_source_locators
    where id = (locator_json->>'id')::uuid for update;
    if found then
      if not public.af_source_locator_matches_resolution_v1(locator_row, locator_json) then
        raise exception using errcode = 'AFR02', message = 'Source locator identifier conflicts with stored proposal';
      end if;
    else
      insert into public.af_source_locators (
        id, source_id, kind, status, resolver_id, resolver_version,
        revision, supersedes_locator_id, open_url, resolved_at,
        last_verified_at, created_at, heading_path, paragraph_index,
        text_fragment_url, provider, provider_item_id, timestamp_start_ms,
        timestamp_end_ms, transcript_cue_ids, transcript_fingerprint,
        edition_id, isbn, page_start, page_end, printed_page_label, chapter,
        section, text_fingerprint, document_version_id, page_index, heading,
        collection_id, item_id, issuing_body, record_id, draft_id,
        scene_number, scene_heading, asset_id, location_description,
        content_fingerprint
      ) values (
        (locator_json->>'id')::uuid, source_row.id,
        (locator_json->>'kind')::public.af_source_medium, 'SOURCE_ONLY',
        locator_json#>>'{resolver,id}', locator_json#>>'{resolver,version}',
        1, null, locator_json->>'openUrl',
        (locator_json->>'resolvedAt')::timestamptz, null,
        (locator_json->>'createdAt')::timestamptz,
        case when locator_json ? 'headingPath' then
          array(select jsonb_array_elements_text(locator_json->'headingPath')) else null end,
        (locator_json->>'paragraphIndex')::integer,
        locator_json->>'textFragmentUrl', locator_json->>'provider',
        locator_json->>'providerItemId',
        (locator_json->>'timestampStartMs')::bigint,
        (locator_json->>'timestampEndMs')::bigint,
        case when locator_json ? 'transcriptCueIds' then
          array(select jsonb_array_elements_text(locator_json->'transcriptCueIds')) else null end,
        locator_json->>'transcriptFingerprint', locator_json->>'editionId',
        locator_json->>'isbn', (locator_json->>'pageStart')::integer,
        (locator_json->>'pageEnd')::integer,
        locator_json->>'printedPageLabel', locator_json->>'chapter',
        locator_json->>'section', locator_json->>'textFingerprint',
        locator_json->>'documentVersionId',
        (locator_json->>'pageIndex')::integer, locator_json->>'heading',
        locator_json->>'collectionId', locator_json->>'itemId',
        locator_json->>'issuingBody', locator_json->>'recordId',
        locator_json->>'draftId', locator_json->>'sceneNumber',
        locator_json->>'sceneHeading', null, null, null
      ) returning * into locator_row;
    end if;
  end if;

  insert into public.af_source_resolution_records (
    schema_version, id, run_id, job_id, attempt_id, case_id, candidate_id,
    manifest_fingerprint, idempotency_key, resolver_id, resolver_version,
    status, failure_code, source_id, locator_id, resolution_fingerprint,
    review_state, metadata_trust, evidence_status, publication_authority,
    content_body_included, record_json, created_at, accepted_at
  ) values (
    1, (p_record->>'id')::uuid, run_row.id, job_row.id, attempt_row.id,
    run_row.case_id, candidate_row.id, manifest_row.manifest_fingerprint,
    p_record->>'idempotencyKey', p_record#>>'{resolver,id}',
    p_record#>>'{resolver,version}', result_json->>'status',
    case when result_json->>'status' = 'UNRESOLVED' then result_json->>'code' else null end,
    case when result_json->>'status' = 'RESOLVED' then (source_json->>'id')::uuid else null end,
    case when result_json->>'status' = 'RESOLVED' then (locator_json->>'id')::uuid else null end,
    resolution_fingerprint_value, 'PROPOSED', 'UNTRUSTED_SOURCE_DATA',
    'NOT_EVIDENCE', 'NONE', false, p_record,
    (p_record->>'createdAt')::timestamptz,
    greatest(observed_at, (p_record->>'createdAt')::timestamptz)
  ) returning * into stored_resolution;

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
    'record', public.af_source_resolution_record_json_v1(stored_resolution)
  );
exception
  when unique_violation then
    raise exception using errcode = 'AFR03', message = 'Source resolution conflicts with an existing identifier or canonical key';
  when foreign_key_violation or check_violation or not_null_violation
    or invalid_text_representation or numeric_value_out_of_range then
    raise exception using errcode = 'AFR04', message = 'Source resolution failed schema or reference invariants';
end;
$function$;

alter function public.af_persist_research_stage_result(
  uuid, uuid, uuid, public.af_research_stage, public.af_sha256,
  uuid, jsonb, timestamptz
) rename to af_persist_research_stage_result_without_resolution_acceptance_v1;

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
begin
  if p_stage = 'RESOLUTION' then
    if exists (
      select 1 from public.af_source_candidates candidate
      where candidate.run_id = p_run_id and not exists (
        select 1 from public.af_source_resolution_records resolution
        where resolution.run_id = candidate.run_id
          and resolution.attempt_id = p_attempt_id
          and resolution.candidate_id = candidate.id
      )
    ) or exists (
      select 1 from public.af_source_resolution_records resolution
      where resolution.run_id = p_run_id
        and resolution.attempt_id = p_attempt_id
        and not exists (
          select 1 from public.af_source_candidates candidate
          where candidate.run_id = resolution.run_id
            and candidate.id = resolution.candidate_id
        )
    ) then
      raise exception using errcode = 'AFR07', message = 'Resolution output requires an exact accepted candidate partition';
    end if;
    if jsonb_array_length(output_json->'sourceIds') <> (
        select count(distinct source_id) from public.af_source_resolution_records
        where run_id = p_run_id and attempt_id = p_attempt_id and status = 'RESOLVED'
      ) or exists (
        select value::uuid from jsonb_array_elements_text(output_json->'sourceIds') value
        except select distinct source_id from public.af_source_resolution_records
          where run_id = p_run_id and attempt_id = p_attempt_id and status = 'RESOLVED'
      ) or jsonb_array_length(output_json->'locatorIds') <> (
        select count(distinct locator_id) from public.af_source_resolution_records
        where run_id = p_run_id and attempt_id = p_attempt_id and status = 'RESOLVED'
      ) or exists (
        select value::uuid from jsonb_array_elements_text(output_json->'locatorIds') value
        except select distinct locator_id from public.af_source_resolution_records
          where run_id = p_run_id and attempt_id = p_attempt_id and status = 'RESOLVED'
      ) or jsonb_array_length(output_json->'unresolvedCandidateIds') <> (
        select count(*) from public.af_source_resolution_records
        where run_id = p_run_id and attempt_id = p_attempt_id and status = 'UNRESOLVED'
      ) or exists (
        select value::uuid from jsonb_array_elements_text(output_json->'unresolvedCandidateIds') value
        except select candidate_id from public.af_source_resolution_records
          where run_id = p_run_id and attempt_id = p_attempt_id and status = 'UNRESOLVED'
      ) then
      raise exception using errcode = 'AFR04', message = 'Resolution output IDs do not match accepted source-resolution decisions';
    end if;
  end if;
  perform public.af_persist_research_stage_result_without_resolution_acceptance_v1(
    p_run_id, p_job_id, p_attempt_id, p_stage, p_stage_input_fingerprint,
    p_plan_id, p_result, p_completed_at
  );
end;
$function$;

alter table public.af_source_resolution_records enable row level security;
alter table public.af_source_resolution_records force row level security;

revoke all on table public.af_source_resolution_records
  from public, anon, authenticated;
grant all on table public.af_source_resolution_records to service_role;

revoke all on function public.af_source_resolution_source_valid_v1(jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.af_source_resolution_locator_valid_v1(jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.af_source_resolution_record_valid_v1(jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.af_source_identity_matches_resolution_v1(
  public.af_sources, jsonb
) from public, anon, authenticated, service_role;
revoke all on function public.af_source_locator_matches_resolution_v1(
  public.af_source_locators, jsonb
) from public, anon, authenticated, service_role;
revoke all on function public.af_source_resolution_record_json_v1(
  public.af_source_resolution_records
) from public, anon, authenticated, service_role;
revoke all on function public.af_persist_research_stage_result_without_resolution_acceptance_v1(
  uuid, uuid, uuid, public.af_research_stage, public.af_sha256,
  uuid, jsonb, timestamptz
) from public, anon, authenticated, service_role;
revoke all on function public.af_persist_research_stage_result(
  uuid, uuid, uuid, public.af_research_stage, public.af_sha256,
  uuid, jsonb, timestamptz
) from public, anon, authenticated, service_role;

revoke all on function public.af_get_research_resolution_context_v1(
  uuid, uuid, uuid, uuid
) from public, anon, authenticated, service_role;
revoke all on function public.af_get_source_resolution_records_v1(
  uuid, uuid, uuid, uuid
) from public, anon, authenticated, service_role;
revoke all on function public.af_accept_source_resolution_v1(
  uuid, jsonb, jsonb, integer
) from public, anon, authenticated, service_role;

grant execute on function public.af_get_research_resolution_context_v1(
  uuid, uuid, uuid, uuid
) to service_role;
grant execute on function public.af_get_source_resolution_records_v1(
  uuid, uuid, uuid, uuid
) to service_role;
grant execute on function public.af_accept_source_resolution_v1(
  uuid, jsonb, jsonb, integer
) to service_role;

comment on function public.af_accept_source_resolution_v1(
  uuid, jsonb, jsonb, integer
) is
  'Atomically accepts one body-free candidate resolution through the active RESOLUTION lease and persists only proposed source identity plus SOURCE_ONLY locator state.';
