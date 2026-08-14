-- AFTERFRAME production persistence foundation (checkpoint 02).
--
-- Migrations 001-003 describe prototype-era tables and migration 004 keeps
-- those tables default-deny.  They cannot round-trip the accepted production
-- TypeScript schemas, so this migration deliberately creates an isolated
-- `af_*` schema spine alongside them.  No prototype data is copied or coerced.
--
-- The Zod schemas in src/core and src/contracts remain the canonical hostile-
-- input boundary.  These tables preserve every accepted field without using
-- movie-specific columns, and repeat the integrity/security laws that can be
-- enforced safely in PostgreSQL.

-- ---------------------------------------------------------------------------
-- Canonical scalar domains
-- ---------------------------------------------------------------------------

create domain public.af_slug as text
  check (
    value = btrim(value)
    and char_length(value) between 1 and 80
    and value ~ '^[a-z0-9]+([._-][a-z0-9]+)*$'
  );

create domain public.af_opaque_reference as text
  check (
    value = btrim(value)
    and char_length(value) between 1 and 512
  );

create domain public.af_version_tag as text
  check (
    value = btrim(value)
    and char_length(value) between 1 and 120
  );

create domain public.af_sha256 as text
  check (value ~ '^[a-f0-9]{64}$');

-- Zod performs the full URL parse.  SQL repeats the security-relevant protocol
-- and whitespace boundary without pretending a regular expression is a URL
-- parser.  Direct client writes are denied below.
create domain public.af_http_url as text
  check (value ~* '^https?://' and value !~ '[[:space:]]');

create domain public.af_safe_nonnegative_integer as bigint
  check (value between 0 and 9007199254740991);

create domain public.af_safe_positive_integer as bigint
  check (value between 1 and 9007199254740991);

-- ---------------------------------------------------------------------------
-- Exact persisted enums
-- ---------------------------------------------------------------------------

create type public.af_review_state as enum (
  'PROPOSED', 'ACCEPTED', 'REJECTED', 'SUPERSEDED', 'RETRACTED'
);
create type public.af_origin_kind as enum (
  'USER', 'SOURCE', 'HUMAN_CURATOR', 'HUMAN_REVIEWER', 'MODEL',
  'DETERMINISTIC_SYSTEM', 'RESOLVER', 'IMPORTER'
);
create type public.af_case_status as enum (
  'DRAFT', 'INTENT_PROPOSED', 'READY', 'ACTIVE', 'PAUSED',
  'CLOSURE_REVIEW', 'CLOSED'
);
create type public.af_case_health as enum ('HEALTHY', 'DEGRADED', 'FAILED');
create type public.af_direction_type as enum (
  'THEORY', 'QUESTION', 'LEAD', 'FOCUS', 'WIDEN', 'CHALLENGE',
  'COMPARE', 'CONNECT', 'STYLE', 'RETURN'
);
create type public.af_requested_direction_action as enum (
  'AUTO', 'THEORY', 'CHALLENGE', 'COMPARE', 'CONNECT', 'RETURN'
);
create type public.af_command_requested_action as enum (
  'auto', 'theory', 'challenge', 'compare', 'connect', 'return'
);
create type public.af_branch_action as enum (
  'CREATE', 'REDIRECT', 'DEEPEN', 'DETOUR', 'COMPARE',
  'PROPOSE_MERGE', 'RETURN'
);
create type public.af_branch_status as enum (
  'PROPOSED', 'PLANNED', 'OPEN', 'PAUSED', 'MERGED', 'CLOSED'
);
create type public.af_branch_kind as enum (
  'ROOT', 'QUESTION', 'THEORY', 'LEAD', 'FOCUS', 'WIDEN',
  'CHALLENGE', 'COMPARISON', 'CONNECTION', 'DETOUR'
);
create type public.af_source_medium as enum (
  'ARTICLE', 'WEBPAGE', 'BOOK', 'VIDEO', 'PODCAST', 'PDF', 'ARCHIVE',
  'OFFICIAL_RECORD', 'SCREENPLAY', 'USER_ASSET', 'OTHER'
);
create type public.af_access_state as enum (
  'OPEN', 'RESTRICTED', 'UNKNOWN', 'UNAVAILABLE'
);
create type public.af_rights_state as enum (
  'PERMITTED', 'LINK_ONLY', 'USER_OWNED', 'PUBLIC_DOMAIN', 'LICENSED',
  'UNKNOWN', 'PROHIBITED'
);
create type public.af_snapshot_extraction_method as enum (
  'RESOLVER', 'AUTHORIZED_API', 'USER_UPLOAD', 'HUMAN_REVIEW',
  'DETERMINISTIC_FIXTURE'
);
create type public.af_locator_status as enum (
  'VERIFIED_EXACT', 'VERIFIED_APPROXIMATE', 'SOURCE_ONLY', 'STALE',
  'UNAVAILABLE'
);
create type public.af_evidence_confidence as enum ('LOW', 'MEDIUM', 'HIGH');
create type public.af_claim_epistemic_kind as enum (
  'FACTUAL_CLAIM', 'ATTRIBUTED_ACCOUNT', 'INTERPRETATION', 'QUESTION',
  'UNCERTAINTY', 'CONNECTION_PROPOSAL', 'CREATIVE_DIRECTION'
);
create type public.af_claim_assessment_state as enum (
  'UNASSESSED', 'STRONG_SUPPORT', 'SUPPORTED_WITH_LIMITATIONS', 'CONTESTED',
  'WEAKLY_SUPPORTED', 'UNRESOLVED'
);
create type public.af_claim_evidence_polarity as enum (
  'SUPPORTS', 'CONTRADICTS', 'CONTEXTUALIZES'
);
create type public.af_provenance_record_type as enum (
  'CASE', 'SUBJECT', 'SOURCE', 'SOURCE_SNAPSHOT', 'LOCATOR', 'EVIDENCE',
  'CLAIM', 'CLAIM_EVIDENCE_EDGE', 'DIRECTION', 'BRANCH'
);
create type public.af_provenance_relationship as enum (
  'DERIVED_FROM', 'EXTRACTED_FROM', 'LOCATED_BY', 'SUPPORTED_BY',
  'CONTRADICTED_BY', 'CONTEXTUALIZED_BY', 'TRIGGERED_BY', 'SCOPED_TO',
  'SUPERSEDES', 'VERIFIED_BY'
);
create type public.af_domain_event_type as enum (
  'direction.submitted', 'branch.proposed'
);
create type public.af_idempotency_state as enum ('IN_PROGRESS', 'COMPLETED');

-- Research-run/job enums.  Every record in this spine has publication
-- authority NONE; candidates and hostile content cannot become evidence by a
-- database default or a stage-output write.
create type public.af_research_stage as enum (
  'IDENTITY', 'SCOPING', 'DISCOVERY', 'RESOLUTION', 'NORMALIZATION',
  'CORROBORATION', 'SEQUENCING'
);
create type public.af_research_run_status as enum (
  'QUEUED', 'PLANNING', 'RUNNING', 'SYNTHESIZING', 'SUCCEEDED', 'DEGRADED',
  'FAILED', 'CANCELLED'
);
create type public.af_research_run_health as enum (
  'HEALTHY', 'DEGRADED', 'FAILED'
);
create type public.af_research_job_status as enum (
  'QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED_RETRYABLE', 'DEGRADED',
  'FAILED_TERMINAL', 'CANCELLED'
);
create type public.af_research_attempt_status as enum (
  'RUNNING', 'SUCCEEDED', 'DEGRADED', 'FAILED_RETRYABLE',
  'FAILED_TERMINAL', 'CANCELLED'
);
create type public.af_execution_kind as enum (
  'DETERMINISTIC', 'MODEL', 'MODEL_TOOL', 'TOOL', 'RESOLVER', 'IMPORTER'
);
create type public.af_pricing_state as enum ('PRICED', 'UNPRICED');
create type public.af_execution_record_type as enum (
  'CASE', 'BRANCH', 'RUN', 'PLAN', 'JOB', 'ATTEMPT', 'SOURCE_CANDIDATE',
  'SOURCE', 'LOCATOR', 'EVIDENCE', 'CLAIM', 'OUTPUT'
);
create type public.af_untrusted_content_kind as enum (
  'METADATA', 'DOCUMENT', 'TRANSCRIPT', 'EXCERPT'
);
create type public.af_screening_state as enum (
  'UNSCREENED', 'PASSED', 'QUARANTINED'
);
create type public.af_research_output_kind as enum (
  'IDENTITY_RESULT', 'SCOPE_RESULT', 'DISCOVERY_RESULT', 'RESOLUTION_RESULT',
  'NORMALIZATION_RESULT', 'CORROBORATION_RESULT', 'SEQUENCING_RESULT'
);

-- ---------------------------------------------------------------------------
-- Reusable deterministic checks
-- ---------------------------------------------------------------------------

create function public.af_text_array_valid(
  values_to_check text[],
  maximum_count integer,
  minimum_length integer,
  maximum_length integer
)
returns boolean
language sql
immutable
set search_path = pg_catalog
as $function$
  select values_to_check is not null
    and cardinality(values_to_check) <= maximum_count
    and not exists (
      select 1
      from unnest(values_to_check) as item(value)
      where value is null
        or value <> btrim(value)
        or char_length(value) not between minimum_length and maximum_length
    );
$function$;

create function public.af_slug_array_valid(
  values_to_check text[],
  minimum_count integer,
  maximum_count integer
)
returns boolean
language sql
immutable
set search_path = pg_catalog
as $function$
  select values_to_check is not null
    and cardinality(values_to_check) between minimum_count and maximum_count
    and not exists (
      select 1
      from unnest(values_to_check) as item(value)
      where value is null
        or value <> btrim(value)
        or char_length(value) not between 1 and 80
        or value !~ '^[a-z0-9]+([._-][a-z0-9]+)*$'
    );
$function$;

create function public.af_uuid_array_valid(
  values_to_check uuid[],
  minimum_count integer,
  maximum_count integer
)
returns boolean
language sql
immutable
set search_path = pg_catalog
as $function$
  select values_to_check is not null
    and cardinality(values_to_check) between minimum_count and maximum_count
    and array_position(values_to_check, null) is null;
$function$;

create function public.af_origin_valid(
  origin_kind_to_check public.af_origin_kind,
  actor_id_to_check text,
  version_to_check text
)
returns boolean
language sql
immutable
set search_path = pg_catalog, public
as $function$
  select
    (
      origin_kind_to_check not in (
        'MODEL'::public.af_origin_kind,
        'DETERMINISTIC_SYSTEM'::public.af_origin_kind,
        'RESOLVER'::public.af_origin_kind,
        'IMPORTER'::public.af_origin_kind
      )
      or version_to_check is not null
    )
    and (
      origin_kind_to_check <> 'USER'::public.af_origin_kind
      or actor_id_to_check is not null
    );
$function$;

-- ---------------------------------------------------------------------------
-- Domain-neutral investigation graph
-- ---------------------------------------------------------------------------

create table public.af_cases (
  id uuid primary key,
  owner_id uuid not null references auth.users(id) on delete restrict,
  specialist_id public.af_slug not null,
  specialist_version public.af_version_tag not null,
  subject_type public.af_slug not null,
  subject_id public.af_opaque_reference not null,
  subject_version_id public.af_opaque_reference,
  exact_curiosity text not null,
  status public.af_case_status not null,
  health public.af_case_health not null,
  active_branch_id uuid,
  aggregate_version public.af_safe_nonnegative_integer not null,
  event_sequence public.af_safe_nonnegative_integer not null,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  constraint af_cases_exact_curiosity_check check (
    char_length(exact_curiosity) between 3 and 4000
    and char_length(btrim(exact_curiosity)) >= 3
  ),
  constraint af_cases_active_status_check check (
    status not in ('ACTIVE', 'PAUSED', 'CLOSURE_REVIEW', 'CLOSED')
    or active_branch_id is not null
  ),
  constraint af_cases_time_check check (updated_at >= created_at),
  unique (id, owner_id)
);

create table public.af_branches (
  id uuid primary key,
  case_id uuid not null references public.af_cases(id) on delete cascade,
  parent_branch_id uuid,
  origin_direction_id uuid,
  kind public.af_branch_kind not null,
  title text not null,
  normalized_objective text not null,
  status public.af_branch_status not null,
  research_axis_ids text[] not null,
  unresolved_questions text[] not null,
  return_branch_id uuid,
  return_reading_sequence_key text,
  return_beat_id uuid,
  aggregate_version public.af_safe_nonnegative_integer not null,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  constraint af_branches_title_check check (
    title = btrim(title) and char_length(title) between 1 and 300
  ),
  constraint af_branches_objective_check check (
    normalized_objective = btrim(normalized_objective)
    and char_length(normalized_objective) between 1 and 2000
  ),
  constraint af_branches_axes_check check (
    public.af_slug_array_valid(research_axis_ids, 0, 20)
  ),
  constraint af_branches_questions_check check (
    public.af_text_array_valid(unresolved_questions, 30, 1, 1000)
  ),
  constraint af_branches_root_shape_check check (
    (kind = 'ROOT' and parent_branch_id is null and origin_direction_id is null)
    or (kind <> 'ROOT' and parent_branch_id is not null and origin_direction_id is not null)
  ),
  constraint af_branches_return_shape_check check (
    (
      return_branch_id is null
      and return_reading_sequence_key is null
      and return_beat_id is null
    )
    or (
      return_branch_id is not null
      and return_reading_sequence_key is not null
      and return_reading_sequence_key = btrim(return_reading_sequence_key)
      and char_length(return_reading_sequence_key) between 1 and 200
      and return_branch_id = parent_branch_id
    )
  ),
  constraint af_branches_time_check check (updated_at >= created_at),
  constraint af_branches_parent_fk foreign key (case_id, parent_branch_id)
    references public.af_branches(case_id, id)
    deferrable initially deferred,
  unique (case_id, id)
);

