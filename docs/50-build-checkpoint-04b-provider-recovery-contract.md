# Build checkpoint 04B.1 — truthful provider recovery contract

Date: 2026-08-22

## Outcome

The durable DISCOVERY boundary now defines the complete body-free provider-run
record required to resume accepted background research without reconstructing
or inventing audit metadata after a worker crash.

## Why the response ID is insufficient

An OpenAI background response ID is enough to retrieve the provider response,
but it does not independently preserve AFTERFRAME's original trace binding,
attempt manifest, external idempotency key, accepted model metadata, start and
observation times, input byte count, or data-control attestation.

The durable provider-run record therefore retains all of those fields while
excluding the private research question, prompt body, source bodies, and raw
provider response.

## Enforced invariants

- accepted state is only `QUEUED` or `IN_PROGRESS`;
- run, job, attempt, case, manifest, and external idempotency bindings must
  exactly match the Postgres-authored discovery input;
- Modified Abuse Monitoring and its OpenAI-project fingerprint are retained;
- provider acceptance and observation cannot precede provider start;
- the record has no publication authority;
- the actor-scoped context must uniquely and exactly cover the pinned axes and
  source classes;
- the provider port now exposes typed start and poll outcomes instead of
  `unknown` values.

## Next gate

Migration 009 will persist this record and the `PROVIDER_ACCEPTED` checkpoint in
one token-fenced Postgres transaction. The resumable executor will not be
registered until that atomic boundary and its takeover tests pass.
