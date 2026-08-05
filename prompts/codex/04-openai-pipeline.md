# Codex Phase 2 — OpenAI Investigation Pipeline

Read:

- `docs/05-agent-system.md`
- `docs/06-evidence-and-source-locators.md`
- `docs/09-api-contracts.md`
- `docs/10-trust-rights-and-safety.md`

Implement only the first server-side pipeline:

1. intent interpretation;
2. source discovery with the OpenAI Responses API web search tool;
3. strict structured output for source candidates and a provisional case plan;
4. persistence behind repository interfaces;
5. a mock mode with deterministic fixtures;
6. full tool-call and prompt-version logging;
7. failure and degraded states.

Do not yet claim exact timestamp/page support unless the resolver verified it. Do not let the model generate raw source URLs that bypass resolver validation.

Write unit tests for schema validation and unsupported model output. Keep API keys server-only.
