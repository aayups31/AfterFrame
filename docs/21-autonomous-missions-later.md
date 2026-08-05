# 21 — Autonomous Missions: Later, but Designed Now

## Feature promise

The future feature is not “offline research.” It is **server-side work while the user is away**.

The user leaves a mission:

> “Explore whether the bookshelf scene was foreshadowed by earlier visual geometry. Prioritize screenplay drafts, Nolan interviews, production design, and counterexamples.”

A cloud worker continues after the browser closes. When the user returns, the case greets them with verified branch headlines:

- “A screenplay revision changes the meaning of the watch.”
- “Two supposed independent theories trace back to one interview.”
- “Your geometry idea survives the opening and ending, but not the school sequence.”

## Why it is deferred

Autonomous research is expensive and creates trust, cost, rights, and observability problems before the core foreground experience is proven. Build it after users trust branching, evidence quality, and source locators.

## Architectural seams to add now

Create domain objects for:

- `research_missions`;
- budgets and source constraints;
- checkpoints;
- resumable research runs;
- branch proposals;
- return digests;
- notification preferences;
- mission cancellation;
- cost and tool-call ledger.

Foreground targeted research should use the same run model so autonomous missions become an execution-mode change, not a rewrite.

## Mission authorization

A mission must specify:

- objective;
- allowed case scope;
- source priorities and exclusions;
- maximum spend, time, source count, and branch count;
- whether new branches may be created automatically or only proposed;
- whether user notes may be referenced;
- spoiler and rights constraints;
- stopping conditions.

## Safe autonomy boundary

The system may autonomously:

- search;
- resolve;
- extract;
- verify;
- compare;
- create provisional branches;
- update internal theory assessments;
- prepare a digest.

It may not autonomously:

- publish;
- share private notes;
- finalize the user’s belief;
- close the investigation;
- purchase access;
- bypass a paywall;
- exceed the mission budget;
- turn provisional findings into an approved script.

## Return experience

The greeting is a prioritized digest, not a work log.

Each headline must include:

- why it matters to the mission;
- branch state;
- source count and independence summary;
- material caveat;
- direct entry into the created branch.

The system must not say “I found something incredible” unless the underlying finding is both real and unusually consequential.
