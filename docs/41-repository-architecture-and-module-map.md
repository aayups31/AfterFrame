# 41 — Repository Architecture and Module Map

## Start simple, preserve seams

The included `starter/` remains a single Next.js application for speed. Keep module boundaries inside it before converting to a monorepo.

Recommended V1 modules:

```text
src/
  app/                         routes and server entry points
  components/
    home/                      film portal only
    investigation/             beat rendering and user interaction
  lib/
    core/                      domain-neutral case/branch/evidence logic
    agent/                     orchestration contracts and policies
    specialists/movie/         Movie Investigator implementation
    sources/                   discovery and resolver interfaces
    provenance/                claim/evidence/input graph
    security/                  untrusted-content and rights boundaries
    telemetry/                 privacy-safe events and traces
    fixtures/                  deterministic golden-case data
```

Do not create a generic plugin framework before a second specialist is justified. One explicit Movie Investigator implementation behind a stable interface is enough.

## Dependency direction

```text
UI → application services → core interfaces
                         ↘ specialist interface
Movie specialist → core types + source interfaces
Core ─X→ movie specialist implementation
Resolvers ─X→ UI
Telemetry ─X→ private content bodies
```

Use dependency-inversion checks or import linting when the module count grows.

## Service boundaries

### Application layer

Owns:

- auth and authorization;
- request validation;
- idempotency;
- orchestration entry points;
- streaming transport;
- cancellation;
- mapping domain events to UI events.

### Core domain

Owns:

- cases;
- branches;
- directions;
- sources and locators;
- claims and evidence;
- notes and connections;
- provenance;
- closure state.

Core functions should be deterministic wherever possible.

### Movie specialist

Owns:

- film identity;
- version/cut resolution policy;
- movie research axes;
- film-specific source ranking;
- adaptation, production, formal, historical, scientific, mythological, and reception semantics;
- film eval fixtures;
- creator modes.

### Infrastructure

Owns:

- OpenAI provider;
- web search provider;
- document extraction;
- YouTube/public-video adapter;
- PDF and book locator adapters;
- persistence;
- queues;
- object storage;
- observability.

## Future monorepo migration

Only after V1 stabilizes:

```text
apps/studio
apps/companion-extension
packages/investigation-core
packages/movie-investigator
packages/source-adapters
packages/contracts
packages/ui
packages/evals
```

The extension must consume contracts and APIs; it must not directly import server-only orchestration or database code.

## Streaming contract

Use typed server events rather than token streaming as the product protocol:

```text
case.intent_ready
job.status_changed
beat.ready
beat.revised
source.candidate_found
locator.verified
branch.opened
branch.updated
connection.proposed
case.degraded
case.failed
```

The UI can animate complete semantic units and remain resilient to retries and reordering.
