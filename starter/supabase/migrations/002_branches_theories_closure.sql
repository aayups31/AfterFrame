-- AFTERFRAME V2: movie-version identity, direction-driven branches, theory assessment,
-- closure artifacts, and future autonomous mission seams.

-- Exact movie-version and film-text identity.
create table if not exists film_versions (
  id uuid primary key default gen_random_uuid(),
  film_id uuid not null references films(id) on delete cascade,
  label text not null,
  cut_type text,
  territory text,
  language text,
  runtime_ms bigint,
  release_medium text,
  release_date date,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique(film_id, label, territory, release_medium)
);

create table if not exists film_scenes (
  id uuid primary key default gen_random_uuid(),
  film_version_id uuid not null references film_versions(id) on delete cascade,
  sequence_key text not null,
  title text,
  start_ms bigint,
  end_ms bigint,
  verification_state text not null default 'approximate',
  source_basis jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique(film_version_id, sequence_key)
);

create table if not exists film_text_observations (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references cases(id) on delete cascade,
  scene_id uuid references film_scenes(id) on delete set null,
  observation_type text not null,
  description text not null,
  origin text not null,
  source_asset_id uuid,
  verification_state text not null default 'provisional',
  created_by_run_id uuid,
  created_at timestamptz not null default now()
);

create table if not exists investigation_branches (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references cases(id) on delete cascade,
  parent_branch_id uuid references investigation_branches(id) on delete set null,
  title text not null,
  normalized_objective text not null,
  branch_type text not null,
  status text not null default 'proposed',
  support_state text,
  fork_beat_id uuid references exploration_beats(id) on delete set null,
  research_axes jsonb not null default '[]'::jsonb,
  unresolved_questions jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists direction_events (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references cases(id) on delete cascade,
  branch_id uuid references investigation_branches(id) on delete set null,
  user_id uuid,
  user_text text not null,
  direction_type text not null,
  branch_action text not null,
  acknowledgement text,
  anchor jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table investigation_branches
  add column if not exists origin_direction_id uuid references direction_events(id) on delete set null;

create table if not exists theory_assessments (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references investigation_branches(id) on delete cascade,
  user_theory_text text not null,
  normalized_proposition text not null,
  support_state text not null,
  support_summary text,
  pressure_summary text,
  contradiction_summary text,
  alternative_explanations jsonb not null default '[]'::jsonb,
  unknowns jsonb not null default '[]'::jsonb,
  supporting_claim_ids jsonb not null default '[]'::jsonb,
  contradicting_claim_ids jsonb not null default '[]'::jsonb,
  model_id text,
  prompt_version text,
  created_at timestamptz not null default now()
);

create table if not exists closure_sessions (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references cases(id) on delete cascade,
  mode text not null,
  status text not null default 'audit',
  options jsonb not null default '{}'::jsonb,
  audit jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create table if not exists closure_artifacts (
  id uuid primary key default gen_random_uuid(),
  closure_session_id uuid not null references closure_sessions(id) on delete cascade,
  artifact_type text not null,
  title text,
  version integer not null default 1,
  created_at timestamptz not null default now()
);

create table if not exists artifact_blocks (
  id uuid primary key default gen_random_uuid(),
  artifact_id uuid not null references closure_artifacts(id) on delete cascade,
  sequence_key text not null,
  block_type text not null,
  body jsonb not null,
  user_locked boolean not null default false,
  model_id text,
  prompt_version text,
  created_at timestamptz not null default now(),
  unique(artifact_id, sequence_key)
);

create table if not exists artifact_block_inputs (
  id uuid primary key default gen_random_uuid(),
  artifact_block_id uuid not null references artifact_blocks(id) on delete cascade,
  input_type text not null,
  input_id uuid not null,
  contribution text,
  created_at timestamptz not null default now()
);

create table if not exists research_missions (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references cases(id) on delete cascade,
  objective text not null,
  status text not null default 'draft',
  "authorization" jsonb not null default '{}'::jsonb,
  budget jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz
);

create index if not exists investigation_branches_case_idx on investigation_branches(case_id);
create index if not exists direction_events_case_idx on direction_events(case_id, created_at desc);
create index if not exists theory_assessments_branch_idx on theory_assessments(branch_id, created_at desc);
create index if not exists closure_sessions_case_idx on closure_sessions(case_id, created_at desc);

create index if not exists film_versions_film_idx on film_versions(film_id);
create index if not exists film_scenes_version_idx on film_scenes(film_version_id, sequence_key);
create index if not exists film_text_observations_case_idx on film_text_observations(case_id);
