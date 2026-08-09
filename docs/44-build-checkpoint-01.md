# Build Checkpoint 01 — Deterministic Investigation Spine

This checkpoint starts the production build beneath the non-authoritative UI prototypes. It proves one honest product transition:

```text
exact user direction
→ specialist-constrained planner proposal
→ immutable direction record
→ proposed child branch becomes the active investigation
→ provenance + ordered outbox events
```

It is deliberately not a chat transcript, generated answer, live research claim, or Black Hawk Down-specific runtime.

## What is implemented

- A strict, domain-neutral case aggregate with opaque specialist subject references.
- Separate source, snapshot, locator, evidence, claim, claim/evidence-edge, branch, direction, and provenance records.
- Whole-graph integrity and rights checks, including locator/source compatibility and private snapshot isolation.
- A Movie Investigator specialist seam that accepts any structurally valid TMDB movie reference; it has no title whitelist.
- Question-driven movie research axes and explicit policy for books, video/podcasts, articles/trades, official/archive sources, film text/screenplays, criticism, and community leads.
- Provider and cut/version identity states that never equate structural input with resolver verification.
- An application command that preserves exact user text, enforces explicit direction intent, validates planner output, activates a proposed branch, and emits reference-only semantic events.
- An atomic in-memory adapter with optimistic concurrency, pre-work idempotency reservations, deterministic replay, collision checks, and no partial writes.
- A Black Hawk Down direction fixture used only as golden regression input—not training data, runtime knowledge, or a supported-movie boundary.
- Default-deny, forced RLS for every existing Supabase prototype table. No client policy is opened yet.

## Safety posture

Production composition accepts only an application-trusted `DETERMINISTIC_FIXTURE` planner identity; planner output cannot self-declare or rewrite its provenance. A live planner requires a new trusted adapter contract plus model/run identity, trace, prompt, schema, tool, usage, cost, latency, and produced-record provenance.

The prototype investigate route cannot call OpenAI. Production direction and closure HTTP routes return `501` until authenticated actor context and durable persistence exist. `.env.local` is ignored, server secrets remain server-only, and API keys are not read by this slice.

The additive “production spine” SQL draft was intentionally withheld because it could not round-trip the TypeScript graph without loss. The next persistence migration must be derived from the accepted schemas and proven through repository contract tests.

## Verification

Use the pinned toolchain:

```bash
cd starter
nvm use
npm ci
npm run check
```

`npm run check` generates Next route types, runs strict TypeScript, lint, the full deterministic/adversarial test suite, and a production Next build.

From the repository root:

```bash
python3 scripts/validate-kit.py
```

## Next production slice

1. Freeze a lossless Postgres mapping and authenticated owner boundary for this exact aggregate.
2. Implement repository contract tests, transactional outbox persistence, expiring idempotency leases, and an outbox consumer.
3. Add movie identity resolution through the server-only TMDB adapter without treating provider metadata as research evidence.
4. Build the deterministic research run/job shell, source candidates, hostile-input boundary, and resolver fixtures.
5. Only then connect the live model/search adapters in shadow mode, with complete run metadata and no factual beat publication.

UI redesign remains intentionally out of scope for this checkpoint.