create unique index af_branches_one_root_per_case_idx
  on public.af_branches(case_id)
  where kind = 'ROOT';

alter table public.af_cases
  add constraint af_cases_active_branch_fk
  foreign key (id, active_branch_id)
  references public.af_branches(case_id, id)
  deferrable initially deferred;

create table public.af_sources (
  id uuid primary key,
  canonical_key text not null,
  canonical_url public.af_http_url,
  title text not null,
  contributors text[] not null,
  publisher text,
  published_at timestamptz,
  medium public.af_source_medium not null,
  source_class public.af_slug not null,
  access_state public.af_access_state not null,
  rights_state public.af_rights_state not null,
  independence_group_id public.af_opaque_reference,
  origin_kind public.af_origin_kind not null,
  origin_actor_id public.af_opaque_reference,
  origin_version public.af_version_tag,
  created_at timestamptz not null,
  constraint af_sources_canonical_key_check check (
    canonical_key = btrim(canonical_key)
    and char_length(canonical_key) between 1 and 1000
  ),
  constraint af_sources_title_check check (
    title = btrim(title) and char_length(title) between 1 and 1000
  ),
  constraint af_sources_contributors_check check (
    public.af_text_array_valid(contributors, 30, 1, 300)
  ),
  constraint af_sources_publisher_check check (
    publisher is null
    or (publisher = btrim(publisher) and char_length(publisher) between 1 and 500)
  ),
  constraint af_sources_open_url_check check (
    access_state <> 'OPEN' or canonical_url is not null
  ),
  constraint af_sources_prohibited_check check (
    rights_state <> 'PROHIBITED' or access_state <> 'OPEN'
  ),
  constraint af_sources_origin_check check (
    public.af_origin_valid(origin_kind, origin_actor_id, origin_version)
  ),
  unique (id, medium)
);

-- SourceRecord has no caseId.  A graph's source collection is represented by
-- this association, which supplies the owner boundary without making public or
-- shared metadata globally readable.
create table public.af_case_sources (
  case_id uuid not null references public.af_cases(id) on delete cascade,
  source_id uuid not null references public.af_sources(id) on delete cascade,
  created_at timestamptz not null default statement_timestamp(),
  primary key (case_id, source_id)
);

create table public.af_source_snapshots (
  id uuid primary key,
  source_id uuid not null references public.af_sources(id) on delete cascade,
  case_id uuid references public.af_cases(id) on delete cascade,
  content_fingerprint public.af_sha256 not null,
  content_length public.af_safe_nonnegative_integer not null,
  extraction_method public.af_snapshot_extraction_method not null,
  storage_ref public.af_opaque_reference,
  access_state public.af_access_state not null,
  rights_state public.af_rights_state not null,
  captured_at timestamptz not null,
  created_by_run_id uuid,
  origin_kind public.af_origin_kind not null,
  origin_actor_id public.af_opaque_reference,
  origin_version public.af_version_tag,
  constraint af_source_snapshots_storage_check check (
    storage_ref is null
    or (
      rights_state in ('PERMITTED', 'USER_OWNED', 'PUBLIC_DOMAIN', 'LICENSED')
      and access_state in ('OPEN', 'RESTRICTED')
    )
  ),
  constraint af_source_snapshots_user_owned_check check (
    rights_state <> 'USER_OWNED' or case_id is not null
  ),
  constraint af_source_snapshots_origin_check check (
    public.af_origin_valid(origin_kind, origin_actor_id, origin_version)
  ),
  constraint af_source_snapshots_case_source_fk
    foreign key (case_id, source_id)
    references public.af_case_sources(case_id, source_id)
    deferrable initially deferred,
  unique (source_id, id)
);

create table public.af_source_locators (
  id uuid primary key,
  source_id uuid not null,
  kind public.af_source_medium not null check (kind <> 'OTHER'),
  status public.af_locator_status not null,
  resolver_id public.af_slug not null,
  resolver_version public.af_version_tag not null,
  revision integer not null check (revision > 0),
  supersedes_locator_id uuid,
  open_url public.af_http_url,
  resolved_at timestamptz,
  last_verified_at timestamptz,
  created_at timestamptz not null,

  -- ARTICLE / WEBPAGE
  heading_path text[],
  paragraph_index integer check (paragraph_index is null or paragraph_index >= 0),
  text_fragment_url public.af_http_url,

  -- VIDEO / PODCAST
  provider public.af_slug,
  provider_item_id public.af_opaque_reference,
  timestamp_start_ms public.af_safe_nonnegative_integer,
  timestamp_end_ms public.af_safe_nonnegative_integer,
  transcript_cue_ids text[],
  transcript_fingerprint public.af_sha256,

  -- BOOK
  edition_id public.af_opaque_reference,
  isbn text check (
    isbn is null or (isbn = btrim(isbn) and char_length(isbn) between 10 and 17)
  ),
  page_start integer check (page_start is null or page_start > 0),
  page_end integer check (page_end is null or page_end > 0),
  chapter text check (
    chapter is null or (chapter = btrim(chapter) and char_length(chapter) between 1 and 300)
  ),

  -- BOOK and paginated variants share these domain properties.
  printed_page_label text check (
    printed_page_label is null
    or (
      printed_page_label = btrim(printed_page_label)
      and char_length(printed_page_label) between 1 and 40
    )
  ),
  section text check (
    section is null or (section = btrim(section) and char_length(section) between 1 and 300)
  ),
  text_fingerprint public.af_sha256,

  -- PDF / ARCHIVE / OFFICIAL_RECORD / SCREENPLAY
  document_version_id public.af_opaque_reference,
  page_index integer check (page_index is null or page_index > 0),
  heading text check (
    heading is null or (heading = btrim(heading) and char_length(heading) between 1 and 300)
  ),

  -- ARCHIVE
  collection_id public.af_opaque_reference,
  item_id public.af_opaque_reference,

  -- OFFICIAL_RECORD
  issuing_body text check (
    issuing_body is null
    or (issuing_body = btrim(issuing_body) and char_length(issuing_body) between 1 and 500)
  ),
  record_id public.af_opaque_reference,

  -- SCREENPLAY
  draft_id public.af_opaque_reference,
  scene_number text check (
    scene_number is null
    or (scene_number = btrim(scene_number) and char_length(scene_number) between 1 and 40)
  ),
  scene_heading text check (
    scene_heading is null
    or (scene_heading = btrim(scene_heading) and char_length(scene_heading) between 1 and 300)
  ),

  -- USER_ASSET
  asset_id public.af_opaque_reference,
  location_description text check (
    location_description is null
    or (
      location_description = btrim(location_description)
      and char_length(location_description) between 1 and 500
    )
  ),
  content_fingerprint public.af_sha256,

  constraint af_source_locators_source_medium_fk
    foreign key (source_id, kind)
    references public.af_sources(id, medium)
    on delete cascade,
  constraint af_source_locators_supersedes_fk
    foreign key (source_id, supersedes_locator_id)
    references public.af_source_locators(source_id, id)
    deferrable initially deferred,
  constraint af_source_locators_base_check check (
    (supersedes_locator_id is null and revision = 1)
    or (supersedes_locator_id is not null and revision > 1)
  ),
  constraint af_source_locators_open_check check (
    status = 'UNAVAILABLE' or open_url is not null
  ),
  constraint af_source_locators_verified_time_check check (
    status not in ('VERIFIED_EXACT', 'VERIFIED_APPROXIMATE')
    or (resolved_at is not null and last_verified_at is not null)
  ),
  constraint af_source_locators_time_order_check check (
    (resolved_at is null or resolved_at >= created_at)
    and (
      last_verified_at is null
      or resolved_at is null
      or last_verified_at >= resolved_at
    )
  ),
  constraint af_source_locators_kind_shape_check check (
    case kind
      when 'ARTICLE' then
        heading_path is not null
        and public.af_text_array_valid(heading_path, 20, 1, 300)
        and provider is null and provider_item_id is null
        and timestamp_start_ms is null and timestamp_end_ms is null
        and transcript_cue_ids is null and transcript_fingerprint is null
        and edition_id is null and isbn is null and page_start is null and page_end is null
        and printed_page_label is null and chapter is null and section is null
        and document_version_id is null and page_index is null and heading is null
        and collection_id is null and item_id is null and issuing_body is null and record_id is null
        and draft_id is null and scene_number is null and scene_heading is null
        and asset_id is null and location_description is null and content_fingerprint is null
      when 'WEBPAGE' then
        heading_path is not null
        and public.af_text_array_valid(heading_path, 20, 1, 300)
        and provider is null and provider_item_id is null
        and timestamp_start_ms is null and timestamp_end_ms is null
        and transcript_cue_ids is null and transcript_fingerprint is null
        and edition_id is null and isbn is null and page_start is null and page_end is null
        and printed_page_label is null and chapter is null and section is null
        and document_version_id is null and page_index is null and heading is null
        and collection_id is null and item_id is null and issuing_body is null and record_id is null
        and draft_id is null and scene_number is null and scene_heading is null
        and asset_id is null and location_description is null and content_fingerprint is null
      when 'VIDEO' then
        heading_path is null and paragraph_index is null and text_fragment_url is null
        and text_fingerprint is null
        and provider is not null and provider_item_id is not null
        and transcript_cue_ids is not null
        and public.af_text_array_valid(transcript_cue_ids, 100, 1, 512)
        and edition_id is null and isbn is null and page_start is null and page_end is null
        and printed_page_label is null and chapter is null and section is null
        and document_version_id is null and page_index is null and heading is null
        and collection_id is null and item_id is null and issuing_body is null and record_id is null
        and draft_id is null and scene_number is null and scene_heading is null
        and asset_id is null and location_description is null and content_fingerprint is null
      when 'PODCAST' then
        heading_path is null and paragraph_index is null and text_fragment_url is null
        and text_fingerprint is null
        and provider is not null and provider_item_id is not null
        and transcript_cue_ids is not null
        and public.af_text_array_valid(transcript_cue_ids, 100, 1, 512)
        and edition_id is null and isbn is null and page_start is null and page_end is null
        and printed_page_label is null and chapter is null and section is null
        and document_version_id is null and page_index is null and heading is null
        and collection_id is null and item_id is null and issuing_body is null and record_id is null
        and draft_id is null and scene_number is null and scene_heading is null
        and asset_id is null and location_description is null and content_fingerprint is null
      when 'BOOK' then
        heading_path is null and paragraph_index is null and text_fragment_url is null
        and provider is null and provider_item_id is null
        and timestamp_start_ms is null and timestamp_end_ms is null
        and transcript_cue_ids is null and transcript_fingerprint is null
        and text_fingerprint is null
        and document_version_id is null and page_index is null and heading is null
        and collection_id is null and item_id is null and issuing_body is null and record_id is null
        and draft_id is null and scene_number is null and scene_heading is null
        and asset_id is null and location_description is null and content_fingerprint is null
      when 'PDF' then
        heading_path is null and paragraph_index is null and text_fragment_url is null
        and provider is null and provider_item_id is null
        and timestamp_start_ms is null and timestamp_end_ms is null
        and transcript_cue_ids is null and transcript_fingerprint is null
        and edition_id is null and isbn is null and page_start is null and page_end is null and chapter is null
        and collection_id is null and item_id is null and issuing_body is null and record_id is null
        and draft_id is null and scene_number is null and scene_heading is null
        and asset_id is null and location_description is null and content_fingerprint is null
      when 'ARCHIVE' then
        heading_path is null and paragraph_index is null and text_fragment_url is null
        and provider is null and provider_item_id is null
        and timestamp_start_ms is null and timestamp_end_ms is null
        and transcript_cue_ids is null and transcript_fingerprint is null
        and edition_id is null and isbn is null and page_start is null and page_end is null and chapter is null
        and collection_id is not null and item_id is not null
        and issuing_body is null and record_id is null
        and draft_id is null and scene_number is null and scene_heading is null
        and asset_id is null and location_description is null and content_fingerprint is null
      when 'OFFICIAL_RECORD' then
        heading_path is null and paragraph_index is null and text_fragment_url is null
        and provider is null and provider_item_id is null
        and timestamp_start_ms is null and timestamp_end_ms is null
        and transcript_cue_ids is null and transcript_fingerprint is null
        and edition_id is null and isbn is null and page_start is null and page_end is null and chapter is null
        and collection_id is null and item_id is null
        and issuing_body is not null and record_id is not null
        and draft_id is null and scene_number is null and scene_heading is null
        and asset_id is null and location_description is null and content_fingerprint is null
      when 'SCREENPLAY' then
        heading_path is null and paragraph_index is null and text_fragment_url is null
        and provider is null and provider_item_id is null
        and timestamp_start_ms is null and timestamp_end_ms is null
        and transcript_cue_ids is null and transcript_fingerprint is null
        and edition_id is null and isbn is null and page_start is null and page_end is null and chapter is null
        and collection_id is null and item_id is null and issuing_body is null and record_id is null
        and draft_id is not null
        and asset_id is null and location_description is null and content_fingerprint is null
      when 'USER_ASSET' then
        heading_path is null and paragraph_index is null and text_fragment_url is null
        and text_fingerprint is null
        and provider is null and provider_item_id is null
        and timestamp_start_ms is null and timestamp_end_ms is null
        and transcript_cue_ids is null and transcript_fingerprint is null
        and edition_id is null and isbn is null and page_start is null and page_end is null
        and printed_page_label is null and chapter is null and section is null
        and document_version_id is null and page_index is null and heading is null
        and collection_id is null and item_id is null and issuing_body is null and record_id is null
        and draft_id is null and scene_number is null and scene_heading is null
        and asset_id is not null and location_description is not null and content_fingerprint is not null
    end
  ),
  constraint af_source_locators_variant_semantics_check check (
    case
      when kind = 'BOOK' then
        (page_end is null or page_start is not null)
        and (page_end is null or page_end >= page_start)
        and (
          status <> 'VERIFIED_EXACT'
          or (edition_id is not null and page_start is not null)
        )
        and (
          status <> 'VERIFIED_APPROXIMATE'
          or (
            edition_id is not null
            and (page_start is not null or chapter is not null or section is not null)
          )
        )
      when kind in ('VIDEO', 'PODCAST') then
        (timestamp_end_ms is null or timestamp_start_ms is not null)
        and (timestamp_end_ms is null or timestamp_end_ms >= timestamp_start_ms)
        and (
          status not in ('VERIFIED_EXACT', 'VERIFIED_APPROXIMATE')
          or timestamp_start_ms is not null
        )
      when kind in ('ARTICLE', 'WEBPAGE') then
        (
          status <> 'VERIFIED_EXACT'
          or (
            text_fingerprint is not null
            and (
              cardinality(heading_path) > 0
              or paragraph_index is not null
              or text_fragment_url is not null
            )
          )
        )
        and (
          status <> 'VERIFIED_APPROXIMATE'
          or cardinality(heading_path) > 0
          or paragraph_index is not null
          or text_fragment_url is not null
        )
      when kind in ('PDF', 'ARCHIVE', 'OFFICIAL_RECORD', 'SCREENPLAY') then
        status not in ('VERIFIED_EXACT', 'VERIFIED_APPROXIMATE')
        or (
          (page_index is not null or printed_page_label is not null or section is not null or heading is not null)
          and (
            status <> 'VERIFIED_EXACT'
            or page_index is not null
            or printed_page_label is not null
          )
        )
      else true
    end
  ),
  unique (source_id, id)
);

