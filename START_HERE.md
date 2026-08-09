# START HERE — Build Order

This is the operational entry point for a human builder or coding agent.

## 1. Lock the product truth

Read, in order:

1. `AGENTS.md`
2. `WHY.md`
3. `docs/00-north-star.md`
4. `docs/23-final-build-plan.md`
5. `docs/26-engine-and-specialist-boundary.md`

The canonical plan defines V1 scope, architecture, gates, and sequencing. Focused documents add detail. If an older roadmap or feature document conflicts with the canonical plan, follow the canonical plan.

Do not implement until you can explain all four statements:

- AFTERFRAME is an agent-created exploration, not an answer engine or chat product.
- The agent removes research logistics; the user retains interpretation and authorship.
- V1 is the Movie Investigator; the domain-neutral engine is an internal boundary.
- The investigation is the product object, not any particular screen or generated artifact.

## 2. Treat the existing artifacts correctly

`prototype/`, the current starter components, diagrams, storyboards, and premium visual specifications are vision experiments. They may suggest atmosphere or interaction hypotheses, but they do not prescribe the production interface.

The existing starter UI is a mocked vertical slice, not a production research engine. The parallel production domain/application slice is tracked in `docs/44-build-checkpoint-01.md`; its boundaries, not the mock UI types or routes, are the implementation starting point.

To run it:

```bash
cd starter
nvm use
npm ci
cp .env.example .env.local
npm run dev
```

Do not connect live research to the present raw route and call it the engine. Build the verified evidence spine first.

## 3. Build in this sequence

### Phase 0 — Product and architecture lock

- freeze V1 and its non-goals;
- record prototype posture in an ADR;
- unify movie-axis, locator, branch, and event vocabularies;
- lock the renderability and core/specialist boundaries;
- resolve the exact Black Hawk Down case boundary and version;
- complete separate problem interviews with enthusiasts and documentary/video-essay creators and verify that at least one cohort repeatedly experiences the target problem.

### Phase 1 — Behavioral proof and golden truth

Run two tracks in parallel:

- test the minimal curiosity → evidence → direction → branch → note → return loop with neutral presentation;
- curate the Black Hawk Down golden evaluation pack, claim graph, locators, canonical trail, theory/adaptation branches, and 25-question regression suite.

Do not spend this phase matching the prototype or building playlists, graph editors, or generated artifacts.

### Phase 2 — Deterministic production spine

- strict domain schemas;
- optional reviewed packs with nullable pins from private live-research case overlays;
- sources, snapshots, locators, evidence, claims, and normalized edges;
- cases, versioned intents, immutable directions, branches, notes, and anchors;
- runs, jobs, outbox, idempotency, cancellation, corrections, authorization, and deletion;
- fixture-driven semantic streaming and reopen behavior;
- success, slow, empty, degraded, malformed, cancellation, and failure fixtures.

### Phase 3 — Live specialist in shadow mode

- intent and Movie Investigator axis planning;
- candidate discovery, rights/security screening, and canonicalization;
- resolver validation;
- evidence extraction and claim verification;
- contradiction and source-independence handling;
- movie-aware theory assessment and sequencing;
- full provenance, cost, latency, and evaluation against Black Hawk Down plus a broad multi-film development/holdout suite and a strong generic baseline;
- a minimum durable worker with leases, checkpoints, retries, cancellation, recovery, and outbox consumption;
- live-fetch network protections, parser limits/isolation, source-worker isolation, rate limits, and adapter kill switches.

No factual beat may render before its claim, evidence, locator state, limitations, and provenance are persisted.

### Phase 4 — Open-title invited alpha

- 12–20 invited users;
- user-selected movies and real curiosities researched live from scratch;
- live directions and researched branches;
- anchored notes, truthful degraded states, close-as-world, and reopening;
- behavioral, trust, cost, and latency measurement.

### Phase 5 — Open-title retention V1

Accept any identifiable movie. Expand the multi-film benchmark and unseen holdouts rather than adding a curated supported-title list. Measure voluntary second investigations with the exact denominator and clock in the canonical plan. Support only user-invoked, opt-in comparison against approved prior-case objects; keep every suggested relationship provisional.

### Phase 6 — One paid creator pilot

Only after five named creators have suitable active projects and at least two accept a constrained paid pilot in principle, build documentary/video-essay research with permitted source import and provenance-rich dossier export. Do not build multiple creator modes together.

The complete deliverables and exit gates are in `docs/23-final-build-plan.md`.

## 4. First production work

The next concrete work is:

1. freeze canonical source, locator, rights, origin-group, evidence, branch, and event vocabularies;
2. resolve the exact Black Hawk Down version and case boundary;
3. create the 20–40 source inventory using those canonical fields;
4. build the explicit claim/evidence graph;
5. freeze canonical beats, branches, failure fixtures, and expected events;
6. replace the starter’s collapsed domain types with the same vocabulary;
7. implement the deterministic path before live discovery.

The first UX test should observe whether users:

- understand the curiosity and proposed objective;
- recognize evidence, source account, interpretation, and their own thought as different;
- open an original voluntarily;
- submit a direction without treating the product like chat;
- understand that the main investigation changed;
- create a note at the moment of thought;
- return to the prior trail;
- ask to investigate another film.

Use `templates/usability-session.md` and `docs/30-user-research-and-validation.md`.

## 5. Quality gates

For the starter application:

```bash
cd starter
npm run typecheck
npm run lint
npm run test
npm run build
```

For the complete kit:

```bash
cd ..
python3 scripts/validate-kit.py
```

Passing these commands is necessary but not sufficient. Production expansion is gated by provenance, locator, domain-eval, observed-behavior, privacy, cost, and latency requirements in the canonical plan.

## 6. Do not build yet

- a generic research product or second specialist;
- browser companion or extension;
- autonomous/background missions;
- a large manually curated catalog or catalog-first product experience;
- collaboration, team administration, social feeds, or public theory graphs;
- playlist integrations;
- freeform spatial graph editor;
- automatic cross-case conclusions;
- full visual-script creation studio;
- multiple creator modes;
- automated video generation or publishing;
- native mobile app;
- unauthorized full-film, transcript, or book ingestion;
- complex billing or enterprise controls.

These ideas may remain documented. They are not on the production critical path.
