# 23 — AFTERFRAME Canonical Product and Build Plan

> **Status:** canonical execution plan for Movie Investigator V1
>
> **Updated:** 2026-08-08
>
> **Product thesis:** the agent creates the exploration; the user creates the understanding.

This plan operationalizes `AGENTS.md`, `WHY.md`, and `docs/00-north-star.md`. When older roadmap, prototype, starter-code, or feature documents conflict with it, use this order of authority:

1. `AGENTS.md` and `WHY.md` — company and product laws;
2. this plan — V1 scope, sequencing, gates, and architecture decisions;
3. focused domain documents — supporting detail;
4. prototypes and starter components — disposable experiments.

## Prototype rule

The HTML prototype, current starter UI, diagrams, storyboards, and premium-design documents are **vision artifacts, not product specifications**. They communicate possible atmosphere, pacing, restraint, and ambition. They do not lock the production layout, navigation, component system, motion language, home page, graph, soundtrack, creation studio, or visual identity.

Production experience decisions must be derived from the investigation behavior in this plan and tested with users. Reuse prototype code or visuals only when they serve that behavior cleanly.

What survives from the prototypes is the intent:

- the experience should feel paced rather than dumped;
- evidence should remain close to the claim;
- a user direction should alter the main investigation;
- notes should feel part of thinking, not administration;
- the product should feel calm, focused, and premium rather than like a dashboard or chat app.

Everything else remains open.

---

## 1. Executive decision

AFTERFRAME is a persistent, source-grounded environment for investigating the worlds behind movies.

It begins when a film leaves someone with an unresolved curiosity. The Movie Investigator performs the mechanical labor of deep research—planning, finding, locating, checking, comparing, and sequencing material—then reveals a navigable trail. The user performs the valuable intellectual work: reading, interpreting, questioning, steering, noting, connecting, revising, and deciding what matters.

The unit of value is therefore **an investigation**, not:

- an answer;
- a chat session;
- an AI report;
- a citation list;
- a screen or visual effect;
- a generated script.

The durable result is a case with a question, evidence, claims, contradictions, branches, notes, unresolved leads, reading position, and versioned closure. It becomes more personal and more useful as the user thinks inside it.

The company may eventually provide a domain-neutral investigation engine. V1 does not expose a generic research product. V1 is the world’s best **Movie Investigator**, implemented through a clean specialist boundary so the core can generalize later without weakening the first product now.

The first release must prove one proposition:

> When a film creates real curiosity, AFTERFRAME can build a trustworthy exploration that becomes more valuable when the user reads, inspects, and changes direction.

## 2. Why AFTERFRAME should exist

### The broken choice today

Search preserves exploration but makes the user do all of the logistics: query design, tab management, source triage, transcript scrubbing, PDF navigation, citation checking, contradiction tracking, and note organization.

Generic AI removes those logistics by usually removing the exploration too. It compresses the world into a plausible answer before the user has had the chance to form or test an understanding.

AFTERFRAME takes the missing third position:

```text
Remove research friction
without removing discovery, doubt, interpretation, or authorship.
```

### Why movies are the right first portal

Movies create an unusually strong starting condition:

- the user arrives with emotion and a concrete unresolved question;
- one film can open history, politics, science, mythology, biography, production, adaptation, craft, and interpretation;
- film questions naturally require multiple evidence classes and careful separation of depiction, history, intention, and audience reading;
- movie research has specialist problems—cuts, editions, scenes, drafts, collaboration, adaptation, reception—that a generic research agent handles poorly;
- the founder’s taste and obsession can create a specialist advantage before the engine expands.

The movie is the portal into a world. It is not merely a catalog entry or topic label.

### The emotional outcome

The user should leave thinking:

- “I found that connection.”
- “I understand why this matters now.”
- “I can see the world behind the film.”
- “I want to investigate another one.”

If the dominant feeling is “the AI gave me a comprehensive answer,” the product has failed even if that answer is accurate.

## 3. Initial users and market sequence

Do not merge early cohorts into one fictional average user.

| Cohort | Trigger | Job to be done | Success signal |
|---|---|---|---|
| Movie rabbit-hole enthusiast | A film leaves a question that keeps pulling | Enter a deep, trustworthy world without becoming a research operator | Voluntarily starts another film investigation |
| Documentary or video-essay creator | A real upcoming argument or production needs evidence | Build and pressure-test a sourced understanding before writing | Uses it again on the next real project |
| Adaptation, biopic, or film student researcher | A film project requires context, source material, or comparison | Understand a film-linked world with provenance | Imports real work and returns repeatedly |

The sequence is deliberate:

1. **Enthusiasts validate product identity, comprehension, delight, and the exploration loop.**
2. **Documentary/video-essay creators validate recurring workflow value and willingness to pay.**
3. **Adaptation and biopic workflows come only after the shared Movie Investigator is stable.**

The experience proof and creator pilot use the same case, evidence, branch, note, and provenance model. They are not separate products. V1 will not build multiple polished modes at once.

## 4. What makes AFTERFRAME special

No single feature is the differentiation. The advantage is the coupled system below.

| Product property | Mechanism | Proof required |
|---|---|---|
| Agent-created exploration | The system researches and sequences a trail rather than returning one synthesis | Users form thoughts and directions before reaching a conclusion |
| Direction, not chat | Input creates, redirects, deepens, challenges, compares, or returns a branch in the main case | Users understand that typing changes the investigation |
| Inspectable trust | Source, locator, evidence, claim, and narrative beat remain separate, connected records | Every factual beat can traverse to the best verified route into the original |
| Epistemic honesty | Contradictions, missing coverage, dependent sources, access limits, and version differences remain visible | Reviewers can distinguish fact, account, interpretation, and unknown |
| Protected user authorship | Exact user theory and note text is versioned and never silently overwritten; normalized records and agent suggestions remain separate | The product never silently converts an agent inference into a user conclusion |
| Movie-specialist depth | Film versions, scene evidence, screenplays, production, adaptation, history, reception, and influence use distinct policies | The specialist beats a strong generic research baseline on movie-domain evals |
| Pacing as reasoning | Findings arrive in prerequisite order with pauses, turns, and branch opportunities | Removing sequence would materially reduce comprehension or inference |
| Durable personal case | Reading position, branches, notes, evidence, corrections, and closure versions persist | A returning user can continue without a generic recap dump |
| Traceable closure | Creation is explicit, reversible, and derived only from selected case material | Every generated block carries an input manifest and authorship state, including explicit empty input categories |

The moat is not access to a model. It can compound through:

- movie-specific evaluation data;
- verified film, version, source, and locator identity;
- source-origin and independence mapping;
- specialist research playbooks;
- reliable sequencing of evidence into useful next questions;
- creator workflow fit;
- user-controlled case memory;
- trust earned by corrections and inspectable provenance.

## 5. Product laws

These are implementation and product invariants.

1. Never collapse the entire topic into one answer.
2. Every major factual claim must point to inspectable evidence.
3. Promise the **best verified route to the original**, not universal exact deep-linking that cannot be delivered.
4. A search result is a candidate, never evidence.
5. A model-proposed citation or locator is unverified until a resolver confirms it.
6. Several sources repeating one origin count as one independence group.
7. Preserve contradictions, weak coverage, access limits, and unresolved questions.
8. Identify the film cut or version before making timecode-dependent claims.
9. A creator statement is evidence of that person’s account, not objective truth or the voice of the entire production.
10. A community theory may nominate a lead but cannot establish intention, influence, or fact.
11. The agent may propose a connection; the user decides whether it becomes part of their world.
12. Exact user-authored theory and note text is never silently rewritten.
13. A direction changes the investigation; it does not create a visible chat transcript as the product history.
14. A factual beat is not publishable until its claim, evidence, locator state, limitations, and provenance are persisted.
15. Research and creation remain separate. AI creation starts only after explicit closure.
16. Source content and future extension context are hostile inputs, never instructions.
17. V1 remains movie-specific even though the core has domain-neutral seams.
18. Repeated voluntary use is validation. Visual praise is not.

