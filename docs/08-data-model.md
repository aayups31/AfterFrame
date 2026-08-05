# 08 — Data Model

## Core entities

### User and profile

- `users`
- `agent_profiles`
- `style_preferences`

### Film and case

- `films`
- `film_versions`
- `film_scenes`
- `film_text_observations`
- `cases`
- `case_intents`
- `case_members`
- `case_state_snapshots`

### Research

- `research_runs`
- `research_queries`
- `sources`
- `source_locators`
- `evidence_fragments`
- `claims`
- `claim_evidence_edges`
- `entities`
- `events`

### Experience

- `exploration_beats`
- `beat_evidence_edges`
- `leads`
- `direction_events`
- `investigation_branches`
- `theory_assessments`
- `trail_events`

### User-created world

- `notes`
- `note_anchors`
- `graph_nodes`
- `graph_edges`
- `connection_suggestions`
- `case_portals`
- `closure_sessions`
- `closure_artifacts`
- `artifact_blocks`
- `artifact_block_inputs`

### Future autonomy

- `research_missions`
- `mission_checkpoints`
- `return_digests`

### Music

- `playlists`
- `playlist_tracks`
- `case_playlist_state`

## Important fields

### `cases`

```text
id
user_id
film_id
title
status
current_intent_id
active_lead_id
style_override_json
spoiler_policy
created_at
updated_at
```

### `claims`

```text
id
case_id
statement
claim_type
verification_state
confidence_language
valid_from
valid_to
created_by_run_id
```

### `sources`

```text
id
canonical_url
title
author_or_speaker
publisher
source_type
published_at
access_state
rights_state
independence_group
metadata_json
```

### `exploration_beats`

```text
id
case_id
sequence_key
beat_type
body
visual_directive_json
status
created_by_run_id
supersedes_beat_id
```

### `notes`

```text
id
user_id
case_id
kind
body
position_json
visibility
created_at
updated_at
```

### `graph_edges`

```text
id
case_id
from_node_id
to_node_id
relation_type
origin: user | agent_suggested | system_fact
status: accepted | proposed | dismissed
explanation
confidence_state
```

## Sequence keys

Do not use integer indices for streamed beats. Use sortable fractional or lexicographic sequence keys so the agent can insert a targeted branch between existing beats without renumbering the case.

## Versioning

Never destructively overwrite:

- case intent;
- verified claim wording;
- exploration beats already annotated by the user;
- source locators.

Create new versions and retain provenance.

## Embeddings

Useful indexes:

- note text;
- claim statements;
- evidence findings;
- entities;
- compact case summaries.

Do not use embedding similarity as proof of a connection. It only nominates candidates for the Connection Miner.

### `investigation_branches`

```text
id
case_id
parent_branch_id
origin_direction_id
title
normalized_objective
branch_type
status
support_state
fork_beat_id
research_axes_json
unresolved_questions_json
created_at
updated_at
```

### `direction_events`

```text
id
case_id
branch_id
user_text
direction_type
branch_action
acknowledgement
anchor_json
created_at
```

### `closure_artifacts` and `artifact_blocks`

Every artifact block links through `artifact_block_inputs` to notes, branches, claims, evidence, and locators. User edits and AI generations are versioned separately.

### `film_versions`

```text
id
film_id
label
cut_type
territory
language
runtime_ms
release_medium
release_date
metadata_json
```

Every scene-dependent claim must identify the version when known.

### `film_scenes` and `film_text_observations`

`film_scenes` stores stable, version-specific scene and time ranges. `film_text_observations` stores bounded observations from user-provided frames, permitted clips, screenplay alignment, or other lawful inputs. It records the basis and verification state so the agent never implies access it did not have.
## V3 additions

The starter migration `003_profiles_instrumentation.sql` adds:

- investigator profiles with approved preferences only;
- per-case calibration;
- investigation runs with trace/model/prompt/schema/tool metadata;
- generic provenance edges;
- privacy-safe product events.

Core tables must not encode movie-specific fields. Film versions, scenes, screenplay drafts, and film-text observations remain specialist-owned records linked to core case/evidence IDs.