create function public.af_enforce_locator_revision()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $function$
declare
  predecessor_revision integer;
begin
  if new.supersedes_locator_id is null then
    return new;
  end if;

  select revision into predecessor_revision
  from public.af_source_locators
  where source_id = new.source_id and id = new.supersedes_locator_id;

  if predecessor_revision is null or new.revision <> predecessor_revision + 1 then
    raise exception using
      errcode = '23514',
      message = 'Locator revisions must advance exactly once from their predecessor';
  end if;
  return new;
end;
$function$;

create trigger af_source_locators_revision_trigger
before insert or update of source_id, supersedes_locator_id, revision
on public.af_source_locators
for each row execute function public.af_enforce_locator_revision();

create table public.af_evidence_fragments (
  id uuid primary key,
  case_id uuid not null references public.af_cases(id) on delete cascade,
  source_id uuid not null,
  snapshot_id uuid not null,
  locator_id uuid not null,
  finding text not null,
  short_quote text,
  why_surfaced text not null,
  limitations text[] not null,
  confidence public.af_evidence_confidence not null,
  review_state public.af_review_state not null,
  origin_kind public.af_origin_kind not null,
  origin_actor_id public.af_opaque_reference,
  origin_version public.af_version_tag,
  created_by_run_id uuid,
  created_at timestamptz not null,
  constraint af_evidence_finding_check check (
    finding = btrim(finding) and char_length(finding) between 1 and 4000
  ),
  constraint af_evidence_quote_check check (
    short_quote is null
    or (short_quote = btrim(short_quote) and char_length(short_quote) between 1 and 500)
  ),
  constraint af_evidence_why_check check (
    why_surfaced = btrim(why_surfaced)
    and char_length(why_surfaced) between 1 and 2000
  ),
  constraint af_evidence_limitations_check check (
    public.af_text_array_valid(limitations, 30, 1, 1000)
  ),
  constraint af_evidence_origin_check check (
    public.af_origin_valid(origin_kind, origin_actor_id, origin_version)
  ),
  constraint af_evidence_case_source_fk foreign key (case_id, source_id)
    references public.af_case_sources(case_id, source_id)
    deferrable initially deferred,
  constraint af_evidence_snapshot_fk foreign key (source_id, snapshot_id)
    references public.af_source_snapshots(source_id, id),
  constraint af_evidence_locator_fk foreign key (source_id, locator_id)
    references public.af_source_locators(source_id, id),
  unique (case_id, id)
);

create function public.af_enforce_evidence_trust()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $function$
declare
  source_row public.af_sources%rowtype;
  snapshot_row public.af_source_snapshots%rowtype;
  locator_row public.af_source_locators%rowtype;
begin
  select * into strict source_row from public.af_sources where id = new.source_id;
  select * into strict snapshot_row from public.af_source_snapshots where id = new.snapshot_id;
  select * into strict locator_row from public.af_source_locators where id = new.locator_id;

  if snapshot_row.case_id is not null and snapshot_row.case_id <> new.case_id then
    raise exception using errcode = '23514', message = 'Private snapshot belongs to another case';
  end if;

  if new.review_state = 'ACCEPTED' then
    if locator_row.status not in ('VERIFIED_EXACT', 'VERIFIED_APPROXIMATE')
      or source_row.rights_state not in ('PERMITTED', 'LINK_ONLY', 'USER_OWNED', 'PUBLIC_DOMAIN', 'LICENSED')
      or snapshot_row.rights_state not in ('PERMITTED', 'LINK_ONLY', 'USER_OWNED', 'PUBLIC_DOMAIN', 'LICENSED')
      or source_row.access_state not in ('OPEN', 'RESTRICTED')
      or snapshot_row.access_state not in ('OPEN', 'RESTRICTED') then
      raise exception using errcode = '23514', message = 'Accepted evidence violates locator, rights, or access policy';
    end if;
  end if;

  if new.short_quote is not null and (
    source_row.rights_state not in ('PERMITTED', 'USER_OWNED', 'PUBLIC_DOMAIN', 'LICENSED')
    or snapshot_row.rights_state not in ('PERMITTED', 'USER_OWNED', 'PUBLIC_DOMAIN', 'LICENSED')
    or source_row.access_state not in ('OPEN', 'RESTRICTED')
    or snapshot_row.access_state not in ('OPEN', 'RESTRICTED')
  ) then
    raise exception using errcode = '23514', message = 'Quoted excerpts require explicit content-retention rights';
  end if;
  return new;
end;
$function$;

create trigger af_evidence_trust_trigger
before insert or update on public.af_evidence_fragments
for each row execute function public.af_enforce_evidence_trust();

create table public.af_claims (
  id uuid primary key,
  case_id uuid not null references public.af_cases(id) on delete cascade,
  branch_id uuid,
  statement text not null,
  epistemic_kind public.af_claim_epistemic_kind not null,
  assessment_state public.af_claim_assessment_state not null,
  confidence_language text not null,
  review_state public.af_review_state not null,
  origin_kind public.af_origin_kind not null,
  origin_actor_id public.af_opaque_reference,
  origin_version public.af_version_tag,
  created_by_run_id uuid,
  supersedes_claim_id uuid,
  created_at timestamptz not null,
  constraint af_claims_statement_check check (
    statement = btrim(statement) and char_length(statement) between 1 and 4000
  ),
  constraint af_claims_confidence_check check (
    confidence_language = btrim(confidence_language)
    and char_length(confidence_language) between 1 and 1000
  ),
  constraint af_claims_origin_check check (
    public.af_origin_valid(origin_kind, origin_actor_id, origin_version)
  ),
  constraint af_claims_not_self_superseding check (supersedes_claim_id is distinct from id),
  constraint af_claims_branch_fk foreign key (case_id, branch_id)
    references public.af_branches(case_id, id),
  constraint af_claims_supersedes_fk foreign key (case_id, supersedes_claim_id)
    references public.af_claims(case_id, id)
    deferrable initially deferred,
  unique (case_id, id)
);

create table public.af_claim_evidence_edges (
  id uuid primary key,
  case_id uuid not null references public.af_cases(id) on delete cascade,
  claim_id uuid not null,
  evidence_id uuid not null,
  polarity public.af_claim_evidence_polarity not null,
  rationale text not null,
  limitations text[] not null,
  review_state public.af_review_state not null,
  origin_kind public.af_origin_kind not null,
  origin_actor_id public.af_opaque_reference,
  origin_version public.af_version_tag,
  created_by_run_id uuid,
  created_at timestamptz not null,
  constraint af_claim_edges_rationale_check check (
    rationale = btrim(rationale) and char_length(rationale) between 1 and 2000
  ),
  constraint af_claim_edges_limitations_check check (
    public.af_text_array_valid(limitations, 30, 1, 1000)
  ),
  constraint af_claim_edges_origin_check check (
    public.af_origin_valid(origin_kind, origin_actor_id, origin_version)
  ),
  constraint af_claim_edges_claim_fk foreign key (case_id, claim_id)
    references public.af_claims(case_id, id),
  constraint af_claim_edges_evidence_fk foreign key (case_id, evidence_id)
    references public.af_evidence_fragments(case_id, id),
  unique (case_id, claim_id, evidence_id, polarity),
  unique (case_id, id)
);

create function public.af_enforce_claim_edge_review()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $function$
begin
  if new.review_state = 'ACCEPTED' and not exists (
    select 1
    from public.af_claims claim
    join public.af_evidence_fragments evidence
      on evidence.case_id = claim.case_id
    where claim.case_id = new.case_id
      and claim.id = new.claim_id
      and evidence.id = new.evidence_id
      and claim.review_state = 'ACCEPTED'
      and evidence.review_state = 'ACCEPTED'
  ) then
    raise exception using errcode = '23514', message = 'Accepted claim edges require accepted claim and evidence';
  end if;
  return new;
end;
$function$;

create trigger af_claim_edge_review_trigger
before insert or update on public.af_claim_evidence_edges
for each row execute function public.af_enforce_claim_edge_review();

create table public.af_directions (
  id uuid primary key,
  case_id uuid not null references public.af_cases(id) on delete cascade,
  source_branch_id uuid not null,
  actor_id uuid not null references auth.users(id) on delete restrict,
  exact_user_text text not null,
  requested_action public.af_requested_direction_action not null,
  direction_type public.af_direction_type not null,
  branch_action public.af_branch_action not null,
  acknowledgement text,
  anchor_branch_id uuid,
  anchor_beat_id uuid,
  anchor_evidence_id uuid,
  anchor_claim_id uuid,
  anchor_selected_text_fingerprint public.af_opaque_reference,
  anchor_reading_sequence_key text,
  origin_kind public.af_origin_kind not null,
  origin_actor_id public.af_opaque_reference,
  origin_version public.af_version_tag,
  created_at timestamptz not null,
  constraint af_directions_exact_text_check check (
    char_length(exact_user_text) between 3 and 4000
    and char_length(btrim(exact_user_text)) >= 3
  ),
  constraint af_directions_ack_check check (
    acknowledgement is null
    or (
      acknowledgement = btrim(acknowledgement)
      and char_length(acknowledgement) between 1 and 120
    )
  ),
  constraint af_directions_anchor_check check (
    (
      anchor_branch_id is null
      and anchor_beat_id is null
      and anchor_evidence_id is null
      and anchor_claim_id is null
      and anchor_selected_text_fingerprint is null
      and anchor_reading_sequence_key is null
    )
    or (
      anchor_branch_id = source_branch_id
      and (
        anchor_beat_id is not null
        or anchor_evidence_id is not null
        or anchor_claim_id is not null
        or anchor_reading_sequence_key is not null
      )
      and (
        anchor_reading_sequence_key is null
        or (
          anchor_reading_sequence_key = btrim(anchor_reading_sequence_key)
          and char_length(anchor_reading_sequence_key) between 1 and 200
        )
      )
    )
  ),
  constraint af_directions_user_origin_check check (
    origin_kind = 'USER'
    and origin_actor_id = actor_id::text
    and public.af_origin_valid(origin_kind, origin_actor_id, origin_version)
  ),
  constraint af_directions_source_branch_fk foreign key (case_id, source_branch_id)
    references public.af_branches(case_id, id),
  constraint af_directions_anchor_branch_fk foreign key (case_id, anchor_branch_id)
    references public.af_branches(case_id, id),
  constraint af_directions_anchor_evidence_fk foreign key (case_id, anchor_evidence_id)
    references public.af_evidence_fragments(case_id, id),
  constraint af_directions_anchor_claim_fk foreign key (case_id, anchor_claim_id)
    references public.af_claims(case_id, id),
  unique (case_id, id)
);

