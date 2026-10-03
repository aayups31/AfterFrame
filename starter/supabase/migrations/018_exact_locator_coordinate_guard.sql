-- Exact verification must bind every coordinate, not merely copied hashes.
-- This guard also checks existing verified rows before the migration can commit.
create function public.af_exact_locator_coordinates_valid_v1(
  verification_row public.af_exact_locator_verification_records
) returns boolean language plpgsql stable
set search_path = pg_catalog,public
as $function$
declare
  normalization_json jsonb; normalized_receipt jsonb; receipt_json jsonb;
  block_json jsonb; page_json jsonb; target_json jsonb; locator_json jsonb;
  expected_target jsonb; source_row public.af_sources%rowtype;
  retrieval_row public.af_source_retrieval_records%rowtype;
  paragraph_index integer;
begin
  if verification_row.status <> 'VERIFIED_EXACT' then return true; end if;
  receipt_json := verification_row.record_json#>'{result,receipt}';
  target_json := receipt_json->'target'; locator_json := receipt_json->'verifiedLocator';
  if verification_row.normalization_kind = 'BYTE_DOCUMENT' then
    select record_json into normalization_json from public.af_source_normalization_records
    where id=verification_row.normalization_record_id and run_id=verification_row.run_id
      and job_id=verification_row.job_id and attempt_id=verification_row.attempt_id
      and retrieval_record_id=verification_row.retrieval_record_id;
  elsif verification_row.normalization_kind = 'PDF' then
    select record_json into normalization_json from public.af_pdf_normalization_records
    where id=verification_row.normalization_record_id and run_id=verification_row.run_id
      and job_id=verification_row.job_id and attempt_id=verification_row.attempt_id
      and retrieval_record_id=verification_row.retrieval_record_id;
  else return false; end if;
  if normalization_json is null or normalization_json#>>'{result,status}' is distinct from 'NORMALIZED'
    then return false; end if;
  normalized_receipt := normalization_json#>'{result,receipt}';
  block_json := normalized_receipt->'blockManifests'->verification_row.target_block_ordinal;
  select * into source_row from public.af_sources where id=verification_row.source_id;
  select * into retrieval_row from public.af_source_retrieval_records
    where id=verification_row.retrieval_record_id;
  if block_json is null or source_row.id is null or retrieval_row.id is null
    or normalized_receipt->>'screeningState' is distinct from 'PASSED'
    or normalized_receipt->>'sourceId' is distinct from source_row.id::text
    or normalized_receipt->>'sourceLocatorId' is distinct from verification_row.previous_locator_id::text
    or normalized_receipt->>'snapshotId' is distinct from retrieval_row.snapshot_id::text
    or receipt_json->>'snapshotId' is distinct from retrieval_row.snapshot_id::text
    or target_json->>'kind' is distinct from source_row.medium::text
    or locator_json->>'kind' is distinct from source_row.medium::text
    or locator_json->>'id' is distinct from verification_row.verified_locator_id::text
    or locator_json->>'textFingerprint' is distinct from block_json->>'textFingerprint'
    then return false; end if;

  if verification_row.normalization_kind = 'BYTE_DOCUMENT' then
    if source_row.medium not in ('ARTICLE','WEBPAGE') or block_json->>'kind' is distinct from 'PARAGRAPH'
      or normalized_receipt->>'documentKind' not in ('HTML','PLAIN_TEXT') then return false; end if;
    select count(*)::integer into paragraph_index
      from jsonb_array_elements(normalized_receipt->'blockManifests') with ordinality as blocks(value,ordinal)
      where ordinal<=verification_row.target_block_ordinal and value->>'kind'='PARAGRAPH';
    expected_target := jsonb_build_object(
      'kind',source_row.medium,'documentFingerprint',normalized_receipt->'documentFingerprint',
      'blockOrdinal',verification_row.target_block_ordinal,'paragraphIndex',paragraph_index,
      'textFingerprint',block_json->'textFingerprint','sourceByteStart',block_json->'sourceByteStart',
      'sourceByteEnd',block_json->'sourceByteEnd','sourceRangeFingerprint',block_json->'sourceRangeFingerprint',
      'headingPathFingerprints',block_json->'headingPathFingerprints'
    );
    return coalesce(target_json=expected_target
      and locator_json->>'openUrl'=source_row.canonical_url::text
      and locator_json->'paragraphIndex'=to_jsonb(paragraph_index)
      and locator_json->'headingPath'='[]'::jsonb
      and locator_json->'textFragmentUrl'='null'::jsonb,false);
  end if;

  if source_row.medium<>'PDF' or normalized_receipt->>'documentKind' is distinct from 'PDF'
    then return false; end if;
  page_json := normalized_receipt->'pageManifests'->((block_json#>>'{anchor,pageNumber}')::integer-1);
  if page_json is null then return false; end if;
  expected_target := jsonb_build_object(
    'kind','PDF','documentFingerprint',normalized_receipt->'documentFingerprint',
    'blockOrdinal',verification_row.target_block_ordinal,'textFingerprint',block_json->'textFingerprint',
    'pageStructureFingerprint',page_json->'pageStructureFingerprint','anchor',block_json->'anchor'
  );
  return coalesce(target_json=expected_target
    and locator_json->>'documentVersionId'='snapshot:'||retrieval_row.snapshot_id::text
    and locator_json->'pageIndex'=block_json#>'{anchor,pageNumber}'
    and locator_json->>'openUrl'=split_part(source_row.canonical_url::text,'#',1)||'#page='||(block_json#>>'{anchor,pageNumber}')
    and locator_json->'printedPageLabel'='null'::jsonb
    and locator_json->'section'='null'::jsonb
    and locator_json->'heading'='null'::jsonb,false);
exception when invalid_text_representation or numeric_value_out_of_range then return false;
end;
$function$;

create function public.af_guard_exact_locator_coordinates_v1()
returns trigger language plpgsql security definer set search_path = pg_catalog,public
as $function$
begin
  if public.af_exact_locator_coordinates_valid_v1(new) is distinct from true then
    raise exception using errcode='AFR07',message='Exact locator coordinates differ from authoritative normalization';
  end if;
  return new;
end;
$function$;

do $validation$
begin
  if exists(select 1 from public.af_exact_locator_verification_records verification
    where public.af_exact_locator_coordinates_valid_v1(verification) is distinct from true) then
    raise exception using errcode='AFR07',message='Existing exact locators require coordinate review before migration';
  end if;
end;
$validation$;

create trigger af_exact_locator_coordinate_guard
before insert or update on public.af_exact_locator_verification_records
for each row execute function public.af_guard_exact_locator_coordinates_v1();

revoke all on function public.af_exact_locator_coordinates_valid_v1(public.af_exact_locator_verification_records)
  from public,anon,authenticated;
revoke all on function public.af_guard_exact_locator_coordinates_v1() from public,anon,authenticated;
comment on function public.af_exact_locator_coordinates_valid_v1(public.af_exact_locator_verification_records) is
  'Compares complete exact targets to authoritative normalization; copied fingerprints alone cannot authorize altered coordinates.';
