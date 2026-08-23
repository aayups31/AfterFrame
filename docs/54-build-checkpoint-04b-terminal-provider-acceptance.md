# Build checkpoint 04B.5 — synchronous terminal provider acceptance deployed

Date: 2026-08-22

## Outcome

Migration 011 is deployed. A DISCOVERY response that reaches `COMPLETED`,
`FAILED`, `INCOMPLETE`, or `CANCELLED` before the provider start call returns
can now be atomically accepted with its `PROVIDER_ACCEPTED` checkpoint.

This closes the final start-response crash window before the resumable
DISCOVERY executor is implemented. The executor can persist the response
identity first and retrieve the same response after a crash, regardless of
whether its first observed state was pending or terminal. It must never start
replacement paid work for that attempt.

## Enforced behavior

- the provider-run state contract admits exactly the six provider states;
- run, job, attempt, case, manifest, idempotency, model, trace, timing, and
  data-control bindings remain unchanged;
- terminal output and provider diagnostics are not persisted in recovery state;
- the private question, prompt, raw response, source bodies, and generated prose
  remain outside the record;
- Postgres and TypeScript validate the same state set;
- the existing actor-scoped takeover reader can return a synchronously terminal
  accepted response while its owning attempt remains active.

## Deployment proof

- strict TypeScript and ESLint passed;
- 274 tests passed and 6 guarded integration tests remained skipped by default;
- the Next.js production build passed;
- rollback preflight applied migration 011 over the exact production 001–010
  baseline and validated all four synchronous terminal states;
- transactional deployment recorded migration 011 after confirming zero
  production research runs and zero provider-run rows.

## Next gate

Implement the resumable DISCOVERY stage executor. It must read the exact
actor-scoped discovery context and accepted provider record, choose either
start-and-accept or retrieve-never-replace, heartbeat while polling, map
terminal outcomes into bounded worker results, and prove crash recovery with
deterministic provider fixtures before production registration.
