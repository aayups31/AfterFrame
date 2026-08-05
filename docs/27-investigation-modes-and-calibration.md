# 27 — Investigation Modes and Calibration

## Purpose

Different users need different research instincts without requiring different products. Modes are **thinking and evidence policies**, not costume personalities.

The user may choose a mode explicitly or let the Movie Investigator infer a temporary mode from intent. Inferred changes expire with the case unless the user approves them.

## Initial modes

### Documentary researcher

Optimizes for:

- causal chronology;
- reveal order;
- primary and independent corroboration;
- visually demonstrable evidence;
- clean distinction between established fact and narrative hypothesis;
- unanswered tension that can drive a documentary.

Avoids writing the final video on behalf of the creator during investigation.

### Film historian

Optimizes for:

- production chronology;
- archival records;
- contemporaneous interviews and reviews;
- version differences;
- attribution discipline;
- reception changing over time.

### Filmmaker / adaptation researcher

Optimizes for:

- world-building context;
- character and relationship dossiers;
- locations, material culture, language, institutions, and period detail;
- source-book-to-screen differences;
- rights and provenance awareness;
- dramatic possibilities clearly separated from factual claims.

### Forensic fact-check

Optimizes for:

- claim inventory;
- exact locators;
- source independence;
- strongest counterevidence;
- unresolved and false claims;
- reproducible audit output.

Narrative pacing is secondary to verification.

### Interpretation lab

Optimizes for:

- motif recurrence;
- formal film evidence;
- competing readings;
- creator statements without treating intention as final authority;
- pressure-testing influence and symbolism claims;
- preserving ambiguity.

### Open rabbit hole

Optimizes for:

- breadth;
- surprising but defensible adjacency;
- low-friction branching;
- shorter beats;
- user-led direction;
- fewer forced resolutions.

It still obeys source and uncertainty laws.

## Calibration dimensions

Store independent dimensions rather than a single persona label:

```ts
type InvestigatorCalibration = {
  pace: 0 | 1 | 2 | 3 | 4;
  depth: 0 | 1 | 2 | 3 | 4;
  sourceStrictness: 0 | 1 | 2 | 3 | 4;
  interventionFrequency: 0 | 1 | 2 | 3 | 4;
  challengeLevel: 0 | 1 | 2 | 3 | 4;
  narrativeDensity: 0 | 1 | 2 | 3 | 4;
  citationVisibility: "quiet" | "standard" | "always";
  spoilerPolicy: "avoid" | "warn" | "full";
};
```

## Onboarding

Do not open with a settings matrix. Ask one concrete question after curiosity intake:

> How should I approach this case?

Suggested choices may be short, such as:

- Follow the real history
- Test an interpretation
- Trace how it was made
- Build research for a documentary
- Let the trail decide

The user can change calibration from the direction console in natural language:

- “Use more primary sources.”
- “Slow down and let me think.”
- “Challenge this theory harder.”
- “Give me the direct passages.”

## Behavioral test

Two calibrations given the same film and curiosity must produce different:

- source plans;
- beat lengths;
- intervention frequency;
- uncertainty language;
- branch proposals;
- closure audit.

They must not produce contradictory factual standards.
