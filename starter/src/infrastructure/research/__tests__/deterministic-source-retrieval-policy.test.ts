import { describe, expect, it } from "vitest";
import {
  RetrievedSourcePayloadMetadataSchema,
  type SourceRetrievalPolicyInput,
} from "@/application/research/source-retrieval-port";
import { SourceRetrievalReceiptSchema } from "@/core/research/source-retrieval";
import type { SourceLocator, SourceRecord } from "@/core/research/schemas";
import { DeterministicSourceRetrievalPolicy } from "@/infrastructure/research/deterministic-source-retrieval-policy";

const SOURCE_ID = "83000000-0000-4000-8000-000000000001";
const LOCATOR_ID = "83000000-0000-4000-8000-000000000002";
const CASE_ID = "83000000-0000-4000-8000-000000000003";
const RUN_ID = "83000000-0000-4000-8000-000000000004";
const CANDIDATE_ID = "83000000-0000-4000-8000-000000000005";
const ZERO_HASH = "0".repeat(64);
const CAPTURED_AT = "2026-08-30T18:00:00.000Z";

function source(overrides: Partial<SourceRecord> = {}): SourceRecord {
  return {
    id: SOURCE_ID,
    canonicalKey: "url-sha256:example",
    canonicalUrl: "https://example.com/report",
    title: "Source report",
    contributors: [],
    publisher: null,
    publishedAt: null,
    medium: "ARTICLE",
    sourceClass: "editorial-analysis",
    accessState: "OPEN",
    rightsState: "LINK_ONLY",
    independenceGroupId: null,
    origin: { kind: "RESOLVER", actorId: null, version: "1.0.0" },
    createdAt: CAPTURED_AT,
    ...overrides,
  };
}

function articleLocator(overrides: Partial<SourceLocator> = {}): SourceLocator {
  return {
    id: LOCATOR_ID,
    sourceId: SOURCE_ID,
    kind: "ARTICLE",
    status: "SOURCE_ONLY",
    resolver: { id: "http-source-metadata", version: "1.0.0" },
    revision: 1,
    supersedesLocatorId: null,
    openUrl: "https://example.com/report",
    resolvedAt: CAPTURED_AT,
    lastVerifiedAt: null,
    createdAt: CAPTURED_AT,
    headingPath: [],
    paragraphIndex: null,
    textFingerprint: null,
    textFragmentUrl: null,
    ...overrides,
  } as SourceLocator;
}

function input(overrides: Readonly<{
  source?: SourceRecord;
  locator?: SourceLocator;
}> = {}): SourceRetrievalPolicyInput {
  return {
    schemaVersion: 1,
    caseId: CASE_ID,
    runId: RUN_ID,
    candidateId: CANDIDATE_ID,
    source: overrides.source ?? source(),
    locator: overrides.locator ?? articleLocator(),
  };
}

