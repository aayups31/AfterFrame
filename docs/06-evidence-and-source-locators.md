# 06 — Evidence and Exact Source Locators

## Product promise

Every meaningful factual claim should answer:

1. What supports this?
2. Why was this source shown now?
3. Where exactly is the relevant original material?
4. What are the source’s limitations?
5. Can I open it myself?

## Data separation

Do not merge source, evidence, claim, and locator into one object.

```text
Source
  └── SourceLocator
         └── EvidenceFragment
                └── supports / contradicts Claim
```

## Locator schema

```ts
type SourceLocator = {
  kind: "article" | "video" | "podcast" | "pdf" | "book" | "archive" | "webpage";
  canonicalUrl?: string;
  originalUrl?: string;
  providerId?: string;

  // Video / audio
  timestampStartMs?: number;
  timestampEndMs?: number;
  transcriptCueIds?: string[];

  // PDF / book
  editionId?: string;
  isbn?: string;
  pageStart?: number;
  pageEnd?: number;
  printedPageLabel?: string;
  chapter?: string;
  section?: string;

  // Article / webpage
  headingPath?: string[];
  paragraphIndex?: number;
  textFingerprint?: string;
  textFragmentUrl?: string;

  // Verification
  resolvedAt?: string;
  resolverVersion: string;
  status: "verified" | "approximate" | "stale" | "unavailable";
};
```

## Original-opening behavior

### YouTube or other timestamp-capable video

Open at the relevant time. Show an end time in the UI even if the external provider only accepts a start time.

### Podcast

Use a provider deep link where supported; otherwise show the exact timestamp before opening.

### PDF

Use a `#page=` fragment only when the viewer supports it. Always show the printed page label because PDF index pages and printed pages may differ.

### Book

Page numbers vary by edition. A credible locator must include edition or ISBN. If exact pages cannot be verified, use chapter/section and label the location approximate. Do not imply that the product can open copyrighted pages it does not lawfully have access to.

### Article

DOM paragraphs can change. Store:

- canonical URL;
- heading path;
- paragraph index;
- a hash or fingerprint of the relevant text;
- a text-fragment link when supported;
- last verification time.

If the page changes, show the locator as stale and re-resolve it.

## Evidence fragment schema

```ts
type EvidenceFragment = {
  id: string;
  sourceId: string;
  locatorId: string;
  finding: string;              // concise paraphrase
  shortQuote?: string;          // only when useful and lawful
  whySurfaced: string;
  limitations: string[];
  entities: string[];
  eventDate?: string;
  independenceGroup?: string;
  confidence: "low" | "medium" | "high";
  verifiedAt?: string;
};
```

## Claim confidence

Avoid fake precision such as `96% confidence` unless a real calibrated model supports it. Prefer:

- strong support;
- supported with limitations;
- contested;
- weakly supported;
- unresolved.

Show why:

```text
SUPPORTED WITH LIMITATIONS
Two first-hand accounts and one official report agree on the timing,
but the accounts are not independent on the cause.
```

## Copyright and access boundary

For an MVP:

- index public web pages and public-domain material;
- use official APIs or licensed transcript providers;
- accept user-owned or user-uploaded material;
- link to books and provide verified bibliographic locations;
- do not reproduce long copyrighted passages;
- do not circumvent paywalls or access controls;
- store only the minimum excerpts needed for evidence and retrieval;
- retain provenance and deletion paths.

## Trust tests

Automated tests should verify:

- each factual beat references at least one evidence ID;
- each evidence item references a source and locator;
- each verified locator opens successfully or is marked degraded;
- quoted text matches the resolved source;
- the source date is not represented as the event date;
- repeated syndicated copies share an independence group;
- the rendered confidence language matches verification state.
