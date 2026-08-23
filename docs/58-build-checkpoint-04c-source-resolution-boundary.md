# Build checkpoint 04C.1 — source-resolution trust boundary

Date: 2026-08-22

## Outcome

AFTERFRAME now has a strict candidate-resolution boundary between discovery and
evidence work. It can turn an untrusted discovered URL into a conservative,
resolver-checked source identity and source-level locator proposal. It cannot
turn that proposal into evidence, a claim, investigation prose, or published
content.

This is deliberately a trust-boundary slice, not a general web scraper.

## Resolution contract

The application port accepts one persisted discovery candidate bound to its
run, job, attempt, case, and manifest. A successful result contains:

- one proposed canonical source identity;
- one source-level locator with the resolver and resolver version recorded;
- `OPEN` access only after a successful metadata probe;
- conservative `LINK_ONLY` rights;
- explicit `UNTRUSTED_SOURCE_DATA` metadata trust;
- `NOT_EVIDENCE` and `NONE` publication authority;
- an assertion that no content body was admitted.

Unsupported media, missing URLs, unavailable sources, unsafe network targets,
invalid probes, and invalid redirect chains remain bounded unresolved results.

## Network boundary

The resolver admits only HTTP(S) public-network targets. It rejects:

- URL credentials, unsupported schemes, and non-default ports; fragments and
  known tracking parameters are removed before identity resolution;
- localhost, local/internal names, private, loopback, link-local, reserved,
  documentation, multicast, and IPv4-mapped private addresses;
- any DNS result set containing a non-public address;
- redirects that do not begin at the admitted request;
- redirects whose intermediate hop is not actually a redirect;
- chains over the bounded hop limit.

Every hop must carry its independently observed DNS addresses. This preserves
the requirement that a public hostname cannot redirect or rebind into internal
infrastructure.

## Hostile-input posture

The transport contract is metadata-only and strict. HTML, excerpts,
transcripts, headers, and response bodies are absent. If a transport attempts
to return a body or any undeclared field, the probe is rejected rather than
partially trusted.

Titles are treated as untrusted display metadata, stripped of control
characters, whitespace-normalized, and bounded. Publisher, contributor,
publication-date, independence-group, and exact-location claims are not
inferred from page metadata in this slice.

## Determinism and authority

Source identity derives deterministically from the canonical URL, so later
attempts converge on the same source instead of multiplying records. Locator
identity also includes the proposed medium. Replaying an identical resolution
input produces the identical proposal. Metadata-only resolution may create only a
`SOURCE_ONLY` locator; exact or approximate verification is reserved for a
later medium-specific resolver.

## Verification

- focused resolver and public-network policy tests pass;
- unsafe targets are rejected before the transport is called;
- private-address redirect/DNS crossover is rejected;
- body-bearing probe output is rejected by the strict schema;
- deterministic replay and source/locator authority constraints are covered;
- TypeScript strict mode and ESLint pass.

## Next gate

Add Postgres-authored resolution context and versioned persistence for source
identity and locator proposals, then connect this resolver through the durable
worker lifecycle with idempotent acceptance and recovery. Only after that gate
may medium-specific adapters retrieve permitted content for hostile-input
screening and exact locator verification.

Paid live discovery remains independent of this work and stays blocked without
a truthful data-control attestation.
