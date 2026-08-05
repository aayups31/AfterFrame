# 25 — Film Source Adapters and Lawful Inputs

## Principle

A top movie investigator needs direct routes into film-specific material, but the product must never imply that an LLM has watched or ingested copyrighted work it cannot lawfully access.

Every adapter returns:

- stable source identity;
- access and rights state;
- extracted or user-provided material;
- exact or approximate locator;
- extraction method;
- verification state;
- limitations;
- content fingerprint;
- resolver version.

## 1. Film-version registry

Resolve:

- title and release year;
- territory;
- theatrical, director’s, extended, festival, broadcast, restored, or alternate cut;
- runtime;
- language and subtitle track;
- release medium;
- known scene differences.

Do not attach scene timecodes until the exact version is known.

## 2. User-owned film-text adapter

Accept explicit user inputs such as:

- frame grabs;
- short clips the user is permitted to provide;
- scene timecodes from the user’s copy;
- personal scene notes;
- subtitle or screenplay files the user is authorized to use.

Store the original asset separately from derived observations. Record whether an observation came from an image, clip, subtitle, screenplay, or user description.

## 3. Frame and scene analyst

Extract bounded observations about:

- composition and blocking;
- camera angle and apparent lens effects;
- lighting and color relationships;
- props, costume, production design, and visual motifs;
- visible performance choices;
- on-screen text;
- changes across supplied frames.

Sound, editing rhythm, off-screen context, and intent cannot be inferred from a still image alone.

## 4. Screenplay and draft adapter

Resolve:

- draft date and version;
- writer attribution;
- pagination;
- scene numbers and headings;
- revisions and colored-page systems where applicable;
- screenplay-to-film alignment.

A screenplay is not a transcript of the finished film. Store adaptation differences rather than silently reconciling them.

## 5. Video and interview adapter

For compliant public video access:

- resolve canonical video and channel identity;
- obtain an authorized transcript or captions when available;
- attach timestamps;
- fingerprint relevant text;
- record speaker identity and interview date;
- separate edited promotional excerpts from long-form context.

## 6. Podcast and commentary adapter

- resolve episode or commentary-track edition;
- identify speakers;
- store time ranges;
- distinguish retrospective recollection from contemporaneous production evidence;
- record whether the commentary belongs to the exact cut being discussed.

## 7. PDF, archive, and official-record adapter

- preserve original page numbering and printed page numbering separately;
- map sections, exhibits, and appendices;
- retain document date, institution, and revision;
- identify scans, OCR quality, and missing pages;
- verify that cited text exists at the locator.

## 8. Book and scholarship adapter

- require edition identity for exact pages;
- store ISBN or equivalent identifier;
- prefer chapter and section locators when page access cannot be validated;
- never reproduce long copyrighted passages;
- link to publisher, library, or user-owned copy rather than bypassing access controls.

## 9. Trade, creator, and production-source adapter

Resolve outlet, author, date, interview context, and whether a quotation is original or syndicated. Track the creative role of each speaker. Do not treat a director’s retrospective statement as the voice of the entire production.

## 10. Community interpretation adapter

Community posts, video essays, forums, and fan wikis can reveal:

- recurring audience interpretations;
- overlooked visual patterns;
- questions worth testing;
- reception history.

They do not automatically prove production facts, influence, intention, or independent corroboration. Trace repeated claims to their earliest available origin.

## Locator priority

1. verified timecode, page, scene, heading, or paragraph;
2. verified section or chapter with approximate local range;
3. source-level link with an explicit “locator unavailable” state;
4. do not present the claim as inspectable evidence.

## Adapter interface

```ts
interface FilmSourceAdapter {
  supports(candidate: SourceCandidate): boolean;
  resolve(candidate: SourceCandidate, context: ResolveContext): Promise<ResolvedFilmSource>;
  verifyLocator(locator: SourceLocator): Promise<LocatorVerification>;
}
```

Adapters should be testable against saved fixtures and must never let model-generated URLs or locators bypass verification.