alter table public.af_branches
  add constraint af_branches_origin_direction_fk
  foreign key (case_id, origin_direction_id)
  references public.af_directions(case_id, id)
  deferrable initially deferred;

create function public.af_enforce_branch_origin()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $function$
begin
  if new.origin_direction_id is not null and not exists (
    select 1 from public.af_directions direction
    where direction.case_id = new.case_id
      and direction.id = new.origin_direction_id
      and direction.source_branch_id = new.parent_branch_id
  ) then
    raise exception using errcode = '23514', message = 'Origin direction must come from the parent branch';
  end if;
  return new;
end;
$function$;

create constraint trigger af_branches_origin_trigger
after insert or update of case_id, parent_branch_id, origin_direction_id
on public.af_branches
deferrable initially deferred
for each row execute function public.af_enforce_branch_origin();

create table public.af_provenance_edges (
  id uuid primary key,
  case_id uuid not null references public.af_cases(id) on delete cascade,
  output_type public.af_provenance_record_type not null,
  output_id public.af_opaque_reference not null,
  input_type public.af_provenance_record_type not null,
  input_id public.af_opaque_reference not null,
  relationship public.af_provenance_relationship not null,
  origin_kind public.af_origin_kind not null,
  origin_actor_id public.af_opaque_reference,
  origin_version public.af_version_tag,
  method_name public.af_slug not null,
  method_version public.af_version_tag not null,
  run_id uuid,
  created_at timestamptz not null,
  constraint af_provenance_not_self check (
    output_type <> input_type or output_id <> input_id
  ),
  constraint af_provenance_origin_check check (
    public.af_origin_valid(origin_kind, origin_actor_id, origin_version)
  ),
  unique (case_id, output_type, output_id, relationship, input_type, input_id)
);

create table public.af_domain_events (
  id uuid primary key,
  event_type public.af_domain_event_type not null,
  schema_version smallint not null check (schema_version = 1),
  aggregate_type text not null check (aggregate_type = 'case'),
  aggregate_id uuid not null references public.af_cases(id) on delete cascade,
  sequence public.af_safe_positive_integer not null,
  aggregate_version public.af_safe_positive_integer not null,
  occurred_at timestamptz not null,
  payload jsonb not null,
  constraint af_domain_events_payload_object_check check (jsonb_typeof(payload) = 'object'),
  unique (aggregate_id, sequence)
);

create table public.af_outbox_events (
  id uuid primary key,
  domain_event_id uuid not null unique
    references public.af_domain_events(id) on delete cascade,
  recorded_at timestamptz not null,
  publication_attempts public.af_safe_nonnegative_integer not null,
  published_at timestamptz,
  constraint af_outbox_distinct_ids_check check (id <> domain_event_id),
  constraint af_outbox_time_check check (
    published_at is null or published_at >= recorded_at
  )
);

comment on table public.af_domain_events is
  'Reference-only semantic events. Payloads may never contain exact direction text, selected text, source excerpts, note bodies, or arbitrary analytics data.';
comment on table public.af_outbox_events is
  'Transactional outbox envelope. id is the outbox ID; domain_event_id is the distinct semantic event ID.';

-- ---------------------------------------------------------------------------
-- Research run/job spine and hostile discovery boundary
-- ---------------------------------------------------------------------------

create table public.af_research_runs (
  schema_version smallint not null check (schema_version = 1),
  id uuid primary key,
  case_id uuid not null references public.af_cases(id) on delete cascade,
  branch_id uuid,
  plan_id uuid not null,
  specialist_id public.af_slug not null,
  specialist_version public.af_version_tag not null,
  objective_fingerprint public.af_sha256 not null,
  request_fingerprint public.af_sha256 not null,
  trace_id public.af_opaque_reference not null,
  status public.af_research_run_status not null,
  health public.af_research_run_health not null,
  current_stage public.af_research_stage,
  publication_authority text not null check (publication_authority = 'NONE'),
  aggregate_version public.af_safe_nonnegative_integer not null,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  started_at timestamptz,
  completed_at timestamptz,
  constraint af_research_runs_branch_fk foreign key (case_id, branch_id)
    references public.af_branches(case_id, id),
  constraint af_research_runs_time_check check (
    updated_at >= created_at
    and (started_at is null or started_at >= created_at)
    and (
      completed_at is null
      or (started_at is not null and completed_at >= started_at and completed_at <= updated_at)
    )
  ),
  constraint af_research_runs_lifecycle_check check (
    (
      status = 'QUEUED'
      and current_stage is null
      and started_at is null
      and completed_at is null
    )
    or (
      status <> 'QUEUED'
      and started_at is not null
      and (
        (status in ('SUCCEEDED', 'DEGRADED', 'FAILED', 'CANCELLED') and completed_at is not null)
        or (status not in ('SUCCEEDED', 'DEGRADED', 'FAILED', 'CANCELLED') and completed_at is null)
      )
    )
  ),
  constraint af_research_runs_health_check check (
    (status <> 'SUCCEEDED' or health = 'HEALTHY')
    and (status <> 'DEGRADED' or health = 'DEGRADED')
    and (status <> 'FAILED' or health = 'FAILED')
  ),
  unique (id, case_id),
  unique (id, specialist_id, specialist_version)
);

create table public.af_research_plans (
  id uuid primary key,
  run_id uuid not null unique,
  specialist_id public.af_slug not null,
  specialist_version public.af_version_tag not null,
  input_fingerprint public.af_sha256 not null,
  plan_fingerprint public.af_sha256 not null,
  plan jsonb not null check (jsonb_typeof(plan) = 'object'),
  publication_authority text not null check (publication_authority = 'NONE'),
  created_at timestamptz not null,
  constraint af_research_plans_run_specialist_fk
    foreign key (run_id, specialist_id, specialist_version)
    references public.af_research_runs(id, specialist_id, specialist_version)
    deferrable initially deferred
);

alter table public.af_research_runs
  add constraint af_research_runs_plan_fk
  foreign key (plan_id)
  references public.af_research_plans(id)
  deferrable initially deferred;

comment on column public.af_research_plans.plan is
  'Lossless SpecialistResearchPlan JSON. Parse through SpecialistResearchPlanSchema on every load; no planner/model output may bypass that boundary.';

create table public.af_research_jobs (
  schema_version smallint not null check (schema_version = 1),
  id uuid primary key,
  run_id uuid not null,
  case_id uuid not null,
  stage public.af_research_stage not null,
  stage_ordinal smallint not null check (stage_ordinal between 0 and 6),
  depends_on_job_id uuid,
  logical_job_key public.af_opaque_reference not null,
  stage_input_fingerprint public.af_sha256 not null,
  status public.af_research_job_status not null,
  attempt_count public.af_safe_nonnegative_integer not null,
  max_attempts smallint not null check (max_attempts between 1 and 10),
  checkpoint_count public.af_safe_nonnegative_integer not null,
  active_attempt_id uuid,
  first_started_at timestamptz,
  terminal_at timestamptz,
  publication_authority text not null check (publication_authority = 'NONE'),
  aggregate_version public.af_safe_nonnegative_integer not null,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  constraint af_research_jobs_run_case_fk foreign key (run_id, case_id)
    references public.af_research_runs(id, case_id) on delete cascade,
  constraint af_research_jobs_dependency_fk foreign key (run_id, depends_on_job_id)
    references public.af_research_jobs(run_id, id)
    deferrable initially deferred,
  constraint af_research_jobs_stage_matches_ordinal_check check (
    stage_ordinal = case stage
      when 'IDENTITY' then 0
      when 'SCOPING' then 1
      when 'DISCOVERY' then 2
      when 'RESOLUTION' then 3
      when 'NORMALIZATION' then 4
      when 'CORROBORATION' then 5
      when 'SEQUENCING' then 6
    end
  ),
  constraint af_research_jobs_attempt_count_check check (attempt_count <= max_attempts),
  constraint af_research_jobs_time_check check (
    updated_at >= created_at
    and (first_started_at is null or first_started_at >= created_at)
    and (
      terminal_at is null
      or (
        first_started_at is not null
        and terminal_at >= first_started_at
        and terminal_at <= updated_at
      )
    )
  ),
  constraint af_research_jobs_state_check check (
    (status = 'RUNNING' and active_attempt_id is not null and first_started_at is not null)
    or (status <> 'RUNNING' and active_attempt_id is null)
  ),
  constraint af_research_jobs_terminal_check check (
    (
      status in ('SUCCEEDED', 'DEGRADED', 'FAILED_TERMINAL', 'CANCELLED')
      and terminal_at is not null
    )
    or (
      status not in ('SUCCEEDED', 'DEGRADED', 'FAILED_TERMINAL', 'CANCELLED')
      and terminal_at is null
    )
  ),
  constraint af_research_jobs_unattempted_check check (
    attempt_count <> 0
    or (first_started_at is null and status = 'QUEUED')
  ),
  unique (run_id, id),
  unique (run_id, logical_job_key),
  unique (run_id, stage_ordinal)
);

create unique index af_research_jobs_one_running_per_run_idx
  on public.af_research_jobs(run_id)
  where status = 'RUNNING';

create table public.af_research_attempts (
  schema_version smallint not null check (schema_version = 1),
  id uuid primary key,
  run_id uuid not null,
  job_id uuid not null,
  attempt_number public.af_safe_positive_integer not null,
  request_fingerprint public.af_sha256 not null,
  status public.af_research_attempt_status not null,

  execution_kind public.af_execution_kind not null,
  execution_trace_id public.af_opaque_reference not null,
  provider_run_id public.af_opaque_reference,
  model_provider public.af_slug,
  model_name text,
  model_snapshot public.af_version_tag,
  prompt_id public.af_slug,
  prompt_version public.af_version_tag,
  prompt_template_fingerprint public.af_sha256,
  execution_schema_id public.af_slug not null,
  execution_schema_version public.af_version_tag not null,
  execution_schema_fingerprint public.af_sha256 not null,
  tool_id public.af_slug,
  tool_version public.af_version_tag,
  usage_input_tokens public.af_safe_nonnegative_integer not null,
  usage_output_tokens public.af_safe_nonnegative_integer not null,
  usage_tool_calls public.af_safe_nonnegative_integer not null,
  usage_input_bytes public.af_safe_nonnegative_integer not null,
  usage_output_bytes public.af_safe_nonnegative_integer not null,
  cost_currency text not null check (cost_currency = 'USD'),
  cost_pricing_state public.af_pricing_state not null,
  cost_amount_micros public.af_safe_nonnegative_integer,
  latency_ms public.af_safe_nonnegative_integer,
  provenance_inputs jsonb not null,
  -- Body-free telemetry records whether authorized private input was sent to
  -- the worker; it never stores that input body here.
  private_content_included boolean not null,

  output_fingerprint public.af_sha256,
  error_code public.af_slug,
  publication_authority text not null check (publication_authority = 'NONE'),
  aggregate_version public.af_safe_nonnegative_integer not null,
  started_at timestamptz not null,
  completed_at timestamptz,
  constraint af_research_attempts_job_fk foreign key (run_id, job_id)
    references public.af_research_jobs(run_id, id) on delete cascade,
  constraint af_research_attempts_model_name_check check (
    model_name is null
    or (model_name = btrim(model_name) and char_length(model_name) between 1 and 200)
  ),
  constraint af_research_attempts_model_prompt_check check (
    (
      execution_kind in ('MODEL', 'MODEL_TOOL')
      and model_provider is not null
      and model_name is not null
      and model_snapshot is not null
      and prompt_id is not null
      and prompt_version is not null
      and prompt_template_fingerprint is not null
    )
    or (
      execution_kind not in ('MODEL', 'MODEL_TOOL')
      and model_provider is null
      and model_name is null
      and model_snapshot is null
      and prompt_id is null
      and prompt_version is null
      and prompt_template_fingerprint is null
    )
  ),
  constraint af_research_attempts_tool_check check (
    (
      execution_kind in ('MODEL_TOOL', 'TOOL', 'RESOLVER', 'IMPORTER')
      and tool_id is not null and tool_version is not null
    )
    or (
      execution_kind not in ('MODEL_TOOL', 'TOOL', 'RESOLVER', 'IMPORTER')
      and tool_id is null and tool_version is null
    )
  ),
  constraint af_research_attempts_cost_check check (
    (cost_pricing_state = 'PRICED' and cost_amount_micros is not null)
    or (cost_pricing_state = 'UNPRICED' and cost_amount_micros is null)
  ),
  constraint af_research_attempts_inputs_check check (
    jsonb_typeof(provenance_inputs) = 'array'
    and jsonb_array_length(provenance_inputs) between 2 and 100
  ),
  constraint af_research_attempts_completion_check check (
    (
      status = 'RUNNING'
      and completed_at is null
      and latency_ms is null
      and output_fingerprint is null
      and error_code is null
    )
    or (
      status <> 'RUNNING'
      and completed_at is not null
      and completed_at >= started_at
      and latency_ms is not null
      and (
        (status in ('SUCCEEDED', 'DEGRADED') and output_fingerprint is not null and error_code is null)
        or (status not in ('SUCCEEDED', 'DEGRADED') and error_code is not null)
      )
    )
  ),
  unique (run_id, id),
  unique (run_id, job_id, id),
  unique (run_id, request_fingerprint),
  unique (job_id, attempt_number)
);

