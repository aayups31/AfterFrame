# 00 — North Star

## The product in one sentence

AFTERFRAME turns the question a movie leaves in your head into a living, source-grounded investigation that unfolds around your curiosity.

## The emotional promise

The user should not say:

> “I researched Black Hawk Down.”

They should say:

> “I went inside the world behind Black Hawk Down.”

## The key distinction

### Existing AI pattern

```text
Question → search → synthesis → answer
```

### AFTERFRAME pattern

```text
Film → curiosity → agent assembles evidence → paced discovery → user thinks
     → user asks → trail changes → user creates notes and connections
     → a personal world of understanding remains
```

The AI generates the **exploration**, not the user’s final opinion. Only after an explicit **Close Investigation** action may it synthesize the completed case into a traceable visual script, dossier, outline, or creative brief.

## The core job

Remove the logistics of deep research without removing its pleasure.

The agent handles:

- query expansion;
- source discovery;
- source ranking;
- locating relevant passages or moments;
- cross-checking;
- contradiction discovery;
- sequencing;
- connection suggestions;
- remembering prior investigations.

The user handles:

- curiosity;
- interpretation;
- choosing direction;
- questions;
- notes;
- personal connections;
- deciding what matters;
- deciding when the case feels complete.

## Product principles

### 1. Curiosity over completion

No artificial “92% explored” score. A world does not have one correct completion path.

### 2. Evidence over authority

The system shows why it believes something and where the user can inspect it.

### 3. Pacing over density

The right information at the right moment is more immersive than an exhaustive dump.

### 4. Personal worlds over canonical maps

Two people opening the same film should leave with different investigations.

### 5. Original sources remain first-class

The product never traps the user inside AI paraphrases.

### 6. The user earns the connection

The agent can place two findings beside each other and ask a sharp question. It should not always deliver the satisfying conclusion itself.

### 7. Direction changes the world, not a chat transcript

A user theory, idea, question, or instruction should create or redirect a branch in the main investigation. The investigator may answer with one human line, but the work appears in the case.

### 8. Research and creation are separate modes

The user may manually build from the research at any time. AI synthesis becomes available at closure and must remain editable, sourced, and reversible.


## Company architecture

AFTERFRAME's long-term mission is a domain-neutral investigation engine. V1 is deliberately not a general research product: it is the Movie Investigator, a specialist that supplies movie ontology, source policies, version reasoning, source adapters, domain evaluations, and creator workflows to the reusable core. See `docs/26-engine-and-specialist-boundary.md`.

## Initial audience

People who finish a film and immediately open many tabs about:

- the true story;
- history and politics;
- mythology and symbolism;
- production choices;
- real people;
- source material;
- hidden details;
- conflicting interpretations;
- adjacent events or works.

## Initial content boundary

Start with films that naturally open rich worlds:

- Black Hawk Down;
- Troy;
- Hereditary;
- The Conjuring;
- The Odyssey adaptations;
- Interstellar;
- Zodiac;
- Oppenheimer;
- The Social Network;
- 13 Hours.

For the first demo, support one case exceptionally rather than ten cases superficially.
