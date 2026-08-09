# Build Checkpoint 02 — Durable Research-Agent Foundation

This checkpoint begins the real research system beneath the non-authoritative UI. It does not connect an LLM to a chat route or publish a generated answer. It establishes the controlled path that future live movie investigations must follow:

```text
authenticated actor + identified movie + exact curiosity
→ specialist-owned research scope
→ seven durable logical jobs
→ web-search candidates marked untrusted / not evidence
→ resolver, normalization, corroboration, and sequencing gates
→ only later: persisted claims, evidence, locators, and paced investigation beats
```

## What is implemented

### Production Postgres boundary

- An isolated, domain-neutral `af_*` schema that can round-trip the accepted production records without inheriting the prototype tables' film-specific or collapsed fields.
- Separate cases, branches, directions, sources, snapshots, locators, evidence, claims, claim/evidence edges, provenance, semantic domain events, and transactional outbox rows.
- Research plans, runs, logical jobs, bounded attempts, stage outputs, source candidates, and quarantined hostile-content metadata. Research records have no publication authority.
- Expiring direction idempotency leases and immutable private replay results.
- Versioned, actor-scoped RPCs for case/branch reads plus atomic direction reservation, release, and commit.
- Forced row-level security and default-deny client access. The server adapter supplies only the actor ID established by Supabase Auth and performs multi-record mutations through one transaction.

Migration 005 is additive: migrations 001–003 remain prototype history and migration 004 keeps them default-deny. No prototype data is silently coerced into production records.

### Research run and job spine

- Seven ordered stages: identity, scoping, discovery, resolution, normalization, corroboration, and sequencing.
- Stable logical jobs, explicit dependencies, bounded retry attempts, optimistic versions, monotonic timestamps, idempotent replay, run health, and degraded/failure states.
- Complete trace, model, prompt, schema, tool, token/byte usage, cost, latency, and record-provenance metadata.
- Strict separation between a search candidate, untrusted retrieved content, a verified locator, evidence, a claim, and presentation prose.
- Atomic start-run port contracts and reference-only research events/outbox records. A production start-run adapter and durable live worker remain the next composition step.

### Movie identity and specialist boundary

- A server-only TMDB resolver accepts any structurally valid `tmdb:movie:<id>` reference.
- Provider metadata verifies the public subject identity and disambiguation context only. It cannot become a claim or evidence record.
- Not-found, authentication failure, rate limiting, timeout, malformed response, and upstream failure are explicit states with body-free attempt metadata.
- Movie source classes and research axes still come through the Movie Investigator specialist; the domain-neutral core does not import movie implementations.

### Shadow source discovery

- A real OpenAI Responses web-search adapter exists behind the research discovery port.
- It receives a resolver-verified public movie identity, exact question, specialist axis, and permitted source classes.
- Structured model output is accepted only when each URL is also present in the actual web-search call sources or URL annotations.
- Generated prose is discarded. Only deduplicated candidate metadata crosses the boundary.
- Every result remains `UNTRUSTED`, `NOT_EVIDENCE`, `PROPOSED`, with unknown access/rights and `publicationAuthority: NONE`.
- Errors are redacted, raw source bodies do not enter telemetry, and cost remains honestly `UNPRICED` when a complete provider/tool price cannot be calculated.

The adapter is deliberately not exposed through the starter route and this checkpoint makes no paid OpenAI or TMDB call. Shadow activation requires a durable worker to acquire and persist an attempt lease before any external work, then checkpoint the validated result transactionally.

## What this proves about AFTERFRAME

The product object is an investigation, not a model response. A model is one bounded worker in a larger evidence process. It may discover leads, but it cannot declare its own sources verified, promote a candidate to evidence, erase contradictions, or silently author the user's conclusion. Directions continue to change the case through branches rather than append chat messages.

Black Hawk Down appears only in deterministic regression fixtures. Runtime identity resolution and discovery are not title-whitelisted and no private case, note, direction, upload, or fixture is treated as model-training data.

## Verification

Use the pinned toolchain:

```bash
cd starter
nvm use
npm ci
npm run check
```

The check generates Next route types, runs strict TypeScript, lint, the full deterministic/adversarial suite, and a production build.

From the repository root:

```bash
python3 scripts/validate-kit.py
```

## Next production slice

1. Apply migration 005 to the intended Supabase project and generate checked-in database types.
2. Implement the research-start store RPC/adapter and a durable worker with leases, heartbeats, cancellation, recovery, attempt checkpoints, and outbox consumption.
3. Compose TMDB identity and OpenAI discovery in shadow mode; persist candidate metadata before any later stage can read it.
4. Add deterministic URL, article, video/transcript, book/edition, PDF/archive, and film-cut locator resolvers with SSRF, parser, size, rights, and access controls.
5. Implement evidence normalization, independence grouping, contradiction search, claim assessment, and exact-locator verification without allowing source content to issue instructions.
6. Run the golden case plus a broad multi-film development and unseen holdout suite. No factual beat reaches the user until the evidence and provenance gates pass.

UI redesign remains intentionally out of scope.
