# 02 — Experience Architecture

## The investigation is a sequence of beats

The backend should not send “an article.” It should stream typed beats that the interface can pace independently.

### Beat types

| Beat | Purpose | Typical visual treatment |
|---|---|---|
| `opening` | Establish the unresolved question | One sentence, full viewport |
| `context` | Give necessary background | Editorial text with subtle margin source |
| `evidence` | Present a strong piece of evidence | Text + exact locator reveal |
| `turn` | Change interpretation | Typography interruption / contrast shift |
| `question` | Preserve user inference | Pause and optional response |
| `contradiction` | Place accounts in tension | Split lines, not boxes |
| `map` | Establish spatial causality | Full-width map or diagram |
| `timeline` | Establish order | Horizontal or vertical temporal line |
| `connection` | Link current and prior knowledge | Animated line / echoed phrase |
| `lead` | Offer a new direction | Quiet continuation choices or free response |
| `reflection` | Invite a note | Minimal margin prompt |
| `resolution` | Close a local trail | Zoom out to accumulated understanding |

## Streaming strategy

Do not wait for a complete research report.

### Fast path — first 5–15 seconds

- parse user curiosity;
- create case objective;
- retrieve a small set of obvious high-quality sources;
- produce the first 2–3 beats;
- show honest research status in a non-theatrical way.

### Deep path — ongoing

- expand queries;
- retrieve primary and secondary sources;
- validate locators;
- cluster claims;
- discover contradictions;
- sequence later beats;
- compare with user notes and prior cases.

### UI behavior

The user can begin reading while later beats arrive. Empty future space should not show skeleton-card clutter. Use a single quiet line such as:

> The investigator is following two unresolved accounts.

## Scroll grammar

### Arrival

The home screen collapses into the selected film. The title persists as a spatial anchor, then reduces into the case masthead.

### Reveal

Text arrives by phrase or line, not by typewriter character animation. Character-by-character effects are tiring for long reading.

### Accumulation

Previously read evidence becomes a faint margin history rather than disappearing.

### Interruption

A contradiction or major turn breaks rhythm: temporary stillness, changed measure, stronger contrast, or an intentional snap.

### Branch

The current sentence remains visible while the next lead emerges from a phrase, note, person, place, or source.

### Connection

A term from an earlier passage briefly reappears; a line traces the relation; the user can accept, dismiss, or annotate it.

### Resolution

The camera does not fly into 3D. The document scale simply changes and the accumulated trail becomes visible as structure.

## Reading modes

### Guided

The agent controls sequencing and pauses at meaningful forks.

### Free trail

The user asks and moves quickly; the agent rearranges future beats.

### Source-first

The user sees more direct excerpts and less narration.

### Quiet

Assistant suggestions are suppressed unless trust, contradiction, or a requested connection requires attention.

## Session continuity

Persist:

- scroll position;
- current lead;
- unresolved questions;
- note drafts;
- assistant conversation state;
- playlist state;
- source openings;
- accepted and dismissed connections;
- style overrides.

The user must be able to return days later without receiving a generic recap dump.
