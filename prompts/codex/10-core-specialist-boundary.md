# Codex Phase 10 — Core / Movie Specialist Boundary

Read `WHY.md`, `docs/26-engine-and-specialist-boundary.md`, and `AGENTS.md`.

Implement the interface seam without generalizing the V1 UI:

1. define domain-neutral investigation core contracts;
2. define `InvestigationSpecialist`;
3. implement a Movie Investigator manifest and research-axis provider;
4. ensure core modules do not import movie implementation modules;
5. add compile-time or test-level enforcement where practical;
6. preserve the existing mocked Black Hawk Down flow;
7. document any deliberate coupling in an ADR.

Do not add another specialist or generic-topic intake.
