# Codex Phase 1C — Direction Console and Notes

Read:

- `docs/17-direction-console-and-branching.md`
- `docs/19-theory-engine.md`
- `docs/22-agent-personality-and-calibration.md`

Replace any chat-oriented investigator implementation with a direction console.

Direction requirements:

- collapsed by default;
- accepts theories, questions, leads, comparisons, challenges, connections, and style changes;
- gives at most one short acknowledgement;
- creates or redirects a branch in the main investigation surface;
- does not preserve a messenger-style transcript;
- stores the exact user text separately from normalized intent;
- supports return to the parent branch and restores reading position;
- includes loading, degraded, failure, keyboard, mobile, and reduced-motion states.

Notes requirements:

- highlight-to-note where browser selection permits;
- note types: thought, sticky, question, claim, connection, flow step;
- anchors to beat and evidence IDs;
- graceful mobile behavior;
- no yellow-sticky-note cliché;
- local persistence for the prototype.

Add one agent-suggested connection that requires explicit acceptance. Run lint, typecheck, build, and interaction tests.
