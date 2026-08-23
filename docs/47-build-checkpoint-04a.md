# Build Checkpoint 04A — Durable Identity and Causal Inputs

Checkpoint 04A implements the first real production research stage without
turning AFTERFRAME into a prompt wrapper. The durable worker now has a concrete
`IDENTITY` executor, a Movie Investigator TMDB resolver, and a Postgres-authored
causal input manifest. The stage can establish public movie identity metadata;
it cannot create research claims, evidence, source candidates, prose, or a
user-facing answer.

## Release status

- The TypeScript, adapter, migration, and rollback-test implementation is
  complete and locally verified.
- Migrations 001–008 are deployed to the configured Supabase project.
- The guarded migration preflight applied migration 008 inside a transaction,
  verified the complete catalog posture, and restored the exact 001–007
  baseline before the forward-only deployment.
- The post-deploy Supabase/TMDB lifecycle passes through start, durable identity
  resolution and completion, actor-scoped identity read, causally bound
  `SCOPING` claim, checkpoint, retryable handoff, and same-attempt reclaim. The
  test transaction restores exact baseline row counts and production retains
  zero research runs.
- The public investigate route remains disabled outside mock mode.

This distinction is intentional: local code completion is not represented as a
deployed or complete research agent.

## Why this is engine work, not wrapper work

The model of work is durable research state rather than a chat transcript:

```text
owned case + pinned specialist plan
→ Postgres-authored IDENTITY attempt manifest
→ server-only public identity resolution
→ resolver-verified identity record (still NOT_EVIDENCE)
→ exact IDENTITY output and provenance link
→ next-stage manifest bound to that identity and predecessor output
```

The database, not a prompt or caller, chooses the causal inputs. Each attempt
is lease-owned, replayable, and tied to an exact plan, subject fingerprint,
predecessor, identity, execution tool, output, and provenance chain. Later
stages can therefore reason from inspectable state instead of trusting a model
to remember what happened.

## What is implemented

### Domain-neutral causal manifests

- A strict Postgres-authority envelope records the manifest fingerprint and
  authorship time separately from its contents.
- `IDENTITY` is always a causal root with an unbound identity.
- Every later stage must bind the immediately preceding job, attempt, output,
  output fingerprint, resolved subject identity, and identity fingerprint.
- Manifests carry only fingerprints and durable identifiers. Exact curiosity,
  movie title, notes, source bodies, and other private text do not enter them.
- Attempt request fingerprints are database-authored from canonical inputs;
  callers cannot choose or overwrite them.

### First concrete durable executor

- The executor reads actor-scoped identity context from Postgres and rejects any
  drift between the claim, plan, manifest, subject type, specialist, or resolver
  descriptor before making an external call.
- The injected Movie Investigator resolver accepts any structurally valid TMDB
  movie reference. There is no title allowlist and Black Hawk Down remains only
  a deterministic regression fixture.
- Resolver output is limited to public display name, alternate names,
  disambiguators, stable identity fingerprint, resolver identity, and resolved
  time. TMDB overview and tagline text never cross the adapter boundary.
- IDENTITY returns exactly one identity record and one linked stage output. It
  returns no candidates, untrusted content, evidence, claims, or prose.
- Resolved and unresolved identity requirements must be unique, disjoint, and
  exactly partition the authoritative specialist plan. An unresolved film
  version produces the single bounded degradation reason
  `identity-requirements-unresolved`.
- Produced timestamps are floored against both resolver time and the
  database-authored attempt start, so worker clock skew cannot invalidate an
  otherwise valid completion.

### Bounded TMDB boundary

- The API key is server-only and never appears in client code, telemetry, or
  failure output.
- Requests are abort-aware and use bounded timeouts.
- Provider bodies are decoded as a stream with a one-mebibyte hard cap. Chunked
  oversized responses are cancelled before unbounded buffering; split UTF-8
  code points and byte counts are handled correctly.
- Telemetry records one tool call, request/response bytes, latency, provider run
  identity, and honestly unknown pricing as `UNPRICED` with a null amount.
- Not found, rate limiting, authentication, timeout, upstream, malformed, and
  unexpected responses map to bounded body-free outcomes.

### Migration 008

`008_identity_causal_manifests.sql` adds:

- forced-RLS, default-deny `af_resolved_subject_identities`;
- forced-RLS, default-deny `af_research_attempt_input_manifests`;
- the exact subject-identity link on research stage outputs;
- a deferrable constraint trigger proving the identity/output relationship;
- identity and manifest immutability while the owning run exists, with parent
  cascades preserved for the future actor-scoped case/account deletion flow;
