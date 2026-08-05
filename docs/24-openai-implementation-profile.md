# 24 — OpenAI Implementation Profile

> Verified against official OpenAI developer documentation on August 4, 2026. Re-check model IDs, pricing, and beta status before production deployment.

## Default model routing

### GPT-5.6 Sol / `gpt-5.6`

Use for:

- investigation orchestration;
- difficult source-plan decisions;
- theory decomposition and adversarial evaluation;
- contradiction resolution;
- narrative sequencing when context is complex;
- closure audit and synthesis;
- final provenance review.

The `gpt-5.6` alias currently routes to GPT-5.6 Sol. For reproducible evals, pin a snapshot when one is available and store the exact model ID with every derived record.

### GPT-5.6 Terra

Consider for:

- source-candidate triage;
- bounded classification;
- metadata normalization;
- entity extraction;
- first-pass duplicate grouping;
- routine branch summaries.

Promote uncertain or high-impact cases to Sol.

### GPT-5.6 Luna

Consider only after evaluation for high-volume, low-risk transformations such as formatting already verified records. Do not use it as the final verifier merely because it is cheaper.

## Responses API

Use the Responses API for reasoning, tool use, streaming, and multi-turn state. Keep the product state in your own typed database rather than treating model conversation state as the case database.

## Tool strategy

### Web search

Use for discovery and current public-source retrieval. Search results create candidates, not verified evidence. A resolver and verifier must still establish source identity, access state, relevance, independence, and exact locator.

### File search

Use for user-provided scripts, notes, research packs, and permitted documents. Keep the original file, extracted text, and source locator identity separate.

### Programmatic Tool Calling

Use only for bounded operations where code can safely reduce many tool outputs—for example deduplication, metadata joining, ranking, and deterministic validation. Keep semantic judgment, theory assessment, and final verification as explicit model stages.

### Multi-agent beta

Potentially useful for parallel source-class workstreams such as film text, production history, real-world context, and adversarial theory search. Treat it as an optimization, not the product architecture. Each subagent must return typed records with source provenance, and the orchestrator must still run a final verification pass.

## Reasoning settings

- Begin with `medium` for normal orchestration.
- Evaluate `high` or `xhigh` for difficult theory and contradiction cases.
- Use `max` or Pro mode only where measured quality gains justify latency and cost, such as sensitive historical cases or final closure provenance review.
- Use lower effort for deterministic formatting and already-bounded transformations.

Do not assume a higher reasoning setting automatically improves locator accuracy. Locator accuracy depends primarily on resolver evidence and validation.

## Prompt and context strategy

- Keep system prompts lean and stage-specific.
- Cache stable movie ontology, source taxonomy, and output schemas.
- Retrieve only the active branch neighborhood, relevant notes, and exact evidence needed for the current stage.
- Preserve reasoning continuity only where it improves multi-turn branch work; do not use hidden model history as the sole record of decisions.
- Store model, prompt, tool, query, and schema versions.

## Background execution

For the future autonomous mission mode, use durable application jobs and, where appropriate, supported background response execution. The application must own cancellation, budgets, checkpoints, and state reconciliation.

## Official references

- https://developers.openai.com/api/docs/models/gpt-5.6-sol
- https://developers.openai.com/api/docs/models
- https://developers.openai.com/api/docs/guides/latest-model
- https://developers.openai.com/api/docs/guides/tools-web-search
- https://developers.openai.com/api/docs/guides/structured-outputs