## 6. The product mental model

### The case is the product object

A case is not a folder around generated prose. It is a living investigation state:

```text
film + version + exact user curiosity
  → versioned objective and scope
  → root research plan
  → verified claim/evidence graph
  → paced trail of semantic beats
  → user directions and branches
  → anchored notes and accepted connections
  → unresolved questions and corrections
  → reading state and versioned closure
```

Different presentations—reading trail, evidence view, timeline, compact case summary, or later spatial world—are projections of the same case. They are not separate products or sources of truth.

### Optional reviewed packs and private case overlays

The live Movie Investigator must be able to begin with any identifiable movie and no prebuilt research. Reviewed packs are optional accelerators and regression assets, not the engine’s knowledge boundary.

```text
OPTIONAL MOVIE RESEARCH PACK (shared, versioned, reviewed)
film/version identity + lawful source metadata + reviewed locators
+ evidence + claims + dependencies + canonical trail inputs
                              ↓ optional pinned version
USER CASE OVERLAY (private, user-owned)
curiosity + intent + branches + case-local live findings + notes
+ reading state + accepted connections + corrections + closure
```

A case may pin a reviewed pack version when one exists, or begin from an empty live-research state. Pack absence must never reject a movie. A correction to shared truth creates a new pack version and an impact notice for affected cases; it never silently rewrites a user’s annotated trail. Live findings remain private and case-local unless a deliberate rights, privacy, and human-review process promotes eligible public material into a later shared pack. Deleting a case deletes the private overlay and its derived data, not lawful shared source identity or reviewed public pack material.

### Two coupled loops

```text
                         MOVIE INVESTIGATOR
                   film ontology + source policy
                               ↓
RESEARCH LOOP                                             THINKING LOOP
plan → discover → resolve → extract → verify              read → inspect
  → claims → contradictions → sequence → reveal    ↔      note → question
                                                          direct → compare
                                                          revise → return
                               ↓
                    DURABLE INVESTIGATION STATE
```

The research loop removes logistics. The thinking loop preserves agency. The durable case is where they meet.

### Important units

- A **source candidate** is something worth evaluating.
- A **research pack version** is optional reviewed Movie Investigator material for one film/version; a private case may pin it but never requires it.
- A **source** is a canonical work or record with identity and origin.
- A **source snapshot** is the permitted, fingerprinted content observed at a point in time.
- A **locator** is a versioned route to the relevant place in that source.
- An **evidence fragment** is a bounded finding with limitations.
- A **claim** is an explicit proposition supported, contradicted, or contextualized by evidence.
- A **beat** is a semantic delivery unit that advances the investigation; it is not a generic content block.
- A **direction event** preserves exactly what the user submitted.
- A **branch** is a versioned investigatory objective with its own research state, not a chat thread.
- A **note** is user-authored thought with a resilient anchor.
- A **closure** is a user-chosen, versioned milestone, not a declaration of final truth.

## 7. How an investigation works end to end

### 1. Seed

The user selects or identifies a film and states what stayed with them, what confuses them, or what they need to investigate. The product stores that text exactly and privately.

### 2. Intent formation

The Movie Investigator resolves film identity, checks whether a cut/version matters, and proposes a compact objective, included scope, excluded scope, opening question, and likely research axes. The user can correct it.

The system must not silently broaden a precise curiosity into a general film overview.

### 3. Research planning

The specialist selects only the relevant movie axes:

- film text;
- script and development;
- authorship and collaboration;
- versions and cuts;
- adaptation and source material;
- history, politics, science, mythology, or other real-world context;
- reception and interpretation;
- influence and intertext.

It also defines source classes, adversarial questions, budgets, and coverage gaps.

### 4. Honest opening

The case opens immediately with orientation, the unresolved question, or cached verified material. It does not invent factual findings to satisfy a latency target.

A movie with reviewed cached material may begin from pre-verified evidence. Any other movie begins through live discovery and may show an honest research state until the first verified batch is ready.

### 5. Deep trail

The system discovers candidates, resolves identities, screens rights and hostile content, obtains permitted snapshots, verifies locators, extracts evidence, normalizes claims, groups dependent sources, and detects contradictions.

Only then does the narrative layer sequence small batches of beats. The user should receive enough context to think, not an exhaustive report.

### 6. Inspection and thought

At a material claim the user can see why the evidence is relevant, its source role, its limitations, its locator state, and the best route into the original. The user can create a note without leaving the thought behind.

### 7. Direction and branching

A question, theory, challenge, comparison, or lead is stored as an immutable direction event. The router decides whether to create a branch, redirect one, deepen it, make a short detour, compare, or return.

The branch launches targeted research through the same trust pipeline. Theory branches deliberately search for support, pressure, contradictions, alternatives, and unknowns. A short acknowledgement may appear, but the researched result belongs in the main case.

### 8. Continuity

The user can pause, leave, reopen, and return to the precise reading and branch state. The product preserves what changed, what remains unresolved, and which new evidence affects an earlier claim.

### 9. Closure

The user explicitly requests closure. The system first audits open branches, material contradictions, unused notes, weak locators, and unresolved claims. The user can preserve a versioned case or, after the relevant gate, create a sourced dossier or artifact from selected case material.

Closure is reversible. Reopening never destroys an earlier closure version.

## 8. Division of labor and approval boundary

| The system may do autonomously | The user retains | Explicit approval is required before |
|---|---|---|
| Expand queries and plan research | Choose the curiosity and what matters | Asserting that a belief belongs to the user |
| Discover, rank, and deduplicate candidates | Read and interpret findings | Accepting an agent-suggested connection |
| Resolve sources and verify locators | Inspect originals and challenge evidence | Changing lasting preferences or cross-case memory |
| Extract evidence and normalize claims | Write notes and theories in their own words | Merging branches into a user conclusion |
| Find contradictions and missing coverage | Change direction, pace, depth, and source strictness | Closing a contested question on the user’s behalf |
| Sequence and revise future beats | Decide when a branch or case is mature | Generating a closure artifact |
| Suggest connections and pressure-test theories | Accept, reject, or revise those suggestions | Sharing, publishing, or using private case material elsewhere |

## 9. V1 scope ladder

The repository previously used “MVP” and “V1” for several different scopes. Use the following names.

### A. One-case product and trust proof

Black Hawk Down proves the irreducible loop:

- exact film/version identity;
- a correctable intent for “Why did everything go wrong?”;
- 20–40 audited sources across independent source classes;
- 8–12 paced, evidence-backed canonical beats;
- one real contradiction;
- one spatial or causal explanation;
- one explicit film-versus-history or adaptation comparison;
- best-available verified locators with honest degraded states;
- one user-authored theory branch with adversarial pressure-testing;
- one anchored note;
- one proposed connection that can be accepted or dismissed;
- branch return, pause, reopen, and correction;
- a minimal summary of the path, evidence, notes, and unresolved leads;
- close as a versioned case, with an evidence appendix or dossier only if provenance is complete.

This proves product comprehension and trust. It cannot prove retention by itself.

### B. Open-title Retention V1

After the one-case proof passes, Movie Investigator accepts any identifiable movie rather than exposing a hand-curated supported catalog. For every new title it must:

