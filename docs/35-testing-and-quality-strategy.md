# 35 — Testing and Quality Strategy

## Test pyramid

### Deterministic unit tests

Test:

- schemas;
- mode/calibration merge logic;
- branch state transitions;
- source canonicalization;
- locator formatting and verification states;
- independence grouping;
- claim/evidence graph transformations;
- provenance traversal;
- telemetry redaction;
- untrusted-content boundaries.

### Integration tests

Test:

- curiosity → intent → first plan;
- direction → branch job → streamed beats;
- evidence candidate → resolver → verified locator;
- note anchor → connection suggestion;
- close case → audit → artifact provenance;
- cancellation and retry;
- model output rejection and repair.

Use recorded model/tool fixtures for CI. Live-model tests run separately with budgets.

### End-to-end tests

Critical paths:

1. open Black Hawk Down;
2. submit curiosity;
3. inspect exact source;
4. create note;
5. submit theory;
6. see branch in main trail;
7. return to parent;
8. close as case world;
9. reopen at saved position.

Run keyboard and reduced-motion variants.

## Model evaluations

Every model stage needs a typed benchmark and baseline:

- intent fidelity;
- movie-axis selection;
- source-class coverage;
- candidate precision;
- locator accuracy;
- claim support correctness;
- contradiction discovery;
- source independence recognition;
- uncertainty calibration;
- branch usefulness;
- movie-specialist advantage over generic research prompt;
- narrative pacing without answer collapse.

The eval set must include adversarial and ambiguous cases, not only obvious factual questions.

## Human evaluation

Use film researchers or creators to score:

- whether the trail asks the right next question;
- whether evidence appears at the right moment;
- whether interpretation is overclaimed;
- whether a source would be worth opening;
- whether the system understands version/cut differences;
- whether the case changes their understanding.

## Golden case

Black Hawk Down is the first golden case. Freeze:

- film version identity;
- source set;
- claim graph;
- locators;
- one main trail;
- one theory branch;
- expected uncertainty states.

Changes require an eval report, not aesthetic preference alone.

## Release gates

No production research release if:

- any rendered factual beat lacks claim/evidence provenance;
- verified locator precision is below the target defined in the eval report;
- prompt-injection fixtures can alter tool policy;
- cancellation or retry duplicates evidence silently;
- private note content appears in analytics;
- reduced-motion or keyboard critical paths fail;
- cost per activated case is unknown.

## Regression record

Each incident creates:

- a failing fixture;
- root cause;
- corrected behavior;
- model/prompt/resolver version;
- backfill plan for affected cases.
