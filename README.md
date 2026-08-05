# AFTERFRAME — Movie Investigator Build Kit V3

> **Working codename:** AFTERFRAME  
> **North star:** *The film ends. The world opens.*

AFTERFRAME begins with the world's best Movie Investigator and is architected toward a domain-neutral investigation engine. V1 turns the curiosity left by a movie into an agent-created investigation. The user does not search for sources or receive a compressed AI answer. The agent assembles the strongest evidence, reveals it with deliberate pacing, provides exact routes back to originals, and lets the user read, think, question, annotate, and connect ideas until they have built a personal world behind the film.

## Read this first

Start with `START_HERE.md`, then `WHY.md`. These files lock the build order and the distinction between the reusable investigation engine and the movie-specialist layer.

This kit contains:

- a product and interaction specification;
- the visual and motion language;
- the multi-agent research architecture;
- direction-driven investigation branching rather than chat;
- a specialized movie-research ontology and theory engine;
- Close Investigation and a traceable visual-script creation studio;
- a deferred but predesigned autonomous mission architecture;
- exact-source locator and trust design;
- the note, graph, flow, and cross-case system;
- a database model and API contracts;
- a finals-safe roadmap and a full build roadmap;
- Codex / GPT-5.6 Sol prompts;
- a runnable standalone concept prototype;
- a Next.js starter repository with a mocked vertical slice;
- creator workflows for documentary, biopic, adaptation, and fact-check research;
- investigation modes and calibration;
- a post-core browser companion architecture;
- validation, retention, pricing, and distribution experiments;
- security, prompt-injection, privacy, accessibility, performance, cost, and observability plans;
- testing and launch gates;
- operating templates for cases, source audits, usability sessions, ADRs, and eval reports.

## Start in five minutes

### 1. View the concept prototype

Open:

```text
prototype/afterframe-concept.html
```

It runs locally with no installation.

### 2. Run the starter app

The current Next.js documentation requires Node.js 20.9 or newer.

```bash
cd starter
npm install
cp .env.example .env.local
npm run dev
```

Visit `http://localhost:3000`.

The starter runs in mock mode without an API key. Add `OPENAI_API_KEY` to enable the investigation route.

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

Build **Black Hawk Down — “Why did everything go wrong?”** with:

1. one full cinematic home-to-case transition;
2. 8–12 investigation beats;
3. at least one book, one long-form video/interview, one archival or official document, and one article;
4. exact source locators;
5. a direction console that opens a theory branch in the main screen;
6. highlight-to-note;
7. one graph connection;
8. one cross-reference to a previous beat;
9. a simple user playlist;
10. a Close Investigation review;
11. a sourced visual-script preview;
12. a finished case-world view.

Do not start with auth, community features, a giant movie catalog, automated book ingestion, autonomous overnight research, or a general-purpose research engine.

## V1 boundary

Build the standalone Movie Investigator first. The general investigation engine is an internal architecture boundary, not a reason to support arbitrary topics in V1. The companion extension, additional specialists, and autonomous work remain documented but deferred.

## Read in this order

1. `START_HERE.md`
2. `WHY.md`
3. `docs/00-north-star.md`
4. `docs/26-engine-and-specialist-boundary.md`
5. `docs/01-product-spec.md`
6. `docs/02-experience-architecture.md`
7. `docs/04-investigation-interface.md`
8. `docs/17-direction-console-and-branching.md`
9. `docs/18-movie-research-specialization.md`
10. `docs/27-investigation-modes-and-calibration.md`
11. `docs/05-agent-system.md`
12. `docs/06-evidence-and-source-locators.md`
13. `docs/28-creator-workflows.md`
14. `docs/31-metrics-retention-and-instrumentation.md`
15. `docs/33-security-privacy-and-threat-model.md`
16. `docs/35-testing-and-quality-strategy.md`
17. `docs/23-final-build-plan.md`
18. `AGENTS.md`
19. `prompts/codex/00-bootstrap.md`

## External documentation used

- OpenAI GPT-5.6 Sol model: https://developers.openai.com/api/docs/models/gpt-5.6-sol
- OpenAI Codex CLI: https://github.com/openai/codex
- OpenAI Responses API web search: https://developers.openai.com/api/docs/guides/tools-web-search
- OpenAI Structured Outputs: https://developers.openai.com/api/docs/guides/structured-outputs
- OpenAI developer quickstart: https://developers.openai.com/api/docs/quickstart
- Next.js installation: https://nextjs.org/docs/app/getting-started/installation
