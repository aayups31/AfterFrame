# Build Checkpoint 03 — Durable Worker and Deployed Postgres

Checkpoint 03 turns the research-run design into a deployed, crash-aware
execution foundation. It still does not publish a generated answer or expose a
live research route. It proves that a future Movie Investigator stage can spend
time or money only after durable ownership of the work has been established.

```text
authenticated actor + active case
→ atomic seven-stage run creation
→ token-fenced worker claim
→ heartbeat and canonical checkpoints
→ same-attempt provider handoff and recovery
→ atomic stage completion or bounded failure
→ idempotent replay + semantic event/outbox state
```

## What is implemented

### Durable application worker

- A strict worker command boundary and injected executor registry. The worker
  resolves a stage implementation; it is not a single prompt-to-model call.
- Claim-before-external-work, optimistic run/job/attempt versions, expiring
  token-fenced leases, serialized heartbeats, and cancellation/lease-loss
  handling.
- Canonical progress, provider-accepted, and output-validated checkpoints.
- Same-attempt handoff for resumable provider work. Recovery retains the
  external idempotency key and provider checkpoint instead of starting a
  second paid request.
- Fail-closed handling when a provider start may have succeeded but no durable
  resume point exists. Ambiguous work is never retried blindly.
- A finite lease-epoch/handoff budget so poisoned or abandoned jobs cannot
  retry forever.
- Strict, body-free failure envelopes and truthful `COMPLETE`, `PARTIAL`, or
  `UNAVAILABLE` telemetry. Unknown usage and cost remain null; the system does
  not invent zeroes.

### Postgres and Supabase boundary

- Atomic, actor-scoped RPCs for research-run reservation/commit and worker
  claim, heartbeat, checkpoint, completion, failure, and handoff.
- Immutable run-start replay snapshots and idempotent terminal mutation
  results.
- Separate attempts, leases, checkpoints, failures, and handoff audit records.
- Transactional semantic events and outbox records for every accepted state
  transition.
- Forced row-level security on every `af_*` table. Browser roles have no table
  privileges and cannot execute server worker functions. Internal mutation
  helpers are not directly executable even by the service role.

Migrations 001–007 are deployed to the configured Supabase project. Migration
007 is a forward-only function correction: a real lifecycle test found that
PostgreSQL interpreted the PL/pgSQL variable name `current_time` as the built-in
SQL value with a different type. Migration 006 now uses the unambiguous
`observed_at` name for clean installs; migration 007 replaces exactly the six
affected deployed functions and changes no tables or durable data.

### OpenAI background boundary

- The source-discovery adapter is split into explicit start, retrieve, and
  cancel operations for Responses background mode.
- A provider-accepted response ID can be durably checkpointed before polling,
  which is the prerequisite for safe recovery.
- Discovery output remains candidate metadata only. Generated prose is
  discarded, provider/search content is untrusted, and every lead remains
  `NOT_EVIDENCE` with no publication authority.
- The exact private question is marked as provider input in telemetry. It is
  never copied into logs, events, failure messages, or analytics.

The adapter remains uncomposed and no OpenAI call is made by the public route.
Background response retention is treated as a bounded operational dependency;
a lost resume window must degrade or fail closed rather than restart unknown
paid work.

## Real database proof

The guarded Postgres integration test uses the production run-start and worker
store adapters over one database transaction. It verifies:

1. an owned case and branch stage exactly seven logical research jobs;
2. the identity job is claimed once;
3. a provider-accepted checkpoint is committed and replayed canonically;
4. a retryable timeout hands off the same running attempt;
5. another worker reclaims that attempt with a higher lease epoch and the same
   provider checkpoint;
6. completion persists exactly one output and replays idempotently;
7. a later claim sees the terminal result instead of executing again;
8. run-start replay returns the immutable original start result;
9. the entire fixture transaction rolls back and all table/user counts return
   to their exact pre-test values.

Post-deployment verification records 30 `af_*` tables, 48 functions, forced
RLS on all 30 tables, zero browser-role function/table access, all nine public
worker RPC signatures intact, migrations 001–007 tracked, and zero persisted
integration fixture rows.

## What this does not claim

The production investigate route still returns `LIVE_RESEARCH_NOT_COMPOSED`
when mock mode is disabled. There is not yet a concrete stage-executor registry,
queue dispatcher, durable resolved-subject record, source resolver, locator
verifier, evidence normalizer, claim assessor, contradiction graph, or paced
investigation read model.

The worker foundation is real. The complete live research agent is not ready
yet. Keeping that distinction explicit prevents a safe model/tool adapter from
being mistaken for the investigation engine itself.

## Verification

Use the pinned toolchain:

```bash
cd starter
nvm use
npm ci
npm run check
```

The real database lifecycle is opt-in because it needs the server-only pooler
credential and performs remote calls. It is transactionally rolled back:

```bash
cd starter
nvm use
AFTERFRAME_DB_INTEGRATION=1 npx vitest run \
  src/infrastructure/persistence/__tests__/checkpoint-03-postgres.integration.test.ts
```

From the repository root:

```bash
python3 scripts/validate-kit.py
```

## Next production slice

Checkpoint 04A is deliberately narrower than “turn on the agent”:

1. Persist a resolver-verified, domain-neutral public subject identity; TMDB is
   injected only by the Movie Investigator composition layer.
2. Have Postgres author a private-body-free causal input manifest for every
   attempt, binding it to the immutable subject, plan, objective fingerprint,
   immediate predecessor output, and verified identity.
3. Implement the first concrete durable `IDENTITY` executor and complete it
   atomically through versioned claim/complete RPCs.
4. Prove that the following `SCOPING` claim is bound to that exact verified
   identity and predecessor output in another rollback integration test.
5. Keep the route, OpenAI discovery, browser companion, Watson expansion, and
   all factual publication disabled.

Checkpoint 04B can then compose multi-axis candidate discovery. Secure source
and locator resolution, evidence/claim normalization, corroboration, and paced
sequencing follow as separate gates. No factual beat becomes visible before
those records and their provenance are atomically durable.

Checkpoint 04A's implementation and current release status are recorded in
`docs/47-build-checkpoint-04a.md`.
