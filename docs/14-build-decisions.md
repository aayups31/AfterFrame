# 14 — Recommended Build Decisions

## Frontend

- Next.js App Router;
- TypeScript;
- CSS custom properties and scoped CSS or Tailwind used sparingly;
- GSAP/ScrollTrigger for authored scroll sequences after the core document works without JavaScript;
- `@xyflow/react` only for the spatial world editor, heavily restyled to remove default node-card aesthetics;
- server-render initial case state;
- stream later beats.

## Backend

- Next.js route handlers for the first vertical slice;
- Postgres/Supabase for durable case data;
- object storage for permitted source snapshots and user uploads;
- a background-job system once research exceeds request lifetimes;
- server-sent events for one-way research/beat progress;
- typed domain events.

## AI

- OpenAI Responses API;
- GPT-5.6 / GPT-5.6 Sol for orchestration and difficult reasoning;
- GPT-5.6 Terra or Luna for bounded, evaluated volume work where cost matters;
- web search tool for discovery;
- strict Structured Outputs;
- separate prompts per pipeline stage, including direction routing, film source scouting, theory assessment, and closure synthesis;
- evaluator passes for locator and claim integrity;
- model and prompt version stored with every derived record.

## Search and source acquisition

Create adapter interfaces:

```ts
interface SourceDiscoveryAdapter {
  discover(query: ResearchQuery): Promise<SourceCandidate[]>;
}

interface SourceResolverAdapter {
  supports(source: SourceCandidate): boolean;
  resolve(source: SourceCandidate): Promise<ResolvedSource>;
}
```

Adapters may later support:

- normal web pages;
- YouTube metadata/transcripts through compliant access;
- podcasts;
- PDFs;
- user uploads;
- public archives;
- publisher or library links.

## Why not a monolithic agent framework first

The hard product problem is not agent branding. It is:

- trustworthy evidence normalization;
- exact locators;
- adaptive sequencing;
- preserving user agency;
- premium rendering.

Plain typed services and a state machine are easier to inspect and evaluate. Add a specialized orchestration framework only when the workflow requires it.

## Performance budgets

- home initial JavaScript: keep intentionally small despite visual ambition;
- investigation reading route: prioritize text and state over effects;
- lazy-load graph editor and source media;
- do not load all source transcripts into the browser;
- precompute visual directives;
- respect low-power and reduced-motion modes.

## Background execution

Do not describe browser closure as offline execution. Future “work while I’m gone” uses durable server-side jobs, explicit mission budgets, checkpoints, cancellation, and a return digest. Reuse the foreground research-run model.
