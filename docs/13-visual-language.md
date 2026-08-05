# 13 — Visual and Motion Language

## Working visual thesis

**Cinematic at entry. Editorial during thought. Forensic at inspection. Spatial at reflection.**

## Palette

Use near-black and warm off-white as the base. Introduce one film-derived accent at a time. Avoid constant neon gradients.

Example tokens:

```css
--ink: #0b0c0d;
--paper: #f0eee8;
--muted: rgba(240, 238, 232, 0.48);
--hairline: rgba(240, 238, 232, 0.16);
--signal: #d7b66b;
--danger: #d87568;
```

These are starting points, not a locked brand palette.

## Typography

Use a high-contrast display face only for major film/title moments and a restrained grotesk or humanist sans for sustained reading. The starter uses system fonts so no font files are distributed.

Hierarchy:

- portal title: 8–16vw;
- case opening sentence: 5–9vw;
- major beat: 3–6vw;
- reading passage: 20–30px desktop;
- evidence margin: 11–13px uppercase/mono treatment;
- assistant: reading size, never tiny chat text.

## Spacing

- full-viewport beats need real empty space;
- paragraphs should not be stacked at conventional article density;
- source hints align to baselines;
- controls should appear only when context needs them.

## Motion principles

### Timing

- micro response: 120–220ms;
- control transition: 220–420ms;
- sentence reveal: 500–900ms;
- major case transition: 900–1600ms;
- never delay user input merely to appear cinematic.

### Easing

Prefer natural deceleration and long exits. Avoid bouncy UI except in explicitly playful home details.

### Scroll effects

Use:

- opacity and small vertical offset;
- selective blur resolving to clarity;
- scale changes under 4%;
- sticky text anchors;
- mask/clip reveals;
- line drawing for accepted connections;
- crossfades between evidence layers;
- progressive margin annotations.

Avoid:

- constant horizontal scroll;
- large parallax on reading text;
- scroll hijacking;
- excessive pinning;
- character-by-character typing;
- 3D camera navigation.

## Sound

- optional from first interaction onward;
- user controls all playback;
- smooth crossfade between user-selected tracks when provider permits;
- lower volume during spoken assistant output;
- never autoplay before user gesture;
- provide a full silent mode.

## Component vocabulary

Prefer names that reinforce behavior rather than boxes:

- `CaseMasthead`
- `ExplorationBeat`
- `EvidenceWhisper`
- `SourceInspector`
- `DirectionConsole`
- `NoteGesture`
- `ConnectionTrace`
- `TrailMarker`
- `SoundtrackLine`
- `WorldView`
