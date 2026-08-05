# 39 — Premium Design Production Specification

## Design thesis

The home page earns attention. The investigation earns time.

The portal may be visually audacious and film-specific. Once the case opens, the interface becomes an almost invisible editorial instrument: typography, source whispers, pacing, motion, sound, and user thought arranged with extreme control.

Premium is not the number of effects. Premium is the absence of accidental behavior.

## Surface hierarchy

### Portal

- high-impact film imagery or abstract film-derived motion;
- oversized typography;
- one dominant action;
- cinematic transition into the selected title;
- no feature cards or product tour grid;
- recent cases may appear as typographic traces, not tiles.

### Case opening

- title collapses into the masthead;
- one unresolved sentence occupies the screen;
- curiosity prompt is the only obvious input;
- case intent appears as a proposed reading, not a settings form;
- transition audio remains optional.

### Investigation

- sustained text measure of roughly 58–72 characters;
- one dominant narrative or evidence action per viewport;
- evidence remains visible as quiet marginal notation;
- controls enter only when context makes them relevant;
- no persistent left navigation rail unless later testing proves essential;
- branch position is communicated through text, line, and rhythm rather than a dashboard breadcrumb stack.

### Reflection / case world

- spatial layout is built from text labels, lines, anchors, notes, and temporal distance;
- no default rectangular graph nodes;
- only the focused object expands detail;
- user-created structure is visually distinct from agent-proposed structure.

## Token system

Implement tokens before component-specific values:

```css
:root {
  --af-bg: #090a0b;
  --af-fg: #f1eee7;
  --af-fg-muted: color-mix(in srgb, var(--af-fg) 52%, transparent);
  --af-line: color-mix(in srgb, var(--af-fg) 14%, transparent);
  --af-signal: #d7b66b;
  --af-warning: #d89074;
  --af-measure-reading: 68ch;
  --af-measure-cinematic: 18ch;
  --af-gutter: clamp(20px, 4vw, 72px);
  --af-space-1: 4px;
  --af-space-2: 8px;
  --af-space-3: 12px;
  --af-space-4: 20px;
  --af-space-5: 32px;
  --af-space-6: 52px;
  --af-space-7: 84px;
  --af-space-8: 136px;
  --af-ease-out: cubic-bezier(.16, 1, .3, 1);
  --af-ease-in-out: cubic-bezier(.65, 0, .35, 1);
}
```

Each film may contribute one controlled accent and one media treatment. It may not replace the core reading system.

## Typography system

Use variable font loading only from licensed product assets. The starter must remain usable with system fallbacks.

Roles:

- `display-film`: portal and title moments;
- `display-case`: unresolved statements and chapter turns;
- `reading`: investigation prose;
- `evidence`: source labels, locators, trust state;
- `instrument`: controls and system status.

Rules:

- do not use monospaced text as shorthand for “investigation” everywhere;
- do not uppercase sustained controls or paragraphs;
- keep evidence labels compact but readable;
- preserve typographic hierarchy without boxes or background panels;
- paragraphs should enter as units, not typewriter characters.

## Scroll choreography

Every beat receives a motion purpose:

```ts
type MotionPurpose =
  | "arrive"
  | "reveal"
  | "accumulate"
  | "interrupt"
  | "branch"
  | "connect"
  | "resolve";
```

### Rules

- animation begins from user scroll or an explicit action;
- no effect may make text harder to reread;
- source controls become interactive before decorative motion completes;
- pinning is limited to one semantic transition at a time;
- previous context remains findable;
- streaming insertion never jumps the active paragraph;
- reduced motion produces the same document order and meaning.

## Source inspector behavior

The inspector should feel like opening the evidence, not opening a card.

Desktop:

- the reading measure shifts slightly;
- a hairline and source metadata enter from the evidence margin;
- exact location is the visual center;
- “open original” is primary;
- confidence, limitations, and source role remain text-based.

Mobile:

- use a bottom sheet with predictable focus;
- preserve the selected passage behind it;
- return focus to the originating hint on close.

## Note creation choreography

1. User selects text or invokes the note gesture.
2. A minimal inline rail appears.
3. Choosing a note type opens an unboxed writing field aligned to the passage.
4. Save collapses the note into a margin mark and subtle line.
5. The note can later unfold into the case world.

Creating a note must require no modal form. Graph placement can be deferred.

## Sound system

- playlists are user-authored or linked;
- no soundtrack is required for product comprehension;
- volume and ducking remain under user control;
- crossfade only when technically permitted by the playback source;
- navigation never restarts a track accidentally;
- silent mode is first-class;
- audio state persists per case but does not follow the user unexpectedly into another context.

## Design review questions

Before approving a screen:

1. What is the one thing the eye should do first?
2. Is any element visible only because a dashboard convention expects it?
3. Can a hairline, spacing, or timing replace a container?
4. Does motion reveal a state change or merely advertise implementation effort?
5. Can the user reread and verify without fighting choreography?
6. Does the interface still feel complete in silence and reduced motion?
