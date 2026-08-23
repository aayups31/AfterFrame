# Build checkpoint 04B — durable discovery boundary

Date: 2026-08-22

## Outcome

AFTERFRAME now has a strict, multi-axis contract for its first source-seeking
agent stage. This is discovery, not answer generation: every returned URL is an
untrusted candidate, is explicitly `NOT_EVIDENCE`, has no publication
authority, and is bound to the exact Postgres-authored attempt manifest.

The production executor registry remains intentionally closed to DISCOVERY
until its database persistence shape, actor-scoped private input reader, and
resume lifecycle are deployed and verified together.

## What is enforced

- One provider request receives the complete pinned research-axis plan instead
  of running disconnected one-axis prompts.
- Every candidate names the axes it can serve and uses a source class permitted
  by each named axis.
- Candidate URLs must resolve to URLs actually surfaced by the provider's web
  search records or citations; model-only URLs are discarded.
- Candidate IDs and durable candidate records must be unique and exactly equal.
- The worker validates candidate source class, axis membership, and the exact
  attempt-manifest fingerprint before persistence.
- Background requests are bounded by tool-call and output-token limits.
- Completed runs retain model, prompt, schema, tool, trace, usage, cost, latency,
  and ATTEMPT-level provenance metadata.
- Raw provider failures, partial answer text, the exact private question, and
  source bodies cannot cross the bounded result/error contracts.

## Data-control gate

OpenAI background discovery fails closed unless the server composition provides
an explicit Modified Abuse Monitoring attestation and a fingerprint of the
attested OpenAI project. `store: false` is still requested, but is not treated
as a zero-data-retention guarantee.

No paid live discovery request is enabled by this checkpoint.

## Recovery model

The durable worker's token-fenced `PROVIDER_ACCEPTED` checkpoint is the resume
authority. It stores the accepted provider response ID:

- failure before the checkpoint is ambiguous and terminates fail-closed;
- failure after the checkpoint resumes that same provider response;
- shutdown or lease loss never silently starts a replacement paid request;
- cancellation of a durable investigation remains distinct from worker
  shutdown and lease loss.

## Verification

- strict TypeScript: passed
- ESLint: passed
- Vitest: 253 passed, 3 skipped integration tests
- Next.js production build: passed
- diff whitespace validation: passed

## Next checkpoint

1. Add the actor-scoped discovery context read model for the exact case/branch
   question plus resolver-verified public identity.
2. Persist candidate axis tags and strengthen the transactional DISCOVERY
   completion validator in Postgres.
3. Implement the resumable DISCOVERY executor over the accepted-response
   checkpoint protocol.
4. Prove start, in-progress handoff, recovery, cancellation, malformed output,
   and exact candidate persistence with deterministic fixtures.
5. Only then register DISCOVERY in the production executor registry and run a
   controlled live evaluation.