alter table public.af_research_jobs
  add constraint af_research_jobs_active_attempt_fk
  foreign key (run_id, id, active_attempt_id)
  references public.af_research_attempts(run_id, job_id, id)
  deferrable initially deferred;

create table public.af_research_stage_outputs (
  schema_version smallint not null check (schema_version = 1),
  id uuid primary key,
  run_id uuid not null,
  job_id uuid not null,
  attempt_id uuid not null,
  kind public.af_research_output_kind not null,
  stage public.af_research_stage not null,
  review_state public.af_review_state not null check (review_state = 'PROPOSED'),
  publication_authority text not null check (publication_authority = 'NONE'),
  provenance_inputs jsonb not null,
  created_at timestamptz not null,

  resolved_requirement_ids text[],
  unresolved_requirement_ids text[],
  axis_ids text[],
  source_class_ids text[],
  coverage_gap_codes text[],
  candidate_ids uuid[],
  source_ids uuid[],
  locator_ids uuid[],
  unresolved_candidate_ids uuid[],
  proposed_evidence_ids uuid[],
  proposed_claim_ids uuid[],
  assessed_claim_ids uuid[],
  independence_group_ids text[],
  contradiction_ids uuid[],
  unresolved_claim_ids uuid[],
  sequence_proposal_id uuid,
  eligible_claim_ids uuid[],
  omitted_claim_ids uuid[],

  constraint af_research_outputs_attempt_fk foreign key (run_id, job_id, attempt_id)
    references public.af_research_attempts(run_id, job_id, id) on delete cascade,
  constraint af_research_outputs_inputs_check check (
    jsonb_typeof(provenance_inputs) = 'array'
    and jsonb_array_length(provenance_inputs) between 1 and 100
  ),
  constraint af_research_outputs_kind_stage_check check (
    (kind = 'IDENTITY_RESULT' and stage = 'IDENTITY')
    or (kind = 'SCOPE_RESULT' and stage = 'SCOPING')
    or (kind = 'DISCOVERY_RESULT' and stage = 'DISCOVERY')
    or (kind = 'RESOLUTION_RESULT' and stage = 'RESOLUTION')
    or (kind = 'NORMALIZATION_RESULT' and stage = 'NORMALIZATION')
    or (kind = 'CORROBORATION_RESULT' and stage = 'CORROBORATION')
    or (kind = 'SEQUENCING_RESULT' and stage = 'SEQUENCING')
  ),
  constraint af_research_outputs_variant_check check (
    case kind
      when 'IDENTITY_RESULT' then
        public.af_slug_array_valid(resolved_requirement_ids, 0, 50)
        and public.af_slug_array_valid(unresolved_requirement_ids, 0, 50)
        and axis_ids is null and source_class_ids is null and coverage_gap_codes is null
        and candidate_ids is null and source_ids is null and locator_ids is null
        and unresolved_candidate_ids is null and proposed_evidence_ids is null
        and proposed_claim_ids is null and assessed_claim_ids is null
        and independence_group_ids is null and contradiction_ids is null
        and unresolved_claim_ids is null and sequence_proposal_id is null
        and eligible_claim_ids is null and omitted_claim_ids is null
      when 'SCOPE_RESULT' then
        public.af_slug_array_valid(axis_ids, 1, 30)
        and public.af_slug_array_valid(source_class_ids, 1, 30)
        and public.af_slug_array_valid(coverage_gap_codes, 0, 50)
        and resolved_requirement_ids is null and unresolved_requirement_ids is null
        and candidate_ids is null and source_ids is null and locator_ids is null
        and unresolved_candidate_ids is null and proposed_evidence_ids is null
        and proposed_claim_ids is null and assessed_claim_ids is null
        and independence_group_ids is null and contradiction_ids is null
        and unresolved_claim_ids is null and sequence_proposal_id is null
        and eligible_claim_ids is null and omitted_claim_ids is null
      when 'DISCOVERY_RESULT' then
        public.af_uuid_array_valid(candidate_ids, 0, 500)
        and resolved_requirement_ids is null and unresolved_requirement_ids is null
        and axis_ids is null and source_class_ids is null and coverage_gap_codes is null
        and source_ids is null and locator_ids is null and unresolved_candidate_ids is null
        and proposed_evidence_ids is null and proposed_claim_ids is null
        and assessed_claim_ids is null and independence_group_ids is null
        and contradiction_ids is null and unresolved_claim_ids is null
        and sequence_proposal_id is null and eligible_claim_ids is null and omitted_claim_ids is null
      when 'RESOLUTION_RESULT' then
        public.af_uuid_array_valid(source_ids, 0, 500)
        and public.af_uuid_array_valid(locator_ids, 0, 1000)
        and public.af_uuid_array_valid(unresolved_candidate_ids, 0, 500)
        and resolved_requirement_ids is null and unresolved_requirement_ids is null
        and axis_ids is null and source_class_ids is null and coverage_gap_codes is null
        and candidate_ids is null and proposed_evidence_ids is null and proposed_claim_ids is null
        and assessed_claim_ids is null and independence_group_ids is null
        and contradiction_ids is null and unresolved_claim_ids is null
        and sequence_proposal_id is null and eligible_claim_ids is null and omitted_claim_ids is null
      when 'NORMALIZATION_RESULT' then
        public.af_uuid_array_valid(proposed_evidence_ids, 0, 2000)
        and public.af_uuid_array_valid(proposed_claim_ids, 0, 2000)
        and resolved_requirement_ids is null and unresolved_requirement_ids is null
        and axis_ids is null and source_class_ids is null and coverage_gap_codes is null
        and candidate_ids is null and source_ids is null and locator_ids is null
        and unresolved_candidate_ids is null and assessed_claim_ids is null
        and independence_group_ids is null and contradiction_ids is null
        and unresolved_claim_ids is null and sequence_proposal_id is null
        and eligible_claim_ids is null and omitted_claim_ids is null
      when 'CORROBORATION_RESULT' then
        public.af_uuid_array_valid(assessed_claim_ids, 0, 2000)
        and public.af_text_array_valid(independence_group_ids, 1000, 1, 512)
        and public.af_uuid_array_valid(contradiction_ids, 0, 2000)
        and public.af_uuid_array_valid(unresolved_claim_ids, 0, 2000)
        and resolved_requirement_ids is null and unresolved_requirement_ids is null
        and axis_ids is null and source_class_ids is null and coverage_gap_codes is null
        and candidate_ids is null and source_ids is null and locator_ids is null
        and unresolved_candidate_ids is null and proposed_evidence_ids is null
        and proposed_claim_ids is null and sequence_proposal_id is null
        and eligible_claim_ids is null and omitted_claim_ids is null
      when 'SEQUENCING_RESULT' then
        sequence_proposal_id is not null
        and public.af_uuid_array_valid(eligible_claim_ids, 0, 2000)
        and public.af_uuid_array_valid(omitted_claim_ids, 0, 2000)
        and resolved_requirement_ids is null and unresolved_requirement_ids is null
        and axis_ids is null and source_class_ids is null and coverage_gap_codes is null
        and candidate_ids is null and source_ids is null and locator_ids is null
        and unresolved_candidate_ids is null and proposed_evidence_ids is null
        and proposed_claim_ids is null and assessed_claim_ids is null
        and independence_group_ids is null and contradiction_ids is null
        and unresolved_claim_ids is null
    end
  ),
  unique (run_id, id),
  unique (attempt_id, id)
);

create table public.af_source_candidates (
  schema_version smallint not null check (schema_version = 1),
  id uuid primary key,
  run_id uuid not null,
  job_id uuid not null,
  attempt_id uuid not null,
  candidate_key public.af_opaque_reference not null,
  title text not null,
  canonical_url public.af_http_url,
  medium public.af_source_medium not null,
  source_class public.af_slug not null,
  access_state public.af_access_state not null,
  rights_state public.af_rights_state not null,
  discovery_input_fingerprint public.af_sha256 not null,
  content_trust text not null check (content_trust = 'UNTRUSTED'),
  evidence_status text not null check (evidence_status = 'NOT_EVIDENCE'),
  review_state public.af_review_state not null check (review_state = 'PROPOSED'),
  publication_authority text not null check (publication_authority = 'NONE'),
  created_at timestamptz not null,
  constraint af_source_candidates_title_check check (
    title = btrim(title) and char_length(title) between 1 and 1000
  ),
  constraint af_source_candidates_attempt_fk foreign key (run_id, job_id, attempt_id)
    references public.af_research_attempts(run_id, job_id, id) on delete cascade,
  unique (run_id, job_id, attempt_id, id)
);

comment on table public.af_source_candidates is
  'Unverified discovery leads only. Rows are not SourceRecord, EvidenceFragment, or publication-authorized output.';

create table public.af_untrusted_research_content (
  schema_version smallint not null check (schema_version = 1),
  id uuid primary key,
  run_id uuid not null,
  job_id uuid not null,
  attempt_id uuid not null,
  candidate_id uuid not null,
  content_kind public.af_untrusted_content_kind not null,
  content_fingerprint public.af_sha256 not null,
  content_length public.af_safe_nonnegative_integer not null,
  storage_ref public.af_opaque_reference,
  access_state public.af_access_state not null,
  rights_state public.af_rights_state not null,
  trust_boundary text not null check (trust_boundary = 'UNTRUSTED_SOURCE_DATA'),
  instruction_authority text not null check (instruction_authority = 'NONE'),
  screening_state public.af_screening_state not null,
  publication_authority text not null check (publication_authority = 'NONE'),
  created_at timestamptz not null,
  constraint af_untrusted_content_candidate_fk
    foreign key (run_id, job_id, attempt_id, candidate_id)
    references public.af_source_candidates(run_id, job_id, attempt_id, id)
    on delete cascade,
  constraint af_untrusted_content_storage_check check (
    storage_ref is null
    or rights_state in ('PERMITTED', 'USER_OWNED', 'PUBLIC_DOMAIN', 'LICENSED')
  ),
  unique (run_id, id)
);

comment on table public.af_untrusted_research_content is
  'Hostile source data boundary: fingerprints and rights-aware storage references only. Content has no instruction or publication authority.';

create type public.af_research_domain_event_type as enum (
  'research.run_created',
  'research.jobs_staged',
  'research.job_status_changed',
  'research.run_status_changed'
);

create table public.af_research_domain_events (
  id uuid primary key,
  event_type public.af_research_domain_event_type not null,
  schema_version smallint not null check (schema_version = 1),
  aggregate_type text not null check (aggregate_type = 'research_run'),
  aggregate_id uuid not null references public.af_research_runs(id) on delete cascade,
  sequence public.af_safe_positive_integer not null,
  aggregate_version public.af_safe_nonnegative_integer not null,
  occurred_at timestamptz not null,
  publication_authority text not null check (publication_authority = 'NONE'),
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  unique (aggregate_id, sequence)
);

create table public.af_research_outbox_events (
  id uuid primary key,
  domain_event_id uuid not null unique
    references public.af_research_domain_events(id) on delete cascade,
  recorded_at timestamptz not null,
  delivery_attempts public.af_safe_nonnegative_integer not null,
  delivered_at timestamptz,
  constraint af_research_outbox_distinct_ids_check check (id <> domain_event_id),
  constraint af_research_outbox_time_check check (
    delivered_at is null or delivered_at >= recorded_at
  )
);

comment on table public.af_research_domain_events is
  'Reference/classification-only research events with literal publicationAuthority NONE.';
comment on table public.af_research_outbox_events is
  'Delivery state is not authority to publish research prose, claims, evidence, or beats.';

-- ---------------------------------------------------------------------------
-- Strict semantic-event JSON boundaries
-- ---------------------------------------------------------------------------

create function public.af_jsonb_has_exact_keys(value_to_check jsonb, expected_keys text[])
returns boolean
language sql
immutable
set search_path = pg_catalog
as $function$
  select case
    when jsonb_typeof(value_to_check) <> 'object' then false
    else value_to_check ?& expected_keys
      and not exists (
        select 1
        from jsonb_object_keys(value_to_check) as present(key)
        where not (present.key = any(expected_keys))
      )
  end;
