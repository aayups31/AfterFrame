# AFTERFRAME Movie Investigator Starter — V3

The visible starter is still a mocked, non-authoritative vertical slice. A parallel production foundation now lives under `src/core`, `src/application`, `src/contracts`, `src/infrastructure`, and the `af_*` Postgres schema.

The starter preserves a domain-neutral investigation-core interface while implementing only the Movie Investigator specialist. It is not a generic research app.

## Run

```bash
npm install
cp .env.example .env.local
npm run dev

# Before committing
npm run check
```

This repository pins Node.js 22.13.x and npm 10.8.x.

## Routes

- `/` — film portal and curiosity prompt
- `/case/black-hawk-down` — mocked investigation with direction-driven branching and closure preview
- `POST /api/investigate` — mock by default; optional OpenAI provisional intent call
- `POST /api/cases/:caseId/directions` — typed mock branch instruction
- `POST /api/cases/:caseId/close` — typed mock closure request

## Important

The evidence links and locators in `src/lib/mock-case.ts` are clearly marked mock. They exist only to exercise the source-inspection UI. Do not present them as production evidence.

The production research boundary does not return a generated answer. It stages identity, scoping, discovery, resolution, normalization, corroboration, and sequencing as separate jobs. OpenAI search output can create untrusted source candidates only; deterministic resolvers and later human/agent review must establish locators and evidence before anything can enter the investigation.

## Build with Codex

From this directory:

```bash
codex -m gpt-5.6-sol
```

Start with `../prompts/codex/00-bootstrap.md`.

## Production adapters

- `src/infrastructure/auth` verifies a Supabase access token before any service-role persistence call.
- `src/infrastructure/persistence` implements the investigation store through versioned, actor-scoped Postgres RPCs.
- `src/specialists/movie/infrastructure` resolves any structurally valid TMDB movie reference without treating provider metadata as evidence.
- `src/application/research-worker/executors` and the V1 registry compose durable `IDENTITY`, deterministic `SCOPING`, the attested `DISCOVERY` path, and resumable `RESOLUTION` when its body-free resolver capability is supplied; later unimplemented stages still fail closed.
- `src/infrastructure/persistence` authors immutable causal attempt manifests and persists the exact identity/output relationship through deployed migration 008.
- `src/infrastructure/research` contains the shadow-only OpenAI web-source discovery adapter plus a body-free deterministic source metadata resolver. Neither is connected to a public route.
- deployed migration 013, the worker-owned acceptance RPC, and `src/infrastructure/persistence/supabase-source-resolution-persistence.ts` provide actor-scoped RESOLUTION recovery, lease-fenced source/locator acceptance, exact replay, bounded same-attempt handoff, and a database-enforced completion partition.

Future visual libraries such as `gsap` or `@xyflow/react` remain intentionally deferred; the prototype UI is not the production build target.

## V3 architecture additions

- `src/lib/agent/engine-boundaries.ts` — core/specialist interface;
- `src/lib/agent/investigator-profile.ts` — thinking modes and calibration;
- `src/lib/security/untrusted-content.ts` — hostile source boundary;
- `src/lib/telemetry/events.ts` — private-content-safe event contracts;
- `supabase/migrations/003_profiles_instrumentation.sql` — profiles, runs, provenance, and events;
- Vitest unit-test scaffold.

## Interaction

The bottom surface is intentionally a direction console. Submit a theory or question and the main screen opens a branch; it does not build a chat transcript. Scroll to the end of the root case to try Close Investigation and the sourced visual-script preview.