describe("DeterministicSourceRetrievalPolicy", () => {
  const policy = new DeterministicSourceRetrievalPolicy();

  it("allows only transient bounded retrieval for a link-only public article", () => {
    expect(policy.decide(input())).toEqual({
      status: "GRANTED",
      retention: "TRANSIENT_ONLY",
      requestedUrl: "https://example.com/report",
      allowedMediaTypes: ["text/html", "application/xhtml+xml", "text/plain"],
      maxWireBytes: 5_000_000,
      maxDecodedBytes: 10_000_000,
      contentEncodingPolicy: "IDENTITY_ONLY",
      accessControlPolicy: "NO_CIRCUMVENTION",
      instructionAuthority: "NONE",
      publicationAuthority: "NONE",
    });
  });

  it.each(["PERMITTED", "PUBLIC_DOMAIN", "LICENSED"] as const)(
    "allows retained bytes only under storage-eligible rights: %s",
    (rightsState) => {
      expect(
        policy.decide(input({ source: source({ rightsState }) })),
      ).toMatchObject({ status: "GRANTED", retention: "RETAINABLE" });
    },
  );

  it("denies inaccessible, prohibited, and unknown-rights sources", () => {
    expect(
      policy.decide(input({ source: source({ accessState: "RESTRICTED" }) })),
    ).toMatchObject({ status: "DENIED", code: "source-access-not-open" });
    expect(
      policy.decide(
        input({
          source: source({
            accessState: "UNAVAILABLE",
            rightsState: "PROHIBITED",
          }),
        }),
      ),
    ).toMatchObject({ status: "DENIED", code: "source-rights-prohibited" });
    expect(
      policy.decide(input({ source: source({ rightsState: "UNKNOWN" }) })),
    ).toMatchObject({ status: "DENIED", code: "source-rights-unknown" });
  });

  it("denies a locator that does not bind exactly to its source", () => {
    expect(
      policy.decide(
        input({
          locator: articleLocator({ openUrl: "https://other.example/report" }),
        }),
      ),
    ).toMatchObject({ status: "DENIED", code: "source-locator-mismatch" });
  });

  it("requires specialist adapters for books, video, podcasts, and user assets", () => {
    for (const medium of ["BOOK", "VIDEO", "PODCAST", "USER_ASSET"] as const) {
      expect(
        policy.decide(
          input({ source: source({ medium }), locator: articleLocator() }),
        ),
      ).toMatchObject({ status: "DENIED", code: "medium-adapter-required" });
    }
  });

  it("rejects a generic unsupported medium before any fetch capability exists", () => {
    expect(
      policy.decide(
        input({ source: source({ medium: "OTHER" }), locator: articleLocator() }),
      ),
    ).toMatchObject({ status: "DENIED", code: "medium-unsupported" });
  });

  it("assigns larger but still bounded limits only to admitted document media", () => {
    const pdfLocator = {
      ...articleLocator(),
      kind: "PDF",
      documentVersionId: null,
      pageIndex: null,
      printedPageLabel: null,
      section: null,
      heading: null,
      textFingerprint: null,
    } as SourceLocator;
    delete (pdfLocator as Partial<{ headingPath: unknown }>).headingPath;
    delete (pdfLocator as Partial<{ paragraphIndex: unknown }>).paragraphIndex;
    delete (pdfLocator as Partial<{ textFragmentUrl: unknown }>).textFragmentUrl;

    expect(
      policy.decide(
        input({ source: source({ medium: "PDF" }), locator: pdfLocator }),
      ),
    ).toMatchObject({
      status: "GRANTED",
      allowedMediaTypes: ["application/pdf"],
      maxWireBytes: 25_000_000,
      maxDecodedBytes: 50_000_000,
    });
  });
});

describe("source retrieval hostile-data contracts", () => {
  const receipt = {
    schemaVersion: 1,
    id: "83000000-0000-4000-8000-000000000006",
    snapshotId: "83000000-0000-4000-8000-000000000007",
    runId: RUN_ID,
    candidateId: CANDIDATE_ID,
    sourceId: SOURCE_ID,
    sourceLocatorId: LOCATOR_ID,
    requestedUrl: "https://example.com/report",
    finalUrl: "https://example.com/report",
    redirectChainFingerprint: ZERO_HASH,
    declaredMediaType: "text/html",
    verifiedMediaType: "text/html",
    wireContentLength: 100,
    decodedContentLength: 100,
    contentFingerprint: ZERO_HASH,
    retention: "TRANSIENT_ONLY",
    storageRef: null,
    accessState: "OPEN",
    rightsState: "LINK_ONLY",
    trustBoundary: "UNTRUSTED_SOURCE_DATA",
    instructionAuthority: "NONE",
    screeningState: "UNSCREENED",
    publicationAuthority: "NONE",
    retriever: { id: "public-source-retriever", version: "1.0.0" },
    capturedAt: CAPTURED_AT,
  } as const;

  it("forbids retaining a body under link-only or transient authority", () => {
    expect(
      SourceRetrievalReceiptSchema.safeParse({
        ...receipt,
        storageRef: "private/body",
      }).success,
    ).toBe(false);
    expect(
      SourceRetrievalReceiptSchema.safeParse({
        ...receipt,
        retention: "RETAINABLE",
        storageRef: "private/body",
      }).success,
    ).toBe(false);
  });

  it("requires a storage reference when a permitted body is retained", () => {
    expect(
      SourceRetrievalReceiptSchema.safeParse({
        ...receipt,
        retention: "RETAINABLE",
        rightsState: "PERMITTED",
        storageRef: null,
      }).success,
    ).toBe(false);
    expect(
      SourceRetrievalReceiptSchema.safeParse({
        ...receipt,
        retention: "RETAINABLE",
        rightsState: "PERMITTED",
        storageRef: "private/body",
      }).success,
    ).toBe(true);
  });

  it("keeps raw bytes outside the serializable metadata contract", () => {
    expect(
      RetrievedSourcePayloadMetadataSchema.safeParse({
        requestedUrl: receipt.requestedUrl,
        finalUrl: receipt.finalUrl,
        redirectChainFingerprint: ZERO_HASH,
        declaredMediaType: "text/html",
        contentEncoding: null,
        wireContentLength: 100,
        capturedAt: CAPTURED_AT,
        body: "hostile instructions",
      }).success,
    ).toBe(false);
  });
});
