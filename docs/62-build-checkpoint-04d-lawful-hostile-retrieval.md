# Build checkpoint 04D.1 — lawful hostile-source retrieval

Date: 2026-08-30

## Outcome

AFTERFRAME now has a real, production-composable retrieval boundary for public
article, webpage, PDF, official-record, archive, and screenplay candidates.
The boundary can fetch bounded bytes, but it cannot treat them as instructions,
retain them without rights authority, create evidence, or publish a claim.

This is the first NORMALIZATION-side capability. It remains disabled by
default and is not yet registered as a durable NORMALIZATION executor.

## Authority before retrieval

The deterministic retrieval policy binds the case, run, source candidate,
resolved source, and source-level locator. It denies retrieval when:

- access is not open;
- rights are unknown or prohibited;
- source, medium, URL, and locator do not agree exactly;
- the medium needs an authorized specialist adapter;
- the medium is unsupported by the public retrieval path.

Books, video, podcasts, and user assets cannot fall through to a generic web
fetcher. They require edition-, transcript-, provider-, or ownership-aware
adapters in later gates.

`LINK_ONLY` permits transient analysis only. `PERMITTED`, `PUBLIC_DOMAIN`,
`LICENSED`, and case-scoped `USER_OWNED` authority may later permit retained
bytes. A link-only or transient receipt cannot contain a storage reference; a
retained receipt must contain one.

## Hostile public-network retrieval

The Node adapter performs a bounded streaming `GET` with:

- explicit server-side kill switch;
- HTTP/HTTPS URL and port policy;
- all-answer DNS validation and selected-IP socket pinning;
- redirect-by-redirect URL, DNS, and IP revalidation;
- HTTPS downgrade rejection;
- TLS 1.2 minimum, SNI, and certificate validation;
- no cookies, authorization, referrer, ambient session, compression, or
  connection pooling;
- fixed media-type `Accept`, `Accept-Encoding: identity`, bounded headers, and
  one deadline across DNS, redirects, and body streaming;
- declared-length rejection before collection and immediate termination when a
  chunked response crosses the byte budget;
- exact 200-only success; access-controlled, partial, and upstream-failure
  statuses produce bounded failure codes.

Each redirect chain receives a deterministic fingerprint. Raw addresses,
headers, response errors, and body text do not enter telemetry or durable
metadata.

## Byte validation

The independent payload validator does not trust the server's MIME label or
length. It requires:

- requested-URL equality and a still-admitted final URL;
- no HTTPS downgrade;
- identity encoding only;
- declared wire length equal to actual byte length;
- wire and decoded sizes within the policy grant;
- exact MIME allowlist membership;
- `%PDF-` signature for PDF or strict UTF-8/no-NUL text;
- recognizable HTML/XML markup for HTML media;
- exact SHA-256 match when an immutable fingerprint is expected.

Passing these checks does not make content trusted. The result is still an
ephemeral hostile byte array with `instructionAuthority: NONE` and
`publicationAuthority: NONE` inherited from the grant.

## Operational safety

`AFTERFRAME_SOURCE_PAYLOAD_RETRIEVAL_ENABLED=false` is independent from the
metadata-probe switch. Resolution can therefore remain available while body
retrieval is stopped instantly. Merely supplying API credentials does not
enable either capability.

## Verification

- 398 tests pass and 7 environment-gated tests are skipped;
- strict TypeScript, zero-warning ESLint, and the production Next.js build
  pass;
- deterministic attack tests cover DNS rebinding, metadata-service redirects,
  missing/custom-port/downgrade redirects, cancellation, restricted and
  partial responses, compressed payloads, declared and streaming oversize,
  MIME confusion, bad PDF signatures, invalid UTF-8, NUL bytes, request
  substitution, and immutable-fingerprint mismatch;
- no external network or paid-model call is used by the suite.

## Honest boundary

No retrieved body is durably stored yet. No HTML or PDF parser is trusted yet.
No snapshot, excerpt, exact locator, evidence fragment, or claim is accepted.
The production research route remains disabled.

## Next gate

Checkpoint 04D.2 will create the lease-fenced retrieval receipt and immutable
snapshot acceptance ledger. It must fix the existing candidate-attempt foreign
key so NORMALIZATION can retain provenance to a DISCOVERY candidate without
pretending the candidate originated in the normalization attempt. It will add
exact replay, content-fingerprint deduplication, transient-vs-retained storage
enforcement, actor/run/case authorization, and a rollback-only deployed
Postgres lifecycle before any parser is connected.
