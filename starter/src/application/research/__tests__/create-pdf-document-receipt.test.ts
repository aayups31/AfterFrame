import { describe, expect, it } from "vitest";
import { createPdfDocumentReceipt } from "@/application/research/create-pdf-document-receipt";
import { ExtractedPdfDocumentSchema } from "@/core/research/pdf-normalization";

const HASH = "a".repeat(64);

function document() {
  const sourceText = "Private copyrighted source sentence.";
  const anchorBase = {
    schemaVersion: 1 as const,
    pageNumber: 1,
    pageObject: { objectNumber: 3, generation: 0 },
    itemStart: 0,
    itemEnd: 1,
    boundingBox: { x: 72, y: 720, width: 100, height: 12 },
    pageTextFingerprint: "b".repeat(64),
    anchorFingerprint: "c".repeat(64),
  };
  return ExtractedPdfDocumentSchema.parse({
    schemaVersion: 1,
    snapshotId: "98000000-0000-4000-8000-000000000001",
    sourceId: "98000000-0000-4000-8000-000000000002",
    sourceLocatorId: "98000000-0000-4000-8000-000000000003",
    contentFingerprint: HASH,
    documentFingerprint: "d".repeat(64),
    documentKind: "PDF",
    verifiedMediaType: "application/pdf",
    sourceByteLength: 512,
    pageCount: 1,
    normalizedTextLength: sourceText.length,
    pages: [{
      schemaVersion: 1,
      pageNumber: 1,
      pageObject: { objectNumber: 3, generation: 0 },
      rotation: 0,
      width: 612,
      height: 792,
      textItemCount: 1,
      blockStart: 0,
      blockEnd: 1,
      pageTextFingerprint: "b".repeat(64),
      pageStructureFingerprint: "e".repeat(64),
    }],
    blocks: [{
      schemaVersion: 1,
      ordinal: 0,
      kind: "PARAGRAPH",
      text: sourceText,
      textFingerprint: "f".repeat(64),
      anchor: anchorBase,
      trustBoundary: "UNTRUSTED_SOURCE_DATA",
      instructionAuthority: "NONE",
      evidenceStatus: "NOT_EVIDENCE",
      reviewState: "PROPOSED",
      publicationAuthority: "NONE",
    }],
    screeningState: "PASSED",
    hostileSignals: [],
    extractor: { id: "pdfjs-hostile-document-extractor", version: "1.0.0", libraryVersion: "6.3.289" },
    extractedAt: "2026-08-31T05:00:00.000Z",
    trustBoundary: "UNTRUSTED_SOURCE_DATA",
    instructionAuthority: "NONE",
    evidenceStatus: "NOT_EVIDENCE",
    reviewState: "PROPOSED",
    publicationAuthority: "NONE",
  });
}

function create(overrides: Readonly<Record<string, unknown>> = {}) {
  return createPdfDocumentReceipt({
    id: "98000000-0000-4000-8000-000000000010",
    runId: "98000000-0000-4000-8000-000000000011",
    candidateId: "98000000-0000-4000-8000-000000000012",
    retrievalRecordId: "98000000-0000-4000-8000-000000000013",
    document: document(),
    accessState: "OPEN",
    rightsState: "LINK_ONLY",
    retention: "TRANSIENT_ONLY",
    storageRef: null,
    ...overrides,
  });
}

describe("createPdfDocumentReceipt", () => {
  it("emits page/item manifests without source text or raw PDF bytes", () => {
    const receipt = create();
    expect(receipt).toMatchObject({
      documentKind: "PDF",
      pageCount: 1,
      retention: "TRANSIENT_ONLY",
      storageRef: null,
      instructionAuthority: "NONE",
      evidenceStatus: "NOT_EVIDENCE",
    });
    expect(receipt.blockManifests[0]).toMatchObject({
      ordinal: 0,
      textLength: "Private copyrighted source sentence.".length,
      anchor: { pageNumber: 1, pageObject: { objectNumber: 3, generation: 0 } },
    });
    const serialized = JSON.stringify(receipt);
    expect(serialized).not.toContain("Private copyrighted source sentence");
    expect(serialized).not.toContain("body");
    expect(serialized).not.toContain("sourceByteStart");
  });

  it("rejects retained link-only and quarantined PDF output", () => {
    expect(() => create({ retention: "RETAINABLE", storageRef: "object:pdf" })).toThrow();
    const quarantined = document();
    quarantined.screeningState = "QUARANTINED";
    quarantined.hostileSignals.push({
      schemaVersion: 1,
      code: "ACTIVE_CONTENT",
      severity: "HIGH",
      anchorScope: "DOCUMENT",
      anchor: null,
      detectorId: "hostile-content-screen",
      detectorVersion: "1.0.0",
      instructionAuthority: "NONE",
      publicationAuthority: "NONE",
    });
    expect(() => create({ document: quarantined, rightsState: "LICENSED", retention: "RETAINABLE", storageRef: "object:pdf" })).toThrow();
  });
});
