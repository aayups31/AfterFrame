# 29 — Research Companion Extension (Post-Core)

## Product role

The extension is an alternate client of the same AFTERFRAME engine. It meets
users where research already happens without creating a second research
pipeline or forcing every action through the full investigation interface. The
durable case—not a particular screen—remains the product object and source of
truth.

```text
Web / PDF / YouTube / permitted reader
              ↓
AFTERFRAME COMPANION
context, highlights, page identity, exact location
              ↓
AUTHENTICATED AFTERFRAME API
              ↓
AFTERFRAME CORE + MOVIE INVESTIGATOR
              ↓
DURABLE CASE
trail, evidence, notes, branches, provenance
              ↓
MAIN INVESTIGATION OR COMPANION SURFACE
```

The forbidden architecture is:

```text
browser page → extension prompt → model answer
```

Every companion action must use the same Watson direction intelligence,
research jobs, source-resolution policy, evidence gates, provenance graph, and
Postgres case state as the main investigation.

## Why it matters

Recurring professional users should not have to remember to start at AFTERFRAME. While they read or watch, the companion can:

- recognize the active case;
- understand the current page or video context;
- suggest related evidence;
- surface a contradiction or prior connection;
- capture a highlight with an exact locator;
- accept a theory and open a targeted branch;
- return results into the case rather than filling a sidebar transcript.

The companion may show bounded status, clarification, and evidence previews,
but it is not a chat destination and does not duplicate the paced case reader.
Submitting “challenge this,” “connect this,” or “investigate the original
claim” creates the same typed direction event and branch transition as the main
console.

## Why it is not V1

An extension adds:

- permissions and privacy complexity;
- hostile and inconsistent page environments;
- prompt-injection exposure;
- content-script lifecycle issues;
- browser-store review;
- site-specific adapters;
- duplicate capture and sync reconciliation;
- greater support burden.

Build it only after the standalone case proves the investigation loop.

The extension is therefore post-core even though its API and hostile-input
boundaries should be anticipated now. Database, worker, resolver, evidence,
Watson, and domain-evaluation gates must pass before extension implementation.

## Minimal future companion

### Supported contexts

Start with:

1. normal public webpages;
2. YouTube pages with accessible metadata and timestamps;
3. local or web PDFs where the user explicitly activates the extension.

Do not claim universal Kindle, streaming-service, or paywalled-book support.

### User actions

- Add page to case
- Add selection as evidence candidate
- Add thought
- Investigate this claim
- Find connections
- Open case in studio
- Open original source from case evidence

### Passive behavior

Passive suggestions must be rare and dismissible. The extension must not continuously transmit browsing history. Context capture begins only when:

- the user activates it;
- the domain is allow-listed for the active case;
- the user selects text;
- the user enables a time-bounded research session.

## Security boundary

Treat all page text as untrusted evidence, never as instructions. Strip scripts and hidden text. Record capture origin. Never expose system prompts, private notes, or unrelated case memory to page content.

The extension stores no provider API key. It authenticates to the AFTERFRAME
server, sends only user-authorized context, and never continuously uploads
browsing history. A captured URL or selection enters as a source candidate; it
cannot become accepted evidence until the normal resolver, rights, locator, and
review gates pass.

## Context packet

```ts
type CompanionContextPacket = {
  caseId: string;
  canonicalUrl: string;
  title: string;
  contentType: "webpage" | "youtube" | "pdf";
  selection?: string;
  surroundingText?: string;
  locator?: SourceLocator;
  userIntent: "capture" | "connect" | "investigate" | "summon";
  capturedAt: string;
  permissionSessionId: string;
};
```

## Success gate

Build the companion when at least five recurring users independently say some version of:

> I want this beside the research I already do.

The success metric is not extension installs. It is the percentage of captured items that become useful case evidence, notes, or branches.
