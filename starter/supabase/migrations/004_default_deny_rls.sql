-- Security boundary for the prototype-era schema.
--
-- No browser/client data access is authorized yet. Enable and force RLS on
-- every existing table without adding permissive policies. Server-side code
-- using a narrowly held service role can still operate while authenticated and
-- anonymous PostgREST access remains default-deny. Owner-scoped policies are a
-- later migration, added with the production Postgres adapter and auth model.

do $migration$
declare
  table_name text;
begin
  foreach table_name in array array[
    'films',
    'cases',
    'sources',
    'source_locators',
    'evidence_fragments',
    'exploration_beats',
    'notes',
    'film_versions',
    'film_scenes',
    'film_text_observations',
    'investigation_branches',
    'direction_events',
    'theory_assessments',
    'closure_sessions',
    'closure_artifacts',
    'artifact_blocks',
    'artifact_block_inputs',
    'research_missions',
    'investigator_profiles',
    'case_calibrations',
    'investigation_runs',
    'provenance_edges',
    'product_events'
  ]
  loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('alter table public.%I force row level security', table_name);
  end loop;
end
$migration$;

comment on table public.cases is
  'RLS is default-deny until production owner policies and the authenticated Postgres adapter ship.';
comment on table public.direction_events is
  'Contains private user direction text. Client access remains default-deny.';
comment on table public.notes is
  'Contains private user-authored text. Client access remains default-deny.';
