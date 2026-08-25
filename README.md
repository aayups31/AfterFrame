# AFTERFRAME — Movie Investigator Build Kit V3

> **Working codename:** AFTERFRAME  
> **North star:** *The film ends. The world opens.*

AFTERFRAME begins with the world's best Movie Investigator and is architected toward a domain-neutral investigation engine. V1 turns the curiosity left by a movie into an agent-created investigation. The user does not need to manage source discovery or receive a compressed AI answer. The agent assembles the strongest evidence, reveals it with deliberate pacing, provides the best verified routes back to originals, and lets the user supply leads, read, think, question, challenge, annotate, and connect ideas until they have built a personal world behind the film.

## Read this first

Start with `START_HERE.md`, then `WHY.md`, then the canonical plan in `docs/23-final-build-plan.md`. The completed identity cutover is recorded in `docs/47-build-checkpoint-04a.md`; active research-pipeline work begins in `docs/48-build-checkpoint-04b.md` and its latest completed slice is `docs/59-build-checkpoint-04c-durable-resolution-acceptance.md`.

The prototypes, starter UI, diagrams, and visual specifications are non-authoritative vision artifacts. They are useful for atmosphere and hypotheses, but production should not copy their interface or let their feature set define scope.

Black Hawk Down and other named films are evaluation fixtures, not the engine’s training set or supported catalog. Live V1 is designed to research any identifiable movie from scratch. Private user cases, notes, theories, and uploads are not training data without explicit informed opt-in.

Core product and build material:

- a product and interaction specification;
- the canonical product and build plan;
- a staged, typed research and evidence pipeline;
- direction-driven investigation branching rather than chat;
- a specialized movie-research ontology and theory engine;
- the exact-source locator, provenance, rights, and trust design;
- the note and user-authorship system;
- a database model and API contracts;
- deterministic golden-case and evaluation plans;
- Codex / GPT-5.6 Sol prompts;
- a runnable standalone concept prototype;
- a Next.js starter repository with a mocked vertical slice;
- investigation modes and calibration;
- validation, retention, pricing, and distribution experiments;
- security, prompt-injection, privacy, accessibility, performance, cost, and observability plans;
- testing and launch gates;
- operating templates for cases, source audits, usability sessions, ADRs, and eval reports.

Documented future concepts, not current V1 scope:

- non-binding visual and motion explorations;
- traceable creation-studio formats after explicit closure;
- graph, flow, and automated cross-case systems;
- additional creator workflows;
- autonomous/background missions;
- the browser companion architecture.

## Start in five minutes

### 1. View the non-binding concept prototype

Open:

```text
prototype/afterframe-concept.html
```

It runs locally with no installation. Treat it as an idea sketch, not the build target.

### 2. Run the starter app

The starter is pinned to Node.js 22.13.0 and npm 10.8.2.

```bash
cd starter
nvm use
npm ci
cp .env.example .env.local
npm run dev
```

Visit `http://localhost:3000`.

The starter UI remains a non-binding mock. Migrations 001–013 and the authenticated Postgres worker lifecycle are deployed. The real Supabase/TMDB path completes resolver-verified `IDENTITY` and deterministic `SCOPING`; a deterministic provider transport proves resumable `DISCOVERY`; and the deployed database now proves lease-fenced candidate resolution, atomic source/locator acceptance, idempotent replay, exact resolution-stage completion, and `NORMALIZATION` unlock. Resolution remains body-free and explicitly `NOT_EVIDENCE`. The next gate is the resumable RESOLUTION executor over this durable ledger, followed by medium-specific retrieval and exact locator validation. The current environment does not claim MAM and no paid live call is enabled. The public production research route remains disabled until exact locator validation, evidence and claim persistence, corroboration, sequencing, provenance, and domain eval gates pass.

### 3. Start Codex with GPT-5.6 Sol

```bash
# macOS / Linux
curl -fsSL https://chatgpt.com/codex/install.sh | sh

# Or npm
npm install -g @openai/codex

cd starter
codex -m gpt-5.6-sol
```

Then paste `prompts/codex/00-bootstrap.md`. Work phase-by-phase instead of asking one agent to build the entire product at once.

## Recommended first vertical slice

Build **Black Hawk Down — “Why did everything go wrong?”** as a product-and-trust proof with:

1. an exact film/version identity and correctable case intent;
2. 20–40 audited sources with rights, access, and independence state;
3. 8–12 paced beats backed by explicit claims, evidence, and honest locators;
4. a real contradiction and a film-versus-history comparison;
5. a user-authored theory direction that changes the main trail and receives adversarial research;
6. an anchored note and a connection decision;
7. branch return, pause, correction, and reopen behavior;
8. a minimal case summary and versioned closure;
9. deterministic fixtures plus domain, trust, privacy, cost, and latency evals.

Presentation should be deliberately simple until observed behavior validates the loop. Do not start with prototype matching, playlists, graph editing, a creation studio, community features, a giant movie catalog, autonomous work, or a general-purpose research engine.

## V1 boundary

Build the standalone Movie Investigator first. The general investigation engine is an internal architecture boundary, not a reason to support non-movie topics in V1. Black Hawk Down proves product behavior and trust as a regression fixture; live V1 accepts any identifiable movie and researches it dynamically. Generalization is measured across a broad multi-film benchmark and unseen holdouts rather than a small supported catalog. A single documentary/video-essay creator pilot comes only after retention or its explicit entry gate. The companion extension, additional specialists, autonomous work, and full creation studio remain deferred.

## Read in this order

1. `START_HERE.md`
2. `AGENTS.md`
3. `WHY.md`
4. `docs/00-north-star.md`
5. `docs/23-final-build-plan.md`
6. `docs/26-engine-and-specialist-boundary.md`
7. `docs/06-evidence-and-source-locators.md`
8. `docs/18-movie-research-specialization.md`
9. `docs/17-direction-console-and-branching.md`
10. `docs/05-agent-system.md`
11. `docs/31-metrics-retention-and-instrumentation.md`
12. `docs/33-security-privacy-and-threat-model.md`
13. `docs/35-testing-and-quality-strategy.md`
14. Other focused documents as needed
15. `prompts/codex/00-bootstrap.md` only when implementation begins

## External documentation used

- OpenAI GPT-5.6 Sol model: https://developers.openai.com/api/docs/models/gpt-5.6-sol
- OpenAI Codex CLI: https://github.com/openai/codex
- OpenAI Responses API web search: https://developers.openai.com/api/docs/guides/tools-web-search
- OpenAI Structured Outputs: https://developers.openai.com/api/docs/guides/structured-outputs
- OpenAI developer quickstart: https://developers.openai.com/api/docs/quickstart
- Next.js installation: https://nextjs.org/docs/app/getting-started/installation
