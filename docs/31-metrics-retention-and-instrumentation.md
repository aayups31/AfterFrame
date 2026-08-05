# 31 — Metrics, Retention, and Instrumentation

## North-star behavior

**Voluntary next investigation rate:** the percentage of users who begin another meaningful case after completing or pausing one, without a forced prompt or incentive.

This measures whether AFTERFRAME becomes a place users return when curiosity appears.

## Supporting metrics

### Activation

A user is activated when they:

1. submit a real curiosity;
2. consume at least three evidence-backed beats;
3. perform one thinking action: note, direction, connection, or original-source inspection.

### Investigation depth

Track:

- active reading time, excluding idle tabs;
- beats meaningfully viewed;
- branches opened and returned from;
- evidence inspected;
- originals opened;
- notes created and revisited;
- unresolved leads preserved;
- case reopen rate.

Do not turn these into user-facing completion scores.

### Trust

- locator-open success;
- verified-locator ratio;
- source correction rate;
- unsupported-claim rate;
- evidence-to-claim coverage;
- source independence distribution;
- contradiction acknowledgment rate.

### Creator workflow

- cases per active project;
- research sessions per week;
- imported source count;
- dossier export rate;
- time from case opening to usable research artifact;
- repeat use on the next project.

### Cost and latency

- model and tool cost per activated case;
- cost per verified evidence fragment;
- first meaningful beat latency;
- branch response latency;
- resolver success by source class;
- cache hit rate;
- abandoned jobs.

## Event taxonomy

All events must use stable names and typed payloads. Initial events:

```text
case_started
intent_corrected
investigation_activated
beat_viewed
source_hint_opened
original_source_opened
note_created
note_revisited
direction_submitted
branch_opened
branch_returned
connection_accepted
connection_dismissed
case_paused
case_reopened
case_closed
artifact_exported
next_case_started
locator_failed
source_corrected
```

Do not log note bodies, private theories, selected text, source excerpts, or unreleased project names in analytics payloads.

## Cohort review

Review retention separately for:

- consumer curiosity;
- documentary creators;
- adaptation / biopic researchers;
- invited experts.

A single blended retention number will hide the real wedge.

## Guardrail metrics

- excessive intervention dismissal;
- users skipping narrative to reach conclusions;
- source hints ignored;
- notes created but never revisited;
- repeated branches with no new evidence;
- user correction of fabricated or misplaced locators;
- autoplay or motion complaints;
- privacy opt-outs after companion use.

## Instrumentation rule

Events describe product state transitions, not surveillance. Store only what is required to improve the investigation loop and trust layer.