- resolve film identity and version requirements;
- interpret the user’s actual curiosity;
- select relevant movie-research axes and source classes;
- discover, resolve, and verify live evidence from scratch;
- sequence only what passes the same trust policy used by the golden case;
- state honestly when lawful sources, exact versions, translations, or locators limit the investigation.

Pre-reviewed packs may improve speed and coverage for a film, but their absence cannot block case creation or weaken factual standards. Retention is measured on movies users choose themselves.

Generalization is tested with a broad benchmark spanning historical adaptation, ambiguous interpretation, production craft, science, mythology, true-story comparison, versions/cuts, older films, international/non-English cinema, independent films, and source-scarce titles. Some films and questions remain unseen holdouts until after prompts and policies are frozen.

Once a user has more than one case, Retention V1 also supports one narrow cross-case behavior: a user-invoked, opt-in comparison against saved or explicitly approved objects from a prior case. Any relationship the agent finds remains a proposal with a reason and can be accepted or dismissed. This does not require a spatial graph, background connection mining, or automatic conclusions.

### C. Paid creator pilot

Only after retention or the concrete creator entry gate in Phase 6, add one polished creator path: documentary/video-essay research.

It may include:

- private film-linked projects;
- permitted source import;
- thesis decomposition;
- adversarial and counterevidence search;
- visually useful source metadata separated from evidentiary strength;
- research dossier and evidence appendix export;
- read-only provenance sharing;
- explicit closure before any generated outline structure.

Do not build adaptation, biopic, team, or studio workflows simultaneously.

### D. Explicitly deferred

- prototype matching or a large cinematic home build;
- soundtrack and playlist integrations;
- freeform spatial graph editing;
- background cross-case mining or automatic cross-case conclusions;
- full visual-script creation studio;
- multiple creator modes;
- a manually curated giant catalog or catalog-first product experience—the live engine still accepts any identifiable movie;
- generic topic research or another specialist;
- browser companion or extension;
- autonomous/background missions;
- collaboration, team administration, or public theory graphs;
- social feeds or community marketplace;
- automated video generation or publishing;
- native mobile application;
- unauthorized full-film, transcript, or book ingestion;
- complex billing, enterprise controls, or SSO;
- user-facing completion scores.

Deferred ideas may retain architecture seams. They do not receive production tables, routes, screens, or polish until their gate is reached.

## 10. Current repository assessment

The repository is a strong product and architecture kit, not a working investigation engine.

### Worth preserving

- the product laws in `AGENTS.md`, `WHY.md`, and the north-star documents;
- the core/specialist separation;
- strict TypeScript, Zod, and typed-contract intent;
- the Black Hawk Down golden-case direction;
- source, locator, evidence, claim, branch, and provenance concepts;
- the deterministic mock-mode principle;
- early security, telemetry, calibration, and test seams;
- UI experiments that can be reused selectively after behavior is proven.

### Not production truth

- `prototype/afterframe-concept.html` and the present component composition;
- the current collapsed `Evidence` UI type;
- mock source links and locators;
- keyword direction routing and fabricated branch IDs;
- hard-coded closure results;
- the single live model call that returns unstructured text;
- migrations that omit claims, normalized edges, jobs, attempts, outbox, idempotency, corrections, RLS, and deletion workflows;
- inconsistent movie-axis and event names across docs, code, and eval fixtures;
- the five-line JSONL smoke set as a complete evaluation suite;
- dependency versions set to `latest` without a reproducible lock file.

Production work begins by consolidating domain contracts and the golden case, not by refining the prototype UI.

## 11. Production architecture

### Architectural stance

Start as one deployable TypeScript application with enforceable internal modules. Add a durable worker process when live research exceeds request lifetimes. Do not build a monorepo, generic agent framework, or specialist plugin platform before Movie Investigator V1 needs one.

```text
Experience adapters / read models
              ↓
Application commands, queries, streaming, authorization
              ↓
Domain-neutral investigation core
      ├── Movie Specialist port ─────→ Movie Investigator
      ├── Discovery/resolver ports ──→ Source infrastructure
      ├── Structured model port ─────→ Model provider
      ├── Queue port ────────────────→ Durable workers
      └── Repositories + outbox ─────→ Postgres / permitted storage
```

Recommended module direction inside `starter/src`:

```text
app/                         HTTP and stream composition only
application/                 commands, queries, handlers, projections
core/                        cases, branches, research, evidence, claims,
                             narrative, notes, closure, provenance, ports
specialists/movie/           film identity, ontology, playbooks, policies,
                             sequencing hints, movie-specific evals
infrastructure/              database, jobs, model provider, discovery,
                             resolvers, storage, security, telemetry
contracts/                   commands, domain events, stream events, schemas
fixtures/black-hawk-down/    versioned deterministic golden-case truth
```

### Dependency laws

- Core never imports the Movie Investigator implementation.
- Movie Investigator imports only port declarations from `core/ports` or shared contracts, never infrastructure implementations or UI. The composition root injects discovery, resolver, model, queue, and storage implementations.
- UI consumes projections and typed semantic events, not database rows or raw model output.
- Infrastructure implements transport and storage; it does not decide movie meaning.
- A model proposes typed records. It never writes directly to persistence or grants a record “verified” status.
- Every external/model result crosses schema, rights, security, and domain-invariant gates.
- Web, PDF, video, podcast, book, and user-asset resolvers are transport infrastructure; movie-specific source priority and interpretation belong to the specialist.
- V1 explicitly selects Movie Investigator. No automatic specialist discovery is needed.

Use relational transactional state plus append-only domain/outbox events. Do not adopt full event sourcing for V1.

### Core versus Movie Investigator ownership

The domain-neutral core owns:

- cases, versioned intents, branches, and directions;
- research plans, runs, jobs, budgets, cancellation, and recovery;
- source candidate lifecycle and canonical source identity;
- snapshots, access decisions, locators, and verification;
- evidence, claims, contradictions, and independence groups;
- semantic beats, notes, anchors, and proposed connections;
- closure versions, provenance, corrections, and deletion;
- streaming, observability, cost, and idempotency.

Movie Investigator owns:

- film and version identity;
- movie research axes and playbooks;
- film-text, screenplay, production, adaptation, reception, and influence semantics;
- source-class priority for a movie question;
- cut/version-aware evidence policy;
- creator-account versus objective-record distinctions;
- theory evaluation for movie interpretation;
- movie-specific sequencing hints, fixtures, and evals.

Core cases should store `specialist_id` and an opaque specialist subject reference. They should not require a `film_id` field. The Movie Investigator resolves that subject reference to its film records.

### Training, retrieval, and personalization boundary

V1 does not train a model on Black Hawk Down, a small movie subset, or the founder’s taste. It uses a general reasoning model, live retrieval, typed investigation policies, movie-domain ontology, resolvers, and verification services.

- Golden cases are regression fixtures and evaluation truth. They measure behavior; they are not the runtime knowledge base.
- Movie playbooks teach **how to research** versions, adaptation, production, history, symbolism, reception, and influence. They do not contain canned answers for a small catalog.
- Every live case can plan and retrieve from scratch for any identifiable movie, subject to lawful source availability.
- Private curiosities, notes, theories, branches, uploads, and case histories are not used for provider training or internal model tuning without explicit, informed opt-in.
- Personalization changes pace, depth, source preference, and intervention behavior. It must not reshape factual standards or make one user’s taste the Movie Investigator’s worldview.
- Any future fine-tuning requires a broad, rights-cleared, multi-era, multi-language, multi-genre dataset and a strict separation between training, development, and unseen holdout films. It cannot replace retrieval or locator verification.

