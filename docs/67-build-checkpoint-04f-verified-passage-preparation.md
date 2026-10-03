# Build checkpoint 04F.1 — verified passage preparation

## Outcome

The research engine can prepare a bounded passage from an accepted web or PDF
locator for subsequent evidence review. The server service reads actor-scoped
Postgres records, rechecks source bytes and locator coordinates, and returns
transient passage text separately from its text-free provenance receipt.

This completes passage preparation, not evidence acceptance. The public live
research route remains disabled. No migration or model call was needed.

## Behavior and scope

This strengthens the V1 promise that a displayed quotation must be inspectable
in its original source. It implements the next evidence-pipeline dependency
from checkpoint 04E.1. UI expansion, additional specialists, and the browser
companion remain deferred. Deterministic fixtures run without external services.

The service accepts record IDs and normalized-text offsets, never proposed
quotation text. It verifies:

- authenticated actor-scoped read context;
- case, run, job, attempt and manifest agreement;
- unique accepted locator and normalization records;
- candidate, retrieval, snapshot, source and previous-locator lineage;
- current access and rights agreement with the normalization receipt;
- passed hostile-source screening;
- original byte length and content fingerprint;
- the entire independently reconstructed verification receipt, including
  coordinates, source version, URL and locator revision;
- exact selected text and its fingerprint, with a 500 UTF-16-unit limit,
  bounds checks and rejection of split surrogate pairs.

The selected string is a slice of normalized source text. It is not a claim
about original typography or a generated paraphrase. PDF extraction retains
the PDF adapter's existing text-order limitations.

All output stays `PROPOSED`, `NOT_EVIDENCE`, `TRANSIENT_ONLY`, and without
instruction or publication authority. This checkpoint grants no new rights to
store or publish quotations, even for otherwise storage-eligible material.
Semantic support and rights-aware evidence acceptance remain separate gates.

## Failure and operational behavior

Failures return stable codes without raw exceptions, private source text, or
titles. Missing context, unavailable locators, rights drift, quarantine,
changed bytes, altered coordinates, invalid selections and dependency failures
cannot produce a passage. Cancellation returns promptly even during a pending
database read; late results are discarded. Cancellation does not forcibly
terminate the underlying read or parser: their own resource limits still apply.

The operation is read-only and repeatable. Telemetry contains operation/version,
outcome, failure code, elapsed time and zero model calls/provider charges. This
does not imply zero CPU or database cost. No source passage enters telemetry or
the receipt. Source buffers are copied before asynchronous verification to
prevent caller mutation during verification.

Current implementation reparses twice: once through the independent locator
verifier and once to recover text. A later optimization may share an internal
verified parse, but must preserve full target comparison and hostile screening.

This is server infrastructure, so keyboard, mobile and reduced-motion behavior
are unchanged. No UI feature is claimed complete by this checkpoint.

## Verification

- 24 new deterministic tests cover successful web/PDF extraction, repeatability,
  strict input/output contracts, case/run/job/attempt/manifest drift, missing
  authorization context, changed rights and bytes, tampered coordinates,
  selection fingerprints and Unicode, quarantine, cancellation and redaction.
- The synthetic Black Hawk Down fixture contains no historical assertions and
  is neither a knowledge base nor a training example.
- The installed Postgres lifecycle now exercises the actual service through
  actor-scoped RPC readers for both web and PDF passages. Both lifecycle tests
  passed; temporary records roll back and the evidence count stays zero.
- Full check passed: strict TypeScript, ESLint, 478 active tests and production
  build. Eleven opt-in tests are skipped in the ordinary offline suite.

## Next gate

04F.2 must introduce durable evidence decisions and semantic review. It must
bind the reviewed finding and limitations to this verified passage lineage,
enforce rights on any retained text, reject unverified support, distinguish
source accounts from facts, and preserve lease fencing and idempotency. Claims,
independence groups, contradictions and renderable beats follow their own
policies. Do not expose prepared passages as accepted research findings.
