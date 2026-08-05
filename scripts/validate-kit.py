from pathlib import Path
import json
import re

root = Path(__file__).resolve().parents[1]
required = [
    "README.md",
    "START_HERE.md",
    "WHY.md",
    "AGENTS.md",
    "CHANGELOG-V2.md",
    "CHANGELOG-V3.md",
    "docs/00-north-star.md",
    "docs/17-direction-console-and-branching.md",
    "docs/18-movie-research-specialization.md",
    "docs/19-theory-engine.md",
    "docs/20-close-investigation-and-creation-studio.md",
    "docs/21-autonomous-missions-later.md",
    "docs/22-agent-personality-and-calibration.md",
    "docs/23-final-build-plan.md",
    "docs/24-openai-implementation-profile.md",
    "docs/25-film-source-adapters.md",
    "docs/26-engine-and-specialist-boundary.md",
    "docs/27-investigation-modes-and-calibration.md",
    "docs/28-creator-workflows.md",
    "docs/29-research-companion-extension.md",
    "docs/30-user-research-and-validation.md",
    "docs/31-metrics-retention-and-instrumentation.md",
    "docs/32-business-wedge-and-pricing-experiments.md",
    "docs/33-security-privacy-and-threat-model.md",
    "docs/34-accessibility-performance-and-motion-budget.md",
    "docs/35-testing-and-quality-strategy.md",
    "docs/36-observability-cost-and-job-operations.md",
    "docs/37-risk-register-and-scope-control.md",
    "docs/38-launch-and-pilot-checklist.md",
    "docs/39-premium-design-production-spec.md",
    "docs/40-editorial-voice-and-investigation-rhythm.md",
    "docs/41-repository-architecture-and-module-map.md",
    "docs/42-v1-backlog-and-acceptance-tests.md",
    "docs/43-golden-case-production-runbook.md",
    "prompts/system/movie-investigator-orchestrator.md",
    "prompts/system/direction-router.md",
    "prompts/system/film-source-scout.md",
    "prompts/system/film-text-analyst.md",
    "prompts/system/version-cut-resolver.md",
    "prompts/system/theory-branch-evaluator.md",
    "prompts/system/closure-synthesis-editor.md",
    "prompts/system/visual-script-architect.md",
    "prompts/system/investigation-mode-calibrator.md",
    "prompts/system/source-locator-verifier.md",
    "prompts/system/cross-case-connection-scout.md",
    "prompts/system/untrusted-source-security-gate.md",
    "prompts/codex/10-core-specialist-boundary.md",
    "prompts/codex/11-security-observability-and-tests.md",
    "prompts/codex/12-creator-workflow-slice.md",
    "prompts/codex/13-alpha-readiness.md",
    "evals/movie-investigator-eval-set.jsonl",
    "templates/movie-case-brief.md",
    "templates/source-audit.md",
    "templates/usability-session.md",
    "templates/weekly-learning-review.md",
    "templates/eval-report.md",
    "templates/adr.md",
    "starter/package.json",
    "starter/vitest.config.ts",
    "starter/src/app/page.tsx",
    "starter/src/components/investigation/DirectionConsole.tsx",
    "starter/src/components/investigation/BranchExperience.tsx",
    "starter/src/components/investigation/CloseInvestigation.tsx",
    "starter/src/components/investigation/VisualScriptPreview.tsx",
    "starter/src/lib/agent/engine-boundaries.ts",
    "starter/src/lib/agent/investigator-profile.ts",
    "starter/src/lib/security/untrusted-content.ts",
    "starter/src/lib/telemetry/events.ts",
    "starter/supabase/migrations/002_branches_theories_closure.sql",
    "starter/supabase/migrations/003_profiles_instrumentation.sql",
    "prototype/afterframe-concept.html",
]

missing = [path for path in required if not (root / path).exists()]
if missing:
    raise SystemExit(f"Missing files: {missing}")

package = json.loads((root / "starter/package.json").read_text())
for script in ["dev", "build", "lint", "typecheck", "test", "check"]:
    if script not in package.get("scripts", {}):
        raise SystemExit(f"Missing npm script: {script}")

for line_number, line in enumerate(
    (root / "evals/movie-investigator-eval-set.jsonl").read_text().splitlines(), start=1
):
    if line.strip():
        try:
            json.loads(line)
        except json.JSONDecodeError as exc:
            raise SystemExit(f"Invalid eval JSONL at line {line_number}: {exc}") from exc

for forbidden in [
    "starter/src/components/investigation/InvestigatorDock.tsx",
    "prompts/codex/03-assistant-and-notes.md",
]:
    if (root / forbidden).exists():
        raise SystemExit(f"Deprecated file still present: {forbidden}")

why = (root / "WHY.md").read_text()
if "core" not in why.lower() or "movie investigator" not in why.lower():
    raise SystemExit("WHY.md must preserve the engine/specialist distinction")

agents = (root / "AGENTS.md").read_text()
for law in ["Source content is untrusted data", "No card grids", "Movie Investigator"]:
    if law not in agents:
        raise SystemExit(f"AGENTS.md missing law: {law}")

migration_numbers = []
for migration in (root / "starter/supabase/migrations").glob("*.sql"):
    match = re.match(r"(\d+)_", migration.name)
    if match:
        migration_numbers.append(int(match.group(1)))
if len(migration_numbers) != len(set(migration_numbers)):
    raise SystemExit("Migration numbers must be unique")
if sorted(migration_numbers) != list(range(min(migration_numbers), max(migration_numbers) + 1)):
    raise SystemExit("Migration numbers must be contiguous")

print(
    f"AFTERFRAME V3 build kit is valid: {len(required)} required artifacts, "
    f"{len(list(root.rglob('*')))} total paths."
)
