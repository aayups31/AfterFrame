-- AFTERFRAME checkpoint 04A: durable identity and causal worker inputs.
--
-- The database authors every worker input manifest from locked authoritative
-- records. Workers cannot select a predecessor, identity, input fingerprint,
-- or external request fingerprint. Resolved identity is public metadata and
-- remains explicitly NOT_EVIDENCE with no publication authority.

-- ---------------------------------------------------------------------------
-- Domain-separated canonical fingerprints
-- ---------------------------------------------------------------------------

create function public.af_canonical_jsonb_sha256_v1(
  purpose text,
  value_to_fingerprint jsonb
)
returns public.af_sha256
language plpgsql
immutable
set search_path = pg_catalog, public, extensions
as $function$
declare
  fingerprint_value text;
begin
  if purpose is null or purpose !~ '^[a-z0-9]+([._-][a-z0-9]+)*$'
    or value_to_fingerprint is null then
    raise exception using errcode = 'AFR04', message = 'Invalid canonical fingerprint input';
  end if;
  fingerprint_value := encode(
    digest(
      convert_to(
        'afterframe:' || purpose || ':v1:'
          || octet_length(value_to_fingerprint::text)::text || ':'
          || value_to_fingerprint::text,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );
  return fingerprint_value::public.af_sha256;
end;
$function$;

create function public.af_subject_ref_fingerprint_v1(
  subject_type_value text,
  subject_id_value text,
  subject_version_id_value text
)
returns public.af_sha256
language sql
immutable
set search_path = pg_catalog, public
as $function$
  select public.af_canonical_jsonb_sha256_v1(
    'subject-ref',
    jsonb_build_object(
      'type', subject_type_value,
      'id', subject_id_value,
      'versionId', subject_version_id_value
    )
  );
$function$;

-- ---------------------------------------------------------------------------
-- Resolver-verified public identity and immutable attempt input manifests
-- ---------------------------------------------------------------------------

create function public.af_public_identity_names_valid_v1(values_to_check text[])
returns boolean
language sql
immutable
set search_path = pg_catalog
as $function$
  select values_to_check is not null
    and cardinality(values_to_check) <= 30
    and not exists (
      select 1 from unnest(values_to_check) alternate_name
      where alternate_name is null
        or char_length(alternate_name) not between 1 and 500
        or char_length(btrim(alternate_name)) < 1
    );
$function$;

-- 04A cannot truthfully invent Postgres-authored causal manifests for attempts
-- created by the older claim boundary or rewrite immutable run-start replay
-- snapshots to add the new subjectIdentities collection. Production currently
-- has no persisted research runs or start state; every other environment must
-- explicitly backfill all legacy research state before cutover.
do $preflight$
begin
  if exists (
    select 1 from public.af_research_runs
  ) or exists (
    select 1 from public.af_research_start_commit_results
  ) or exists (
    select 1 from public.af_research_start_idempotency
  ) then
    raise exception using errcode = 'AFR07', message = 'Backfill legacy research runs, start replay state, and causal manifests before identity-manifest cutover';
  end if;
end;
$preflight$;

create table public.af_resolved_subject_identities (
  schema_version smallint not null
    constraint af_resolved_identities_schema_version_check
      check (schema_version = 1),
  id uuid constraint af_resolved_identities_pkey primary key,
  case_id uuid not null,
  run_id uuid not null,
  job_id uuid not null,
  attempt_id uuid not null,
  subject_ref_fingerprint public.af_sha256 not null,
  display_name text not null,
  alternate_names text[] not null,
  disambiguators jsonb not null,
  identity_fingerprint public.af_sha256 not null,
  data_class text not null
    constraint af_resolved_identities_data_class_check
      check (data_class = 'PUBLIC'),
  verification_state text not null
    constraint af_resolved_identities_verification_state_check
      check (verification_state = 'RESOLVER_VERIFIED'),
  resolver_id public.af_slug not null,
  resolver_version public.af_version_tag not null,
  evidence_status text not null
    constraint af_resolved_identities_evidence_status_check
      check (evidence_status = 'NOT_EVIDENCE'),
  review_state public.af_review_state not null
    constraint af_resolved_identities_review_state_check
      check (review_state = 'PROPOSED'),
  publication_authority text not null
    constraint af_resolved_identities_publication_authority_check
      check (publication_authority = 'NONE'),
  provenance_inputs jsonb not null,
  resolved_at timestamptz not null,
  created_at timestamptz not null,
  constraint af_resolved_identities_run_case_fk
    foreign key (run_id, case_id)
    references public.af_research_runs(id, case_id) on delete cascade,
  constraint af_resolved_identities_attempt_fk
    foreign key (run_id, job_id, attempt_id)
    references public.af_research_attempts(run_id, job_id, id) on delete cascade,
  constraint af_resolved_identities_display_name_check check (
    char_length(display_name) between 1 and 500
    and char_length(btrim(display_name)) >= 1
  ),
  constraint af_resolved_identities_alternate_names_check check (
    public.af_public_identity_names_valid_v1(alternate_names)
  ),
  constraint af_resolved_identities_disambiguators_check check (
    jsonb_typeof(disambiguators) = 'array'
    and jsonb_array_length(disambiguators) <= 30
  ),
  constraint af_resolved_identities_provenance_check check (
    jsonb_typeof(provenance_inputs) = 'array'
    and jsonb_array_length(provenance_inputs) = 2
  ),
  constraint af_resolved_identities_time_check check (resolved_at <= created_at),
  constraint af_resolved_identities_run_key unique (run_id),
  constraint af_resolved_identities_attempt_key unique (attempt_id),
  constraint af_resolved_identities_run_identity_key unique (run_id, id),
  constraint af_resolved_identities_run_attempt_identity_key
    unique (run_id, attempt_id, id)
);

comment on table public.af_resolved_subject_identities is
  'Resolver-verified public subject metadata. It is NOT_EVIDENCE, never establishes a research claim, and carries no publication authority.';

-- The four-column key lets every later manifest bind the exact predecessor
-- output to both its producing job and its successful/degraded attempt.
alter table public.af_research_stage_outputs
  add constraint af_research_outputs_causal_reference_key
  unique (run_id, job_id, attempt_id, id);

create table public.af_research_attempt_input_manifests (
  schema_version smallint not null
    constraint af_attempt_manifests_schema_version_check
      check (schema_version = 1),
  id uuid constraint af_attempt_manifests_pkey primary key,
  case_id uuid not null,
  run_id uuid not null,
  job_id uuid not null,
  attempt_id uuid not null,
  stage public.af_research_stage not null,
  subject_identity_id uuid,
  predecessor_job_id uuid,
  predecessor_attempt_id uuid,
  predecessor_output_id uuid,
  predecessor_output_fingerprint public.af_sha256,
  manifest_fingerprint public.af_sha256 not null,
  request_fingerprint public.af_sha256 not null,
  manifest jsonb not null
    constraint af_attempt_manifests_manifest_object_check
      check (jsonb_typeof(manifest) = 'object'),
  publication_authority text not null
    constraint af_attempt_manifests_publication_authority_check
      check (publication_authority = 'NONE'),
  authored_at timestamptz not null,
  constraint af_attempt_manifests_run_case_fk
    foreign key (run_id, case_id)
    references public.af_research_runs(id, case_id) on delete cascade,
  constraint af_attempt_manifests_attempt_fk
    foreign key (run_id, job_id, attempt_id)
    references public.af_research_attempts(run_id, job_id, id) on delete cascade,
  constraint af_attempt_manifests_identity_fk
    foreign key (run_id, subject_identity_id)
    references public.af_resolved_subject_identities(run_id, id),
  constraint af_attempt_manifests_predecessor_job_fk
    foreign key (run_id, predecessor_job_id)
    references public.af_research_jobs(run_id, id),
  constraint af_attempt_manifests_predecessor_attempt_fk
    foreign key (run_id, predecessor_job_id, predecessor_attempt_id)
    references public.af_research_attempts(run_id, job_id, id),
  constraint af_attempt_manifests_predecessor_output_fk
    foreign key (
      run_id, predecessor_job_id, predecessor_attempt_id,
      predecessor_output_id
    ) references public.af_research_stage_outputs(run_id, job_id, attempt_id, id),
  constraint af_attempt_manifests_stage_shape_check check (
    (
      stage = 'IDENTITY'
      and subject_identity_id is null
      and predecessor_job_id is null
      and predecessor_attempt_id is null
      and predecessor_output_id is null
      and predecessor_output_fingerprint is null
    )
    or (
      stage <> 'IDENTITY'
      and subject_identity_id is not null
      and predecessor_job_id is not null
      and predecessor_attempt_id is not null
      and predecessor_output_id is not null
      and predecessor_output_fingerprint is not null
    )
  ),
  constraint af_attempt_manifests_attempt_key unique (attempt_id),
  constraint af_attempt_manifests_run_manifest_key unique (run_id, id),
  constraint af_attempt_manifests_run_request_key
    unique (run_id, request_fingerprint)
);

comment on table public.af_research_attempt_input_manifests is
  'Postgres-authored body-free causal inputs. A worker can inspect this immutable envelope but can never choose or overwrite its dependency chain.';

-- One attempt has exactly one stage output. Identity output linkage is added
-- after the internal v1 completion insert, within the same v2 transaction.
alter table public.af_research_stage_outputs
  add column subject_identity_id uuid;

alter table public.af_research_stage_outputs
  add constraint af_research_outputs_one_per_attempt_key unique (attempt_id);

alter table public.af_research_stage_outputs
  add constraint af_research_outputs_subject_identity_fk
  foreign key (run_id, attempt_id, subject_identity_id)
  references public.af_resolved_subject_identities(run_id, attempt_id, id)
  deferrable initially deferred;

alter table public.af_research_stage_outputs
  add constraint af_research_outputs_nonidentity_link_check check (
    kind = 'IDENTITY_RESULT' or subject_identity_id is null
  );

create function public.af_assert_identity_output_link_v1()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $function$
declare
  current_output public.af_research_stage_outputs%rowtype;
begin
  select * into current_output
  from public.af_research_stage_outputs
  where id = new.id;
  if found and current_output.kind = 'IDENTITY_RESULT'
    and current_output.subject_identity_id is null then
    raise exception using errcode = 'AFR04', message = 'Identity output requires its resolved subject identity';
  end if;
  return null;
end;
$function$;

create constraint trigger af_research_outputs_identity_link_trigger
after insert or update of subject_identity_id
on public.af_research_stage_outputs
deferrable initially deferred
for each row execute function public.af_assert_identity_output_link_v1();

-- Case identity and the exact user curiosity define every run. Once a run
-- exists those fields cannot be silently retargeted underneath its manifests.
create function public.af_enforce_case_research_identity_immutability_v1()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
begin
  if exists (
    select 1 from public.af_research_runs stored_run
    where stored_run.case_id = old.id
  ) and (
    new.specialist_id is distinct from old.specialist_id
    or new.specialist_version is distinct from old.specialist_version
    or new.subject_type is distinct from old.subject_type
    or new.subject_id is distinct from old.subject_id
    or new.subject_version_id is distinct from old.subject_version_id
    or new.exact_curiosity is distinct from old.exact_curiosity
  ) then
    raise exception using errcode = 'AFR07', message = 'Research case identity is immutable after a run starts';
  end if;
  return new;
end;
$function$;

create trigger af_cases_research_identity_immutability_trigger
before update of specialist_id, specialist_version, subject_type, subject_id,
  subject_version_id, exact_curiosity
on public.af_cases
for each row execute function public.af_enforce_case_research_identity_immutability_v1();

-- Both durable record classes are immutable while their owning research run
-- exists. DELETE remains available only through parent FK cascades so a future
-- actor-scoped case/account deletion workflow can remove private derived state;
-- neither browser nor service roles receive direct table mutation privileges.
create function public.af_reject_identity_manifest_mutation_v1()
returns trigger
language plpgsql
set search_path = pg_catalog
as $function$
begin
  raise exception using errcode = 'AFR07', message = 'Research identity and input manifests are immutable';
end;
$function$;

create trigger af_resolved_identities_immutable_trigger
before update on public.af_resolved_subject_identities
for each row execute function public.af_reject_identity_manifest_mutation_v1();

create trigger af_attempt_manifests_immutable_trigger
before update on public.af_research_attempt_input_manifests
for each row execute function public.af_reject_identity_manifest_mutation_v1();

-- ---------------------------------------------------------------------------
-- Strict public identity and manifest JSON adapters
-- ---------------------------------------------------------------------------

create function public.af_resolved_subject_identity_valid_v1(
  value_to_check jsonb,
  expected_case_id uuid,
  expected_run_id uuid,
  expected_job_id uuid,
  expected_attempt_id uuid,
  expected_subject_ref_fingerprint public.af_sha256,
  attempt_started_at timestamptz,
  completion_time timestamptz
)
returns boolean
language plpgsql
immutable
set search_path = pg_catalog, public
as $function$
declare
  public_identity jsonb;
  resolver_json jsonb;
  disambiguator_json jsonb;
  provenance_json jsonb;
  alternate_name_json jsonb;
  alternate_name_value text;
  resolved_time timestamptz;
  created_time timestamptz;
  job_reference_count integer := 0;
  attempt_reference_count integer := 0;
begin
  if public.af_jsonb_has_exact_keys(
    value_to_check,
    array[
      'schemaVersion', 'id', 'caseId', 'runId', 'jobId', 'attemptId',
      'subjectRefFingerprint', 'publicIdentity', 'evidenceStatus',
      'reviewState', 'publicationAuthority', 'provenanceInputs', 'createdAt'
    ]
  ) is not true
    or jsonb_typeof(value_to_check->'schemaVersion') is distinct from 'number'
    or jsonb_typeof(value_to_check->'id') is distinct from 'string'
    or jsonb_typeof(value_to_check->'caseId') is distinct from 'string'
    or jsonb_typeof(value_to_check->'runId') is distinct from 'string'
    or jsonb_typeof(value_to_check->'jobId') is distinct from 'string'
    or jsonb_typeof(value_to_check->'attemptId') is distinct from 'string'
    or jsonb_typeof(value_to_check->'subjectRefFingerprint') is distinct from 'string'
    or jsonb_typeof(value_to_check->'publicIdentity') is distinct from 'object'
    or jsonb_typeof(value_to_check->'evidenceStatus') is distinct from 'string'
    or jsonb_typeof(value_to_check->'reviewState') is distinct from 'string'
    or jsonb_typeof(value_to_check->'publicationAuthority') is distinct from 'string'
    or jsonb_typeof(value_to_check->'createdAt') is distinct from 'string'
    or (value_to_check->>'schemaVersion')::smallint is distinct from 1
    or (value_to_check->>'caseId')::uuid is distinct from expected_case_id
    or (value_to_check->>'runId')::uuid is distinct from expected_run_id
    or (value_to_check->>'jobId')::uuid is distinct from expected_job_id
    or (value_to_check->>'attemptId')::uuid is distinct from expected_attempt_id
    or (value_to_check->>'subjectRefFingerprint')::public.af_sha256
      is distinct from expected_subject_ref_fingerprint
    or value_to_check->>'evidenceStatus' is distinct from 'NOT_EVIDENCE'
    or value_to_check->>'reviewState' is distinct from 'PROPOSED'
    or value_to_check->>'publicationAuthority' is distinct from 'NONE'
    or jsonb_typeof(value_to_check->'provenanceInputs') is distinct from 'array'
    or jsonb_array_length(value_to_check->'provenanceInputs') is distinct from 2 then
    return false;
  end if;
  perform (value_to_check->>'id')::uuid;
  created_time := (value_to_check->>'createdAt')::timestamptz;

  public_identity := value_to_check->'publicIdentity';
  if public.af_jsonb_has_exact_keys(
    public_identity,
    array[
      'displayName', 'alternateNames', 'disambiguators',
      'identityFingerprint', 'dataClass', 'verificationState', 'resolver',
      'resolvedAt'
    ]
  ) is not true
    or jsonb_typeof(public_identity->'displayName') is distinct from 'string'
    or char_length(public_identity->>'displayName') not between 1 and 500
    or char_length(btrim(public_identity->>'displayName')) < 1
    or jsonb_typeof(public_identity->'alternateNames') is distinct from 'array'
    or jsonb_array_length(public_identity->'alternateNames') > 30
    or jsonb_typeof(public_identity->'disambiguators') is distinct from 'array'
    or jsonb_array_length(public_identity->'disambiguators') > 30
    or jsonb_typeof(public_identity->'identityFingerprint') is distinct from 'string'
    or jsonb_typeof(public_identity->'dataClass') is distinct from 'string'
    or jsonb_typeof(public_identity->'verificationState') is distinct from 'string'
    or jsonb_typeof(public_identity->'resolver') is distinct from 'object'
    or jsonb_typeof(public_identity->'resolvedAt') is distinct from 'string'
    or public_identity->>'dataClass' is distinct from 'PUBLIC'
    or public_identity->>'verificationState' is distinct from 'RESOLVER_VERIFIED' then
    return false;
  end if;
  perform (public_identity->>'identityFingerprint')::public.af_sha256;
  resolved_time := (public_identity->>'resolvedAt')::timestamptz;

  for alternate_name_json, alternate_name_value in
    select value, value #>> '{}'
    from jsonb_array_elements(public_identity->'alternateNames')
  loop
    if jsonb_typeof(alternate_name_json) is distinct from 'string'
      or char_length(alternate_name_value) not between 1 and 500
      or char_length(btrim(alternate_name_value)) < 1 then
      return false;
    end if;
  end loop;

  for disambiguator_json in
    select value from jsonb_array_elements(public_identity->'disambiguators')
  loop
    if public.af_jsonb_has_exact_keys(
      disambiguator_json, array['label', 'value']
    ) is not true
      or jsonb_typeof(disambiguator_json->'label') is distinct from 'string'
      or jsonb_typeof(disambiguator_json->'value') is distinct from 'string'
      or disambiguator_json->>'value' is distinct from btrim(disambiguator_json->>'value')
      or char_length(disambiguator_json->>'value') not between 1 and 500 then
      return false;
    end if;
    perform (disambiguator_json->>'label')::public.af_slug;
  end loop;

  resolver_json := public_identity->'resolver';
  if public.af_jsonb_has_exact_keys(
    resolver_json, array['id', 'version']
  ) is not true
    or jsonb_typeof(resolver_json->'id') is distinct from 'string'
    or jsonb_typeof(resolver_json->'version') is distinct from 'string' then
    return false;
  end if;
  perform (resolver_json->>'id')::public.af_slug;
  perform (resolver_json->>'version')::public.af_version_tag;

  for provenance_json in
    select value from jsonb_array_elements(value_to_check->'provenanceInputs')
  loop
    if public.af_jsonb_has_exact_keys(
      provenance_json, array['recordType', 'recordId']
    ) is not true
      or jsonb_typeof(provenance_json->'recordType') is distinct from 'string'
      or jsonb_typeof(provenance_json->'recordId') is distinct from 'string' then
      return false;
    end if;
    if provenance_json->>'recordType' = 'JOB'
      and (provenance_json->>'recordId')::uuid = expected_job_id then
      job_reference_count := job_reference_count + 1;
    elsif provenance_json->>'recordType' = 'ATTEMPT'
      and (provenance_json->>'recordId')::uuid = expected_attempt_id then
      attempt_reference_count := attempt_reference_count + 1;
    else
      return false;
    end if;
  end loop;
  if job_reference_count <> 1 or attempt_reference_count <> 1
    or resolved_time > created_time
    or created_time < attempt_started_at
    or created_time > completion_time then
    return false;
  end if;
  return true;
exception
  when invalid_text_representation or check_violation
    or numeric_value_out_of_range or datetime_field_overflow then
    return false;
end;
$function$;

create function public.af_resolved_subject_identity_record_json_v1(
  identity_row public.af_resolved_subject_identities
)
returns jsonb
language sql
stable
set search_path = pg_catalog
as $function$
  select jsonb_build_object(
    'schemaVersion', identity_row.schema_version,
    'id', identity_row.id,
    'caseId', identity_row.case_id,
    'runId', identity_row.run_id,
    'jobId', identity_row.job_id,
    'attemptId', identity_row.attempt_id,
    'subjectRefFingerprint', identity_row.subject_ref_fingerprint,
    'publicIdentity', jsonb_build_object(
      'displayName', identity_row.display_name,
      'alternateNames', to_jsonb(identity_row.alternate_names),
      'disambiguators', identity_row.disambiguators,
      'identityFingerprint', identity_row.identity_fingerprint,
      'dataClass', identity_row.data_class,
      'verificationState', identity_row.verification_state,
      'resolver', jsonb_build_object(
        'id', identity_row.resolver_id,
        'version', identity_row.resolver_version
      ),
      'resolvedAt', identity_row.resolved_at
    ),
    'evidenceStatus', identity_row.evidence_status,
    'reviewState', identity_row.review_state,
    'publicationAuthority', identity_row.publication_authority,
    'provenanceInputs', identity_row.provenance_inputs,
    'createdAt', identity_row.created_at
  );
$function$;

create function public.af_attempt_input_manifest_envelope_json_v1(
  manifest_row public.af_research_attempt_input_manifests
)
returns jsonb
language sql
stable
set search_path = pg_catalog
as $function$
  select jsonb_build_object(
    'schemaVersion', manifest_row.schema_version,
    'authority', 'POSTGRES',
    'manifest', manifest_row.manifest,
    'manifestFingerprint', manifest_row.manifest_fingerprint,
    'authoredAt', manifest_row.authored_at
  );
$function$;

create function public.af_identity_requirement_ids_valid_v1(
  requirements_to_check jsonb
)
returns boolean
language plpgsql
immutable
set search_path = pg_catalog, public
as $function$
declare
  requirement_json jsonb;
  requirement_id text;
  seen_requirement_ids text[] := array[]::text[];
begin
  if jsonb_typeof(requirements_to_check) is distinct from 'array'
    or jsonb_array_length(requirements_to_check) > 50 then return false; end if;
  for requirement_json in
    select value from jsonb_array_elements(requirements_to_check)
  loop
    if jsonb_typeof(requirement_json) is distinct from 'object'
      or jsonb_typeof(requirement_json->'id') is distinct from 'string' then
      return false;
    end if;
    requirement_id := requirement_json->>'id';
    perform requirement_id::public.af_slug;
    if requirement_id = any(seen_requirement_ids) then return false; end if;
    seen_requirement_ids := array_append(seen_requirement_ids, requirement_id);
  end loop;
  return true;
exception
  when invalid_text_representation or check_violation then return false;
end;
$function$;

-- The initial bundle grew one durable, domain-neutral collection. It must be
-- present and empty at start; only IDENTITY completion can populate it.
create or replace function public.af_research_start_result_shape_valid(
  value_to_check jsonb
)
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
  if public.af_jsonb_has_exact_keys(
    value_to_check, array['bundle', 'outboxEvents']
  ) is not true then return false; end if;
  bundle_json := value_to_check->'bundle';
  if public.af_jsonb_has_exact_keys(
    bundle_json,
    array[
      'run', 'plan', 'jobs', 'attempts', 'outputs', 'subjectIdentities',
      'sourceCandidates', 'untrustedContent'
    ]
  ) is not true then return false; end if;
  if jsonb_typeof(bundle_json->'attempts') is distinct from 'array'
    or jsonb_array_length(bundle_json->'attempts') <> 0
    or jsonb_typeof(bundle_json->'outputs') is distinct from 'array'
    or jsonb_array_length(bundle_json->'outputs') <> 0
    or jsonb_typeof(bundle_json->'subjectIdentities') is distinct from 'array'
    or jsonb_array_length(bundle_json->'subjectIdentities') <> 0
    or jsonb_typeof(bundle_json->'sourceCandidates') is distinct from 'array'
    or jsonb_array_length(bundle_json->'sourceCandidates') <> 0
    or jsonb_typeof(bundle_json->'untrustedContent') is distinct from 'array'
    or jsonb_array_length(bundle_json->'untrustedContent') <> 0 then
    return false;
  end if;

  run_json := bundle_json->'run';
  if public.af_jsonb_has_exact_keys(
    run_json,
    array[
      'schemaVersion', 'id', 'caseId', 'branchId', 'planId',
      'specialistId', 'specialistVersion', 'objectiveFingerprint',
      'requestFingerprint', 'traceId', 'status', 'health', 'currentStage',
      'publicationAuthority', 'aggregateVersion', 'createdAt', 'updatedAt',
      'startedAt', 'completedAt'
    ]
  ) is not true then return false; end if;

  plan_json := bundle_json->'plan';
  if public.af_jsonb_has_exact_keys(
    plan_json,
    array[
      'id', 'runId', 'specialistId', 'specialistVersion',
      'inputFingerprint', 'planFingerprint', 'plan',
      'publicationAuthority', 'createdAt'
    ]
  ) is not true or jsonb_typeof(plan_json->'plan') is distinct from 'object' then
    return false;
  end if;
  if not public.af_identity_requirement_ids_valid_v1(
    plan_json#>'{plan,identityRequirements}'
  ) then return false; end if;

  if jsonb_typeof(bundle_json->'jobs') is distinct from 'array'
    or jsonb_array_length(bundle_json->'jobs') <> 7 then return false; end if;
  for job_json in select value from jsonb_array_elements(bundle_json->'jobs')
  loop
    if public.af_jsonb_has_exact_keys(
      job_json,
      array[
        'schemaVersion', 'id', 'runId', 'caseId', 'stage',
        'stageOrdinal', 'dependsOnJobId', 'logicalJobKey',
        'stageInputFingerprint', 'status', 'attemptCount', 'maxAttempts',
        'checkpointCount', 'activeAttemptId', 'firstStartedAt', 'terminalAt',
        'publicationAuthority', 'aggregateVersion', 'createdAt', 'updatedAt'
      ]
    ) is not true then return false; end if;
  end loop;

  if jsonb_typeof(value_to_check->'outboxEvents') is distinct from 'array'
    or jsonb_array_length(value_to_check->'outboxEvents') <> 2 then
    return false;
  end if;
  for outbox_json in
    select value from jsonb_array_elements(value_to_check->'outboxEvents')
  loop
    if public.af_jsonb_has_exact_keys(
      outbox_json,
      array['id', 'event', 'recordedAt', 'deliveryAttempts', 'deliveredAt']
    ) is not true then return false; end if;
    event_json := outbox_json->'event';
    if public.af_jsonb_has_exact_keys(
      event_json,
      array[
        'id', 'type', 'schemaVersion', 'aggregateType', 'aggregateId',
        'sequence', 'aggregateVersion', 'occurredAt',
        'publicationAuthority', 'payload'
      ]
    ) is not true then return false; end if;
  end loop;
  return true;
end;
$function$;

create function public.af_identity_requirements_valid_v1(
  requirements_to_check jsonb
)
returns boolean
language plpgsql
immutable
set search_path = pg_catalog, public
as $function$
declare
  requirement_json jsonb;
  seen_requirement_ids text[] := array[]::text[];
  requirement_id text;
begin
  if not public.af_identity_requirement_ids_valid_v1(requirements_to_check) then
    return false;
  end if;
  for requirement_json in
    select value from jsonb_array_elements(requirements_to_check)
  loop
    if public.af_jsonb_has_exact_keys(
      requirement_json, array['id', 'state', 'basis', 'reason']
    ) is not true
      or jsonb_typeof(requirement_json->'id') is distinct from 'string'
      or jsonb_typeof(requirement_json->'state') is distinct from 'string'
      or jsonb_typeof(requirement_json->'basis') is distinct from 'string'
      or jsonb_typeof(requirement_json->'reason') is distinct from 'string'
      or requirement_json->>'reason' <> btrim(requirement_json->>'reason')
      or char_length(requirement_json->>'reason') not between 1 and 1000
      or not (
        (requirement_json->>'state' = 'UNRESOLVED'
          and requirement_json->>'basis' in ('STRUCTURAL_REFERENCE', 'MISSING_REFERENCE'))
        or (requirement_json->>'state' = 'IDENTIFIED'
          and requirement_json->>'basis' = 'EXPLICIT_REFERENCE')
        or (requirement_json->>'state' = 'RESOLVER_VERIFIED'
          and requirement_json->>'basis' = 'RESOLVER')
        or (requirement_json->>'state' = 'NOT_REQUIRED'
          and requirement_json->>'basis' = 'POLICY')
      ) then
      return false;
    end if;
    perform (requirement_json->>'id')::public.af_slug;
    requirement_id := requirement_json->>'id';
    if requirement_id = any(seen_requirement_ids) then return false; end if;
    seen_requirement_ids := array_append(seen_requirement_ids, requirement_id);
  end loop;
  return true;
exception
  when invalid_text_representation or check_violation then return false;
end;
$function$;

create function public.af_identity_resolution_partition_valid_v1(
  output_to_check jsonb,
  outcome_to_check text,
  bounded_reasons_to_check jsonb,
  requirements_to_check jsonb
)
returns boolean
language plpgsql
immutable
set search_path = pg_catalog, public
as $function$
declare
  requirement_json jsonb;
  output_id_json jsonb;
  requirement_ids text[] := array[]::text[];
  resolved_ids text[] := array[]::text[];
  unresolved_ids text[] := array[]::text[];
  identifier_value text;
begin
  if not public.af_identity_requirements_valid_v1(requirements_to_check)
    or jsonb_typeof(output_to_check) is distinct from 'object'
    or jsonb_typeof(output_to_check->'resolvedRequirementIds') is distinct from 'array'
    or jsonb_typeof(output_to_check->'unresolvedRequirementIds') is distinct from 'array'
    or jsonb_array_length(output_to_check->'resolvedRequirementIds') > 50
    or jsonb_array_length(output_to_check->'unresolvedRequirementIds') > 50
    or jsonb_typeof(bounded_reasons_to_check) is distinct from 'array' then
    return false;
  end if;

  for requirement_json in select value from jsonb_array_elements(requirements_to_check)
  loop
    identifier_value := requirement_json->>'id';
    if identifier_value = any(requirement_ids) then return false; end if;
    requirement_ids := array_append(requirement_ids, identifier_value);
  end loop;
  for output_id_json in
    select value from jsonb_array_elements(output_to_check->'resolvedRequirementIds')
  loop
    if jsonb_typeof(output_id_json) is distinct from 'string' then return false; end if;
    identifier_value := output_id_json #>> '{}';
    perform identifier_value::public.af_slug;
    if identifier_value = any(resolved_ids) then return false; end if;
    resolved_ids := array_append(resolved_ids, identifier_value);
  end loop;
  for output_id_json in
    select value from jsonb_array_elements(output_to_check->'unresolvedRequirementIds')
  loop
    if jsonb_typeof(output_id_json) is distinct from 'string' then return false; end if;
    identifier_value := output_id_json #>> '{}';
    perform identifier_value::public.af_slug;
    if identifier_value = any(unresolved_ids)
      or identifier_value = any(resolved_ids) then return false; end if;
    unresolved_ids := array_append(unresolved_ids, identifier_value);
  end loop;

  if not (
    requirement_ids <@ (resolved_ids || unresolved_ids)
    and (resolved_ids || unresolved_ids) <@ requirement_ids
  ) then return false; end if;
  if cardinality(unresolved_ids) = 0 then
    return outcome_to_check = 'SUCCEEDED'
      and jsonb_array_length(bounded_reasons_to_check) = 0;
  end if;
  return outcome_to_check = 'DEGRADED'
    and bounded_reasons_to_check = '["identity-requirements-unresolved"]'::jsonb;
exception
  when invalid_text_representation or check_violation
    or numeric_value_out_of_range then return false;
end;
$function$;

-- Body-minimal actor-scoped context used only to prepare the resolver. Exact
-- curiosity text and any private source body remain outside this read model.
create function public.af_get_research_identity_context_v1(
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
  plan_row public.af_research_plans%rowtype;
  job_row public.af_research_jobs%rowtype;
  requirements_json jsonb;
  subject_fingerprint public.af_sha256;
begin
  perform public.af_assert_actor_scope(p_actor_id);
  select stored_run.* into run_row
  from public.af_research_runs stored_run
  join public.af_cases stored_case on stored_case.id = stored_run.case_id
  where stored_run.id = p_run_id and stored_case.owner_id = p_actor_id;
  if not found then return null; end if;
  select * into strict case_row from public.af_cases where id = run_row.case_id;
  select * into job_row from public.af_research_jobs
  where id = p_job_id and run_id = p_run_id and stage = 'IDENTITY';
  if not found then return null; end if;
  select * into plan_row from public.af_research_plans
  where id = run_row.plan_id and run_id = run_row.id;
  if not found then
    raise exception using errcode = 'AFR07', message = 'Research run is missing its authoritative plan';
  end if;
  requirements_json := plan_row.plan->'identityRequirements';
  if not public.af_identity_requirements_valid_v1(requirements_json) then
    raise exception using errcode = 'AFR07', message = 'Research plan has invalid identity requirements';
  end if;
  subject_fingerprint := public.af_subject_ref_fingerprint_v1(
    case_row.subject_type, case_row.subject_id, case_row.subject_version_id
  );
  return jsonb_build_object(
    'schemaVersion', 1,
    'runId', run_row.id,
    'jobId', job_row.id,
    'caseId', case_row.id,
    'specialistId', case_row.specialist_id,
    'specialistVersion', case_row.specialist_version,
    'subjectRef', jsonb_build_object(
      'type', case_row.subject_type,
      'id', case_row.subject_id,
      'versionId', case_row.subject_version_id
    ),
    'subjectRefFingerprint', subject_fingerprint,
    'identityRequirements', requirements_json
  );
exception
  when invalid_text_representation or check_violation
    or numeric_value_out_of_range then
    raise exception using errcode = 'AFR04', message = 'Research identity context failed schema invariants';
end;
$function$;

create function public.af_research_stage_result_v2_valid(
  value_to_check jsonb,
  expected_case_id uuid,
  expected_run_id uuid,
  expected_job_id uuid,
  expected_attempt_id uuid,
  expected_stage public.af_research_stage,
  expected_subject_ref_fingerprint public.af_sha256,
  attempt_started_at timestamptz,
  completion_time timestamptz
)
returns boolean
language plpgsql
immutable
set search_path = pg_catalog, public
as $function$
declare
  output_json jsonb;
  identity_json jsonb;
  base_result jsonb;
begin
  if public.af_jsonb_has_exact_keys(
    value_to_check,
    array[
      'outcome', 'boundedReasonCodes', 'output', 'subjectIdentities',
      'sourceCandidates', 'untrustedContent'
    ]
  ) is not true
    or jsonb_typeof(value_to_check->'subjectIdentities') is distinct from 'array'
    or jsonb_array_length(value_to_check->'subjectIdentities') > 1 then
    return false;
  end if;
  output_json := value_to_check->'output';
  if jsonb_typeof(output_json) is distinct from 'object' then return false; end if;

  if expected_stage = 'IDENTITY' then
    if jsonb_array_length(value_to_check->'subjectIdentities') <> 1
      or not (output_json ? 'subjectIdentityId')
      or jsonb_typeof(output_json->'subjectIdentityId') is distinct from 'string' then
      return false;
    end if;
    identity_json := value_to_check#>'{subjectIdentities,0}';
    if (output_json->>'subjectIdentityId')::uuid
        is distinct from (identity_json->>'id')::uuid
      or public.af_resolved_subject_identity_valid_v1(
        identity_json,
        expected_case_id,
        expected_run_id,
        expected_job_id,
        expected_attempt_id,
        expected_subject_ref_fingerprint,
        attempt_started_at,
        completion_time
      ) is not true then return false; end if;
    base_result := (value_to_check - 'subjectIdentities');
    base_result := jsonb_set(
      base_result, '{output}', output_json - 'subjectIdentityId', false
    );
  else
    if jsonb_array_length(value_to_check->'subjectIdentities') <> 0
      or output_json ? 'subjectIdentityId' then return false; end if;
    base_result := value_to_check - 'subjectIdentities';
  end if;
  return coalesce(public.af_research_stage_result_valid(
    base_result,
    expected_run_id,
    expected_job_id,
    expected_attempt_id,
    expected_stage
  ), false);
exception
  when invalid_text_representation or check_violation
    or numeric_value_out_of_range or datetime_field_overflow then
    return false;
end;
$function$;

create function public.af_resolved_subject_identity_matches_v1(
  identity_row public.af_resolved_subject_identities,
  identity_json jsonb
)
returns boolean
language plpgsql
stable
set search_path = pg_catalog, public
as $function$
declare
  alternate_names_value text[];
begin
  alternate_names_value := array(
    select jsonb_array_elements_text(identity_json#>'{publicIdentity,alternateNames}')
  );
  return identity_row.schema_version = (identity_json->>'schemaVersion')::smallint
    and identity_row.id = (identity_json->>'id')::uuid
    and identity_row.case_id = (identity_json->>'caseId')::uuid
    and identity_row.run_id = (identity_json->>'runId')::uuid
    and identity_row.job_id = (identity_json->>'jobId')::uuid
    and identity_row.attempt_id = (identity_json->>'attemptId')::uuid
    and identity_row.subject_ref_fingerprint
      = (identity_json->>'subjectRefFingerprint')::public.af_sha256
    and identity_row.display_name = identity_json#>>'{publicIdentity,displayName}'
    and identity_row.alternate_names = alternate_names_value
    and identity_row.disambiguators = identity_json#>'{publicIdentity,disambiguators}'
    and identity_row.identity_fingerprint
      = (identity_json#>>'{publicIdentity,identityFingerprint}')::public.af_sha256
    and identity_row.data_class = identity_json#>>'{publicIdentity,dataClass}'
    and identity_row.verification_state = identity_json#>>'{publicIdentity,verificationState}'
    and identity_row.resolver_id = identity_json#>>'{publicIdentity,resolver,id}'
    and identity_row.resolver_version = identity_json#>>'{publicIdentity,resolver,version}'
    and identity_row.evidence_status = identity_json->>'evidenceStatus'
    and identity_row.review_state::text = identity_json->>'reviewState'
    and identity_row.publication_authority = identity_json->>'publicationAuthority'
    and identity_row.provenance_inputs = identity_json->'provenanceInputs'
    and identity_row.resolved_at
      = (identity_json#>>'{publicIdentity,resolvedAt}')::timestamptz
    and identity_row.created_at = (identity_json->>'createdAt')::timestamptz;
exception
  when invalid_text_representation or check_violation
    or numeric_value_out_of_range or datetime_field_overflow then return false;
end;
$function$;

-- ---------------------------------------------------------------------------
-- V2 worker completion: identity metadata and its output link commit together
-- ---------------------------------------------------------------------------

create function public.af_complete_research_job_v2(
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
  case_row public.af_cases%rowtype;
  plan_row public.af_research_plans%rowtype;
  job_row public.af_research_jobs%rowtype;
  attempt_row public.af_research_attempts%rowtype;
  lease_row public.af_research_job_leases%rowtype;
  manifest_row public.af_research_attempt_input_manifests%rowtype;
  identity_row public.af_resolved_subject_identities%rowtype;
  output_row public.af_research_stage_outputs%rowtype;
  subject_fingerprint public.af_sha256;
  identity_json jsonb;
  base_result jsonb;
  completion_result jsonb;
  derived_output_fingerprint public.af_sha256;
  completion_time timestamptz;
  identity_id uuid;
  output_id uuid;
  stored_identity_exists boolean := false;
begin
  perform public.af_assert_actor_scope(p_actor_id);
  if not public.af_research_lease_cursor_valid(p_lease)
    or p_idempotency_key !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,199}$'
    or not public.af_research_worker_completion_valid(p_execution)
    or p_execution->>'telemetryState' <> 'COMPLETE' then
    raise exception using errcode = 'AFR04', message = 'Invalid research completion input';
  end if;
  completion_time := (p_execution->>'completedAt')::timestamptz;

  select stored_run.* into run_row
  from public.af_research_runs stored_run
  join public.af_cases stored_case on stored_case.id = stored_run.case_id
  where stored_run.id = (p_lease->>'runId')::uuid
    and stored_case.owner_id = p_actor_id for update of stored_run;
  if not found then
    raise exception using errcode = 'AFR05', message = 'Actor scope mismatch or record not found';
  end if;
  select * into strict case_row from public.af_cases
  where id = run_row.case_id for share;
  select * into plan_row from public.af_research_plans
  where id = run_row.plan_id and run_id = run_row.id for share;
  if not found then
    raise exception using errcode = 'AFR07', message = 'Research run is missing its authoritative plan';
  end if;
  select * into job_row from public.af_research_jobs
  where id = (p_lease->>'jobId')::uuid and run_id = run_row.id for update;
  if not found then
    raise exception using errcode = 'AFR05', message = 'Actor scope mismatch or record not found';
  end if;
  select * into attempt_row from public.af_research_attempts
  where id = (p_lease->>'attemptId')::uuid and run_id = run_row.id
    and job_id = job_row.id for update;
  if not found then
    raise exception using errcode = 'AFR05', message = 'Actor scope mismatch or record not found';
  end if;
  select * into lease_row from public.af_research_job_leases
  where attempt_id = attempt_row.id for update;
  if not found then
    raise exception using errcode = 'AFR05', message = 'Actor scope mismatch or record not found';
  end if;
  select * into manifest_row
  from public.af_research_attempt_input_manifests
  where attempt_id = attempt_row.id for share;
  if not found
    or manifest_row.run_id <> run_row.id
    or manifest_row.job_id <> job_row.id
    or manifest_row.stage <> job_row.stage
    or manifest_row.request_fingerprint <> attempt_row.request_fingerprint then
    raise exception using errcode = 'AFR07', message = 'Research completion requires its exact causal manifest';
  end if;
  subject_fingerprint := public.af_subject_ref_fingerprint_v1(
    case_row.subject_type, case_row.subject_id, case_row.subject_version_id
  );
  if manifest_row.manifest_fingerprint is distinct from
      public.af_canonical_jsonb_sha256_v1(
        'research-attempt-input-manifest', manifest_row.manifest
      )
    or manifest_row.request_fingerprint is distinct from
      public.af_canonical_jsonb_sha256_v1(
        'research-attempt-request',
        jsonb_build_object(
          'schemaVersion', 1,
          'manifestFingerprint', manifest_row.manifest_fingerprint,
          'idempotencyKey', attempt_row.claim_idempotency_key
        )
      )
    or (manifest_row.manifest->>'runId')::uuid is distinct from run_row.id
    or (manifest_row.manifest->>'caseId')::uuid is distinct from case_row.id
    or (manifest_row.manifest->>'planId')::uuid is distinct from plan_row.id
    or (manifest_row.manifest->>'jobId')::uuid is distinct from job_row.id
    or (manifest_row.manifest->>'stage')::public.af_research_stage
      is distinct from job_row.stage
    or (manifest_row.manifest->>'subjectRefFingerprint')::public.af_sha256
      is distinct from subject_fingerprint
    or (manifest_row.manifest->>'objectiveFingerprint')::public.af_sha256
      is distinct from run_row.objective_fingerprint
    or (manifest_row.manifest->>'runRequestFingerprint')::public.af_sha256
      is distinct from run_row.request_fingerprint
    or (manifest_row.manifest->>'planFingerprint')::public.af_sha256
      is distinct from plan_row.plan_fingerprint
    or (manifest_row.manifest->>'stageSeedFingerprint')::public.af_sha256
      is distinct from job_row.stage_input_fingerprint then
    raise exception using errcode = 'AFR07', message = 'Research completion causal manifest no longer matches authoritative input';
  end if;
  if not public.af_research_stage_result_v2_valid(
    p_result,
    case_row.id,
    run_row.id,
    job_row.id,
    attempt_row.id,
    job_row.stage,
    subject_fingerprint,
    attempt_row.started_at,
    completion_time
  ) then
    raise exception using errcode = 'AFR04', message = 'Research completion has an invalid or lossy v2 result';
  end if;
  if job_row.stage = 'IDENTITY' then
    identity_json := p_result#>'{subjectIdentities,0}';
    if not public.af_identity_resolution_partition_valid_v1(
      p_result->'output',
      p_result->>'outcome',
      p_result->'boundedReasonCodes',
      plan_row.plan->'identityRequirements'
    ) then
      raise exception using errcode = 'AFR04', message = 'Identity result must exactly partition authoritative requirements';
    end if;
    if attempt_row.execution_kind <> 'RESOLVER'
      or attempt_row.model_provider is not null
      or attempt_row.prompt_id is not null
      or attempt_row.tool_id is null
      or attempt_row.tool_version is null
      or attempt_row.private_content_included
      or (lease_row.execution_plan->>'privateContentIncluded')::boolean
        is distinct from false
      or lease_row.execution_plan->>'automaticRetrySafety'
        is distinct from 'IDEMPOTENT_PROVIDER_REQUEST'
      or attempt_row.tool_id::text
        is distinct from identity_json#>>'{publicIdentity,resolver,id}'
      or attempt_row.tool_version::text
        is distinct from identity_json#>>'{publicIdentity,resolver,version}' then
      raise exception using errcode = 'AFR04', message = 'Subject identity resolver does not match the durable execution plan';
    end if;
  end if;

  base_result := p_result - 'subjectIdentities';
  if job_row.stage = 'IDENTITY' then
    identity_id := (identity_json->>'id')::uuid;
    output_id := (p_result#>>'{output,id}')::uuid;
    base_result := jsonb_set(
      base_result,
      '{output}',
      (p_result->'output') - 'subjectIdentityId',
      false
    );
  end if;

  -- The causal predecessor hash is authored from the full strict v2 result,
  -- including identity metadata. p_output_fingerprint remains in the frozen
  -- RPC signature for wire compatibility but has no authority.
  derived_output_fingerprint := public.af_canonical_jsonb_sha256_v1(
    'research-stage-result', p_result
  );

  completion_result := public.af_complete_research_job_v1(
    p_actor_id => p_actor_id,
    p_lease => p_lease,
    p_idempotency_key => p_idempotency_key,
    p_result => base_result,
    p_output_fingerprint => derived_output_fingerprint,
    p_execution => p_execution
  );
  if completion_result->>'status' not in ('COMMITTED', 'REPLAY') then
    return completion_result;
  end if;

  if job_row.stage = 'IDENTITY' then
    select * into identity_row
    from public.af_resolved_subject_identities
    where attempt_id = attempt_row.id for share;
    stored_identity_exists := found;
    if stored_identity_exists then
      if public.af_resolved_subject_identity_matches_v1(
        identity_row, identity_json
      ) is not true then
        raise exception using errcode = 'AFR02', message = 'Completion idempotency key identifies a different subject identity';
      end if;
    elsif completion_result->>'status' = 'REPLAY' then
      raise exception using errcode = 'AFR07', message = 'Completed identity attempt lacks its durable subject identity';
    else
      insert into public.af_resolved_subject_identities (
        schema_version, id, case_id, run_id, job_id, attempt_id,
        subject_ref_fingerprint, display_name, alternate_names,
        disambiguators, identity_fingerprint, data_class,
        verification_state, resolver_id, resolver_version, evidence_status,
        review_state, publication_authority, provenance_inputs, resolved_at,
        created_at
      ) values (
        1,
        identity_id,
        case_row.id,
        run_row.id,
        job_row.id,
        attempt_row.id,
        subject_fingerprint,
        identity_json#>>'{publicIdentity,displayName}',
        array(
          select jsonb_array_elements_text(
            identity_json#>'{publicIdentity,alternateNames}'
          )
        ),
        identity_json#>'{publicIdentity,disambiguators}',
        identity_json#>>'{publicIdentity,identityFingerprint}',
        'PUBLIC',
        'RESOLVER_VERIFIED',
        identity_json#>>'{publicIdentity,resolver,id}',
        identity_json#>>'{publicIdentity,resolver,version}',
        'NOT_EVIDENCE',
        'PROPOSED',
        'NONE',
        identity_json->'provenanceInputs',
        (identity_json#>>'{publicIdentity,resolvedAt}')::timestamptz,
        (identity_json->>'createdAt')::timestamptz
      ) returning * into identity_row;
    end if;

    select * into output_row from public.af_research_stage_outputs
    where run_id = run_row.id and job_id = job_row.id
      and attempt_id = attempt_row.id for update;
    if not found or output_row.id <> output_id
      or output_row.kind <> 'IDENTITY_RESULT' then
      raise exception using errcode = 'AFR07', message = 'Completed identity attempt lacks its exact durable output';
    end if;
    if output_row.subject_identity_id is null then
      update public.af_research_stage_outputs
      set subject_identity_id = identity_id
      where id = output_row.id and subject_identity_id is null;
    elsif output_row.subject_identity_id <> identity_id then
      raise exception using errcode = 'AFR02', message = 'Identity output is linked to a different subject identity';
    end if;
  else
    if exists (
      select 1 from public.af_resolved_subject_identities
      where attempt_id = attempt_row.id
    ) or exists (
      select 1 from public.af_research_stage_outputs
      where attempt_id = attempt_row.id and subject_identity_id is not null
    ) then
      raise exception using errcode = 'AFR07', message = 'Only IDENTITY may create or link subject identity';
    end if;
  end if;
  return completion_result;
exception
  when unique_violation then
    raise exception using errcode = 'AFR03', message = 'Research identity conflicts with an existing identifier';
  when foreign_key_violation or check_violation or not_null_violation
    or invalid_text_representation or numeric_value_out_of_range then
    raise exception using errcode = 'AFR04', message = 'Research completion failed identity or output invariants';
end;
$function$;

-- Downstream stages receive only the resolver-verified public metadata record.
-- No source excerpt, note body, or user-authored curiosity is exposed here.
create function public.af_get_resolved_subject_identity_v1(
  p_actor_id uuid,
  p_run_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, auth
as $function$
declare
  identity_row public.af_resolved_subject_identities%rowtype;
begin
  perform public.af_assert_actor_scope(p_actor_id);
  select stored_identity.* into identity_row
  from public.af_resolved_subject_identities stored_identity
  join public.af_research_runs stored_run on stored_run.id = stored_identity.run_id
  join public.af_cases stored_case on stored_case.id = stored_run.case_id
  where stored_identity.run_id = p_run_id and stored_case.owner_id = p_actor_id;
  if not found then return null; end if;
  return public.af_resolved_subject_identity_record_json_v1(identity_row);
end;
$function$;

-- ---------------------------------------------------------------------------
-- V2 worker claim: Postgres authors and fences the exact causal input
-- ---------------------------------------------------------------------------

create function public.af_claim_research_job_v2(
  p_actor_id uuid,
  p_run_id uuid,
  p_job_id uuid,
  p_stage public.af_research_stage,
  p_expected_run_version bigint,
  p_expected_job_version bigint,
  p_idempotency_key text,
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
  case_row public.af_cases%rowtype;
  plan_row public.af_research_plans%rowtype;
  job_row public.af_research_jobs%rowtype;
  prior_job_row public.af_research_jobs%rowtype;
  prior_attempt_row public.af_research_attempts%rowtype;
  prior_output_row public.af_research_stage_outputs%rowtype;
  identity_row public.af_resolved_subject_identities%rowtype;
  existing_attempt_row public.af_research_attempts%rowtype;
  stored_manifest_row public.af_research_attempt_input_manifests%rowtype;
  subject_fingerprint public.af_sha256;
  manifest_fingerprint_value public.af_sha256;
  request_fingerprint_value public.af_sha256;
  manifest_json jsonb;
  dependency_json jsonb;
  subject_identity_json jsonb;
  claim_result jsonb;
  claim_attempt_id uuid;
  authored_time timestamptz;
  stored_manifest_exists boolean := false;
begin
  perform public.af_assert_actor_scope(p_actor_id);
  if p_stage is null then
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
  select * into strict case_row from public.af_cases
  where id = run_row.case_id for share;
  select * into plan_row from public.af_research_plans
  where id = run_row.plan_id and run_id = run_row.id for share;
  if not found then
    raise exception using errcode = 'AFR07', message = 'Research run is missing its authoritative plan';
  end if;
  select * into job_row from public.af_research_jobs
  where id = p_job_id and run_id = p_run_id for update;
  if not found then
    raise exception using errcode = 'AFR05', message = 'Actor scope mismatch or record not found';
  end if;
  if job_row.stage <> p_stage then
    raise exception using errcode = 'AFR07', message = 'Claim stage does not match the durable job';
  end if;
  if not public.af_research_execution_plan_valid(p_execution) then
    raise exception using errcode = 'AFR04', message = 'Invalid research-job execution plan';
  end if;
  if job_row.stage = 'IDENTITY' and (
    p_execution->>'executionKind' is distinct from 'RESOLVER'
    or p_execution->'model' is distinct from 'null'::jsonb
    or p_execution->'prompt' is distinct from 'null'::jsonb
    or jsonb_typeof(p_execution->'tool') is distinct from 'object'
    or (p_execution->>'privateContentIncluded')::boolean is distinct from false
    or p_execution->>'automaticRetrySafety'
      is distinct from 'IDEMPOTENT_PROVIDER_REQUEST'
  ) then
    raise exception using errcode = 'AFR04', message = 'Identity execution must be body-free and provider-idempotent';
  end if;

  subject_fingerprint := public.af_subject_ref_fingerprint_v1(
    case_row.subject_type, case_row.subject_id, case_row.subject_version_id
  );
  if job_row.stage = 'IDENTITY' then
    if job_row.stage_ordinal <> 0 or job_row.depends_on_job_id is not null then
      raise exception using errcode = 'AFR07', message = 'Identity job must be the causal root';
    end if;
    dependency_json := jsonb_build_object('state', 'ROOT');
    subject_identity_json := jsonb_build_object('state', 'UNBOUND');
  else
    select * into prior_job_row from public.af_research_jobs
    where run_id = run_row.id and id = job_row.depends_on_job_id for share;
    if not found or prior_job_row.stage_ordinal <> job_row.stage_ordinal - 1
      or prior_job_row.status not in ('SUCCEEDED', 'DEGRADED') then
      raise exception using errcode = 'AFR07', message = 'Immediate predecessor is not durably complete';
    end if;
    select stored_attempt.* into prior_attempt_row
    from public.af_research_attempts stored_attempt
    where stored_attempt.run_id = run_row.id
      and stored_attempt.job_id = prior_job_row.id
      and stored_attempt.status in ('SUCCEEDED', 'DEGRADED')
    order by stored_attempt.attempt_number desc
    limit 1 for share;
    if not found or prior_attempt_row.output_fingerprint is null then
      raise exception using errcode = 'AFR07', message = 'Immediate predecessor lacks a terminal output fingerprint';
    end if;
    select * into prior_output_row from public.af_research_stage_outputs
    where run_id = run_row.id and job_id = prior_job_row.id
      and attempt_id = prior_attempt_row.id for share;
    if not found then
      raise exception using errcode = 'AFR07', message = 'Immediate predecessor lacks its durable output';
    end if;
    select stored_identity.* into identity_row
    from public.af_resolved_subject_identities stored_identity
    join public.af_research_stage_outputs identity_output
      on identity_output.run_id = stored_identity.run_id
      and identity_output.attempt_id = stored_identity.attempt_id
      and identity_output.subject_identity_id = stored_identity.id
    where stored_identity.run_id = run_row.id
      and stored_identity.subject_ref_fingerprint = subject_fingerprint
    for share of stored_identity;
    if not found then
      raise exception using errcode = 'AFR07', message = 'Resolver-verified subject identity is required';
    end if;
    dependency_json := jsonb_build_object(
      'state', 'BOUND',
      'predecessorJobId', prior_job_row.id,
      'predecessorAttemptId', prior_attempt_row.id,
      'predecessorOutputId', prior_output_row.id,
      'predecessorOutputFingerprint', prior_attempt_row.output_fingerprint
    );
    subject_identity_json := jsonb_build_object(
      'state', 'BOUND',
      'subjectIdentityId', identity_row.id,
      'identityFingerprint', identity_row.identity_fingerprint
    );
  end if;

  manifest_json := jsonb_build_object(
    'schemaVersion', 1,
    'runId', run_row.id,
    'caseId', case_row.id,
    'branchId', run_row.branch_id,
    'planId', plan_row.id,
    'jobId', job_row.id,
    'stage', job_row.stage,
    'subjectRefFingerprint', subject_fingerprint,
    'objectiveFingerprint', run_row.objective_fingerprint,
    'runRequestFingerprint', run_row.request_fingerprint,
    'planFingerprint', plan_row.plan_fingerprint,
    'stageSeedFingerprint', job_row.stage_input_fingerprint,
    'dependency', dependency_json,
    'subjectIdentity', subject_identity_json
  );
  manifest_fingerprint_value := public.af_canonical_jsonb_sha256_v1(
    'research-attempt-input-manifest', manifest_json
  );
  request_fingerprint_value := public.af_canonical_jsonb_sha256_v1(
    'research-attempt-request',
    jsonb_build_object(
      'schemaVersion', 1,
      'manifestFingerprint', manifest_fingerprint_value,
      'idempotencyKey', p_idempotency_key
    )
  );

  select * into existing_attempt_row
  from public.af_research_attempts
  where run_id = run_row.id and job_id = job_row.id
    and claim_idempotency_key = p_idempotency_key
  for update;
  if found then
    select * into stored_manifest_row
    from public.af_research_attempt_input_manifests
    where attempt_id = existing_attempt_row.id for share;
    stored_manifest_exists := found;
    if not stored_manifest_exists then
      raise exception using errcode = 'AFR07', message = 'Existing research attempt lacks its causal manifest';
    end if;
    if stored_manifest_row.manifest is distinct from manifest_json
      or stored_manifest_row.manifest_fingerprint is distinct from manifest_fingerprint_value
      or stored_manifest_row.request_fingerprint is distinct from request_fingerprint_value
      or stored_manifest_row.case_id is distinct from case_row.id
      or stored_manifest_row.run_id is distinct from run_row.id
      or stored_manifest_row.job_id is distinct from job_row.id
      or stored_manifest_row.stage is distinct from job_row.stage
      or stored_manifest_row.subject_identity_id is distinct from identity_row.id
      or stored_manifest_row.predecessor_job_id is distinct from prior_job_row.id
      or stored_manifest_row.predecessor_attempt_id is distinct from prior_attempt_row.id
      or stored_manifest_row.predecessor_output_id is distinct from prior_output_row.id
      or stored_manifest_row.predecessor_output_fingerprint
        is distinct from prior_attempt_row.output_fingerprint then
      raise exception using errcode = 'AFR02', message = 'Job idempotency key identifies different causal input';
    end if;
  end if;

  claim_result := public.af_claim_research_job_v1(
    p_actor_id => p_actor_id,
    p_run_id => p_run_id,
    p_job_id => p_job_id,
    p_stage => p_stage,
    p_expected_run_version => p_expected_run_version,
    p_expected_job_version => p_expected_job_version,
    p_idempotency_key => p_idempotency_key,
    p_request_fingerprint => request_fingerprint_value,
    p_attempt_id => p_attempt_id,
    p_worker_id => p_worker_id,
    p_execution => p_execution,
    p_lease_seconds => p_lease_seconds
  );
  if claim_result->>'status' <> 'CLAIMED' then return claim_result; end if;

  claim_attempt_id := (claim_result#>>'{claim,attempt,id}')::uuid;
  if stored_manifest_exists and claim_attempt_id <> stored_manifest_row.attempt_id then
    raise exception using errcode = 'AFR02', message = 'Claim replay selected a different research attempt';
  end if;
  if not stored_manifest_exists then
    authored_time := (claim_result#>>'{claim,lease,claimedAt}')::timestamptz;
    insert into public.af_research_attempt_input_manifests (
      schema_version, id, case_id, run_id, job_id, attempt_id, stage,
      subject_identity_id, predecessor_job_id, predecessor_attempt_id,
      predecessor_output_id, predecessor_output_fingerprint,
      manifest_fingerprint, request_fingerprint, manifest,
      publication_authority, authored_at
    ) values (
      1, claim_attempt_id, case_row.id, run_row.id, job_row.id,
      claim_attempt_id, job_row.stage, identity_row.id, prior_job_row.id,
      prior_attempt_row.id, prior_output_row.id,
      prior_attempt_row.output_fingerprint, manifest_fingerprint_value,
      request_fingerprint_value, manifest_json, 'NONE', authored_time
    ) returning * into stored_manifest_row;
  end if;
  return jsonb_set(
    claim_result,
    '{claim,inputManifest}',
    public.af_attempt_input_manifest_envelope_json_v1(stored_manifest_row),
    true
  );
exception
  when unique_violation then
    raise exception using errcode = 'AFR03', message = 'Research claim conflicts with an existing identifier or causal manifest';
  when foreign_key_violation or check_violation or not_null_violation
    or invalid_text_representation or numeric_value_out_of_range then
    raise exception using errcode = 'AFR04', message = 'Research claim failed schema or causal invariants';
end;
$function$;

-- ---------------------------------------------------------------------------
-- Checkpoint 04A default-deny cutover
-- ---------------------------------------------------------------------------

alter table public.af_resolved_subject_identities enable row level security;
alter table public.af_resolved_subject_identities force row level security;
alter table public.af_research_attempt_input_manifests enable row level security;
alter table public.af_research_attempt_input_manifests force row level security;

revoke all on table public.af_resolved_subject_identities
  from public, anon, authenticated, service_role;
revoke all on table public.af_research_attempt_input_manifests
  from public, anon, authenticated, service_role;

do $security$
declare
  function_record record;
begin
  for function_record in
    select namespace.nspname as schema_name,
      procedure.proname as function_name,
      pg_catalog.pg_get_function_identity_arguments(procedure.oid) as arguments
    from pg_catalog.pg_proc procedure
    join pg_catalog.pg_namespace namespace
      on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'public'
      and procedure.proname = any(array[
        'af_canonical_jsonb_sha256_v1',
        'af_subject_ref_fingerprint_v1',
        'af_public_identity_names_valid_v1',
        'af_assert_identity_output_link_v1',
        'af_enforce_case_research_identity_immutability_v1',
        'af_reject_identity_manifest_mutation_v1',
        'af_resolved_subject_identity_valid_v1',
        'af_resolved_subject_identity_record_json_v1',
        'af_attempt_input_manifest_envelope_json_v1',
        'af_identity_requirement_ids_valid_v1',
        'af_research_start_result_shape_valid',
        'af_identity_requirements_valid_v1',
        'af_identity_resolution_partition_valid_v1',
        'af_get_research_identity_context_v1',
        'af_research_stage_result_v2_valid',
        'af_resolved_subject_identity_matches_v1',
        'af_complete_research_job_v2',
        'af_get_resolved_subject_identity_v1',
        'af_claim_research_job_v2'
      ])
  loop
    execute format(
      'revoke all on function %I.%I(%s) from public, anon, authenticated, service_role',
      function_record.schema_name, function_record.function_name,
      function_record.arguments
    );
  end loop;
end;
$security$;

grant execute on function public.af_get_research_identity_context_v1(
  uuid, uuid, uuid
) to service_role;
grant execute on function public.af_get_resolved_subject_identity_v1(
  uuid, uuid
) to service_role;
grant execute on function public.af_claim_research_job_v2(
  uuid, uuid, uuid, public.af_research_stage, bigint, bigint, text, uuid,
  text, jsonb, integer
) to service_role;
grant execute on function public.af_complete_research_job_v2(
  uuid, jsonb, text, jsonb, text, jsonb
) to service_role;

-- V1 claim and completion are still invoked transactionally by their v2
-- SECURITY DEFINER owners, but are no longer an externally callable worker
-- boundary after this migration.
revoke all on function public.af_claim_research_job_v1(
  uuid, uuid, uuid, public.af_research_stage, bigint, bigint, text, text,
  uuid, text, jsonb, integer
) from public, anon, authenticated, service_role;
revoke all on function public.af_complete_research_job_v1(
  uuid, jsonb, text, jsonb, text, jsonb
) from public, anon, authenticated, service_role;

comment on function public.af_get_research_identity_context_v1(
  uuid, uuid, uuid
) is
  'Service-only actor-scoped body-minimal resolver context; exact curiosity and source bodies are never returned.';
comment on function public.af_get_resolved_subject_identity_v1(uuid, uuid) is
  'Service-only actor-scoped resolver-verified public subject identity; this metadata is explicitly NOT_EVIDENCE.';
comment on function public.af_claim_research_job_v2(
  uuid, uuid, uuid, public.af_research_stage, bigint, bigint, text, uuid,
  text, jsonb, integer
) is
  'Service-only actor-scoped claim whose request fingerprint and body-free causal input manifest are authored and fenced by Postgres.';
comment on function public.af_complete_research_job_v2(
  uuid, jsonb, text, jsonb, text, jsonb
) is
  'Service-only token-fenced completion that atomically persists one IDENTITY metadata record and its one output link.';
