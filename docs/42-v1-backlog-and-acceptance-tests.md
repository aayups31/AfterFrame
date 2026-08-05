# 42 — V1 Backlog and Acceptance Tests

## Epic 0 — Product lock

- [ ] Read and sign off `WHY.md` and `AGENTS.md`.
- [ ] Create ADR for any change to the investigation metaphor.
- [ ] Define the exact Black Hawk Down version used by the fixture.
- [ ] Freeze V1 non-goals.

Acceptance: a new coding agent can explain the core/specialist boundary and V1 loop without describing the product as chat or generic search.

## Epic 1 — Premium portal and case opening

- [ ] film portal with responsive media fallback;
- [ ] film selection transition;
- [ ] curiosity intake;
- [ ] proposed case intent and correction;
- [ ] optional investigation-mode selection;
- [ ] keyboard and reduced-motion behavior.

Acceptance: a first-time user opens the case without feature explanation and sees the first mocked beat within one second of shell load.

## Epic 2 — Exploration stream

- [ ] typed beat renderer;
- [ ] stable insertion keys;
- [ ] source whispers;
- [ ] pauses and interruptions;
- [ ] long-case anchor stability;
- [ ] degraded research state;
- [ ] mobile reading surface.

Acceptance: 12 mocked beats can stream in out of order at the transport layer but render in a stable intended sequence without moving the active paragraph.

## Epic 3 — Evidence and original source

- [ ] source inspector;
- [ ] exact locator display;
- [ ] open-original action;
- [ ] version/edition and limitations;
- [ ] failed locator state;
- [ ] correction action;
- [ ] one manually verified example per source class.

Acceptance: every factual fixture beat has at least one evidence ID, and each rendered verified locator opens to the expected location.

## Epic 4 — Direction and branching

- [ ] direction input;
- [ ] type classification;
- [ ] branch creation;
- [ ] main-stream transition;
- [ ] branch origin and return;
- [ ] theory pressure lane;
- [ ] repeated direction idempotency.

Acceptance: “I think the mission failed before contact” creates a visibly separate branch, preserves the exact user text, and returns to the original position.

## Epic 5 — Notes and connections

- [ ] highlight action rail;
- [ ] inline note;
- [ ] question/claim/counterpoint types;
- [ ] anchor persistence;
- [ ] agent connection proposal;
- [ ] accept/dismiss;
- [ ] case-world projection.

Acceptance: a user creates a note without modal navigation, reloads the case, and finds it attached to the correct passage.

## Epic 6 — Movie specialist live slice

- [ ] specialist intent interpretation;
- [ ] movie-axis plan;
- [ ] candidate discovery;
- [ ] source security gate;
- [ ] canonical identity;
- [ ] resolver and locator verifier;
- [ ] evidence normalization;
- [ ] beat sequencing;
- [ ] trace and cost records.

Acceptance: a live run never renders a factual beat before provenance and locator state are persisted.

## Epic 7 — Creator path

- [ ] documentary mode;
- [ ] thesis decomposition;
- [ ] counterevidence search;
- [ ] visual-potential metadata;
- [ ] research dossier closure;
- [ ] provenance export.

Acceptance: a creator can use a real upcoming video topic and export a dossier without the system generating the final script during investigation.

## Epic 8 — Alpha readiness

- [ ] unit/integration/E2E suite;
- [ ] prompt-injection fixtures;
- [ ] accessibility pass;
- [ ] performance budgets;
- [ ] privacy-safe metrics;
- [ ] deletion test;
- [ ] launch checklist;
- [ ] six observed sessions.

Acceptance: all release gates in `docs/35-testing-and-quality-strategy.md` and `docs/38-launch-and-pilot-checklist.md` pass.
