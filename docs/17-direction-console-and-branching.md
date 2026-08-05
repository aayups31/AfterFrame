# 17 — Direction Console and Branching

## Product rule

The investigator is not a texting destination. The user gives it a direction; the main investigation changes.

```text
User direction
  → intent classification
  → branch decision
  → short acknowledgement
  → targeted research run
  → verified findings
  → main-screen branch transition
```

The acknowledgement is atmospheric feedback, not the deliverable. Good examples:

- “Whoa—let me get in on that.”
- “That changes the trail. I’m following it.”
- “I see the angle. Let me pressure-test it.”
- “There may be something here. I’m checking the strongest version first.”

Never say “you are definitely right” before evidence exists.

## Direction types

The router classifies every submission into one primary action:

- `THEORY` — a user-authored interpretation to test;
- `QUESTION` — a focused uncertainty to investigate;
- `LEAD` — a person, scene, interview, source, symbol, or event to follow;
- `FOCUS` — narrow the current branch;
- `WIDEN` — bring in another research axis;
- `CHALLENGE` — search for disconfirming evidence;
- `COMPARE` — place two scenes, versions, claims, films, or sources beside each other;
- `CONNECT` — test a proposed relationship;
- `STYLE` — change depth, pace, voice, or source strictness;
- `RETURN` — leave the current branch and restore a prior trail.

## Branch decision

A direction may:

1. create a new child branch;
2. redirect the active branch;
3. insert a small detour and return;
4. deepen the current branch without creating a new node;
5. merge two existing branches after user approval.

The system should create a branch when the direction changes the question, evidence set, or interpretation enough that the user may later want to return to the previous path.

## Main-screen transition

When a branch opens:

- the current stream recedes rather than disappearing abruptly;
- the direction appears once as the branch origin;
- a compact branch thesis or objective replaces the previous trail label;
- the first research status is honest and operational;
- initial verified findings stream into the main reading surface;
- the branch remains addressable from the case world.

The UI must not show a transcript of every acknowledgement. Direction events are provenance, not conversation content.

## Branch states

```text
PROPOSED
  → INTERPRETING
  → RESEARCHING
  → OPEN
  → PRESSURE_TESTING
  → STABLE | FRAGILE | UNDERDETERMINED | CONTRADICTED
  → MERGED | PAUSED | CLOSED
```

A branch can remain open indefinitely. “Stable” means the current evidence supports continued use; it does not mean canonically true.

## Data required

Each branch stores:

- user-authored origin text;
- normalized objective;
- branch type;
- parent branch;
- fork beat and evidence anchors;
- included and excluded research axes;
- current support state;
- unresolved questions;
- accepted and rejected connections;
- research runs and prompt versions;
- closure disposition.

## Failure and degraded behavior

If research fails, the branch still opens with an honest state:

> “I can frame the question, but I could not verify enough material yet.”

The system must never fabricate a dramatic branch because the UI expects one.