$function$;

create function public.af_jsonb_has_allowed_keys(
  value_to_check jsonb,
  allowed_keys text[],
  required_keys text[]
)
returns boolean
language sql
immutable
set search_path = pg_catalog
as $function$
  select case
    when jsonb_typeof(value_to_check) <> 'object' then false
    else value_to_check ?& required_keys
      and not exists (
        select 1
        from jsonb_object_keys(value_to_check) as present(key)
        where not (present.key = any(allowed_keys))
      )
  end;
$function$;

create function public.af_enforce_case_domain_event_payload()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $function$
declare
  event_anchor jsonb;
begin
  if new.event_type = 'direction.submitted' then
    if not public.af_jsonb_has_exact_keys(
      new.payload,
      array['directionId', 'sourceBranchId', 'requestedAction', 'anchor']
    ) then
      raise exception using errcode = '23514', message = 'Invalid direction.submitted payload keys';
    end if;
    perform (new.payload->>'directionId')::uuid;
    perform (new.payload->>'sourceBranchId')::uuid;
    perform (new.payload->>'requestedAction')::public.af_command_requested_action;
    event_anchor := new.payload->'anchor';
    if event_anchor <> 'null'::jsonb then
      if not public.af_jsonb_has_allowed_keys(
        event_anchor,
        array['beatId', 'evidenceId'],
        array[]::text[]
      ) or not (event_anchor ? 'beatId' or event_anchor ? 'evidenceId') then
        raise exception using errcode = '23514', message = 'Invalid direction event anchor';
      end if;
      if event_anchor ? 'beatId' then
        perform (event_anchor->>'beatId')::uuid;
      end if;
      if event_anchor ? 'evidenceId' then
        perform (event_anchor->>'evidenceId')::uuid;
      end if;
    end if;
  elsif new.event_type = 'branch.proposed' then
    if not public.af_jsonb_has_exact_keys(
      new.payload,
      array['branchId', 'parentBranchId', 'originDirectionId']
    ) then
      raise exception using errcode = '23514', message = 'Invalid branch.proposed payload keys';
    end if;
    perform (new.payload->>'branchId')::uuid;
    perform (new.payload->>'parentBranchId')::uuid;
    perform (new.payload->>'originDirectionId')::uuid;
  end if;
  return new;
end;
$function$;

create trigger af_domain_events_payload_trigger
before insert or update of event_type, payload
on public.af_domain_events
for each row execute function public.af_enforce_case_domain_event_payload();

create function public.af_enforce_research_domain_event_payload()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $function$
declare
  item jsonb;
begin
  if new.event_type = 'research.run_created' then
    if not public.af_jsonb_has_exact_keys(
      new.payload,
      array['caseId', 'branchId', 'planId', 'specialistId', 'specialistVersion']
    ) then
      raise exception using errcode = '23514', message = 'Invalid research.run_created payload';
    end if;
    perform (new.payload->>'caseId')::uuid;
    if new.payload->'branchId' <> 'null'::jsonb then
      perform (new.payload->>'branchId')::uuid;
    end if;
    perform (new.payload->>'planId')::uuid;
    perform (new.payload->>'specialistId')::public.af_slug;
    perform (new.payload->>'specialistVersion')::public.af_version_tag;
  elsif new.event_type = 'research.jobs_staged' then
    if not public.af_jsonb_has_exact_keys(new.payload, array['jobs'])
      or jsonb_typeof(new.payload->'jobs') <> 'array'
      or jsonb_array_length(new.payload->'jobs') <> 7 then
      raise exception using errcode = '23514', message = 'Invalid research.jobs_staged payload';
    end if;
    for item in select value from jsonb_array_elements(new.payload->'jobs') loop
      if not public.af_jsonb_has_exact_keys(item, array['jobId', 'stage', 'dependsOnJobId']) then
        raise exception using errcode = '23514', message = 'Invalid staged job payload';
      end if;
      perform (item->>'jobId')::uuid;
      perform (item->>'stage')::public.af_research_stage;
      if item->'dependsOnJobId' <> 'null'::jsonb then
        perform (item->>'dependsOnJobId')::uuid;
      end if;
    end loop;
  elsif new.event_type = 'research.job_status_changed' then
    if not public.af_jsonb_has_exact_keys(
      new.payload,
      array['jobId', 'stage', 'previousStatus', 'status', 'attemptId', 'boundedReasonCode']
    ) then
      raise exception using errcode = '23514', message = 'Invalid research.job_status_changed payload';
    end if;
    perform (new.payload->>'jobId')::uuid;
    perform (new.payload->>'stage')::public.af_research_stage;
    perform (new.payload->>'previousStatus')::public.af_research_job_status;
    perform (new.payload->>'status')::public.af_research_job_status;
    if new.payload->'attemptId' <> 'null'::jsonb then
      perform (new.payload->>'attemptId')::uuid;
    end if;
    if new.payload->'boundedReasonCode' <> 'null'::jsonb then
      perform (new.payload->>'boundedReasonCode')::public.af_slug;
    end if;
  elsif new.event_type = 'research.run_status_changed' then
    if not public.af_jsonb_has_exact_keys(
      new.payload,
      array['previousStatus', 'status', 'currentStage', 'boundedReasonCode']
    ) then
      raise exception using errcode = '23514', message = 'Invalid research.run_status_changed payload';
    end if;
    perform (new.payload->>'previousStatus')::public.af_research_run_status;
    perform (new.payload->>'status')::public.af_research_run_status;
    if new.payload->'currentStage' <> 'null'::jsonb then
      perform (new.payload->>'currentStage')::public.af_research_stage;
    end if;
    if new.payload->'boundedReasonCode' <> 'null'::jsonb then
      perform (new.payload->>'boundedReasonCode')::public.af_slug;
    end if;
  end if;
  return new;
end;
$function$;

create trigger af_research_domain_events_payload_trigger
before insert or update of event_type, payload
on public.af_research_domain_events
for each row execute function public.af_enforce_research_domain_event_payload();

-- ---------------------------------------------------------------------------
-- Expiring direction leases and immutable replay results
-- ---------------------------------------------------------------------------

create table public.af_direction_commit_results (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid not null references auth.users(id) on delete cascade,
  case_id uuid not null,
  request_fingerprint public.af_sha256 not null,
  result_json jsonb not null,
  committed_at timestamptz not null,
  constraint af_direction_results_case_owner_fk foreign key (case_id, actor_id)
    references public.af_cases(id, owner_id) on delete cascade,
  constraint af_direction_results_json_check check (jsonb_typeof(result_json) = 'object'),
  unique (actor_id, request_fingerprint, id)
);

comment on table public.af_direction_commit_results is
  'Private immutable command-result snapshot required for exact idempotent replay after mutable case, branch, or outbox state advances. It is never analytics input and has no direct client policy.';

