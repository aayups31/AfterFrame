import { describe, expect, it } from "vitest";
import {
  HostileContentSignalSchema,
  NormalizedDocumentBlockSchema,
  NormalizedSourceDocumentSchema,
} from "@/core/research/source-normalization";

const HASH = "a".repeat(64);
const BASE_BLOCK = {
  schemaVersion: 1 as const,
  ordinal: 0,
  kind: "PARAGRAPH" as const,
  headingLevel: null,
  headingPath: [],
  text: "Source text",
  sourceByteStart: 0,
  sourceByteEnd: 11,
  sourceRangeFingerprint: HASH,
  textFingerprint: HASH,
  trustBoundary: "UNTRUSTED_SOURCE_DATA" as const,
  instructionAuthority: "NONE" as const,
  evidenceStatus: "NOT_EVIDENCE" as const,
  reviewState: "PROPOSED" as const,
  publicationAuthority: "NONE" as const,
};

function document() {
  return {
    schemaVersion: 1 as const,
    snapshotId: "98000000-0000-4000-8000-000000000001",
    sourceId: "98000000-0000-4000-8000-000000000002",
    sourceLocatorId: "98000000-0000-4000-8000-000000000003",
    contentFingerprint: HASH,
    documentFingerprint: HASH,
    documentKind: "HTML" as const,
    verifiedMediaType: "text/html",
    sourceByteLength: 11,
    normalizedTextLength: 11,
    title: null,
    blocks: [BASE_BLOCK],
    screeningState: "PASSED" as const,
    hostileSignals: [],
    normalizer: { id: "normalizer", version: "1.0.0" },
    normalizedAt: "2026-08-31T04:00:00.000Z",
    trustBoundary: "UNTRUSTED_SOURCE_DATA" as const,
    instructionAuthority: "NONE" as const,
    evidenceStatus: "NOT_EVIDENCE" as const,
    reviewState: "PROPOSED" as const,
    publicationAuthority: "NONE" as const,
  };
}

describe("source normalization contracts", () => {
  it("accepts only internally consistent authority-free documents", () => {
    expect(NormalizedSourceDocumentSchema.parse(document())).toEqual(document());
  });

  it("rejects false passed state, broken byte bounds, length, and ordinals", () => {
    const signal = {
      schemaVersion: 1 as const,
      code: "INSTRUCTION_OVERRIDE" as const,
      severity: "HIGH" as const,
      sourceByteStart: 1,
      sourceByteEnd: 4,
      sourceRangeFingerprint: HASH,
      detectorId: "detector",
      detectorVersion: "1.0.0",
      instructionAuthority: "NONE" as const,
      publicationAuthority: "NONE" as const,
    };
    expect(HostileContentSignalSchema.safeParse(signal).success).toBe(true);
    expect(
      NormalizedSourceDocumentSchema.safeParse({
        ...document(),
        hostileSignals: [signal],
      }).success,
    ).toBe(false);
    expect(
      NormalizedSourceDocumentSchema.safeParse({
        ...document(),
        normalizedTextLength: 10,
      }).success,
    ).toBe(false);
    expect(
      NormalizedSourceDocumentSchema.safeParse({
        ...document(),
        blocks: [{ ...BASE_BLOCK, ordinal: 1 }],
      }).success,
    ).toBe(false);
    expect(
      NormalizedSourceDocumentSchema.safeParse({
        ...document(),
        blocks: [{ ...BASE_BLOCK, sourceByteEnd: 12 }],
      }).success,
    ).toBe(false);
  });

  it("rejects heading-level authority on non-heading blocks", () => {
    expect(
      NormalizedDocumentBlockSchema.safeParse({
        ...BASE_BLOCK,
        headingLevel: 1,
      }).success,
    ).toBe(false);
  });
});
