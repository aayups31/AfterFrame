# Build checkpoint 04C.3 — resumable source-resolution executor

Date: 2026-08-30

## Outcome

AFTERFRAME now has a real durable RESOLUTION stage executor. It consumes the
Postgres-authored candidate context, recovers previously accepted decisions,
resolves only missing candidates, commits each decision through the active
worker lease, and emits an exact resolved/unresolved partition for guarded
stage completion.

This is agent orchestration rather than a model response wrapper: execution is
stateful, bounded, recoverable, authority-fenced, independently validated, and
capable of continuing the same attempt after process handoff.

## Worker-owned mutation authority

Source-resolution acceptance is now part of the durable worker store. The
executor cannot call the acceptance RPC with a captured lease. Instead, it
receives a narrow callback whose implementation is serialized with heartbeat,
checkpoint, provider-acceptance, release, and completion mutations.

The worker:

- validates that every decision belongs to the active RESOLUTION attempt and
  exact manifest;
- uses the current lease cursor at mutation time;
- validates the returned lease is a monotonic continuation;
- requires the stored record to equal the submitted decision exactly;
- revokes local authority on an uncertain or mismatched acceptance;
- prevents late writes after cancellation, lease loss, or shutdown.

The read-only resolution persistence adapter can reconstruct context and list
accepted decisions, but can no longer accept a decision independently. This
removes the stale-lease side path.

## Resumable execution

The executor uses a bounded candidate budget per invocation. Every candidate
decision is committed before the next one contributes to output. If the budget
is reached or a retryable resolver problem occurs after partial progress, the
worker releases the same idempotent attempt for a safe handoff.

On takeover, the next worker:

1. reconstructs the exact Postgres-authored context;
2. reads the accepted decision ledger;
3. rejects foreign, duplicate, or binding-mismatched records;
4. skips accepted candidates;
5. resolves and accepts only the missing partition;
6. deterministically rebuilds and checkpoints the final output;
7. asks Postgres to complete the stage.

Identical canonical sources and locators are deduplicated in stage output while
each candidate retains its own resolution decision. Unresolved candidates
produce a truthful `DEGRADED` result rather than disappearing.

## Production composition

The V1 executor registry can now compose RESOLUTION when supplied a body-free
`SourceCandidateResolver`. Without that explicit capability, the stage remains
fail-closed. Discovery remains separately gated by its data-control attestation.

The core worker/source-resolution contract was moved into the domain layer so
core orchestration does not depend on an application adapter implementation.

## Verification

- strict source-resolution executor tests cover complete degraded partition,
  partial-ledger recovery, bounded handoff, foreign-ledger rejection, missing
  mutation authority, and canonical source/locator deduplication;
- durable worker adapter tests cover the versioned acceptance RPC;
- the full deployed Supabase lifecycle now runs RESOLUTION through the actual
  executor rather than manually driving its persistence methods;
- the deployed lifecycle proves two candidates across two leases on one
  attempt: first decision commit, intentional release, takeover, skipped prior
  work, second decision commit, output checkpoint, stage completion, and
  NORMALIZATION unlock;
- all database fixture writes are rolled back and baseline counts are restored;
- strict typecheck, ESLint, 323 tests, and the production Next.js build pass.

## Honest boundary

The executor is fully functional with an injected resolver and the deployed
database. The production public-network metadata transport is not yet composed,
so live source probing and the public research route remain disabled. Resolution
still creates only body-free `SOURCE_ONLY`, `LINK_ONLY`, `NOT_EVIDENCE`
proposals; it does not claim exact passages, pages, transcript cues, or film
timestamps.

## Next gate

Checkpoint 04C.4 will implement the production public-network metadata probe:
DNS resolution and IP pinning, redirect-by-redirect revalidation, TLS and port
policy, abort/timeout limits, bounded headers, body exclusion, adapter kill
switches, and deterministic degraded behavior. After shadow evaluation, the
pipeline can proceed to hostile-input retrieval, normalization, and exact
medium-specific locator verification.
