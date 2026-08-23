# Build checkpoint 04B.2 — Migration 009 deployed

Date: 2026-08-22

## Outcome

Migration 009 is deployed to the configured Supabase project. AFTERFRAME can
now persist the complete body-free recovery record for accepted background
DISCOVERY work and its `PROVIDER_ACCEPTED` checkpoint in one token-fenced
transaction.

The production ledger contains migrations 001–009. Production retains zero
research runs and zero provider-run rows after deployment.

## Database boundary

`af_research_provider_runs` retains the provider response ID, accepted state,
requested and observed model, trace, exact attempt-manifest and idempotency
bindings, timing, byte count, and Modified Abuse Monitoring project
attestation. It cannot retain private question text, prompt bodies, source
bodies, raw provider responses, evidence, claims, or publication authority.

`af_accept_research_provider_run_v1`:

- verifies actor ownership;
- verifies the exact run, case, DISCOVERY job, attempt, manifest, external
  idempotency key, model execution plan, and private-input disclosure;
- commits the existing token-fenced checkpoint first inside the same database
  transaction;
- inserts recovery state only after a committed checkpoint;
- rolls the checkpoint back if recovery persistence fails;
- replays only an exactly equal stored recovery record;
- fails closed if a replayed checkpoint has no matching recovery record.

`af_get_research_discovery_context_v1` is service-only and actor-scoped. It
returns the exact case/branch research objective, resolver-verified public
identity, and pinned specialist axes/source classes only to the authorized
worker boundary.

## Security and deployment proof

- all 13 provider-run constraints are deliberately named and validated;
- forced RLS is enabled with no browser-role policy;
- direct table access is denied to public, anon, and authenticated roles;
- only service role can execute the two new worker RPCs;
- the guarded preflight applied all SQL inside a rollback transaction over the
  exact 001–008 production baseline;
- deployment used an advisory lock, exact ledger check, zero-live-run gate,
  one transaction, rollback-on-failure, and postcondition verification;
- post-deploy inspection confirmed ledger 001–009, forced RLS, zero research
  runs, and zero provider runs.

## Verification

- strict TypeScript: passed;
- ESLint: passed;
- Vitest: 264 passed, 4 guarded integration tests skipped by default;
- Migration 009 real rollback preflight: passed;
- production deployment and post-deploy catalog verification: passed.

## Next gate

The worker must expose this atomic acceptance operation through its serialized
lease mutation boundary. Then the resumable DISCOVERY executor can start or
retrieve one accepted background response without racing heartbeats, shutdown,
lease takeover, or cancellation.