## 12. Research and evidence pipeline

Do not implement “research” as one prompt. Implement a staged, observable pipeline.

```text
intent interpretation
→ movie-axis plan
→ source discovery
→ canonical identity and origin tracing
→ rights/access decision
→ secure fetch or link-only resolution
→ hostile-content screening
→ permitted snapshot + fingerprint
→ evidence extraction
→ locator resolution and deterministic verification
→ semantic claim-support verification
→ claim graph, contradiction, and independence update
→ movie-specialist assessment and sequence hints
→ narrative sequencing
→ transactional persistence + provenance + outbox event
→ semantic beat stream
```

### Elite movie-source strategy

The engine does not run one generic web search and summarize the first results. For each curiosity, Movie Investigator creates a source plan using the evidence classes that can actually answer it:

- the identified film version and lawful user-provided scene observations;
- screenplays, drafts, production documents, commentaries, and archival material;
- books, biographies, scholarly work, and edition-aware source material;
- official records and primary documents for historical, legal, political, scientific, or technical claims;
- long-form creator, cast, crew, expert, and participant interviews;
- public video and podcast material with verified speaker identity, context, transcript basis, and timestamps;
- contemporaneous journalism and reputable film-industry trade reporting;
- high-quality criticism and specialist analysis;
- community theories only as lead generators or evidence of reception, never as proof of intention or fact.

Credibility is contextual, not a permanent score attached to a website. Evaluate each source for:

- directness and proximity to the event, scene, decision, or production;
- demonstrated expertise and role;
- contemporaneous versus retrospective context;
- editorial and correction standards;
- independence from the claim’s original source;
- incentives, bias, memory limitations, translation, and access constraints;
- version, edition, speaker, and date identity;
- locator precision and whether the user can inspect the original.

A YouTube video is not weak merely because it is on YouTube, and it is not credible merely because it looks professional. An original long-form crew interview, archive upload, lecture, or expert analysis can be strong evidence; a derivative video repeating an unattributed claim is not independent support. Apply the same reasoning to books and articles: identify the author, edition, original reporting, citations, publication context, and whether later sources merely repeat it.

For a major claim, seek at least two independent lines of support when available. For a major interpretation or theory, attempt evidence from three relevant classes—film text, production/creator material, and independent contextual or critical work—while preserving counterevidence. When only one credible source exists, attribute the claim to that source rather than presenting it as settled fact.

Source breadth is question-driven. Do not mechanically add a book, video, and article when one of them cannot answer the question. Do not omit a source class because it is harder to resolve. Record missing coverage explicitly.

### Renderability policy

A search candidate never renders as evidence. A factual or interpretive assertion may become a published beat only when all required records exist:

1. an explicit claim;
2. at least one policy-accepted evidence edge with the correct polarity;
3. canonical source identity and origin/dependency state;
4. lawful `VERIFIED_EXACT` or `VERIFIED_APPROXIMATE` support for a major factual claim;
5. access and rights state;
6. finding limitations and calibrated claim language;
7. a film version for scene- or timecode-dependent claims;
8. actor, method, resolver/import/model/tool version, and run provenance as applicable;
9. a validated beat-to-claim and beat-to-evidence relationship.

An opening question, transition, or reflection may render without evidence only when it contains no disguised factual assertion.

`SOURCE_ONLY` material may nominate a lead, provide explicitly labeled context, or supplement other inspectable evidence. It cannot independently satisfy a major factual claim. `UNAVAILABLE` material cannot independently satisfy the evidence promise. Material allegations, safety-sensitive claims, or conclusions central to a branch require independent support when available; otherwise they must be framed as one attributed account or remain unresolved.

### Verification and publication authority

- Models can propose locators, evidence, claim relationships, and wording only in `PROPOSED` state.
- A resolver or recorded human review grants locator verification after identity, edition/version, fingerprint, range, rights, and open-target checks.
- A policy service accepts evidence only after schema, security, rights, locator, and semantic-support checks; designated high-risk classes require human review.
- The claim policy aggregates accepted edges, dependency groups, contradictions, and limitations into an assessment.
- A deterministic renderability service decides whether a beat may become `READY`. A model cannot mark its own evidence accepted or its own claim publishable.

### Locator promise and states

Use clear states instead of pretending every medium supports exact opening:

- `VERIFIED_EXACT` — the route and relevant range were resolved and checked;
- `VERIFIED_APPROXIMATE` — source identity is certain but edition/provider constraints limit precision;
- `SOURCE_ONLY` — the original can be opened but the relevant range cannot be verified;
- `STALE` — a previously verified route no longer matches its fingerprint;
- `UNAVAILABLE` — rights, access, or provider behavior prevents opening.

The UI may phrase these naturally, but must not blur them.

### Model policy

- Structured outputs are mandatory at every model boundary.
- Deterministic code owns IDs, URL canonicalization, hashes, locator opening, range checks, state transitions, graph integrity, policy checks, and idempotency.
- Models may assess semantic support, but resolver checks remain authoritative for source identity, editions, versions, fingerprints, and open targets.
- A model-suggested independence group is provisional until origin tracing supports it.
- Complex reasoning receives a stronger model only after evals show the need; bounded classification/extraction may use cheaper models after passing the same gates.
- Every run records model, prompt, schema, tool, token, cost, latency, retry, and produced-record metadata. Hidden reasoning is never stored.

## 13. Domain model

Critical integrity uses normalized relational records. Generic provenance edges supplement those relations; they do not replace them. The table names the ownership model across the planned product; each phase creates only the records it actually exercises. In particular, V1 close-as-world needs closure sessions and snapshots, while generated artifact tables wait for the creator-pilot gate.

| Area | Required records | Critical rule |
|---|---|---|
| Optional reviewed pack | research packs, pack versions, memberships, impact notices | A case may pin a reviewed pack version; pack absence never blocks live research, and corrections create a new version rather than rewriting cases |
| Case | cases, case subject refs, optional pinned pack version, intent revisions, calibrations, reading positions | Exact user seed and every intent revision remain recoverable; private live-research overlay remains separate from optional shared material |
| Branching | branches, direction events, branch assessments | Direction text is immutable; branch lifecycle and theory support are separate |
| Research operations | research plans, runs, jobs, attempts, queries, budgets | Trace, run, and job are distinct; all state changes are idempotent |
| Source lifecycle | candidates, sources, origins, snapshots, access decisions | Search result is not evidence; dependent copies share an origin group |
| Locators | locators, locator revisions, verifications | Verification is medium-, edition-, and version-aware |
| Evidence | evidence fragments, limitations, extraction records | A bounded finding is never the same object as its source or claim |
| Claims | claims, assessments, evidence edges, claim relations | Support, contradiction, context, and aggregate confidence remain separate |
| Narrative | beat revisions, beat-claim edges, beat-evidence edges, leads | Published factual beats pass the renderability policy |
| User world | notes, note anchors, connection proposals, decisions | User text is protected; agent connections stay provisional until accepted |
| Closure | V1: sessions and snapshots; creator pilot: artifact versions, blocks, and block inputs | Every generated block stores authorship plus explicit note, branch, claim, evidence, and locator input lists; a category with no input is stored as empty rather than omitted |
| Trust and operations | provenance, corrections, outbox events, idempotency, usage/cost records, deletion tombstones/jobs | Corrections invalidate dependents; deletion includes private derived data and queued work |

Movie-specialist ownership may include films, external identities, film versions, version relations, scenes, film-text assets and observations, screenplay works and drafts, adaptation links, creator credits, production events, reception periods, and selected movie axes. Create only the records exercised by a current golden case or validated phase. Do not prebuild dedicated screenplay, production-event, reception-period, adaptation, cost-ledger, or artifact systems merely because the conceptual boundary is known; run/job usage fields and a generic deletion job plus tombstone are sufficient until proven otherwise.

