# AFTERFRAME Movie Investigator Starter — V3

This is a mocked vertical slice. Approve the experience before building the expensive research system.

The starter preserves a domain-neutral investigation-core interface while implementing only the Movie Investigator specialist. It is not a generic research app.

## Run

```bash
npm install
cp .env.example .env.local
npm run dev

# Before committing
npm run check
```

Node.js 20.9+ is required by the current Next.js documentation.

## Routes

- `/` — film portal and curiosity prompt
- `/case/black-hawk-down` — mocked investigation with direction-driven branching and closure preview
- `POST /api/investigate` — mock by default; optional OpenAI provisional intent call
- `POST /api/cases/:caseId/directions` — typed mock branch instruction
- `POST /api/cases/:caseId/close` — typed mock closure request

## Important

The evidence links and locators in `src/lib/mock-case.ts` are clearly marked mock. They exist only to exercise the source-inspection UI. Do not present them as production evidence.

## Build with Codex

From this directory:

```bash
codex -m gpt-5.6-sol
```

Start with `../prompts/codex/00-bootstrap.md`.

## Optional later dependencies

Add `gsap` for authored scroll sequences, `@xyflow/react` for the world editor, and `@supabase/supabase-js` when those phases begin. They are intentionally excluded from the first vertical slice.

## V3 architecture additions

- `src/lib/agent/engine-boundaries.ts` — core/specialist interface;
- `src/lib/agent/investigator-profile.ts` — thinking modes and calibration;
- `src/lib/security/untrusted-content.ts` — hostile source boundary;
- `src/lib/telemetry/events.ts` — private-content-safe event contracts;
- `supabase/migrations/003_profiles_instrumentation.sql` — profiles, runs, provenance, and events;
- Vitest unit-test scaffold.

## Interaction

The bottom surface is intentionally a direction console. Submit a theory or question and the main screen opens a branch; it does not build a chat transcript. Scroll to the end of the root case to try Close Investigation and the sourced visual-script preview.
