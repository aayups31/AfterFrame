# 03 — Homepage Storyboard

The homepage is the highest-intensity visual surface. It sells possibility before asking for work.

## Scene 1 — Atmospheric opening

Full viewport. Near-black background. Film titles, years, names, fragments of maps, frame counts, and thin typographic traces drift at different speeds. No 3D scene. The effect should feel like cinema memory passing through the screen.

Copy:

```text
THE FILM ENDS.
THE WORLD OPENS.
```

Subcopy appears later, not immediately:

```text
Choose the film that left a question behind.
```

## Scene 2 — Film selection

Search is visually integrated into the composition, not placed in a rounded search card.

As a film becomes active:

- surrounding titles recede;
- the selected title expands;
- its release year, director, and one evocative line appear;
- ambient visual language changes by film family;
- the CTA is simply `ENTER`.

Avoid copyrighted poster dependence in the initial prototype. Use licensed imagery, user-provided imagery, public metadata, generated abstract textures, or typography-first art direction.

## Scene 3 — Curiosity handoff

After selecting the film, everything except the title clears.

Prompt:

```text
What stayed with you?
```

Examples can appear as faint, non-clickable prompts:

```text
Why did the mission fail?
Was the mythology changed?
Which parts really happened?
What was the director trying to imply?
```

The text area is not a boxed form. It is a large editorial line with a blinking baseline and generous space.

## Scene 4 — Intent reflection

The agent reflects the understood intent in one short paragraph. User can edit it inline.

```text
You want to trace how a short capture mission became an extended urban battle,
and separate immediate mistakes from deeper political and operational constraints.
```

Action:

```text
OPEN THE CASE
```

## Scene 5 — Transition

The selected title remains while the page changes context. Research status appears as real milestones:

```text
Locating first-hand accounts
Resolving the mission timeline
Comparing official and participant accounts
```

Do not fake exact numbers, source counts, or progress percentages.

## Homepage motion budget

- 1 pointer-reactive atmospheric field;
- 1 title selection transformation;
- 1 curiosity handoff;
- 1 case-opening transition;
- no continuous expensive canvas effect required;
- respect `prefers-reduced-motion`.
