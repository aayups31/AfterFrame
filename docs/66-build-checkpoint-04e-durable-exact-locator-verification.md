# Build checkpoint 04E.1 — durable exact-locator verification

Date: 2026-09-07

## Outcome

AFTERFRAME can now re-parse retrieved web and PDF bytes, independently verify a
proposed normalized block against the original snapshot, and atomically persist
a superseding `VERIFIED_EXACT` source-locator revision. Migration 017 is
deployed.

The installed-database lifecycle proves both supported paths:

- HTML uses the exact UTF-8 source-byte interval, paragraph ordinal, structural
  heading fingerprints, and text/range fingerprints;
- PDF uses an identified snapshot and page together with the PDF page object,
  parser item interval, bounded page-space geometry, page-text fingerprint,
  page-structure fingerprint, anchor fingerprint, and text fingerprint.

The verifier does not accept a model-authored citation as truth. A proposal may
identify a block and expected fingerprints, but deterministic re-parsing and the
database acceptance boundary decide whether the locator is exact.

## Independent verification boundary

`DeterministicExactLocatorVerifier` receives the authoritative durable
normalization-record ID separately from the proposal. It validates the proposal
against that lineage, re-parses the original bytes with the same bounded hostile
document adapter, and requires the resulting document, block text, and anchor
fingerprints to match the accepted normalization receipt.

The output contains no source prose. It carries only identifiers, exact target
coordinates, fingerprints, verifier identity, and a new source-locator revision.
The result remains:

- untrusted source data;
- instruction authority `NONE`;
- review state `PROPOSED`;
- evidence status `NOT_EVIDENCE`;
- publication authority `NONE`.

An exact location establishes where material came from. It does not establish
that the material is true, independent, relevant, or sufficient for a claim.

## Durable acceptance and recovery

`af_accept_exact_locator_verification_v1` independently validates:

- actor, case, run, job, attempt, active lease, and immutable input manifest;
- committed retrieval, snapshot, source, and previous-locator lineage;
- exactly one accepted byte-document or PDF normalization record;
- `PASSED` hostile-content screening and permitted access/rights state;
- document, block-text, and web-range or PDF-anchor fingerprints;
- source medium, canonical URL, locator revision, verifier identity, and time;
- the text-free result contract and its explicit lack of evidence authority.

For a verified result, the function creates the source-locator revision and
verification ledger record in one transaction. The first decision returns
`COMMITTED`; an identical retry returns `REPLAY`. The target identity is unique
per attempt, normalization kind, durable normalization record, and block
ordinal. A stale, released, expired, cancelled, or superseded lease cannot
write. The worker revokes local authority if a returned durable record cannot be
proven byte-for-byte equivalent to its submitted decision.

## Database security

`af_exact_locator_verification_records` uses forced Row Level Security and
default-deny grants. Anonymous and authenticated clients cannot read or mutate
the ledger. Actor-scoped service-role RPCs provide acceptance and typed
readback. The verified locator has a database foreign key back to its source,
and the ledger retains the prior locator, retrieval, normalization, run, job,
attempt, manifest, and verifier lineage.

Deployment is reproducible through `npm run db:migrate:017`. It requires the
exact 001–016 baseline, takes the schema-migration advisory lock, refuses active
research jobs, verifies table, RLS, RPC, locator-lineage, target-idempotency, and
client-denial postconditions, and records migration 017 atomically.

## Verification

- deterministic verifier tests cover successful web and PDF re-resolution,
  authoritative normalization-record lineage, changed bytes, changed targets,
  quarantine, unsupported media, source/locator mismatch, and malformed input;
- SQL contract tests cover exact JSON allowlists, lease fencing, actor scope,
  normalization lineage, fingerprint comparison, target uniqueness, RLS, and
  the evidence-authority separation;
- migration 017 passed rollback-only preflight against the deployed 001–016
  baseline;
- the installed Supabase schema passed stale-lease rejection, exact
  commit/replay, typed readback, web and PDF locator revision creation, and
  rollback cleanup;
- the live lifecycle confirmed two exact locators and zero evidence records;
- 454 active tests pass; strict TypeScript, zero-warning ESLint, and the
  production Next.js build are green.

## Honest boundary

This slice supports deterministic HTML/webpage passages and PDF text regions.
It does not yet resolve transcript cues, video timecodes, book editions/pages,
or film timestamps tied to an identified cut. A PDF anchor is a reproducible
parser observation, not OCR, semantic page labeling, or proof of a quotation.
No claim, corroboration group, contradiction, or investigation beat is created
here, and the public live-research route remains disabled.

## Next gate

The next checkpoint is the evidence-fragment acceptance boundary: extract a
bounded candidate fragment only from a verified locator, persist its exact
source/snapshot/locator lineage separately from claims and prose, preserve
rights and uncertainty, and require review before it can support a claim. The
broader transcript, timecode, book-edition/page, and identified-film-cut locator
classes follow as their own honest resolver adapters rather than guessed model
citations.
