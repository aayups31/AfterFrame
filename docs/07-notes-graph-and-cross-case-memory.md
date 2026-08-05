# 07 — Notes, Graphs, Flows, and Cross-Case Memory

## Goal

Notes are the visible proof that the user—not the agent—constructed the world.

## Note types

```ts
type NoteKind =
  | "thought"
  | "sticky"
  | "question"
  | "claim"
  | "counterpoint"
  | "entity"
  | "event"
  | "flow_step"
  | "connection"
  | "portal";
```

## Anchors

A note can anchor to:

- text range;
- exploration beat;
- claim;
- evidence fragment;
- person/place/event;
- timestamp;
- PDF page;
- another note;
- another case.

Anchors must survive copy edits. Store both semantic IDs and a text fingerprint fallback.

## Smooth note creation sequence

1. User highlights text.
2. A hairline action menu appears.
3. User selects note type or starts typing.
4. Note text remains visually near the anchor.
5. The system quietly saves.
6. Optional connection suggestions arrive after the thought is captured—not before.

## Sticky notes

“Sticky” describes behavior, not visual skeuomorphism. Do not force yellow squares. A sticky thought can be a floating editorial annotation with a subtle pin marker.

## Graph behavior

### Node sources

- user-created notes;
- verified entities;
- claims;
- events;
- sources;
- cases.

### Edge types

- supports;
- contradicts;
- caused;
- preceded;
- involved;
- resembles;
- derived from;
- user connected;
- agent suggested.

Agent-suggested edges remain visually provisional until accepted.

## Flow charts

A flow is useful for:

- mission sequence;
- decision chain;
- myth lineage;
- production pipeline;
- causal explanation;
- timeline with branches.

Creating one should be possible from selected beats:

```text
Select → Add to flow → Arrange automatically → Refine manually
```

## Cross-case memory

Maintain a user knowledge index containing only objects the user has saved or explicitly permitted the system to retain.

Example:

```text
Current finding: fragmented command authority during Operation Gothic Serpent
Prior note: “Who actually had final authority?” — 13 Hours case
Suggested relation: shared pattern, not identical cause
```

The assistant must state why the relation is being suggested.

## Retrieval priority

1. exact current anchor;
2. nearby beats;
3. current case notes;
4. current case graph neighborhood;
5. user-approved prior case notes;
6. broader case evidence.

## Privacy boundary

- allow per-case memory off;
- allow deletion of individual notes and derived embeddings;
- show which prior cases are being used;
- do not infer sensitive personal beliefs from media investigations;
- distinguish private note, shared case, and published artifact.
