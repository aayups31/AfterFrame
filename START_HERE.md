# START HERE — Build Order

This file is the operational entry point for a coding agent or human builder.

## 1. Lock the product truth

Read, in order:

1. `WHY.md`
2. `docs/00-north-star.md`
3. `docs/26-engine-and-specialist-boundary.md`
4. `AGENTS.md`
5. `docs/23-final-build-plan.md`

Do not implement anything until the distinction between the domain-neutral investigation engine and the Movie Investigator specialist is clear.

## 2. Run the existing vertical slice

```bash
cd starter
npm install
cp .env.example .env.local
npm run dev
```

Use mock mode first. Do not connect live research until the Black Hawk Down experience has a coherent rhythm.

## 3. Build V1 in this sequence

### Slice A — Experience proof

- film portal;
- curiosity intake;
- case-intent correction;
- 8–12 mocked beats;
- source whisper and exact-locator inspector;
- direction console that alters the main trail;
- note creation;
- close-case world.

### Slice B — Curated truth proof

- one verified film version;
- 20–40 curated sources;
- resolved locators;
- explicit claims and contradictions;
- one complete theory branch;
- provenance audit.

### Slice C — Live specialist proof

- intent router;
- Movie Investigator axis selection;
- source discovery;
- resolver validation;
- evidence normalization;
- paced beat generation;
- evaluation against saved fixtures.

### Slice D — Creator workflow proof

- documentary research mode;
- adaptation/biopic mode;
- source-first mode;
- exportable research dossier with provenance;
- no automatic final script unless the user explicitly closes the case and requests one.

## 4. Run quality gates before expanding scope

```bash
npm run typecheck
npm run lint
npm run test
npm run build
```

Then run the kit validator:

```bash
cd ..
python3 scripts/validate-kit.py
```

## 5. Do not build yet

- browser extension;
- generic topic research;
- autonomous overnight work;
- public community graph;
- social feeds;
- giant movie catalog;
- full copyrighted-film ingestion;
- automated video generation;
- complex billing.

Their architecture is documented so V1 does not block them. They are not V1 deliverables.

## 6. First real-user test

Put one user in front of the Black Hawk Down case without explaining the interface. Observe:

- whether they understand the curiosity prompt;
- whether they scroll without prompting;
- where they pause;
- whether evidence hints feel useful or decorative;
- whether they submit a direction;
- whether they create a note;
- whether they open an original;
- whether they ask to investigate another film.

Use `templates/usability-session.md` and `docs/30-user-research-and-validation.md`.