create table public.af_direction_idempotency (
  actor_id uuid not null references auth.users(id) on delete cascade,
  command_name text not null check (command_name = 'submit_direction'),
  idempotency_key text not null,
  request_fingerprint public.af_sha256 not null,
  state public.af_idempotency_state not null,
  reservation_token uuid,
  lease_expires_at timestamptz,
  result_id uuid unique references public.af_direction_commit_results(id) on delete restrict,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  completed_at timestamptz,
  constraint af_direction_idempotency_key_check check (
    char_length(idempotency_key) between 8 and 200
    and idempotency_key ~ '^[A-Za-z0-9][A-Za-z0-9._:-]*$'
  ),
  constraint af_direction_idempotency_state_check check (
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
  constraint af_direction_idempotency_time_check check (
    updated_at >= created_at
    and (completed_at is null or completed_at >= created_at)
  ),
  primary key (actor_id, command_name, idempotency_key)
);

-- A service-role adapter supplies the actor established by the authenticated
-- API boundary.  If a user-JWT scoped caller is ever granted these RPCs,
-- auth.uid() must match that explicit actor.  Anonymous execution is revoked.
create function public.af_assert_actor_scope(actor_id_to_check uuid)
returns void
language plpgsql
stable
security definer
set search_path = pg_catalog, auth
as $function$
declare
  jwt_actor uuid;
begin
  jwt_actor := auth.uid();
  if jwt_actor is not null and jwt_actor <> actor_id_to_check then
    raise exception using errcode = 'AFD05', message = 'Actor scope mismatch or record not found';
  end if;
end;
$function$;

create function public.af_case_record_json(case_row public.af_cases)
returns jsonb
language sql
stable
set search_path = pg_catalog, public
as $function$
  select jsonb_build_object(
    'id', case_row.id,
    'ownerId', case_row.owner_id,
    'specialistId', case_row.specialist_id,
    'specialistVersion', case_row.specialist_version,
    'subjectRef', jsonb_build_object(
      'type', case_row.subject_type,
      'id', case_row.subject_id,
      'versionId', case_row.subject_version_id
    ),
    'exactCuriosity', case_row.exact_curiosity,
    'status', case_row.status,
    'health', case_row.health,
    'activeBranchId', case_row.active_branch_id,
    'aggregateVersion', case_row.aggregate_version,
    'eventSequence', case_row.event_sequence,
    'createdAt', case_row.created_at,
    'updatedAt', case_row.updated_at
  );
$function$;

create function public.af_branch_record_json(branch_row public.af_branches)
returns jsonb
language sql
stable
set search_path = pg_catalog, public
as $function$
  select jsonb_build_object(
    'id', branch_row.id,
    'caseId', branch_row.case_id,
    'parentBranchId', branch_row.parent_branch_id,
    'originDirectionId', branch_row.origin_direction_id,
    'kind', branch_row.kind,
    'title', branch_row.title,
    'normalizedObjective', branch_row.normalized_objective,
    'status', branch_row.status,
    'researchAxisIds', branch_row.research_axis_ids,
    'unresolvedQuestions', branch_row.unresolved_questions,
    'returnAnchor', case
      when branch_row.return_branch_id is null then 'null'::jsonb
      else jsonb_build_object(
        'branchId', branch_row.return_branch_id,
        'readingSequenceKey', branch_row.return_reading_sequence_key,
        'beatId', branch_row.return_beat_id
      )
    end,
    'aggregateVersion', branch_row.aggregate_version,
    'createdAt', branch_row.created_at,
    'updatedAt', branch_row.updated_at
  );
$function$;

create function public.af_get_case_v1(p_actor_id uuid, p_case_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, auth
as $function$
declare
  record_json jsonb;
begin
  perform public.af_assert_actor_scope(p_actor_id);
  select public.af_case_record_json(case_record)
    into record_json
  from public.af_cases case_record
  where case_record.id = p_case_id and case_record.owner_id = p_actor_id;
  return record_json;
end;
$function$;

create function public.af_get_branch_v1(p_actor_id uuid, p_branch_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, auth
as $function$
declare
  record_json jsonb;
begin
  perform public.af_assert_actor_scope(p_actor_id);
  select public.af_branch_record_json(branch_record)
    into record_json
  from public.af_branches branch_record
  join public.af_cases case_record on case_record.id = branch_record.case_id
  where branch_record.id = p_branch_id and case_record.owner_id = p_actor_id;
  return record_json;
end;
$function$;

create function public.af_reserve_direction_v1(
  p_actor_id uuid,
  p_idempotency_key text,
  p_request_fingerprint text,
  p_lease_seconds integer default 60
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, public, auth
as $function$
declare
  lease_row public.af_direction_idempotency%rowtype;
  replay_json jsonb;
  current_time timestamptz := clock_timestamp();
  new_token uuid := gen_random_uuid();
begin
  perform public.af_assert_actor_scope(p_actor_id);
  perform p_request_fingerprint::public.af_sha256;
  if char_length(p_idempotency_key) not between 8 and 200
    or p_idempotency_key !~ '^[A-Za-z0-9][A-Za-z0-9._:-]*$'
    or p_lease_seconds not between 5 and 900 then
    raise exception using errcode = 'AFD04', message = 'Invalid direction reservation input';
  end if;

  insert into public.af_direction_idempotency (
    actor_id, command_name, idempotency_key, request_fingerprint, state,
    reservation_token, lease_expires_at, created_at, updated_at
  ) values (
    p_actor_id, 'submit_direction', p_idempotency_key,
    p_request_fingerprint::public.af_sha256, 'IN_PROGRESS', new_token,
    current_time + make_interval(secs => p_lease_seconds), current_time, current_time
  )
  on conflict (actor_id, command_name, idempotency_key) do nothing;

  select * into strict lease_row
  from public.af_direction_idempotency
  where actor_id = p_actor_id
    and command_name = 'submit_direction'
    and idempotency_key = p_idempotency_key
  for update;

  if lease_row.request_fingerprint <> p_request_fingerprint then
    raise exception using errcode = 'AFD02', message = 'Idempotency key identifies a different request';
  end if;

  if lease_row.state = 'COMPLETED' then
    select result_json into strict replay_json
    from public.af_direction_commit_results where id = lease_row.result_id;
    return jsonb_build_object(
      'status', 'REPLAY',
      'replay', jsonb_build_object(
        'requestFingerprint', lease_row.request_fingerprint,
        'result', replay_json
      )
    );
  end if;

  -- The insert above already acquired this exact token.  An existing live
  -- lease returns IN_PROGRESS; an expired lease is taken over atomically.
  if lease_row.reservation_token = new_token then
    return jsonb_build_object('status', 'ACQUIRED', 'reservationToken', new_token);
  end if;
  if lease_row.lease_expires_at > current_time then
    return jsonb_build_object('status', 'IN_PROGRESS');
  end if;

  update public.af_direction_idempotency
  set reservation_token = new_token,
      lease_expires_at = current_time + make_interval(secs => p_lease_seconds),
      updated_at = current_time
  where actor_id = p_actor_id
    and command_name = 'submit_direction'
    and idempotency_key = p_idempotency_key;
  return jsonb_build_object('status', 'ACQUIRED', 'reservationToken', new_token);
end;
$function$;

create function public.af_release_direction_reservation_v1(
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
  delete from public.af_direction_idempotency
  where actor_id = p_actor_id
    and command_name = 'submit_direction'
    and idempotency_key = p_idempotency_key
    and request_fingerprint = p_request_fingerprint
    and state = 'IN_PROGRESS'
    and reservation_token = p_reservation_token;
  get diagnostics deleted_count = row_count;
  return deleted_count = 1;
end;
$function$;

create function public.af_direction_result_shape_valid(result_to_check jsonb)
returns boolean
language plpgsql
immutable
set search_path = pg_catalog, public
as $function$
declare
  item jsonb;
  nested_value jsonb;
begin
  if not public.af_jsonb_has_exact_keys(
    result_to_check,
    array['investigationCase', 'direction', 'proposedBranch', 'provenanceEdges', 'outboxEvents']
  ) then return false; end if;

  if not public.af_jsonb_has_exact_keys(
    result_to_check->'investigationCase',
    array['id', 'ownerId', 'specialistId', 'specialistVersion', 'subjectRef',
      'exactCuriosity', 'status', 'health', 'activeBranchId', 'aggregateVersion',
      'eventSequence', 'createdAt', 'updatedAt']
  ) or not public.af_jsonb_has_exact_keys(
    result_to_check#>'{investigationCase,subjectRef}',
    array['type', 'id', 'versionId']
  ) then return false; end if;

  if not public.af_jsonb_has_exact_keys(
    result_to_check->'direction',
    array['id', 'caseId', 'sourceBranchId', 'actorId', 'exactUserText',
      'requestedAction', 'directionType', 'branchAction', 'acknowledgement',
      'anchor', 'origin', 'createdAt']
  ) or not public.af_jsonb_has_exact_keys(
    result_to_check#>'{direction,origin}', array['kind', 'actorId', 'version']
  ) then return false; end if;
  nested_value := result_to_check#>'{direction,anchor}';
  if nested_value <> 'null'::jsonb and not public.af_jsonb_has_exact_keys(
    nested_value,
    array['branchId', 'beatId', 'evidenceId', 'claimId',
      'selectedTextFingerprint', 'readingSequenceKey']
  ) then return false; end if;

  if not public.af_jsonb_has_exact_keys(
    result_to_check->'proposedBranch',
    array['id', 'caseId', 'parentBranchId', 'originDirectionId', 'kind', 'title',
      'normalizedObjective', 'status', 'researchAxisIds', 'unresolvedQuestions',
      'returnAnchor', 'aggregateVersion', 'createdAt', 'updatedAt']
  ) then return false; end if;
  nested_value := result_to_check#>'{proposedBranch,returnAnchor}';
  if nested_value <> 'null'::jsonb and not public.af_jsonb_has_exact_keys(
    nested_value, array['branchId', 'readingSequenceKey', 'beatId']
  ) then return false; end if;

  if jsonb_typeof(result_to_check->'provenanceEdges') <> 'array'
    or jsonb_array_length(result_to_check->'provenanceEdges') <> 2 then
    return false;
  end if;
  for item in select value from jsonb_array_elements(result_to_check->'provenanceEdges') loop
    if not public.af_jsonb_has_exact_keys(
      item,
      array['id', 'caseId', 'output', 'input', 'relationship', 'origin',
        'method', 'runId', 'createdAt']
    ) or not public.af_jsonb_has_exact_keys(item->'output', array['type', 'id'])
      or not public.af_jsonb_has_exact_keys(item->'input', array['type', 'id'])
      or not public.af_jsonb_has_exact_keys(item->'origin', array['kind', 'actorId', 'version'])
      or not public.af_jsonb_has_exact_keys(item->'method', array['name', 'version']) then
      return false;
    end if;
  end loop;

  if jsonb_typeof(result_to_check->'outboxEvents') <> 'array'
    or jsonb_array_length(result_to_check->'outboxEvents') <> 2 then
    return false;
  end if;
  for item in select value from jsonb_array_elements(result_to_check->'outboxEvents') loop
    if not public.af_jsonb_has_exact_keys(
      item, array['id', 'event', 'recordedAt', 'publicationAttempts', 'publishedAt']
    ) or not public.af_jsonb_has_exact_keys(
      item->'event',
      array['id', 'type', 'schemaVersion', 'aggregateType', 'aggregateId',
        'sequence', 'aggregateVersion', 'occurredAt', 'payload']
    ) then return false; end if;
  end loop;
  return true;
end;
$function$;

create function public.af_commit_direction_v1(
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
  lease_row public.af_direction_idempotency%rowtype;
  current_case public.af_cases%rowtype;
  source_branch public.af_branches%rowtype;
  case_json jsonb := p_result->'investigationCase';
  direction_json jsonb := p_result->'direction';
  branch_json jsonb := p_result->'proposedBranch';
  provenance_json jsonb := p_result->'provenanceEdges';
  first_outbox jsonb := p_result#>'{outboxEvents,0}';
  second_outbox jsonb := p_result#>'{outboxEvents,1}';
  first_event jsonb;
  second_event jsonb;
  first_payload jsonb;
  second_payload jsonb;
  direction_anchor jsonb;
  branch_return_anchor jsonb;
  replay_json jsonb;
  committed_result_id uuid;
  target_case_id uuid;
  new_direction_id uuid;
  new_branch_id uuid;
  source_branch_record_id uuid;
  mutation_time timestamptz;
  new_case_version bigint;
  new_event_sequence bigint;
  routed_direction_type public.af_direction_type;
  routed_branch_action public.af_branch_action;
  persisted_requested_action public.af_requested_direction_action;
  proposed_branch_kind public.af_branch_kind;
  affected_rows integer;
  provenance_item jsonb;
begin
  perform public.af_assert_actor_scope(p_actor_id);
  perform p_request_fingerprint::public.af_sha256;

  select * into lease_row
  from public.af_direction_idempotency
  where actor_id = p_actor_id
    and command_name = 'submit_direction'
    and idempotency_key = p_idempotency_key
  for update;
  if not found then
    raise exception using errcode = 'AFD04', message = 'Matching active direction reservation required';
  end if;
  if lease_row.request_fingerprint <> p_request_fingerprint then
    raise exception using errcode = 'AFD02', message = 'Idempotency key identifies a different request';
  end if;
  if lease_row.state = 'COMPLETED' then
    select result_json into strict replay_json
    from public.af_direction_commit_results where id = lease_row.result_id;
    return jsonb_build_object('replayed', true, 'result', replay_json);
  end if;
  if lease_row.reservation_token <> p_reservation_token
    or lease_row.lease_expires_at <= clock_timestamp() then
    raise exception using errcode = 'AFD04', message = 'Direction reservation is stale or does not match';
  end if;
  if not public.af_direction_result_shape_valid(p_result) then
    raise exception using errcode = 'AFD04', message = 'Direction result has an invalid or lossy JSON shape';
  end if;

  target_case_id := (case_json->>'id')::uuid;
  new_direction_id := (direction_json->>'id')::uuid;
  new_branch_id := (branch_json->>'id')::uuid;
  source_branch_record_id := (direction_json->>'sourceBranchId')::uuid;
  mutation_time := (case_json->>'updatedAt')::timestamptz;
  new_case_version := (case_json->>'aggregateVersion')::bigint;
  new_event_sequence := (case_json->>'eventSequence')::bigint;
  routed_direction_type := (direction_json->>'directionType')::public.af_direction_type;
  routed_branch_action := (direction_json->>'branchAction')::public.af_branch_action;
  persisted_requested_action := (direction_json->>'requestedAction')::public.af_requested_direction_action;
  proposed_branch_kind := (branch_json->>'kind')::public.af_branch_kind;
  direction_anchor := direction_json->'anchor';
  branch_return_anchor := branch_json->'returnAnchor';

  select * into current_case from public.af_cases as stored_case
  where stored_case.id = target_case_id and stored_case.owner_id = p_actor_id
  for update;
  if not found then
    raise exception using errcode = 'AFD05', message = 'Actor scope mismatch or record not found';
  end if;
  if current_case.aggregate_version <> p_expected_case_version then
    raise exception using errcode = 'AFD01', message = 'Case aggregate version conflict';
  end if;
  if current_case.status <> 'ACTIVE' then
    raise exception using errcode = 'AFD04', message = 'Directions require an active case';
  end if;

  select * into source_branch from public.af_branches as stored_branch
  where stored_branch.id = source_branch_record_id
    and stored_branch.case_id = current_case.id
  for share;
  if not found or source_branch.status not in ('OPEN', 'PAUSED') then
    raise exception using errcode = 'AFD04', message = 'Source branch is not directional';
  end if;

  if (case_json->>'ownerId')::uuid <> current_case.owner_id
    or case_json->>'specialistId' <> current_case.specialist_id::text
    or case_json->>'specialistVersion' <> current_case.specialist_version::text
    or case_json#>>'{subjectRef,type}' <> current_case.subject_type::text
    or case_json#>>'{subjectRef,id}' <> current_case.subject_id::text
    or (case_json#>>'{subjectRef,versionId}') is distinct from current_case.subject_version_id::text
    or case_json->>'exactCuriosity' <> current_case.exact_curiosity
    or (case_json->>'status')::public.af_case_status <> current_case.status
    or (case_json->>'health')::public.af_case_health <> current_case.health
    or (case_json->>'createdAt')::timestamptz <> current_case.created_at
    or mutation_time < current_case.updated_at
    or new_case_version <> current_case.aggregate_version + 1
    or new_event_sequence <> current_case.event_sequence + 2
    or (case_json->>'activeBranchId')::uuid <> new_branch_id then
    raise exception using errcode = 'AFD04', message = 'Direction attempted an invalid case delta';
  end if;

  if (direction_json->>'caseId')::uuid <> target_case_id
    or (direction_json->>'actorId')::uuid <> p_actor_id
    or (branch_json->>'caseId')::uuid <> target_case_id
    or (branch_json->>'parentBranchId')::uuid <> source_branch_record_id
    or (branch_json->>'originDirectionId')::uuid <> new_direction_id
    or (branch_json->>'status')::public.af_branch_status <> 'PROPOSED'
    or (branch_json->>'aggregateVersion')::bigint <> 0
    or (direction_json->>'createdAt')::timestamptz <> mutation_time
    or (branch_json->>'createdAt')::timestamptz <> mutation_time
    or (branch_json->>'updatedAt')::timestamptz <> mutation_time
    or persisted_requested_action = 'RETURN' then
    raise exception using errcode = 'AFD04', message = 'Direction, child branch, or case references are inconsistent';
  end if;

  if not (
    (routed_branch_action = 'COMPARE' and routed_direction_type = 'COMPARE' and proposed_branch_kind = 'COMPARISON')
    or (
      routed_branch_action = 'DETOUR' and proposed_branch_kind = 'DETOUR'
      and routed_direction_type not in ('RETURN', 'STYLE', 'COMPARE')
    )
    or (
      routed_branch_action = 'CREATE' and (
        (routed_direction_type = 'QUESTION' and proposed_branch_kind = 'QUESTION')
        or (routed_direction_type = 'THEORY' and proposed_branch_kind = 'THEORY')
        or (routed_direction_type = 'LEAD' and proposed_branch_kind = 'LEAD')
        or (routed_direction_type = 'FOCUS' and proposed_branch_kind = 'FOCUS')
        or (routed_direction_type = 'WIDEN' and proposed_branch_kind = 'WIDEN')
        or (routed_direction_type = 'CHALLENGE' and proposed_branch_kind = 'CHALLENGE')
        or (routed_direction_type = 'CONNECT' and proposed_branch_kind = 'CONNECTION')
      )
    )
  ) or not (
    persisted_requested_action = 'AUTO'
    or (persisted_requested_action = 'THEORY' and routed_direction_type = 'THEORY' and proposed_branch_kind = 'THEORY')
    or (persisted_requested_action = 'CHALLENGE' and routed_direction_type = 'CHALLENGE' and proposed_branch_kind = 'CHALLENGE')
    or (persisted_requested_action = 'COMPARE' and routed_direction_type = 'COMPARE' and proposed_branch_kind = 'COMPARISON')
    or (persisted_requested_action = 'CONNECT' and routed_direction_type = 'CONNECT' and proposed_branch_kind = 'CONNECTION')
  ) then
    raise exception using errcode = 'AFD04', message = 'Direction route violates child-branch policy';
  end if;

  if (select count(*) from jsonb_array_elements(provenance_json) edge
      where (edge->>'caseId')::uuid = target_case_id
        and edge#>>'{output,type}' = 'BRANCH'
        and edge#>>'{output,id}' = new_branch_id::text
        and edge#>>'{input,type}' = 'DIRECTION'
        and edge#>>'{input,id}' = new_direction_id::text
        and edge->>'relationship' = 'TRIGGERED_BY') <> 1
    or (select count(*) from jsonb_array_elements(provenance_json) edge
      where (edge->>'caseId')::uuid = target_case_id
        and edge#>>'{output,type}' = 'DIRECTION'
        and edge#>>'{output,id}' = new_direction_id::text
        and edge#>>'{input,type}' = 'BRANCH'
        and edge#>>'{input,id}' = source_branch_record_id::text
        and edge->>'relationship' = 'SCOPED_TO') <> 1 then
    raise exception using errcode = 'AFD04', message = 'Direction commit requires exactly two canonical provenance edges';
  end if;

  first_event := first_outbox->'event';
  second_event := second_outbox->'event';
  first_payload := first_event->'payload';
  second_payload := second_event->'payload';
  if first_event->>'type' <> 'direction.submitted'
    or second_event->>'type' <> 'branch.proposed'
    or (first_event->>'schemaVersion')::smallint <> 1
    or (second_event->>'schemaVersion')::smallint <> 1
    or first_event->>'aggregateType' <> 'case'
    or second_event->>'aggregateType' <> 'case'
    or (first_event->>'aggregateId')::uuid <> target_case_id
    or (second_event->>'aggregateId')::uuid <> target_case_id
    or (first_event->>'sequence')::bigint <> current_case.event_sequence + 1
    or (second_event->>'sequence')::bigint <> current_case.event_sequence + 2
    or (first_event->>'aggregateVersion')::bigint <> new_case_version
    or (second_event->>'aggregateVersion')::bigint <> new_case_version
    or (first_event->>'occurredAt')::timestamptz <> mutation_time
    or (second_event->>'occurredAt')::timestamptz <> mutation_time
    or (first_outbox->>'recordedAt')::timestamptz <> mutation_time
    or (second_outbox->>'recordedAt')::timestamptz <> mutation_time
    or (first_outbox->>'publicationAttempts')::bigint <> 0
    or (second_outbox->>'publicationAttempts')::bigint <> 0
    or first_outbox->'publishedAt' <> 'null'::jsonb
    or second_outbox->'publishedAt' <> 'null'::jsonb
    or (first_payload->>'directionId')::uuid <> new_direction_id
    or (first_payload->>'sourceBranchId')::uuid <> source_branch_record_id
    or first_payload->>'requestedAction' <> lower(persisted_requested_action::text)
    or (second_payload->>'branchId')::uuid <> new_branch_id
    or (second_payload->>'parentBranchId')::uuid <> source_branch_record_id
    or (second_payload->>'originDirectionId')::uuid <> new_direction_id then
    raise exception using errcode = 'AFD04', message = 'Direction semantic events are inconsistent or contain mutable delivery state';
  end if;

  if (direction_anchor = 'null'::jsonb) <> (first_payload->'anchor' = 'null'::jsonb)
    or (
      direction_anchor <> 'null'::jsonb
      and (
        (direction_anchor->>'beatId')::uuid is distinct from (first_payload#>>'{anchor,beatId}')::uuid
        or (direction_anchor->>'evidenceId')::uuid is distinct from (first_payload#>>'{anchor,evidenceId}')::uuid
      )
    ) then
    raise exception using errcode = 'AFD04', message = 'Direction event anchor does not match the immutable direction';
  end if;

  if (first_outbox->>'id')::uuid in ((first_event->>'id')::uuid, (second_outbox->>'id')::uuid, (second_event->>'id')::uuid)
    or (first_event->>'id')::uuid in ((second_outbox->>'id')::uuid, (second_event->>'id')::uuid)
    or (second_outbox->>'id')::uuid = (second_event->>'id')::uuid then
    raise exception using errcode = 'AFD03', message = 'Generated domain-event and outbox identifiers must be distinct';
  end if;

  insert into public.af_directions (
    id, case_id, source_branch_id, actor_id, exact_user_text, requested_action,
    direction_type, branch_action, acknowledgement, anchor_branch_id,
    anchor_beat_id, anchor_evidence_id, anchor_claim_id,
    anchor_selected_text_fingerprint, anchor_reading_sequence_key,
    origin_kind, origin_actor_id, origin_version, created_at
  ) values (
    new_direction_id, target_case_id, source_branch_record_id, p_actor_id,
    direction_json->>'exactUserText', persisted_requested_action, routed_direction_type,
    routed_branch_action, direction_json->>'acknowledgement',
    case when direction_anchor = 'null'::jsonb then null else (direction_anchor->>'branchId')::uuid end,
    case when direction_anchor = 'null'::jsonb or direction_anchor->'beatId' = 'null'::jsonb then null else (direction_anchor->>'beatId')::uuid end,
    case when direction_anchor = 'null'::jsonb or direction_anchor->'evidenceId' = 'null'::jsonb then null else (direction_anchor->>'evidenceId')::uuid end,
    case when direction_anchor = 'null'::jsonb or direction_anchor->'claimId' = 'null'::jsonb then null else (direction_anchor->>'claimId')::uuid end,
    case when direction_anchor = 'null'::jsonb then null else direction_anchor->>'selectedTextFingerprint' end,
    case when direction_anchor = 'null'::jsonb then null else direction_anchor->>'readingSequenceKey' end,
    (direction_json#>>'{origin,kind}')::public.af_origin_kind,
    direction_json#>>'{origin,actorId}', direction_json#>>'{origin,version}', mutation_time
  );

  insert into public.af_branches (
    id, case_id, parent_branch_id, origin_direction_id, kind, title,
    normalized_objective, status, research_axis_ids, unresolved_questions,
    return_branch_id, return_reading_sequence_key, return_beat_id,
    aggregate_version, created_at, updated_at
  ) values (
    new_branch_id, target_case_id, source_branch_record_id, new_direction_id, proposed_branch_kind,
    branch_json->>'title', branch_json->>'normalizedObjective', 'PROPOSED',
    array(select jsonb_array_elements_text(branch_json->'researchAxisIds')),
    array(select jsonb_array_elements_text(branch_json->'unresolvedQuestions')),
    case when branch_return_anchor = 'null'::jsonb then null else (branch_return_anchor->>'branchId')::uuid end,
    case when branch_return_anchor = 'null'::jsonb then null else branch_return_anchor->>'readingSequenceKey' end,
    case when branch_return_anchor = 'null'::jsonb or branch_return_anchor->'beatId' = 'null'::jsonb then null else (branch_return_anchor->>'beatId')::uuid end,
    0, mutation_time, mutation_time
  );

  for provenance_item in select value from jsonb_array_elements(provenance_json) loop
    insert into public.af_provenance_edges (
      id, case_id, output_type, output_id, input_type, input_id, relationship,
      origin_kind, origin_actor_id, origin_version, method_name, method_version,
      run_id, created_at
    ) values (
      (provenance_item->>'id')::uuid, target_case_id,
      (provenance_item#>>'{output,type}')::public.af_provenance_record_type,
      provenance_item#>>'{output,id}',
      (provenance_item#>>'{input,type}')::public.af_provenance_record_type,
      provenance_item#>>'{input,id}',
      (provenance_item->>'relationship')::public.af_provenance_relationship,
      (provenance_item#>>'{origin,kind}')::public.af_origin_kind,
      provenance_item#>>'{origin,actorId}', provenance_item#>>'{origin,version}',
      (provenance_item#>>'{method,name}')::public.af_slug,
      provenance_item#>>'{method,version}',
      case when provenance_item->'runId' = 'null'::jsonb then null else (provenance_item->>'runId')::uuid end,
      (provenance_item->>'createdAt')::timestamptz
    );
  end loop;

  insert into public.af_domain_events (
    id, event_type, schema_version, aggregate_type, aggregate_id, sequence,
    aggregate_version, occurred_at, payload
  ) values
  (
    (first_event->>'id')::uuid, 'direction.submitted', 1, 'case', target_case_id,
    (first_event->>'sequence')::bigint, new_case_version, mutation_time, first_payload
  ),
  (
    (second_event->>'id')::uuid, 'branch.proposed', 1, 'case', target_case_id,
    (second_event->>'sequence')::bigint, new_case_version, mutation_time, second_payload
  );

  insert into public.af_outbox_events (
    id, domain_event_id, recorded_at, publication_attempts, published_at
  ) values
  ((first_outbox->>'id')::uuid, (first_event->>'id')::uuid, mutation_time, 0, null),
  ((second_outbox->>'id')::uuid, (second_event->>'id')::uuid, mutation_time, 0, null);

  update public.af_cases as stored_case
  set active_branch_id = new_branch_id,
      aggregate_version = new_case_version,
      event_sequence = new_event_sequence,
      updated_at = mutation_time
  where stored_case.id = target_case_id
    and stored_case.owner_id = p_actor_id
    and stored_case.aggregate_version = p_expected_case_version
    and stored_case.status = 'ACTIVE';
  get diagnostics affected_rows = row_count;
  if affected_rows <> 1 then
    raise exception using errcode = 'AFD01', message = 'Case aggregate version conflict';
  end if;

  insert into public.af_direction_commit_results (
    actor_id, case_id, request_fingerprint, result_json, committed_at
  ) values (
    p_actor_id, target_case_id, p_request_fingerprint::public.af_sha256, p_result, mutation_time
  ) returning id into committed_result_id;

  update public.af_direction_idempotency
  set state = 'COMPLETED', reservation_token = null, lease_expires_at = null,
      result_id = committed_result_id, updated_at = mutation_time, completed_at = mutation_time
  where actor_id = p_actor_id
    and command_name = 'submit_direction'
    and idempotency_key = p_idempotency_key;

  return jsonb_build_object('replayed', false, 'result', p_result);
exception
  when unique_violation then
    raise exception using errcode = 'AFD03', message = 'A generated persistence identifier already exists';
  when foreign_key_violation or check_violation or not_null_violation
    or invalid_text_representation or numeric_value_out_of_range then
    raise exception using errcode = 'AFD04', message = 'Direction mutation failed schema or reference invariants';
end;
$function$;

-- ---------------------------------------------------------------------------
-- Default-deny production boundary
-- ---------------------------------------------------------------------------

-- Every production table is server-only in checkpoint 02. There are no
-- browser policies to accidentally widen: the authenticated HTTP boundary
-- verifies the JWT, then a service-role adapter calls only the actor-scoped
-- functions above. Later read policies must be added table-by-table with
-- explicit owner and rights tests.
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
      table_record.schemaname,
      table_record.tablename
    );
    execute format(
      'alter table %I.%I force row level security',
      table_record.schemaname,
      table_record.tablename
    );
    execute format(
      'revoke all on table %I.%I from public, anon, authenticated',
      table_record.schemaname,
      table_record.tablename
    );
    execute format(
      'grant all on table %I.%I to service_role',
      table_record.schemaname,
      table_record.tablename
    );
  end loop;

  -- PostgreSQL grants function execution to PUBLIC by default. Remove that
  -- implicit capability from every AfterFrame function, including SECURITY
  -- DEFINER RPCs and helpers, before granting the isolated server role.
  for function_record in
    select
      namespace.nspname as schema_name,
      procedure.proname as function_name,
      pg_catalog.pg_get_function_identity_arguments(procedure.oid) as arguments
    from pg_catalog.pg_proc procedure
    join pg_catalog.pg_namespace namespace
      on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'public' and procedure.proname like 'af\_%' escape '\'
  loop
    execute format(
      'revoke all on function %I.%I(%s) from public, anon, authenticated',
      function_record.schema_name,
      function_record.function_name,
      function_record.arguments
    );
    execute format(
      'grant execute on function %I.%I(%s) to service_role',
      function_record.schema_name,
      function_record.function_name,
      function_record.arguments
    );
  end loop;
end;
$security$;

comment on function public.af_get_case_v1(uuid, uuid) is
  'Server-only actor-scoped production case read. Returns SQL null for absent or unauthorized records.';
comment on function public.af_get_branch_v1(uuid, uuid) is
  'Server-only actor-scoped production branch read. Returns SQL null for absent or unauthorized records.';
comment on function public.af_reserve_direction_v1(uuid, text, text, integer) is
  'Server-only expiring idempotency reservation acquired before planner work.';
comment on function public.af_release_direction_reservation_v1(uuid, text, text, uuid) is
  'Server-only token-matched release for failed direction work.';
comment on function public.af_commit_direction_v1(uuid, text, text, uuid, bigint, jsonb) is
  'Server-only atomic direction, branch, provenance, event, outbox, case-version, and replay commit.';
