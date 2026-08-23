# Build checkpoint 04B.4 — provider takeover reader deployed

Date: 2026-08-22

## Outcome

Migration 010 is deployed. A reclaimed worker can now read the exact durable
provider recovery record for its actor-owned active DISCOVERY attempt.

The reader returns a record only when:

- run, job, attempt, and actor ownership match;
- the job is DISCOVERY and remains RUNNING;
- the attempt remains RUNNING and is the job's active attempt;
- a `PROVIDER_ACCEPTED` checkpoint exists for the same provider response ID.

If recovery state exists without its exact checkpoint, the RPC raises a bounded
invariant failure instead of silently permitting replacement work.

## Security and recovery posture

- the RPC is `SECURITY DEFINER` with a fixed search path;
- only service role can execute it;
- public, anon, and authenticated roles have no execute privilege;
- the TypeScript adapter is actor-pinned and strict-schema validated;
- expanded records containing response bodies or arbitrary fields are rejected;
- database and provider diagnostics are replaced with bounded errors.

## Deployment proof

- real rollback preflight passed over the exact production 001–009 baseline;
- transactional deployment recorded migration 010;
- post-deploy inspection confirmed ledger 001–010 and the installed RPC;
- production remains at zero research runs and zero provider-run rows.

## Next gate

The resumable DISCOVERY executor will use this reader to select one legal path:
start and atomically accept a new provider response, or retrieve the exact
already-accepted response. Before implementation, accepted-state persistence
must also support a response that reaches a terminal state synchronously during
the start call so even that crash window remains recoverable.
