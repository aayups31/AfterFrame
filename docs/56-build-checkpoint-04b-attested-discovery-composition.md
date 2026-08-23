# Build checkpoint 04B.7 — attested DISCOVERY composition

Date: 2026-08-22

## Outcome

AFTERFRAME now has a separate production-oriented composition path for its
resumable `DISCOVERY` executor. The ordinary V1 registry still registers only
`IDENTITY` and deterministic `SCOPING`; it cannot accidentally resolve a paid
discovery executor.

The shadow composition registers `DISCOVERY` only after the OpenAI provider
boundary validates an explicit server-side Modified Abuse Monitoring
attestation. The deployment reader requires the exact attested mode, hashes the
raw OpenAI project ID with domain separation, and exposes only that fingerprint
to provider recovery records and traces.

This checkpoint does not claim that the current OpenAI organization has MAM.
The local environment intentionally contains no attestation because the
organization settings inspected on 2026-08-22 did not expose MAM or Zero Data
Retention. `store=false` and disabled voluntary data sharing are not treated as
equivalent claims.

## Fail-closed properties

- no attestation means no shadow registry composition;
- any mode other than `MODIFIED_ABUSE_MONITORING` is rejected;
- the raw OpenAI project ID is not returned, persisted, or logged;
- the default registry continues to return `null` for `DISCOVERY`;
- provider snapshot identity remains explicit at claim time;
- constructing the registry performs no network or paid provider call;
- the public investigation route remains disconnected.

## Verification

- strict TypeScript passed on Node.js 22.13.0;
- ESLint passed without warnings;
- 289 tests passed and 6 guarded integration tests remained skipped by
  default;
- the production Next.js build passed;
- regression tests prove body-free project fingerprinting, absent and invalid
  attestation rejection, default-registry isolation, and attested shadow
  registration.

## Next gate

Prove the full `DISCOVERY` lifecycle through the deployed Postgres worker using
a deterministic provider transport:

```text
claim → start → atomic provider acceptance → pending handoff
→ same-attempt takeover → completed candidate persistence
```

That integration must roll back all test records and prove there is exactly one
provider start, one accepted recovery record, one terminal stage output, and no
claim or evidence publication. Only after that deterministic lifecycle passes
may a tightly budgeted live discovery evaluation be considered; live execution
remains blocked while truthful MAM attestation is unavailable.