### Origin, epistemic role, review, and derivation

Do not collapse authorship, meaning, and approval into one enum. Every material text record carries separate dimensions:

- **actor/origin:** user, source, human curator, human reviewer, model, deterministic system, resolver, or importer;
- **epistemic kind:** factual claim, attributed account, interpretation, question, uncertainty, connection proposal, or creative direction;
- **review state:** proposed, accepted, rejected, superseded, or retracted;
- **derivation:** exact input records, method, version, and run or review record.

The original user submission is immutable. A user edit creates a new revision and can replace the active version; a user may still delete their content under the product’s retention policy. Accepting an agent suggestion records the user’s decision but never makes the agent’s wording user-authored. Presentation may simplify these dimensions, but the data cannot collapse them.

## 14. Independent state machines

Do not use one orchestrator status to represent the entire product. Multiple branches and jobs can operate concurrently.

### Case lifecycle

```text
DRAFT → INTENT_PROPOSED → READY → ACTIVE ↔ PAUSED
                                  ↓
                            CLOSURE_REVIEW → CLOSED
                                               ↓ case.reopened
                                             ACTIVE
```

`case.reopened` is the transition event for `CLOSED → ACTIVE`; `REOPENED` is not a stored case state. Degraded health is separate metadata, not a case lifecycle state.

### Branch lifecycle

```text
PROPOSED → PLANNED → OPEN ↔ PAUSED
                       ↓
                 MERGED | CLOSED
```

Research and pressure-testing are concurrent activities represented by attached runs, not exclusive branch lifecycle states. Theory support is an independent assessment: `RESEARCHING`, `STRONG`, `PLAUSIBLE`, `FRAGILE`, `UNDERDETERMINED`, `UNSUPPORTED`, or `CONTRADICTED`.

### Research run and job lifecycle

```text
RUN:  QUEUED → PLANNING → RUNNING → SYNTHESIZING
                                     ↓
             SUCCEEDED | DEGRADED | FAILED | CANCELLED

JOB:  QUEUED → RUNNING → SUCCEEDED
                    ├──→ FAILED_RETRYABLE → QUEUED
                    └──→ DEGRADED | FAILED_TERMINAL | CANCELLED
```

`CHECKPOINTED` is repeatable metadata recorded while a job remains `RUNNING`, not a one-way lifecycle state.

### Beat lifecycle

```text
REVISION:  DRAFT → VALIDATED → READY → PUBLISHED
PUBLISHED REVISION:  PUBLISHED → SUPERSEDED | RETRACTED
```

A revision creates a new record; `REVISED` is an event, not a status on the prior beat. Corrections append revisions and invalidate affected projections or closure blocks. They never silently rewrite an annotated historical beat.

### Closure lifecycle

```text
REQUESTED → AUDITING → REVIEW_READY → FROZEN
                            └──→ CANCELLED

CREATOR PILOT ONLY:
REVIEW_READY → CONFIGURED → GENERATING → READY | DEGRADED | FAILED → FROZEN
```

Closing a case snapshot does not require generated artifact infrastructure. Reopening the case preserves every frozen closure version.

## 15. Commands, events, idempotency, and streaming

Primary commands:

- create case;
- propose/correct/confirm intent;
- start or pause investigation;
- submit direction;
- create/update/delete note;
- accept/dismiss connection;
- open original;
- correct evidence or claim;
- cancel/retry research;
- request closure;
- reopen case;
- delete/export case.

Every state-changing command accepts a stable idempotency key for the user action. Each logical job has a stable key based on run, stage, and normalized input. Attempt records—not the logical key—store provider, model, adapter, prompt, resolver, and schema versions. A configuration change creates an explicit reprocess run; a deployment during retry cannot silently bypass deduplication and create duplicate logical work.

Domain changes and outbox events commit in the same transaction. Stream events have stable IDs, schema versions, monotonic per-case sequence, aggregate version, and resume support.

Stream complete semantic events rather than tokens of model prose, for example:

```text
case.intent_proposed
research.run_updated
source.coverage_updated
locator.verified
claim.revised
beat.published
branch.opened
branch.assessment_updated
connection.proposed
case.health_degraded
closure.audit_ready
```

Domain events, client stream events, and analytics events are separate schemas even when one produces another. Analytics never contains curiosity text, note bodies, theories, selected excerpts, source text, or private project names.

## 16. Failure, rights, privacy, and security behavior

Failure states are part of the product contract.

- **Unknown cut:** continue non-scene research, prohibit film timecodes, and expose the version gap.
- **No useful source:** preserve the coverage gap; do not fill it from model memory.
- **Provider outage:** use verified cached material where allowed, keep completed work, and mark the affected axis degraded.
- **Restricted source:** keep bibliographic metadata and a link-only state; do not reproduce inaccessible content.
- **Locator failure:** downgrade precision or suppress the claim from inspectable rendering; never guess.
- **Duplicate sources:** retain identities but count one independence group.
- **Malformed model output:** reject, attempt bounded repair, and fail safely without publishing partial prose.
- **Weak support:** mark the claim unresolved/contested or omit the factual beat.
- **Timeout or cancellation:** preserve verified work and cancel downstream jobs.
- **Stale locator:** re-resolve server-side and append a verification revision.
- **User correction:** append correction, invalidate dependents, and schedule re-verification.
- **Closure with unresolved issues:** show the audit and require explicit inclusion choices.

Security and privacy requirements:

- sources remain untrusted after screening and cannot change tools, policies, permissions, budgets, or memory scope;
- outbound fetches enforce SSRF and DNS-rebinding protection, allowed schemes and ports, redirect revalidation, private-network denial, and canonical target checks;
- adapters enforce MIME, byte, page, archive-depth, OCR, compression-ratio, and processing-time limits before parsing;
- risky parsers execute in an isolated sandbox, and stored/rendered source material is sanitized against script and HTML injection;
- source-analysis workers receive no credentials, mutation tools, or unrelated case memory and return only allow-listed structured records;
- every live adapter has rate limits, circuit breakers, and an operational kill switch;
- API keys remain server-side;
- cases and notes are private by default;
- row-level authorization protects every user record;
- user-owned uploads have explicit rights and retention state;
- cross-case memory is opt-in, inspectable, and deferred from V1 automation;
- deleting a case removes blobs, embeddings, derived memory, queued jobs, and private records through a tracked workflow;
- quote length, storage, and opening behavior obey rights state;
- prompt-injection, exfiltration, poisoned-document, redirect, malformed-locator, and decompression fixtures block release.

## 17. The Black Hawk Down golden case

Black Hawk Down is simultaneously product content, Golden Evaluation Pack V1, research ground truth, a deterministic fixture, and a live-system benchmark. It is not training data or demo prose.

### Required production pack

