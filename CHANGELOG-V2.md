# AFTERFRAME Build Kit V2 — What Changed

This revision incorporates the complete product direction developed after the first kit.

## Product changes

- The bottom investigator surface is now a **direction console**, not a chat product.
- A user theory, question, lead, connection, or instruction creates or redirects an **investigation branch** in the main experience.
- The agent may acknowledge the direction briefly and humanly, but the result appears in the investigation itself—not as a long message.
- A dedicated **theory engine** separates support, contradiction, alternative explanation, and unresolved uncertainty.
- The agent is now explicitly specialized for movie research across film text, screenplay, production, authorship, versions/cuts, adaptation, history, science, mythology, criticism, reception, and community interpretation.
- A new **Close Investigation** flow can preserve the case as-is or synthesize the completed research into a traceable visual script, documentary outline, research dossier, essay structure, or director brief.
- Generated closure artifacts remain editable and every statement can trace back to user notes, accepted theories, evidence, and source locators.
- The future **Work While I’m Gone** mode is designed now as an architectural seam but remains intentionally deferred until the foreground experience is trusted.

## Engineering changes

- Added branch, direction, theory-assessment, and closure-artifact domain models.
- Added API contracts and mock route handlers for direction and closure flows.
- Added a second database migration for branches, directions, theory assessments, closure sessions, artifacts, and future autonomous missions.
- Added specialized system prompts and evaluation fixtures.
- Updated the starter UI to demonstrate input-driven branch creation and investigation closure without becoming a chat interface.
