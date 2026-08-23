# Build Checkpoint 04B — Durable Scoping and Candidate Discovery

Checkpoint 04B is where AFTERFRAME begins live agentic research. It does not
turn the public route into a prompt endpoint. The worker must first project the
pinned specialist plan deterministically, then bind one resumable multi-axis
discovery run to the exact Postgres-authored attempt manifest.

## Current status

- Migration 008 and Checkpoint 04A are deployed and production-proven.
- Deterministic durable `SCOPING` is implemented and registered after
  `IDENTITY`.
- Unit tests prove replay-stable output, zero model/tool use, bounded degraded
  coverage state, rejection of duplicate scope, and absence of private
  coverage-gap text.
- The real rollback lifecycle now proves TMDB `IDENTITY` completion followed by
  deterministic `SCOPING` completion, two immutable causal manifests, two
  linked outputs, zero source candidates, and a queued `DISCOVERY` job.
- Live `DISCOVERY` is not registered or exposed yet.

## Deterministic scoping contract

`SCOPING` copies only the authoritative axis IDs and source-class IDs from the
pinned specialist plan. It cannot call a model, inspect a source, invent a new
axis, produce a candidate, create evidence or claims, or carry publication
authority. The output ID and timestamp are deterministic for the durable
attempt so a process crash cannot change its completion fingerprint.

Free-form specialist coverage-gap text remains private. Its presence becomes
one body-free bounded code: `specialist-plan-coverage-gaps`.

## Discovery release boundary

The next slice must add all of the following before any paid provider call is
made by the durable worker:

1. one multi-axis discovery input bound to the full attempt-manifest
   fingerprint, attempt, resolved identity, predecessor output, and lease;
2. axis-tagged candidate records that remain `UNTRUSTED`, `NOT_EVIDENCE`,
   `PROPOSED`, and `NONE`;
3. a body-free provider-run record committed atomically with the
   `PROVIDER_ACCEPTED` checkpoint;
4. retrieval of the same background response after worker recovery;
5. explicit durable cancellation authority, distinct from shutdown and lease
   loss;
6. fail-closed data-control attestation for background processing;
7. source/citation equality checks that discard unsupported URLs and all
   generated prose or hostile source bodies;
8. complete model, prompt, schema, tool, usage, cost, bytes, latency, trace, and
   provenance metadata.

The public investigate route remains disabled. Candidate discovery is still
not evidence, and discovery completion is not permission to render factual
research.

## OpenAI platform constraints

The implementation follows the current official Responses API contract:
background responses can be retrieved and cancelled; web-search source records
can be explicitly included; structured JSON output is supported; and tool calls
can be bounded. `store: false` does not establish Zero Data Retention.
Background mode temporarily stores response state for polling and therefore
requires an explicit compatible data-control posture rather than an inferred
privacy claim.

- https://developers.openai.com/api/reference/cli/resources/responses/methods/create
- https://developers.openai.com/api/docs/guides/your-data#default-usage-policies-by-endpoint
