# Codex Phase 5 — Movie Specialist and Theory Engine

Read:

- `docs/18-movie-research-specialization.md`
- `docs/19-theory-engine.md`
- `prompts/system/movie-investigator-orchestrator.md`
- `evals/movie-investigator-eval-set.jsonl`

Implement typed services for:

1. movie research-axis routing;
2. exact film version and cut identity;
3. source-class planning;
4. user-theory decomposition;
5. support, pressure, contradiction, alternatives, and unknown lanes;
6. adversarial source search;
7. qualitative support-state assessment;
8. calibrated one-line investigator response.

Use deterministic curated fixtures before live search. Never infer that the system watched a full film. Treat user-provided frames, scripts, notes, and permitted clips as explicit film-text inputs. Preserve creator intent separately from textual interpretation.

Add regression tests for every eval fixture and at least five negative cases involving invented quotes, dependent sources, version confusion, confirmation bias, and similarity mistaken for influence.
