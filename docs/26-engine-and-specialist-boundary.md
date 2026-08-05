# 26 — Investigation Engine and Movie Specialist Boundary

## Architectural rule

The engine must not specialize in movies. The **Movie Investigator** specializes in movie research.

This boundary prevents V1 domain logic from contaminating the reusable investigation core while also preventing the first product from becoming prematurely generic.

## Domain-neutral investigation core

The core owns capabilities that remain valid for any future specialist:

- intake normalization;
- objective and scope formation;
- investigation planning;
- job orchestration and budgets;
- source-candidate lifecycle;
- source identity and deduplication;
- locator resolution and verification;
- claim/evidence separation;
- source independence tracking;
- contradiction and uncertainty handling;
- branch state and return paths;
- note anchoring and user-authorship boundaries;
- cross-case memory;
- event streaming;
- provenance;
- observability;
- cancellation and recovery.

The core must not contain hard-coded film axes such as cinematography, screenplay draft, director intent, historical accuracy, adaptation, or cut differences.

## Movie Investigator specialist

The specialist contributes:

- film-specific intake interpretation;
- film identity and version resolution;
- research ontology;
- source taxonomies and priority rules;
- source adapters;
- query templates;
- evidence quality heuristics;
- film-specific theory evaluation;
- scene, cut, screenplay, production, reception, and adaptation semantics;
- film-specific narrative pacing;
- benchmark cases and expert rubrics;
- creator modes such as documentary, biopic, adaptation, and fact-check.

## Interface contract

```ts
interface InvestigationSpecialist {
  id: string;
  version: string;
  canHandle(input: InvestigationSeed): Promise<SpecialistFit>;
  interpretIntent(input: InvestigationSeed): Promise<SpecialistIntent>;
  planAxes(input: SpecialistIntent): Promise<ResearchAxisPlan[]>;
  sourcePolicy(): SpecialistSourcePolicy;
  queryStrategies(): QueryStrategy[];
  evaluateEvidence(input: EvidenceEvaluationInput): Promise<SpecialistEvaluation>;
  sequenceHints(input: SequenceContext): Promise<SequenceHint[]>;
  evaluationSuite(): string;
}
```

The engine calls the interface. It never imports Movie Investigator implementation modules directly.

## Data ownership

### Core records

- cases;
- branches;
- direction events;
- sources;
- locators;
- evidence fragments;
- claims;
- contradictions;
- notes;
- connections;
- runs;
- artifacts;
- provenance edges.

### Movie-specialist records

- films;
- film versions and cuts;
- scenes;
- screenplay drafts;
- adaptation links;
- film-text observations;
- creator roles;
- production events;
- reception periods;
- movie research axes.

## Runtime flow

```text
User curiosity
  ↓
Core intake
  ↓
Specialist selected: movie-investigator@v1
  ↓
Movie intent + axes
  ↓
Core orchestrates jobs
  ↓
Movie adapters discover and interpret candidates
  ↓
Core resolves, verifies, stores, and streams evidence
  ↓
Movie specialist suggests domain-aware sequencing
  ↓
Core preserves branch, note, provenance, and user state
```

## Expansion gate

A second specialist is not approved until all are true:

1. Movie Investigator has a repeat-user cohort.
2. Domain evals materially beat a generic research baseline.
3. Core/specialist coupling is measured and documented.
4. At least 80% of the new specialist can use existing core interfaces without branching the engine.
5. The new specialist has a real recurring user and source ecosystem.
6. Building it will not reduce Movie Investigator quality or velocity.

## Naming rule

External product language may say “Movie Investigator.” Internal implementation may use “specialist,” “adapter,” and “engine.” Avoid advertising “multi-agent architecture” as a user benefit.