- immutability of case specialist, subject, and exact curiosity after research
  begins;
- versioned service-only claim and completion RPCs;
- actor-scoped identity context and resolved-identity readers.

The v2 claim RPC authors the canonical manifest and request fingerprint under
locked authoritative rows. The v2 completion RPC recomputes the full result
fingerprint, enforces exact plan partitioning and resolver provenance, and
atomically persists the identity/output link. Old v1 claim and completion RPCs
lose service-role execution at cutover.

The migration fails closed if any legacy research run, start reservation, or
start replay snapshot exists. A terminal legacy attempt is unsafe because a v2
replay could select it without a causal manifest; a queued legacy run is unsafe
because its immutable start replay bundle predates `subjectIdentities`.
Environments with legacy research state require an explicit backfill before
migration.

## Trust posture

Resolved movie metadata has these fixed states:

- data class: `PUBLIC`;
- verification: `RESOLVER_VERIFIED`;
- evidence: `NOT_EVIDENCE`;
- review: `PROPOSED`;
- publication authority: `NONE`.

Identifying a movie is not evidence for a claim about that movie. Search results
will likewise remain candidates until separate resolution, locator, evidence,
and corroboration gates establish what can be shown.

## Verification

Use the pinned Node.js 22.13.0 toolchain:

```bash
cd starter
nvm use
npm run check
```

Current local release gates pass strict TypeScript, ESLint with no warnings,
241 unit/static tests, the production Next.js build, the repository build-kit
validator, and `npm audit` with zero known vulnerabilities. Three database
tests remain explicitly guarded rather than silently mocked.

The deployment gate applies migration 008 inside a rollback-only transaction
and compares the entire database catalog and row counts before and after. Its
constraint assertion covers all 37 deliberately named checks, foreign keys,
unique keys, primary keys, and the deferred constraint-trigger record:

```bash
cd starter
nvm use
npm run test:migration:008:predeploy
```

The post-deploy gate runs the real rollback lifecycle:

```bash
cd starter
nvm use
AFTERFRAME_DB_INTEGRATION=1 npx vitest run \
  src/infrastructure/persistence/__tests__/checkpoint-03-postgres.integration.test.ts
```

That test uses a generic non-Black-Hawk-Down movie and the real TMDB adapter to
prove start → IDENTITY claim → resolution → v2 completion → actor-scoped read →
causally bound SCOPING claim. It then proves checkpoint → retryable handoff →
same-attempt reclaim on SCOPING and rolls the full transaction back to exact
baseline counts.

From the repository root:

```bash
python3 scripts/validate-kit.py
```

## Deliberately not enabled

- no live `/api/investigate` composition;
- no model call in IDENTITY;
- no generated research answer;
- no source candidate treated as evidence;
- no source-body ingestion, locator verification, evidence normalization,
  corroboration, narrative sequencing, or investigation rendering;
- no Watson expansion, browser companion, world model, collaboration, or
  additional specialist.

## Next production slice: Checkpoint 04B

04B begins with deterministic durable `SCOPING`, then adds durable multi-axis
`DISCOVERY`. It must not simply connect the existing OpenAI adapter.

The required design constraints are:

1. Bind discovery to the full Postgres input-manifest fingerprint, resolved
   identity, predecessor output, attempt, and lease—not the weaker stage seed.
2. Submit all selected Movie V1 axes in one bounded background response and
   produce only deduplicated candidate metadata tagged with axis IDs.
3. Persist a body-free provider-run record atomically with the
   provider-accepted checkpoint so a crash can resume the same paid response.
4. Distinguish durable user/run cancellation from shutdown or lease loss. Only
   durable cancellation may cancel the provider response.
5. Validate every candidate URL against actual web-search sources or citations;
   discard generated prose, bodies, instructions, and unsupported URLs.
6. Keep candidates `UNTRUSTED`, `NOT_EVIDENCE`, `PROPOSED`, and `NONE`, with
   exact output/candidate set equality at completion.
7. Treat the exact question as private provider input. `store: false` is not a
   ZDR claim; required MAM/ZDR policy attestation must fail closed when absent.
8. Keep cost, usage, model, tool, trace, bytes, latency, and provenance truthful;
   unknown price remains null rather than zero.
9. Keep the public route disabled until later source, locator, evidence, claim,
   contradiction, sequencing, and domain-evaluation gates pass.