1. Resolve and freeze the exact film cut, territory, runtime, medium, and spoiler policy.
2. Define the case boundary for “Why did everything go wrong?” and what is excluded initially.
3. Inventory 20–40 sources with canonical identity, access/rights state, origin group, fingerprint, and resolver status.
4. Include official/archival records, edition-identified reporting, participant accounts from different roles, independent scholarship, contemporaneous journalism, spatial evidence, Somali perspectives, and film/adaptation evidence.
5. Create explicit claims for plan assumptions, intelligence, command, communications, terrain, convoy navigation, helicopter vulnerability, reinforcement, political constraints, casualties, aftermath, and adaptation choices.
6. Separate what the film depicts, what the historical record supports, what participants recall, and what remains interpretation.
7. Manually verify every rendered locator. An unidentified edition or version can never be marked exact.
8. Author 8–12 canonical beats with one contradiction, one spatial/causal moment, one inference pause, and one branch opportunity.
9. Build the theory branch: “The mission was structurally fragile before the first helicopter was hit.” Include support, pressure, alternatives, unknowns, adversarial search, calibrated state, and return.
10. Add one explicit film-versus-history/adaptation branch so the golden case tests movie expertise rather than only generic military-history research.
11. Freeze expected events, note anchors, connection decisions, closure audit, provenance paths, degraded states, and idempotency behavior.
12. Expand the current smoke evals to at least 25 Black Hawk Down questions with gold sources, expected passages, disagreements, forbidden overclaims, and confidence language.

### Golden-case release gate

- 100% of rendered factual beats traverse to claim, evidence, source, locator, and actor/method provenance. Manually curated truth records the curator, reviewer, import/resolver method, and version without inventing a model run.
- 100% of frozen “verified” locators open to the manually reviewed location.
- 100% quote fidelity.
- Film version and book/video edition constraints are enforced.
- Source dependencies are correctly grouped.
- A domain-informed reviewer approves the history/film distinction and uncertainty.
- Every change to frozen truth produces a versioned eval report.

## 18. Delivery roadmap

Exit gates are authoritative. Timeboxes are focused-work estimates, not calendar promises. They assume two capacities can overlap: product/engineering and research/editorial, with access to a domain reviewer. A solo founder should execute the tracks serially and expect longer elapsed time. Research quality may extend any phase.

### Phase 0 — Product, vocabulary, and assumption lock (1–2 weeks)

Deliver:

- this plan signed off as the canonical scope;
- an ADR recording prototypes as non-authoritative vision artifacts;
- one canonical vocabulary for movie axes, source classes, locator states, branch states, and event families;
- an architecture ADR for module boundaries, renderability policy, state machines, and transactional outbox;
- the exact Black Hawk Down case brief, cut-resolution task, rights boundary, and first branch;
- a ranked assumption register;
- separate problem-interview scripts and recruitment for enthusiasts and creators;
- frozen V1 non-goals.

Complete at least six problem interviews with movie rabbit-hole enthusiasts and five with documentary/video-essay creators, synthesized separately around the last real research journey rather than reactions to the concept.

Exit when collaborators can explain the product without calling it chat, a wiki, a generic research tool, or content generation; the schema vocabulary has no unresolved contradictions; and the interview record shows that at least one cohort repeatedly performs this research job and experiences a material logistics, trust, or continuity problem. If that evidence is absent, revise the target problem before building the golden case experience.

### Phase 1 — Behavioral proof and golden truth pack (3–5 weeks, parallel tracks)

**Behavior track:** build a deliberately simple deterministic loop:

```text
film + curiosity → correctable intent → 3–6 paced findings
→ inspect original → submit direction → main trail changes
→ anchored note → return → reopen
```

Do not use this phase for visual polish, playlists, spatial graph work, or generated artifacts.

**Research track:** produce the Black Hawk Down source inventory, claim graph, locator audit, 8–12 beat trail, theory/adaptation branches, and 25-question eval suite.

Exit when:

- at least 5 of 6 observed users understand direction-versus-chat;
- at least 4 of 6 submit a meaningful direction without coaching;
- at least half voluntarily open an original or create a note;
- users can distinguish evidence, source account, agent interpretation, and their own theory;
- the golden-case trust gate passes.

If comprehension fails, change the interaction model before changing styling.

### Phase 2 — Deterministic production spine (4–6 weeks)

Implement without live model dependence:

- corrected core/specialist domain types and strict schemas;
- optional reviewed-pack versions, memberships, nullable case pins, and private live-research overlays;
- cases, intent revisions, sources, snapshots, locators, evidence, claims, and normalized edges;
- branches, immutable direction events, theory assessments, notes, and anchors;
- research runs, jobs, attempts, outbox, idempotency, cancellation, and corrections;
- private case authorization and minimum RLS;
- fixture-driven semantic streaming;
- stable beat insertion and reading-position persistence;
- fresh original-source resolution;
- privacy-safe analytics and cost records;
- mock success, slow, empty, malformed, stale, partial, cancellation, and failure fixtures;
- pinned dependencies and a reproducible lock file.

Exit when the deterministic E2E path completes curiosity → evidence → note → branch → return → close-as-world → reopen, retries create no duplicate state, out-of-order events do not move the active reading anchor, private text cannot enter telemetry, and typecheck/lint/test/build pass.

### Phase 3 — Live Movie Investigator in shadow mode (4–6 weeks)

Implement the staged research pipeline one adapter at a time. Run it against the frozen golden case and a multi-film development/holdout benchmark without exposing live output to users.

Deliver:

- structured intent and movie-axis planning;
- open-title film identity resolution with version/cut escalation only when the question requires it;
- candidate discovery;
- canonical source identity and origin tracing;
- rights/security gate;
- initial resolvers for general movie-research source classes, beginning with public webpages, PDFs/archives, compliant public video/transcript metadata, edition-aware books, and permitted user inputs;
- evidence and claim extraction with strict schemas;
- deterministic locator verification plus semantic support checks;
- contradiction and independence handling;
- movie-specialist theory evaluation;
- narrative sequencing from verified records only;
- full trace, cost, latency, retry, and provenance records;
- a minimum durable worker with leases, checkpoints, bounded retries, cancellation, recovery after process/deploy failure, and an outbox consumer;
- the live-fetch controls in section 16, including network-boundary protection, parser/resource limits, isolated source workers, rate limits, and adapter kill switches.

Exit when the live system clears the golden-case trust gates, passes a pre-alpha breadth benchmark of at least 40 questions across at least eight films with unseen holdouts, and materially beats the generic baseline without film-specific code paths. If it does not, improve ontology, source adapters, or evals before inviting users.

### Phase 4 — Open-title invited alpha (3–4 weeks)

Invite 12–20 users to choose their own movies and curiosities. The same engine must create each case through live film identity resolution, research planning, source discovery, verification, persistent notes, live directions, targeted branches, honest degraded states, closure as a case version, and reopening. Keep Black Hawk Down as a regression benchmark, not the default user experience.

Do not build a catalog-first discovery experience or creation studio. Open-title case creation is enough.

Exit when activation, source inspection, direction use, reopening, trust, latency, and cost gates pass and users describe themselves as thinking through the evidence rather than watching the AI think.

### Phase 5 — Open-title retention beta and breadth gate (5–7 weeks)

Expand the breadth benchmark and invite users to investigate movies they select themselves. Add adapters or movie policies only when a repeated source-class or ontology gap justifies them; never add title-specific answer logic.

Test with 30–50 invited users and report enthusiasts and creators separately.

Exit when:

- the precisely defined seven-day and days-22–28 retention gates in section 19C pass with at least 30 eligible activated users;
- the full breadth and unseen-holdout gates in section 19B pass across every required movie/source stratum;
- no case depends on pretending to access unavailable copyrighted material;
- evidence economics are sustainable;
- the primary continuing wedge is chosen rather than averaged across cohorts.

### Phase 6 — Paid documentary/video-essay creator pilot (4–8 weeks)

Enter this phase only when at least five named creators have active, film-linked projects suitable for the workflow and at least two have accepted a constrained paid pilot in principle.

Build the single creator path in section 9C and pilot it with 5–8 people doing real upcoming work.

Exit when:

