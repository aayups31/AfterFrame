# 12 — Evaluation Plan

## Product success signals

### Immersion

- user continues past the first three beats;
- low accidental exit rate;
- return-to-case rate;
- reading dwell without forced delays;
- playlist usage as an optional engagement signal.

### Curiosity

- follow-up questions per session;
- branches initiated by the user;
- sources opened voluntarily;
- notes created;
- accepted and rejected connections;
- direction-to-branch completion rate;
- return-to-parent-branch behavior.

### Trust

- source inspector open rate;
- original-source open rate;
- stale-locator rate;
- unsupported-claim rate;
- correction rate;
- user-reported confidence.

### Personal construction

- percent of world nodes created or confirmed by the user;
- cross-case links accepted;
- notes revisited;
- cases reopened.

Do not optimize only for session duration. A manipulative experience can produce time without value.

## Research quality eval set

Create 25 fixed questions for the initial film. For each:

- gold-standard source set;
- expected relevant passages;
- known source disagreements;
- unacceptable overclaims;
- locator verification target;
- expected confidence language.

## Agent evals

### Intent Interpreter

- preserves user’s actual question;
- does not broaden into a generic film overview;
- respects spoiler and focus constraints.

### Source Scout

- source diversity;
- primary-source recall;
- reputation and relevance;
- duplicate independence handling.

### Evidence Extractor

- claim fidelity;
- locator accuracy;
- quote accuracy;
- limitation preservation.

### Narrative Director

- no premature answer dump;
- coherent prerequisite order;
- pacing variation;
- evidence adjacency;
- meaningful branch points.

### Theory Branch Evaluator

- confirmation-bias resistance;
- negative-case recall;
- calibrated support state;
- version/cut awareness;
- separation of intent and interpretation.

### Closure Synthesis

- factual block provenance coverage;
- unsupported new-fact rate;
- preservation of contradictions;
- usefulness of visual direction;
- manual editability.

### Connection Miner

- explanation quality;
- false relation rate;
- distinction between resemblance and causation;
- user acceptance rate.

## UX test prompts

Ask testers:

- “At what moment did this begin feeling like an investigation?”
- “When did it feel like normal AI chat?”
- “Did the system ever steal a conclusion you wanted to reach yourself?”
- “Could you tell what was evidence versus interpretation?”
- “Did you trust the exact source route?”
- “Which motion helped understanding and which felt decorative?”
- “Would you reopen this case?”

Use `evals/movie-investigator-eval-set.jsonl` as the first regression fixture.
