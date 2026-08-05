# 01 — Product Specification

## Product loop

1. **Choose a film.**
2. **Describe what stayed with you.**
3. **Agent interprets the curiosity.**
4. **Agent constructs a provisional case plan.**
5. **The exploration begins before the full research run is finished.**
6. **Evidence and narrative beats stream in.**
7. **User highlights, writes, asks, links, and redirects.**
8. **A user theory, question, or direction creates or redirects a branch in the main screen.**
9. **Agent adapts unresolved leads, source plans, and theory assessments.**
10. **Connections to earlier findings and earlier cases surface.**
11. **User closes the investigation as a living case world or enters a traceable creation studio.**

## Core surfaces

### A. Home / film portal

Purpose: anticipation and selection.

Must contain:

- bold cinematic art direction;
- film discovery or search;
- recent open cases;
- a transition from film to curiosity prompt;
- no dense feature explanation;
- no dashboard.

Primary line:

> What stayed with you?

Example response:

> I want to understand why the Black Hawk Down mission collapsed so quickly.

### B. Case opening

Purpose: establish the investigation objective and tone.

The agent returns a compact interpretation:

```text
CASE INTENT
Understand how a short capture mission became an extended urban battle,
and which failures were structural rather than accidental.
```

The user may correct the intent before launch.

### C. Exploration stream

Purpose: paced, immersive reading and discovery.

Contains:

- full-width narrative beats;
- source hints in editorial margins;
- exact-evidence markers;
- occasional maps, timelines, photographs, diagrams, and quotations;
- branch moments;
- interruptions from the investigator;
- user notes and connections;
- scroll-driven transitions.

It must not resemble a feed of cards.

### D. Direction console

Purpose: let the user steer the investigation without turning the product into chat.

The user can submit:

- a theory;
- a question;
- a lead;
- a challenge;
- a comparison;
- a connection;
- a narrower or wider direction;
- a pace, depth, or source preference.

The investigator may acknowledge the direction in one short human line. It then creates, redirects, deepens, or pressure-tests a branch in the main exploration surface. Long responses do not accumulate in the console.

Examples:

```text
“I think the hotel is amplifying Jack rather than possessing him.”
→ THEORY BRANCH
```

```text
“Compare the screenplay ending with the theatrical cut.”
→ COMPARISON BRANCH
```

The console cannot silently rewrite the case, user notes, or user belief.

### E. Source inspection

Purpose: trace every meaningful claim to originals.

A source hint expands to:

- source name;
- author or speaker;
- source type;
- why it matters now;
- exact locator;
- confidence and limitations;
- open-original action.

Examples:

```text
Video: Veteran oral history
Relevant moment: 18:42–21:13
Open original at 18:42
```

```text
Book: Black Hawk Down, 2010 edition, ISBN …
Relevant location: Chapter 3, pp. 42–44
Open publisher / library / owned copy
```

```text
PDF: After-action report
Relevant location: p. 17, section 2.1
Open original at page 17
```

### F. Note creation

Entry points:

- highlight text;
- select evidence;
- ask the investigator to hold a thought;
- keyboard shortcut;
- persistent minimal note control.

Note forms:

- plain note;
- sticky thought;
- question;
- claim;
- contradiction;
- graph node;
- flow step;
- relationship;
- link to current beat;
- link to prior beat;
- link to another case.

### G. Case world

Purpose: show what the user built.

Views:

- narrative path;
- evidence map;
- timeline;
- entities;
- claims and counterclaims;
- user notes;
- unresolved leads;
- cross-case connections.

This is not a completion screen. It remains editable and reopenable.

### H. Investigation playlists

A user can:

- create named playlists;
- associate a playlist with a case or genre;
- attach external streaming links;
- add owned/local ambient tracks later;
- choose automatic low-volume behavior while the investigator speaks;
- store per-case volume and playback position.

Do not make music mandatory. Respect autoplay restrictions and user control.


### I. Close investigation and creation studio

Purpose: turn a mature case into an optional artifact without collapsing the research process into content generation.

The close flow must first surface unresolved branches, contradictions, unused user notes, and unverified locators. The user can:

- close as an editable case world;
- create a visual documentary script;
- create a research dossier;
- create an essay or video outline;
- create a director or writer brief;
- create an evidence appendix;
- return to the investigation.

The user can also start from a blank artifact and manually drag evidence, notes, and theory branches into it. Every AI-generated block retains provenance.

## Personalization profile

Adjustable dimensions:

- pace: meditative ↔ rapid;
- depth: accessible ↔ expert;
- voice: documentarian / forensic / historical / conversational;
- source strictness: broad ↔ primary-source heavy;
- intervention frequency: quiet ↔ proactive;
- challenge level: affirming ↔ skeptical;
- spoiler policy;
- focus weights: history / production / symbolism / real people / science / mythology;
- preferred note style;
- citation visibility.

The system may infer temporary preferences inside a case, but lasting changes require user approval.


## Recurring professional workflows

V1 also supports tightly scoped Movie Investigator modes for documentary/video-essay research and adaptation/biopic world research. These modes change evidence policy, pacing, and closure artifacts; they do not turn the product into automatic script generation. See `docs/28-creator-workflows.md`.

## MVP acceptance criteria

A first-time user can:

1. choose Black Hawk Down;
2. state a curiosity;
3. begin reading within seconds;
4. inspect at least four distinct source types;
5. open original sources at exact locations where supported;
6. submit a question or direction and visibly alter the trail;
7. create a text note and a connection;
8. see one agent-suggested connection to an earlier beat;
9. control an investigation playlist;
10. submit a theory or direction and see the main trail branch;
11. close the case and preview a sourced visual-script structure;
12. reopen the resulting case world.
