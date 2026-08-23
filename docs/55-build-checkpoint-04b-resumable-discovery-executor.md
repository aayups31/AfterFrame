# Build checkpoint 04B.6 — resumable DISCOVERY executor

Date: 2026-08-22

## Outcome

AFTERFRAME now has the application-level executor for its first complete
provider-backed agent loop. DISCOVERY can select exactly one legal path for an
active Postgres-authored attempt:

```text
no accepted provider response → start once → atomically accept → retrieve
accepted provider response    → never start → retrieve exact response
```

The executor produces only deterministic, search-backed source candidates.
Candidates remain `UNTRUSTED`, `NOT_EVIDENCE`, `PROPOSED`, and without
publication authority. It cannot create claims, evidence, prose, or conclusions.

## Recovery and idempotency

- the actor-scoped provider-run reader is checked before every start decision;
- a provider checkpoint and recovery record must either both exist or both be
  absent;
- an ambiguous start is terminal and cannot authorize a replacement paid call;
- accepted pending work is polled for a bounded window, then handed back to the
  same durable attempt with a retry delay;
- takeover reconstructs the exact body-free provider handle and retrieves only
  its response ID;
- candidate and stage-output UUIDs are deterministic from the attempt and
  candidate identity;
- `OUTPUT_VALIDATED` uses the worker's canonical execution fingerprint;
- recovery after an output-checkpoint crash replays the same result without
  writing a conflicting checkpoint.

## Trust and provenance

- private research context is read only through the actor-scoped server port;
- context identity, axes, source classes, manifest, attempt, and provider
  bindings must match before external work;
- every retrieved handle is revalidated against the exact attempt;
- completed output is revalidated against the pinned manifest and specialist
  source policy;
- requested model, provider snapshot, prompt, schema, tool, provider run,
  usage, cost state, and private-content disclosure must match the execution
  plan;
- model snapshot drift is rejected rather than silently recorded as approved;
- provider failures and hostile bodies become bounded body-free envelopes;
- an empty search-backed candidate set is honestly `DEGRADED`, not presented as
  successful research.

## Verification

- strict TypeScript passed;
- ESLint passed without warnings;
- 284 tests passed and 6 guarded integration tests remained skipped by default;
- the production Next.js build passed;
- adversarial executor tests cover first start, atomic acceptance order,
  takeover, bounded polling, deterministic replay, ambiguous start, recovery
  disagreement, provider terminal failure, empty results, and snapshot drift.

## Production posture

The executor and its snapshot-explicit production execution-plan factory are
implemented, but DISCOVERY remains deliberately unregistered in the production
registry. This checkpoint performs no paid live research and does not enable
the public investigate route.

## Next gate

Compose DISCOVERY behind explicit server-only OpenAI data-control attestation,
then prove the complete Postgres lifecycle with a deterministic transport:
claim → start → atomic acceptance → pending handoff → same-attempt takeover →
completed candidate persistence. After that passes, run a tightly controlled
live discovery evaluation before enabling the executor in production.
