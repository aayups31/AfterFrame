# Build checkpoint 04B.3 — serialized worker provider acceptance

Date: 2026-08-22

## Outcome

The durable worker now routes accepted background-provider work through the
same serialized, lease-fenced mutation lane as heartbeats and checkpoints.
This closes the in-process race between provider acceptance, worker shutdown,
heartbeat renewal, cancellation, and lease takeover.

## Enforced behavior

- The provider-run recovery schema is owned by the domain-neutral research
  runtime rather than the OpenAI adapter.
- The durable worker store exposes the atomic Migration 009 acceptance RPC.
- Executors receive a dedicated `acceptProviderRun` capability.
- The worker creates the canonical checkpoint ID and timestamp; executors
  cannot persist arbitrary checkpoint records.
- Run, case, job, attempt, manifest, external idempotency key, and provider
  response ID must match before the mutation reaches Postgres.
- The returned lease must monotonically continue the worker's current fenced
  cursor.
- The returned checkpoint and recovery record must exactly match the proposal.
- A committed or replayed atomic acceptance becomes the sole provider-resume
  authority for safe handoff and same-attempt takeover.
- Ordinary `checkpoint` calls are forbidden from using
  `PROVIDER_ACCEPTED`; bypass attempts fail closed without writing a
  checkpoint.
- The redundant standalone acceptance adapter was removed, leaving one
  production mutation path.

## Verification

- adversarial worker tests cover atomic acceptance, safe retry handoff,
  same-attempt reclaim, and rejection of non-atomic provider acceptance;
- Supabase durable-store tests verify the exact RPC and parameter mapping;
- 262 tests pass and 4 guarded integration tests remain skipped by default;
- strict TypeScript, ESLint, Next.js production build, and diff validation
  pass.

## Next gate

A service-only provider-run reader must return the exact persisted recovery
record during takeover. The resumable DISCOVERY executor can then choose
exactly one path: start and atomically accept new work, or retrieve the already
accepted provider response. It may never silently start replacement work.
