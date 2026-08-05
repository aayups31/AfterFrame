# 33 — Security, Privacy, and Threat Model

## Assets to protect

- API keys and service credentials;
- private case titles and project intent;
- unreleased scripts and notes;
- user-owned files and excerpts;
- browsing context captured by a future companion;
- source resolver credentials;
- model prompts and system policy;
- cross-case memory;
- provenance records.

## Primary threats

### Prompt injection from sources

Webpages, PDFs, transcripts, captions, comments, and imported documents may contain instructions intended to manipulate the model.

Controls:

- treat source content as quoted untrusted data;
- never concatenate it into system instructions;
- isolate tool outputs with typed boundaries;
- strip scripts, hidden content, and irrelevant navigation;
- prohibit source text from changing tools, permissions, budgets, or policies;
- run injection detection and record warnings;
- require deterministic locator verification outside model judgment.

### Data exfiltration

A malicious source may ask for notes, prior cases, system prompts, or secrets.

Controls:

- retrieve only the active branch neighborhood;
- never expose unrelated case memory to source-analysis workers;
- redact secrets before model calls;
- use separate scoped workers for untrusted content;
- maintain allow-listed output schemas;
- audit tool arguments.

### Fabricated or poisoned evidence

Controls:

- canonical source identity;
- content fingerprinting;
- independence groups;
- source reputation is a signal, not proof;
- exact-locator verification;
- preserved raw metadata;
- user correction workflow;
- adversarial source search for material claims.

### Unauthorized copyrighted content

Controls:

- link-only records where rights are unclear;
- short excerpts only where legally appropriate;
- user attestation for owned uploads;
- no paywall bypass;
- no reconstruction of full works from fragments;
- retention limits and deletion controls.

### Over-broad browser permissions

Future companion controls:

- active-tab permission by default;
- domain allow-list per research session;
- visible capture indicator;
- no background history collection;
- expiry for permission sessions;
- local preprocessing where possible;
- clear delete/export controls.

### Account and authorization failures

- row-level security on all user data;
- project and team role checks;
- signed upload URLs;
- server-only API keys;
- rate limiting;
- CSRF protection for state-changing routes;
- audit logs for exports and shared links.

## Privacy defaults

- cases are private;
- analytics exclude content bodies;
- cross-case memory is opt-in and inspectable;
- users can detach a note or case from memory;
- imported files have explicit retention settings;
- deleted cases remove derived embeddings and queued jobs;
- no training on user content without explicit consent.

## Security test cases

Maintain fixtures containing:

- direct prompt injection;
- hidden HTML instructions;
- poisoned PDF footers;
- fake citations and redirect URLs;
- source text requesting private notes;
- conflicting metadata;
- duplicate articles syndicated from one origin;
- malformed locators;
- oversized input and decompression bombs.

## Incident readiness

Document how to:

- disable a source adapter;
- revoke extension sessions;
- cancel active research jobs;
- rotate credentials;
- identify affected cases;
- notify users;
- re-run verification after a resolver bug.