- at least five real projects enter the system;
- at least three creators use it repeatedly for four weeks or on a second project;
- at least two pay or commit a card to a constrained plan;
- exports retain complete provenance;
- every generated artifact block retains an authorship state and explicit note, branch, claim, evidence, and locator input manifests, including empty categories;
- measured time to a usable research dossier improves over the creator’s baseline;
- value comes from investigation quality, not only automatic script generation;
- cohort-level gross margin can support the service.

If creators only want generated scripts, treat that as evidence for a different product rather than distorting AFTERFRAME.

### Phase 7 — Production hardening and limited release (4–6 weeks)

Complete:

- authorization and RLS audit;
- delete/export, backup/restore, and incident runbooks;
- hardening and scale work for the durable queue, leases, retries, dead-letter handling, cancellation, recovery, and worker deployment already introduced before alpha;
- stale-locator revalidation and adapter health;
- long-case, mobile, keyboard, reduced-motion, low-data, and accessibility testing;
- privacy, rights, abuse, correction, and rate-limit workflows;
- internal error, cost, latency, and source-quality operations;
- model/provider snapshot pinning and upgrade evals;
- only the entitlement or billing required by the validated plan.

Release remains blocked by the quality gates below.

## 19. Evaluation and release gates

### A. Deterministic invariants

CI must cover:

- case and exact film-version identity;
- discriminated locator validation by medium;
- source canonicalization, snapshots, rights state, and independence grouping;
- quote and evidence fidelity;
- claim/evidence polarity and contradiction retention;
- film depiction versus historical record;
- branch routing, exact user-text preservation, and return anchor;
- theory support, pressure, alternatives, unknowns, and adversarial search;
- sequence stability under duplicate/out-of-order events;
- idempotency for direction, note, retry, correction, and closure;
- provenance traversal;
- telemetry redaction;
- hostile-source isolation;
- slow, empty, malformed, stale, partial, cancellation, and terminal-failure behavior;
- deletion of private and derived data.

No network or live model call is permitted in ordinary CI.

### B. Model and specialist evals

For each stage record at least three runs per prompt/model snapshot and compare against saved fixtures. Use blind human scoring for the full-pipeline comparison. Before running the comparison, freeze the sample, source-class strata, rubric, weights, budgets, and judge instructions.

The release suite contains:

- at least 25 deep Black Hawk Down questions for deterministic trust and regression coverage;
- at least 60 additional questions across at least 12 other films;
- historical adaptation, ambiguous interpretation, production craft, science, mythology, true-story comparison, versions/cuts, older/pre-internet films, international/non-English cinema, independent films, and source-scarce films;
- at least 25% unseen holdout films/questions selected after prompts, policies, and orchestration code are frozen;
- no single film contributing more than 15% of the breadth score;
- representation of every source class the release claims to handle.

These are evaluations, not training examples or a supported-title list.

Initial release targets, ratified in the first eval report:

- zero unsupported rendered facts or critical overclaims in the golden case;
- 100% of user-visible `VERIFIED_EXACT` locators are correct on frozen fixtures and the live evaluation sample; uncertain candidates are downgraded instead of counted as verified;
- at least 98% resolver-candidate precision before downgrade, so the perfect user-visible verified set is not achieved by hiding an unusably large rejection rate;
- at least 90% coverage of gold answerable claims with accepted inspectable evidence, reported separately by source class; abstentions and rejected candidates count against coverage;
- exact, approximate, source-only, stale, and unavailable locator classification accuracy is reported separately from open-target correctness;
- at least 90% direction and movie-axis routing accuracy across the breadth suite, with 100% on canonical Black Hawk Down regression inputs;
- correct source-independence treatment on every golden fixture;
- no prompt-injection fixture changes tools, policy, budgets, permissions, provenance, or memory scope;
- Movie Investigator composite quality at least 15% above a strong generic deep-research baseline on a rubric whose dimensions and weights were frozen before the run, using equal tool/source access and comparable time and cost budgets with blinded judges;
- every absolute trust floor passes independently; composite gains can never compensate for weaker claim support, locator integrity, source independence, or uncertainty calibration;
- cost per activated case measured and attributable by stage.

Score:

- intent fidelity;
- source usefulness and class coverage;
- movie/version awareness;
- film/history/intention/interpretation separation;
- claim support and contradiction discovery;
- locator correctness;
- uncertainty calibration;
- theory pressure-testing;
- branch usefulness;
- sequencing and resistance to answer collapse.

### C. Product behavior

Activation means a user submits a real curiosity, meaningfully consumes at least three evidence-backed beats, and performs one thinking action: inspect an original, create a note, submit a direction, or decide on a connection.

Initial alpha targets, refined only through a recorded learning review:

- activation rate at least 70%;
- at least half of activated users submit a direction;
- at least 40% open an original source;
- at least 25% reopen the case within seven days;
- users can distinguish evidence, interpretation, and user-authored theory;
- no severe confusion is hidden by long dwell time.

During the small open-title alpha, record second-case behavior but treat it as directional evidence because the cohort is too small for the release gate.

In the open-title beta, the retention gate is: at least 30% of **eligible activated users**—users who meaningfully activated, then paused or closed a first case—start a second meaningful case for another movie within seven 24-hour periods. A second meaningful case requires three evidence-backed beats plus one thinking action; clicking a recommendation does not count. At least 20% of the same eligible cohort must return during days 22–28, with a minimum of 30 eligible users before treating the percentage as a gate. Report cohort-specific numerators, denominators, and confidence intervals.

The north-star behavior is **voluntary next investigation rate**. Session duration, scrolling, compliments, and visual reactions are supporting observations, not success by themselves.

### D. Cost and latency budgets

Initial service objectives to validate by workload class:

- saved shell or curated first beat: P95 under 1.5 seconds;
- intent proposal: P95 under 5 seconds;
- cached verified evidence batch: P95 under 3 seconds;
- first new verified finding from an ordinary supported web source: P50 under 10 seconds and P95 under 30 seconds;
- direction persisted and branch shell opened: P95 under 1 second;
- first verified branch finding using cached or ordinary supported sources: P50 under 15 seconds and P95 under 45 seconds;
- fresh open-original resolution: P95 under 2 seconds;
- cancellation reflected: under 2 seconds.

Deep multi-source, restricted, book, archive, or version-resolution work is asynchronous and receives a source-class-specific budget in the research plan rather than a false universal response deadline. The case must acknowledge the run promptly and report only real stage changes. Never publish unverified material to meet a latency goal.

Track cost independently for discovery, fetch/resolution, extraction, verification, sequencing, theory pressure-testing, closure, storage, egress, human curation, and pilot support. Report P50/P95 cost per started, activated, and retained case and per live branch. Before invited alpha, an eval report must declare hard P50/P95 case and branch caps, an absolute run budget, and the behavior when each is reached. Do not set final prices or offer unlimited live research until actual distributions are known. A paid cohort should support approximately 70% gross margin before broad release using the full service-cost formula.

### E. Reliability and operational release gates

Before limited production release:

- at least 99% of verified-original open requests succeed on supported providers during the release sample; any failure returns an honest degraded state;
- at least 95% of activated live movie investigations whose film identity resolves and whose research is not blocked by rights/access reach three verified beats without staff intervention;
- resume tests recover 100% of acknowledged semantic events after simulated connection loss, duplication, and reordering;
- essential job success is at least 95%, with every degraded or failed run retaining verified partial work and a machine-readable reason;
- correction fixtures invalidate and re-project 100% of known dependent claims, beats, and closure snapshots;
- deletion, backup, and restore drills pass completely on a production-like environment;
- zero critical privacy, authorization, prompt-injection, rights, or secret-exposure findings remain open;
- incident and adapter-disable drills identify affected cases and stop new unsafe work.

