# Build checkpoint 04B.8 — deterministic Postgres DISCOVERY lifecycle

Date: 2026-08-22

## Outcome

AFTERFRAME has now proven its first complete provider-shaped agent loop through
the deployed Postgres worker without making a paid OpenAI call:

```text
IDENTITY → SCOPING → DISCOVERY claim → provider start
→ atomic provider acceptance → pending handoff
→ same-attempt takeover → output validation → candidate persistence
```

Migration 012 is deployed and recorded. It closes a schema drift discovered by
the lifecycle proof: discovery candidates are axis-tagged in the strict
TypeScript contract, and Postgres now preserves those tags instead of rejecting
or dropping them.

## Database truth

- `af_source_candidates.axis_ids` stores the pinned research axes a candidate
  may help investigate;
- axis IDs must be unique, valid slugs, and present in the authoritative
  specialist plan;
- each candidate's source class must be permitted by every selected axis;
- `discoveryInputFingerprint` binds the candidate to the full Postgres-authored
  attempt manifest, not the older stage-seed fingerprint;
- deferred validation prevents any candidate from committing without valid
  axis bindings;
- internal legacy persistence functions are no longer executable by API roles.

## Recovery proof

The deterministic provider returns `PENDING` on its first observation and
`COMPLETED` on takeover. The deployed lifecycle proves:

- exactly one provider start;
- exactly one atomic `PROVIDER_ACCEPTED` checkpoint and recovery record;
- one retry handoff;
- the same attempt is reclaimed by a different worker;
- the accepted provider response is retrieved rather than restarted;
- one `OUTPUT_VALIDATED` checkpoint;
- one terminal `DISCOVERY_RESULT` and one untrusted candidate;
- three causal attempt manifests across identity, scoping, and discovery;
- no evidence, claim, prose, or publication authority is created;
- all integration records roll back to the exact baseline.

## Contract defect fixed

The first real run also exposed that Postgres normalizes equivalent UTC
timestamps while the worker compared provider recovery records as raw JSON.
The worker now compares canonical instants, preventing a valid atomic provider
acceptance from being misclassified as lease loss. An adversarial regression
test covers the normalization boundary.

## Verification

- migration 012 passed twice inside rollback-only predeploy transactions;
- migration 012 deployed successfully over the exact 001–011 baseline;
- the full lifecycle passed against the installed 001–012 schema;
- strict TypeScript and ESLint passed;
- 290 tests passed and 6 guarded integration tests remained skipped by
  default;
- the production Next.js build passed.

## Next gate

Build the candidate resolution boundary. A discovered URL remains
`UNTRUSTED`, `NOT_EVIDENCE`, `PROPOSED`, and without publication authority.
The next executor must independently establish canonical source identity,
access and rights state, origin/dependency grouping, and resolver-verified
locators before any source content can be normalized or any factual claim can
exist.

Paid OpenAI discovery remains blocked because the current organization has no
truthful MAM attestation. This does not block deterministic resolution work.

