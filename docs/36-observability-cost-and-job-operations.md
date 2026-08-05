# 36 — Observability, Cost, and Job Operations

## Why this is core product architecture

An agentic investigation can fail partially: search succeeds while a locator fails, one branch times out while another streams, or a model creates valid JSON with poor evidence. The application must make these states observable and recoverable.

## Trace model

Every investigation action receives:

- `trace_id` for the user action;
- `run_id` for each orchestrator run;
- `job_id` for each external or model task;
- `model_id`, prompt version, schema version, and reasoning effort;
- tool call metadata;
- input/output token and cost estimates;
- source IDs and locator IDs produced;
- retry and cancellation state.

Do not store hidden reasoning. Store decisions, structured outputs, tool records, and provenance.

## Job states

```text
queued → running → checkpointed → succeeded
                   ↘ degraded
                   ↘ failed_retryable → queued
                   ↘ failed_terminal
                   ↘ cancelled
```

A case may continue in degraded mode when nonessential jobs fail. The UI must not imply that all planned source classes were completed.

## Budgets

Set per-case and per-branch limits for:

- web searches;
- source fetches;
- resolver attempts;
- model tokens;
- wall-clock time;
- concurrent jobs;
- premium-model escalations.

The orchestrator may request an increase, but cannot silently exceed user or system budgets.

## Model routing

- use Sol for complex orchestration, theory pressure-testing, difficult contradiction resolution, and closure audit;
- use Terra for bounded extraction, classification, candidate normalization, and duplicate grouping after evaluation;
- use deterministic code for locators, URL handling, hashes, graph operations, and policy checks;
- never use a cheaper model as final verifier solely for cost.

## Operational dashboards

Track:

- first-beat latency;
- resolver success by source class;
- failed and degraded cases;
- unsupported claim rate;
- cost distribution by activated case;
- branch queue age;
- duplicate evidence rate;
- user corrections;
- source adapter failures;
- prompt-injection alerts.

The product UI must remain free of dashboard aesthetics; internal operations may use them.

## Retry rules

- idempotency keys for all state-changing jobs;
- exponential backoff for transient network failures;
- bounded repair attempts for invalid model output;
- no blind retry on policy or rights failures;
- preserve partial verified work;
- notify the orchestrator when repeated retries reduce source diversity.

## Development mode

Support deterministic fixture mode with no external calls. Every major route must have:

- mock success;
- slow response;
- empty result;
- malformed model output;
- locator failure;
- partial source-class failure;
- cancellation.