## 20. Experience requirements without prescribing a UI

The production design may look nothing like the prototypes, but it must satisfy these behaviors:

- the current question and branch are always understandable;
- the first useful state arrives quickly and honestly;
- one dominant line of inquiry is foregrounded at a time;
- a major claim and its evidence relationship are never far apart;
- the user can reach the best available original location without citation archaeology;
- evidence, source account, agent interpretation, uncertainty, and user thought are distinguishable;
- a direction changes the primary case rather than opening a transcript destination;
- branches preserve origin and make return obvious;
- notes can be captured at the moment of thought and survive revisions;
- the system interrupts only for material turns, contradictions, trust issues, or useful connections;
- later findings can revise earlier claims without erasing history;
- returning after days restores context without an answer dump;
- closing feels like preserving a milestone, not declaring that the world is solved;
- the document remains comprehensible without motion;
- keyboard, mobile, reduced-motion, degraded, empty, and failure paths are first-class.

Visual restraint remains law: no card-grid default, dashboard chrome, pill overload, detective cosplay, or decorative motion. The specific composition remains a design problem to solve through testing.

## 21. Definition of done for every production feature

A feature is complete only when it has:

- a named user behavior or trust outcome;
- loading, success, empty, degraded, and failure states;
- keyboard behavior;
- mobile behavior;
- reduced-motion behavior;
- source provenance where applicable;
- deterministic transformation tests;
- integration coverage for its critical path;
- a Black Hawk Down fixture or regression case;
- typed, private-content-safe telemetry;
- cost and latency visibility for model/tool work;
- idempotency for every state change;
- cancellation/retry behavior for every external job;
- specialist/core dependency review;
- no new visual primitive that violates the design laws;
- an explicit scope tradeoff: what it delays and what is removed.

## 22. Principal risks and decision rules

| Risk | Early evidence | Decision rule |
|---|---|---|
| Beautiful one-time demo | Praise without another case | Stop visual expansion; test and repair the core loop |
| Chatbot drift | Direction area accumulates answers | Route output back into a branch or reject the feature |
| Answer collapse | Users skim generated conclusions | Reduce narration; improve evidence order and inference pauses |
| Generic-tool equivalence | Baseline produces comparable movie research | Improve specialist ontology/adapters or reconsider the thesis before expanding |
| Trust failure | Fabricated locator or unsupported rendered claim | Block release, create a failing fixture, correct downstream records |
| Source monoculture | Repeated claims appear independent | Trace origin and broaden source roles, including overlooked perspectives |
| Copyright/access gap | Product implies film/book access it lacks | Use link-only/approximate states or narrow the supported claim |
| Cost explosion | Verification cost rises faster than activation | Cache verified work, narrow source classes, enforce budgets, change model routing |
| Creator pull toward scripts | Users bypass research for generation | Keep it behind closure or recognize a separate product |
| Premature generic architecture | Core interfaces exist without V1 use | Remove unused abstractions; keep only Movie Investigator seams |
| Audience dilution | Enthusiast and creator feedback conflict | Report cohorts separately and choose a primary wedge at the retention gate |
| Founder/prototype bias | UI refinement outruns source/eval work | Freeze presentation work until the next behavioral or trust gate passes |

Materially revise or stop the business thesis if repeated iterations still show no second-case behavior, no recurring cohort, no specialist advantage over generic tools, economically unsustainable verification, or inadequate lawful source coverage.

## 23. Go-to-market and business learning

1. Run problem interviews before showing the product. Ask about the last real research journey, not whether someone likes an AI idea. Continue only if a cohort shows recurring behavior and material pain.
2. Use Black Hawk Down as a concierge-quality proof, not a broad catalog launch. Measure invited user → real curiosity → activation → thinking action; stop acquisition work if users consume the demo without entering the loop.
3. Recruit serious small cohorts from film-history communities, video-essay creators, film schools, and documentary researchers. Track outreach → qualified person → active project/case → repeat case, not replies or compliments.
4. Publish one exceptional read-only investigation only after its provenance passes review. Measure qualified visitor → submitted real curiosity → activation; do not scale the channel if it produces passive reading only.
5. Test consumer and creator positioning separately:
   - consumer: “Investigate the worlds behind the films that stay with you.”
   - creator: “Build a sourced understanding of the world before you write it.”
6. Offer a constrained paid research pilot around an actual upcoming creator project. Measure qualified creator → active project → paid pilot → second project or second paid cycle; stop building creator-specific scope if repeat project behavior does not appear.
7. Let retention and paid behavior choose the wedge.
8. Expand distribution only after voluntary next-case behavior exists.

Do not market “multi-agent,” “RAG for movies,” “Perplexity for film,” or “AI script generator.” Those describe implementation or the wrong product category.

## 24. Decisions locked now versus questions to test

### Locked now

- the long-term company builds an investigation engine;
- Movie Investigator is the only V1 specialist and external promise;
- live Movie Investigator accepts any identifiable movie; named films are evaluation fixtures, not a supported catalog or training boundary;
- the case, not the answer, is the unit of value;
- evidence precedes publishable factual narrative;
- direction changes the main investigation;
- user-authored text remains distinct from normalized and agent-authored records;
- uncertainty, contradictions, source dependence, rights, and version identity remain visible;
- prototypes are non-authoritative vision artifacts;
- creation is explicit closure, not the initial destination;
- retention and domain evals gate expansion.

### Test rather than assume

- whether “case,” “branch,” and “close investigation” are the right user-facing words;
- when intent confirmation helps versus creates friction;
- the minimum useful first batch and pacing rhythm;
- how visibly evidence should remain present during reading;
- when users naturally create notes;
- whether a compact path/evidence summary is enough before a spatial view;
- which third film archetype has the best lawful source coverage;
- whether enthusiasts or creators become the first durable cohort;
- which locator states users understand without false confidence;
- whether creator export should begin as Markdown/JSON, PDF, or both.

## 25. Immediate execution order

The next work should happen in this order:

1. Approve this plan and freeze the deferred list.
2. Add the prototype-posture and architecture ADRs and freeze canonical source, locator, evidence, rights, branch, and event vocabularies.
3. Complete and synthesize the Phase 0 problem interviews by cohort.
4. Resolve and record the exact Black Hawk Down version and case boundary.
5. Create the real source inventory, rights states, dependency groups, and locator audit using the frozen vocabulary.
6. Replace the starter domain types with strict core and Movie Investigator schemas.
7. Design the production relational schema, including optional reviewed-pack versions, claims, normalized edges, jobs, outbox, idempotency, corrections, authorization, and deletion.
8. Freeze Black Hawk Down Golden Evaluation Pack V1 and its deterministic fixture with expected records and events.
9. Build the minimal deterministic investigation loop from semantic read models.
10. Observe six users before investing in a new visual system.
11. Implement one live source adapter at a time in shadow mode with the minimum durable and security controls.
12. Open the engine to user-selected films only after the golden-case trust gate and pre-alpha multi-film holdout benchmark pass.

## 26. V1 is done when

Movie Investigator V1 is complete only when a user can choose any identifiable movie, begin with a real curiosity, receive a dynamically researched, paced, and inspectable trail, open the best verified original locations, distinguish evidence from accounts and interpretation, change the investigation through a researched branch, preserve a thought in their own words, leave and return without losing the case, and close a version without false certainty—and when enough users voluntarily begin a second movie to show that this is a behavior, not a beautiful one-time experience.

That is AFTERFRAME: **the world’s best environment for thinking through the worlds behind movies, powered by an investigation engine that does the research labor without taking the discovery away.**
