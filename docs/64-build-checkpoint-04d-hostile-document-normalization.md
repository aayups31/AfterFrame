# Build checkpoint 04D.3 — hostile-document normalization

Date: 2026-08-31

## Outcome

AFTERFRAME now has a deterministic hostile-content parser and a deployed,
lease-fenced Postgres boundary for accepting text-free normalization receipts.
The engine can turn independently retrieved HTML or plain text into bounded
semantic blocks with exact source-byte anchors while treating every source
character as untrusted data rather than an instruction.

Migration 015 is deployed. The live rollback-only lifecycle proves `IDENTITY →
SCOPING → DISCOVERY → RESOLUTION → NORMALIZATION retrieval → normalization`
against the installed Supabase schema and a generic movie identity from TMDB.

## Hostile parser boundary

The deterministic normalizer:

- validates the retrieved byte length and SHA-256 fingerprint before parsing;
- supports bounded HTML and plain text without executing active content;
- ignores raw script and style bodies, including deceptive `<` characters;
- decodes entities while retaining offsets back to the original UTF-8 bytes;
- emits ordered semantic blocks, heading ancestry, text fingerprints, exact
  byte ranges, and range fingerprints;
- detects hidden content, active or embedded content, credential forms, and
  direct or obfuscated prompt-injection language;
- applies strict byte, element, block, block-size, and hostile-signal limits;
- quarantines malformed, oversized, over-complex, or suspicious documents;
- never grants evidence, instruction, or publication authority.

The parser is behind a core normalization port. It does not import movie
specialist behavior, so the investigation engine remains domain-neutral while
Movie Investigator controls V1 source and research policy.

## Text-free durable receipt

The durable record contains document identity, source lineage, byte lengths,
block kinds, structural ancestry fingerprints, byte anchors, hostile-signal
metadata, rights state, and screening state. It deliberately excludes:

- raw HTML, PDF bytes, and normalized prose;
- source excerpts and heading text;
- prompt-like content from logs, telemetry, or RPC output;
- any model-generated interpretation of the document.

For `LINK_ONLY` material, normalization must remain `TRANSIENT_ONLY` and cannot
carry a storage reference. Quarantined material cannot be retained. Retainable
material requires an explicit rights state and opaque storage reference.

## Acceptance and replay

Postgres independently revalidates the full JSON contract and authoritative
retrieval lineage. Acceptance requires the active normalization lease, exact
input manifest, exact committed retrieval record, matching source, locator,
snapshot, rights and access policy, and a deterministic record fingerprint.

The first exact decision returns `COMMITTED`. An identical retry returns
`REPLAY`. A changed record for the same attempt/retrieval pair is rejected.
Released, expired, cancelled, stale, or superseded work cannot write. If the
worker cannot prove the returned durable record exactly matches its decision,
it revokes its own lease rather than proceeding under uncertainty.

Accepted parser output is represented in `af_untrusted_research_content` as a
text-free `DOCUMENT` boundary and remains `UNTRUSTED_SOURCE_DATA`,
`NOT_EVIDENCE`, `PROPOSED`, with instruction and publication authority `NONE`.

## Database security

`af_source_normalization_records` uses forced Row Level Security and
default-deny grants. Anonymous and authenticated clients cannot read or mutate
the ledger. Actor-scoped service-role RPCs provide lease-fenced acceptance and
readback.

The deployment is reproducible through `npm run db:migrate:015`. It requires
the exact 001–014 baseline, takes the schema-migration advisory lock, refuses
deployment while a research job is active, validates table, RPC, RLS, grant,
and lineage postconditions, and records version 015 atomically.

## Verification

- migration 015 passed its rollback preflight over deployed migrations 001–014;
- migration 015 deployed and registered atomically;
- the deployed database passed the full generic-film normalization lifecycle;
- exact commit/replay, a changed-record conflict, stale-lease rejection,
  transient-only retention, text-free readback, and baseline restoration were
  exercised against real Postgres;
- deterministic fixtures cover benign, malformed, oversized, over-complex,
  active, hidden, credential-seeking, and obfuscated-injection documents;
- 435 active tests passed before deployment, with strict TypeScript,
  zero-warning ESLint, and the production Next.js build green.

## Honest boundary

No PDF body is parsed yet. HTML normalization does not verify a human-readable
passage locator. No book page, transcript cue, video timecode, or film timestamp
is resolved. A byte range proves where parser output came from in the retrieved
object; it does not prove the source's claim or make it evidence. No evidence
fragment or claim is created, and the public production research route remains
disabled.

## Next gate

Checkpoint 04D.4 will add deterministic PDF structure extraction and explicit
page/object anchors behind the same hostile-data boundary, with strict resource
limits, encryption and malformed-file handling, no JavaScript execution, and
fixture-backed version stability. The following locator gate will independently
resolve inspectable passage, page, cue, and timecode locations before any
normalized fragment can enter evidence review.
