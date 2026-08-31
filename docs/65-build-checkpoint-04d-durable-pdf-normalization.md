# Build checkpoint 04D.4 — durable hostile-PDF normalization

Date: 2026-08-31

## Outcome

AFTERFRAME now has a bounded hostile-PDF extractor and a deployed, lease-fenced,
text-free Postgres acceptance boundary. Retrieved PDF bytes can be parsed into
complete page manifests and ordered text blocks without inventing raw-byte
locations for compressed PDF content.

Migration 016 is deployed. The live rollback-only lifecycle proves `IDENTITY →
SCOPING → DISCOVERY → RESOLUTION → PDF RETRIEVAL → PDF NORMALIZATION` against
the installed Supabase schema using a generic movie and a real PDF candidate.

## Parser boundary

The extractor uses a pinned Mozilla PDF.js release behind an AFTERFRAME-owned
port. The library parses format structure; it does not decide trust, evidence,
rights, publication, or research meaning.

The boundary:

- requires an independently verified `application/pdf` payload and exact
  content fingerprint;
- accepts bytes directly and performs no parser-initiated network requests;
- disables XFA, rendering, system fonts, image decoding, and WebAssembly;
- applies file, page, text-item, block, normalized-text, signal, and deadline
  limits;
- rejects empty, encrypted, malformed, oversized, over-page-limit,
  over-item-limit, over-text-limit, timed-out, and contract-invalid files with
  stable failure codes;
- detects document/page JavaScript, interactive forms, direct instructions,
  role impersonation, tool commands, exfiltration language, and large encoded
  instruction-like strings;
- quarantines signaled documents without executing embedded behavior;
- never grants evidence, instruction, or publication authority.

## Honest PDF provenance

PDF text may live inside compressed or transformed object streams, so a parser
cannot honestly claim that extracted prose occupies a simple raw-byte range.
AFTERFRAME therefore stores a distinct PDF anchor:

- one-based page number;
- PDF page object number and generation when available;
- parser text-item start and end;
- bounded page-space geometry;
- page-text, anchor, text, and page-structure fingerprints.

Page manifests also retain rotation, page dimensions, text-item count, and the
exact block interval assigned to the page. Postgres verifies complete,
contiguous page coverage and confirms every block belongs to its declared page
and page fingerprint.

These anchors make extraction reproducible and independently checkable. They do
not yet constitute a user-facing page citation or evidence locator.

## Text-free durability

The durable receipt uses an explicit allowlist. It stores page/object/item
coordinates, geometry, counts, structural identities, hostile signals,
fingerprints, rights state, and parser versions. It does not store:

- PDF bytes;
- extracted block text;
- source excerpts;
- metadata text;
- any model-generated interpretation.

`LINK_ONLY` PDFs remain transient and cannot have a storage reference.
Quarantined output cannot be retained. Retention requires explicit
storage-eligible rights.

## Acceptance and recovery

`af_accept_pdf_normalization_v1` independently validates the strict JSON shape,
active normalization lease, input manifest, actor/case/run/job/attempt lineage,
committed retrieval record, snapshot, candidate, source, locator, media type,
content fingerprint, byte length, access state, rights state, timestamps, and
normalizer identity.

The first exact decision returns `COMMITTED`; an identical retry returns
`REPLAY`. A stale, released, expired, cancelled, or superseded lease cannot
write. A different decision for the same retrieval conflicts instead of
silently replacing provenance. The worker revokes its authority if the durable
response cannot be proven identical to its submitted record.

## Database security

`af_pdf_normalization_records` uses forced Row Level Security and default-deny
grants. Anonymous and authenticated clients cannot read or mutate it. Only
actor-scoped service-role RPCs expose acceptance and typed readback.

Deployment is reproducible through `npm run db:migrate:016`. It requires the
exact 001–015 baseline, takes the schema-migration advisory lock, refuses active
research jobs, checks table, RLS, RPC, grant, and content-lineage postconditions,
and records version 016 atomically.

## Verification

- deterministic fixtures cover multi-page extraction, page objects, geometry,
  stable fingerprints, JavaScript quarantine, hostile text, malformed files,
  encrypted-file error mapping, timeout, and every configured resource bound;
- text-free receipt tests prove source prose, raw bytes, and fabricated byte
  anchors do not cross the persistence boundary;
- migration 016 passed atomic rollback preflight over deployed 001–015;
- the installed database passed stale-lease rejection, exact commit/replay,
  typed text-free readback, transient-only enforcement, and rollback cleanup;
- 446 active tests pass; strict TypeScript, zero-warning ESLint, and the
  production Next.js build are green.

## Honest boundary

PDF text order and coordinates are parser observations. Scanned image-only PDFs
need a future OCR adapter and remain unavailable here. Printed page labels,
edition identity, section headings, quotations, and human-visible passage
locations are not yet independently resolved. No PDF block is evidence, no
claim is created, and no public research route is enabled.

## Next gate

Checkpoint 04E begins independent exact-locator verification. It will resolve a
normalized fragment back to an inspectable original location and verify the
source version before evidence review. Initial locator classes are webpage text
fragments and PDF page/text regions, followed by transcript cues, video
timecodes, book editions/pages, and film timestamps tied to an identified cut.
