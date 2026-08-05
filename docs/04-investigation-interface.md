# 04 — Investigation Interface

## Visual character

Premium editorial investigation—not “detective cosplay.”

Reference qualities:

- museum exhibition typography;
- luxury editorial spacing;
- documentary pacing;
- archival precision;
- restrained forensic annotations;
- cinematic sound discipline.

## Desktop composition

```text
┌ masthead: film / case intent / current trail / quiet controls ┐
│                                                               │
│ editorial margin      primary exploration      evidence margin│
│ prior anchors         text / media / pauses    source hints   │
│                                                               │
│                direction console (collapsible)                 │
│ soundtrack line          note gesture                           │
└───────────────────────────────────────────────────────────────┘
```

This is a layout diagram, not a recommendation for visible boxes.

## Primary exploration column

- 58–72 characters per line for sustained passages;
- larger measure for one-line cinematic beats;
- clear rhythm between evidence and interpretation;
- no infinite wall of text;
- no standard article header/body/footer template;
- visual rests every few beats.

## Evidence hints

Evidence should first appear as a subtle margin cue:

```text
01  Bowden, ch. 3, pp. 42–44
02  Eversmann oral history, 18:42
```

Hover/focus reveals why the source matters. Activation opens the source inspector. A second action opens the original.

## Direction console

Collapsed state:

```text
Give the investigator a direction…
```

Expanded state supports:

- a theory;
- a question or lead;
- “follow this”;
- “challenge this”;
- “compare the accounts”;
- “connect this to…”;
- “slow down / go deeper / move on.”

Submission triggers a branch action in the main surface. Acknowledgements may appear as a temporary lower-third line and then recede. Do not preserve a visible chat transcript as the primary interaction history.

## Notes interaction

### Highlight gesture

On selecting text, a thin action rail appears near the selection:

```text
NOTE · QUESTION · CONNECT · HOLD
```

### Note palette

Invoked by shortcut or control:

- text note;
- sticky thought;
- claim;
- counterpoint;
- question;
- graph node;
- flow step;
- link;
- portal to another case.

### Placement

By default, the system places a note in the nearest clean margin location and records its anchor. The user can later open the spatial case world for manual layout.

### Agent suggestions

Example:

> This resembles your note about chain-of-command ambiguity from the 13 Hours case. Connect them?

Actions:

```text
CONNECT · COMPARE FIRST · DISMISS
```

Never auto-connect user-authored meaning.

## Graph and flow view

Do not render conventional rectangular node cards. Prefer:

- text labels;
- small evidence symbols;
- thin directional lines;
- halos for uncertainty;
- temporal positioning;
- clusters formed through spacing;
- details on focus, not permanently visible.

## Mobile

- one reading column;
- evidence opens as a bottom sheet;
- assistant uses a temporary full-width layer;
- notes anchor to passages and are organized later;
- playlist remains a minimal line control;
- no tiny graph editing; use relationship lists and defer spatial arrangement to larger screens.

## Accessibility

- all reveal content must exist in normal document order;
- motion cannot be required to understand relationships;
- source hints need keyboard focus;
- color cannot be the only confidence signal;
- audio is off by default unless the user has explicitly enabled it;
- reduced-motion mode replaces transform choreography with fades and static anchors.

## Branch transition

When a direction creates a branch, the current stream recedes, the branch origin appears once, and the new objective becomes the current trail. Research status and verified findings occupy the main column. Returning restores the prior reading position.

## Close control

A quiet `CLOSE INVESTIGATION` action lives at the end of the trail and in the case-world view. It opens a closure review followed by optional creation formats. It must not be visually treated as a destructive action.
