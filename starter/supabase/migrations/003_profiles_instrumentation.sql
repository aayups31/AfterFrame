-- V3: investigation calibration, user-controlled cross-case memory,
-- model/tool run provenance, and privacy-safe product events.

create table if not exists investigator_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  specialist_id text not null default 'movie-investigator',
  approved_preferences jsonb not null default '{}'::jsonb,
  cross_case_memory_enabled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, specialist_id)
);

create table if not exists case_calibrations (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references cases(id) on delete cascade,
  mode text not null,
  calibration jsonb not null,
  source text not null default 'user',
  approved_for_profile boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists investigation_runs (
  id uuid primary key default gen_random_uuid(),
  case_id uuid references cases(id) on delete cascade,
  branch_id uuid references investigation_branches(id) on delete cascade,
  trace_id text not null,
  stage text not null,
  status text not null default 'queued',
  model_id text,
  prompt_version text,
  schema_version text,
  reasoning_effort text,
  tool_metadata jsonb not null default '{}'::jsonb,
  usage_metadata jsonb not null default '{}'::jsonb,
  error_code text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists provenance_edges (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references cases(id) on delete cascade,
  output_type text not null,
  output_id uuid not null,
  input_type text not null,
  input_id uuid not null,
  relationship text not null,
  run_id uuid references investigation_runs(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists product_events (
  id uuid primary key default gen_random_uuid(),
  anonymous_user_id text not null,
  session_id text not null,
  event_name text not null,
  case_id uuid references cases(id) on delete set null,
  branch_id uuid references investigation_branches(id) on delete set null,
  properties jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null,
  created_at timestamptz not null default now()
);

comment on table product_events is
  'Privacy-safe product state transitions only. Do not store note bodies, selected text, source excerpts, curiosities, theories, or private project names.';

create index if not exists case_calibrations_case_idx on case_calibrations(case_id, created_at desc);
create index if not exists investigation_runs_trace_idx on investigation_runs(trace_id);
create index if not exists investigation_runs_case_idx on investigation_runs(case_id, created_at desc);
create index if not exists provenance_output_idx on provenance_edges(output_type, output_id);
create index if not exists provenance_input_idx on provenance_edges(input_type, input_id);
create index if not exists product_events_name_time_idx on product_events(event_name, occurred_at desc);
