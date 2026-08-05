-- Starter schema: deliberately small. Expand using docs/08-data-model.md.
create extension if not exists pgcrypto;
create extension if not exists vector;

create table if not exists films (
  id uuid primary key default gen_random_uuid(),
  external_id text,
  title text not null,
  release_year integer,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists cases (
  id uuid primary key default gen_random_uuid(),
  user_id uuid,
  film_id uuid references films(id),
  title text not null,
  curiosity text not null,
  intent text,
  status text not null default 'draft',
  style_override jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists sources (
  id uuid primary key default gen_random_uuid(),
  canonical_url text,
  title text not null,
  author_or_speaker text,
  source_type text not null,
  published_at timestamptz,
  access_state text not null default 'unknown',
  rights_state text not null default 'unknown',
  independence_group text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists source_locators (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references sources(id) on delete cascade,
  kind text not null,
  locator jsonb not null,
  status text not null default 'approximate',
  resolver_version text not null,
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists evidence_fragments (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references cases(id) on delete cascade,
  source_id uuid not null references sources(id),
  locator_id uuid not null references source_locators(id),
  finding text not null,
  short_quote text,
  why_surfaced text not null,
  limitations jsonb not null default '[]'::jsonb,
  confidence_state text not null,
  embedding vector(1536),
  created_at timestamptz not null default now()
);

create table if not exists exploration_beats (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references cases(id) on delete cascade,
  sequence_key text not null,
  beat_type text not null,
  body text not null,
  evidence_ids jsonb not null default '[]'::jsonb,
  visual_directive jsonb not null default '{}'::jsonb,
  status text not null default 'ready',
  created_at timestamptz not null default now(),
  unique(case_id, sequence_key)
);

create table if not exists notes (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references cases(id) on delete cascade,
  user_id uuid,
  kind text not null,
  body text not null,
  anchors jsonb not null default '[]'::jsonb,
  position jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
