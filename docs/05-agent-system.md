# 05 — Agent System Architecture

## Architecture principle

Use a coordinated pipeline with explicit state, not one enormous prompt that asks a model to “research and write the experience.”

## Core agents / services

### 1. Intent Interpreter

Input:

- movie identity;
- user curiosity;
- agent profile;
- spoiler policy;
- prior case context.

Output:

- case objective;
- scope boundaries;
- initial hypotheses or questions;
- likely evidence classes;
- first research queries;
- first beat strategy.

### 2. Source Scout

Responsibilities:

- web search;
- discover books, papers, interviews, archives, official records, production sources, and reputable analysis;
- prioritize original and primary material where possible;
- record access limitations;
- deduplicate syndicated copies;
- rank source usefulness for the exact case objective.

### 3. Source Resolver

Responsibilities:

- canonicalize URLs and source identities;
- fetch or index permitted content;
- resolve editions;
- obtain transcripts when legitimately accessible;
- map PDF pages;
- generate stable paragraph fingerprints;
- create open-original links;
- detect stale or inaccessible locators.

### 4. Evidence Extractor

Transforms source material into evidence fragments:

- bounded claim;
- paraphrased finding;
- short allowable quote where useful;
- exact locator;
- source type;
- date;
- people, places, events;
- relevance explanation;
- limitations.

### 5. Claim Graph Builder

Creates:

- claims;
- support edges;
- contradiction edges;
- dependency edges;
- entity relationships;
- timeline links;
- source independence signals.

It must distinguish “three sites repeating one report” from three independent accounts.

### 6. Verification Agent

Checks:

- whether a source actually supports the claim;
- whether the locator resolves;
- whether dates and names conflict;
- whether the evidence is independent;
- whether the system overstates confidence;
- whether the summary preserves source uncertainty.

### 7. Narrative Director

Does not write a final article. It sequences evidence into exploration beats.

Inputs:

- case objective;
- verified claim graph;
- user reading state;
- recent questions;
- style profile;
- unresolved leads.

Outputs:

- next 2–5 beats;
- reveal style;
- source hints;
- one optional branch;
- one optional reflection prompt;
- whether to pause.

### 8. Direction Router and Investigator Presence

The router treats user input as control over the case, not as a request for a long chat response. It:

- classifies theory, question, lead, focus, challenge, comparison, connection, style, or return;
- decides whether to create, redirect, deepen, detour, compare, or propose a merge;
- preserves the exact user-authored origin;
- emits a short neutral acknowledgement;
- starts targeted research and updates the main branch.

The investigator presence later emits calibrated one-line reactions based on verified theory state.

### 9. Movie Research Axis Router

Selects film-specific research playbooks across film text, script and development, authorship and collaboration, versions and cuts, adaptation, history/science/mythology, reception, and influence. It records the exact film version and never pretends the system watched unavailable copyrighted material.

### 10. Theory Branch Evaluator

Separates support, pressure, contradiction, alternatives, and unknowns. Runs an adversarial search and assigns STRONG, PLAUSIBLE, FRAGILE, UNDERDETERMINED, UNSUPPORTED, or CONTRADICTED.

### 11. Connection Miner

Compares new entities, claims, patterns, and notes against:

- earlier beats;
- current case graph;
- prior cases;
- explicit user interests.

Outputs a suggestion with reason and strength. The user decides whether to make the connection part of their world.

### 12. Note Curator

- preserves exact anchors;
- proposes note type;
- extracts optional entities only after user confirmation;
- maintains graph integrity;
- never rewrites the user’s words silently.

### 13. Closure Synthesis Editor

Runs only after explicit closure. Audits unresolved issues and produces provenance-rich visual scripts, dossiers, outlines, briefs, or evidence appendices while preserving manual editing.

## Orchestrator state machine

```text
DRAFT
  → INTENT_CONFIRMED
  → FAST_RESEARCH
  → OPEN
  → STREAMING
  → DIRECTION_RECEIVED
  → BRANCH_INTERPRETING
  → TARGETED_RESEARCH
  → BRANCH_OPEN
  → STREAMING
  → TRAIL_PAUSED
  → CLOSURE_REVIEW
  → WORLD_READY | CREATION_STUDIO
  → REOPENED
```

Research runs have separate states:

```text
QUEUED → SEARCHING → RESOLVING → EXTRACTING → VERIFYING → READY
                                               ↘ DEGRADED / FAILED
```

## Recommended model use

- Use GPT-5.6 Sol for high-stakes orchestration, theory assessment, closure synthesis, and difficult verification; use Terra or Luna selectively for bounded high-volume transformations after evals.
- Use the Responses API with web search for source discovery.
- Require Structured Outputs for plans, evidence fragments, claims, locators, and beats.
- Keep factual claims in typed records; render prose from those records.
- For long research operations, run a background job and stream verified batches rather than keeping one browser request open indefinitely.

## Context strategy

Do not resend the entire case every turn.

Maintain:

- compact case intent;
- current trail summary;
- active entities;
- unresolved leads;
- relevant claim neighborhood;
- recent interaction window;
- retrieved note subset;
- prior-case connection candidates.

Retrieve exact evidence on demand.

## Human agency rule

The system may autonomously:

- retrieve;
- rank;
- verify;
- sequence;
- suggest.

The system must ask before it:

- asserts a user belief;
- connects two user notes as a conclusion;
- closes a contested question;
- changes persistent style preferences;
- shares or publishes a case.

See `docs/17-direction-console-and-branching.md`, `docs/18-movie-research-specialization.md`, `docs/19-theory-engine.md`, and `docs/20-close-investigation-and-creation-studio.md`.
