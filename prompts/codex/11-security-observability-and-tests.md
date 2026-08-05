# Codex Phase 11 — Security, Observability, and Tests

Read docs 31, 33, 35, and 36.

Implement:

- typed telemetry with content redaction;
- trace/run/job identifiers;
- idempotency helpers for state-changing routes;
- untrusted-source isolation utility;
- deterministic fixtures for malformed model output, prompt injection, locator failure, and partial source failure;
- unit tests for calibration, security boundaries, and event redaction;
- route-level error envelopes;
- cost/latency metadata types without exposing them in the premium product UI.

Do not log private note bodies, source excerpts, or user project names.
