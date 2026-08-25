# Build checkpoint 04C.2 — durable source-resolution acceptance

Date: 2026-08-25

## Outcome

AFTERFRAME now has a deployed, lease-fenced Postgres boundary for turning every
persisted discovery candidate into exactly one durable resolution decision. A
decision may create a conservative source identity and source-level locator, or
retain a bounded unresolved reason. It cannot create evidence, claims,
investigation prose, or publication authority.

Migration 013 is deployed. The real rollback-only lifecycle proves `IDENTITY →
SCOPING → DISCOVERY → RESOLUTION`, including atomic resolution acceptance and
the guarded unlock of `NORMALIZATION`.

## Durable contract

- Postgres authors the RESOLUTION context from the locked run, attempt manifest,
  case, and persisted discovery candidates.
- Every accepted record is bound to the active run, job, attempt, manifest,
  candidate, resolver ID/version, and idempotency key.
- A resolved decision persists its source, source-level locator, case-source
  relationship, and resolution ledger entry in one transaction.
- An unresolved decision remains explicit and preserves its bounded failure
  code.
- An identical retry returns `REPLAY`; a changed decision for the same candidate
  is rejected instead of silently overwriting history.
- Acceptance refreshes only the matching live lease. Lost, released, expired,
  cancelled, or superseded work cannot write.

## Independent database enforcement

The database does not trust the TypeScript resolver result. It independently
checks:

- strict JSON shape and scalar/domain bounds;
- the candidate's authoritative run, medium, and source class;
- the exact attempt manifest fingerprint;
- the attempt's resolver tool identity and body-free execution declaration;
- deterministic `url-sha256` canonical identity;
- canonical URL, source medium, locator kind, and resolver agreement;
- `OPEN`, `LINK_ONLY`, `SOURCE_ONLY`, `PROPOSED`, `NOT_EVIDENCE`, and `NONE`
  authority states;
- absence of content bodies, inferred contributors, publisher, publication
  date, and independence claims.

The resolution ledger uses forced RLS and default-deny grants. Only the
service-role actor-scoped RPC boundary can read or mutate it.

## Stage-completion gate

A RESOLUTION job cannot complete by merely claiming output IDs. Postgres
compares the proposed `sourceIds`, `locatorIds`, and
`unresolvedCandidateIds` with the accepted decision ledger and requires an
exact, duplicate-free partition of every discovery candidate. Only then is the
stage output persisted and NORMALIZATION queued.

## Verification

- migration 013 passed an atomic rollback preflight over deployed migrations
  001–012;
- the deployed database passed the full rollback-only generic-film lifecycle;
- acceptance commit and exact replay were exercised against real Postgres;
- one source, locator, resolution record, and RESOLUTION output were observed,
  followed by a queued NORMALIZATION job;
- rollback returned every production table to its baseline row count;
- strict typecheck, ESLint, 317 unit/contract tests, and the Next.js production
  build pass;
- `npm audit` remained at zero known vulnerabilities in the preceding full
  dependency audit.

## What this does not claim

The durable source-resolution substrate is production-grade, but the complete
RESOLUTION executor is not yet registered in the worker composition. The
integration deliberately drives the resolver and persistence boundary directly
to prove the database invariants first. No source body has been retrieved and
no exact passage, page, transcript cue, or film timestamp has been verified.

## Next gate

Checkpoint 04C.3 will build the resumable RESOLUTION stage executor over this
ledger: bounded candidate scheduling, heartbeat and takeover behavior,
per-candidate commit/replay recovery, truthful degraded outcomes, and final
exact-partition completion. After that, medium-specific retrieval can enter the
hostile-input boundary and exact-locator verification can begin.
