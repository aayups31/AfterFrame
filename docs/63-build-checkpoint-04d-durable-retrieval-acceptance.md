# Build checkpoint 04D.2 — durable source-retrieval acceptance

Date: 2026-08-31

## Outcome

AFTERFRAME now has a deployed, lease-fenced Postgres boundary for accepting
hostile-source retrieval decisions during `NORMALIZATION`. A decision records
either a bounded retrieval failure or an immutable receipt and snapshot
identity. It cannot turn source bytes into evidence, claims, instructions, or
published investigation prose.

Migration 014 is deployed. The real rollback-only lifecycle proves `IDENTITY →
SCOPING → DISCOVERY → RESOLUTION → NORMALIZATION retrieval` against the
installed Supabase schema and a live generic-movie identity from TMDB.

## Provenance correction

Retrieved content belongs to a source candidate created by `DISCOVERY`, even
when retrieval happens in a later `NORMALIZATION` attempt. Migration 014
corrects the prior attempt-local candidate foreign key and preserves the real
`(run, candidate)` lineage instead of pretending the candidate originated in
the normalization attempt.

Every accepted retrieval remains bound to:

- actor, case, run, normalization job, attempt, and input manifest;
- the original discovery candidate;
- the committed terminal-successful resolution attempt and its
  `RESOLUTION_RESULT`;
- the exact resolution ledger record, canonical source, and source locator;
- policy and retriever identities and versions;
- a deterministic retrieval-record fingerprint and idempotency key.

## Acceptance and replay

Postgres independently validates the strict record shape, authoritative source
and locator identity, access and rights states, receipt timestamps, content
fingerprint, storage policy, and live lease cursor. It does not trust the
TypeScript record merely because it passed Zod.

The first exact decision returns `COMMITTED`. An identical retry returns
`REPLAY` and refreshes only the matching active lease. A changed decision for
the same candidate is rejected. Released, expired, cancelled, stale, or
superseded work returns `LEASE_LOST` or `CANCELLED` and cannot write.

## Snapshot and rights invariants

- Retrieval receipts create immutable snapshot metadata keyed by source, case,
  and content fingerprint.
- An advisory transaction lock serializes competing writes for the same
  case/source/content identity.
- A content fingerprint cannot silently identify two snapshot IDs.
- `LINK_ONLY` retrieval is `TRANSIENT_ONLY` and must have no storage reference.
- Retainable content requires explicit rights authority and a storage
  reference.
- Raw response bytes are absent from the durable receipt and telemetry schemas.
- Every receipt and snapshot remains `UNTRUSTED_SOURCE_DATA`, `UNSCREENED`,
  `NOT_EVIDENCE`, with instruction and publication authority `NONE`.

The current live lifecycle deliberately uses link-only sources: it creates two
receipts and two immutable snapshot identities while retaining zero bodies.

## Database security

`af_source_retrieval_records` uses forced Row Level Security and default-deny
grants. Public, anonymous, and authenticated roles cannot read or mutate it.
Only actor-scoped service-role RPCs expose normalization context, accepted
records, and lease-fenced acceptance.

The deployment is reproducible through `npm run db:migrate:014`. It requires
the exact 001–013 baseline, takes the schema migration advisory lock, refuses
deployment while a research job is active, checks all table/RPC/RLS/lineage
postconditions, and records version 014 in the same transaction.

## Verification

- migration 014 passed its atomic rollback preflight over deployed migrations
  001–013;
- migration 014 deployed and registered atomically;
- the installed database passed the full rollback-only generic-film lifecycle;
- exact commit/replay, snapshot creation and deduplication, transient-only
  rights handling, stale-lease rejection, and baseline restoration were
  exercised against real Postgres;
- 407 active tests pass and 8 environment-gated tests are skipped in the local
  suite;
- strict TypeScript, zero-warning ESLint, the production Next.js build, and the
  71-artifact architecture validator pass;
- `npm audit` reports zero known vulnerabilities.

## Honest boundary

No hostile HTML, PDF, transcript, subtitle, book page, or screenplay body is
parsed yet. No instruction screening result is accepted yet. No exact passage,
page, cue, or film timestamp is verified. No evidence fragment or claim is
created, and the public production research route remains disabled.

## Next gate

Checkpoint 04D.3 will build the hostile-content normalization boundary. It will
produce a bounded, provenance-preserving document tree from independently
validated bytes; separate data from embedded instructions; quarantine malformed
or suspicious material; retain exact byte/structural anchors; and expose only
screened parser output to later medium-specific locator verification. Parsing
success will still not grant evidence or publication authority.
