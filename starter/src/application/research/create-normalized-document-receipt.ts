import {
  NormalizedDocumentReceiptSchema,
  type NormalizedDocumentReceipt,
  type NormalizedSourceDocument,
} from "@/core/research/source-normalization";

/**
 * Converts ephemeral parser output into a text-free durable receipt. Source
 * text and heading text never cross this persistence-facing boundary.
 */
export function createNormalizedDocumentReceipt(input: Readonly<{
  id: string;
  runId: string;
  candidateId: string;
  retrievalRecordId: string;
  document: NormalizedSourceDocument;
  accessState: string;
  rightsState: string;
  retention: "TRANSIENT_ONLY" | "RETAINABLE";
  storageRef: string | null;
}>): NormalizedDocumentReceipt {
  const receipt = {
    schemaVersion: 1 as const,
    id: input.id,
    runId: input.runId,
    candidateId: input.candidateId,
    retrievalRecordId: input.retrievalRecordId,
    snapshotId: input.document.snapshotId,
    sourceId: input.document.sourceId,
    sourceLocatorId: input.document.sourceLocatorId,
    contentFingerprint: input.document.contentFingerprint,
    documentFingerprint: input.document.documentFingerprint,
    documentKind: input.document.documentKind,
    verifiedMediaType: input.document.verifiedMediaType,
    sourceByteLength: input.document.sourceByteLength,
    normalizedTextLength: input.document.normalizedTextLength,
    blockManifests: input.document.blocks.map((block) => ({
      schemaVersion: 1 as const,
      ordinal: block.ordinal,
      kind: block.kind,
      headingLevel: block.headingLevel,
      headingPathFingerprints: block.headingPath.map((heading) =>
        input.document.blocks.find(
          (candidate) =>
            candidate.kind === "HEADING" && candidate.text === heading,
        )?.textFingerprint ?? block.textFingerprint,
      ),
      textLength: block.text.length,
      sourceByteStart: block.sourceByteStart,
      sourceByteEnd: block.sourceByteEnd,
      sourceRangeFingerprint: block.sourceRangeFingerprint,
      textFingerprint: block.textFingerprint,
      instructionAuthority: "NONE" as const,
      evidenceStatus: "NOT_EVIDENCE" as const,
      publicationAuthority: "NONE" as const,
    })),
    screeningState: input.document.screeningState,
    hostileSignals: input.document.hostileSignals,
    retention: input.retention,
    storageRef: input.storageRef,
    accessState: input.accessState,
    rightsState: input.rightsState,
    normalizer: input.document.normalizer,
    normalizedAt: input.document.normalizedAt,
    trustBoundary: "UNTRUSTED_SOURCE_DATA" as const,
    instructionAuthority: "NONE" as const,
    evidenceStatus: "NOT_EVIDENCE" as const,
    reviewState: "PROPOSED" as const,
    publicationAuthority: "NONE" as const,
  };
  return NormalizedDocumentReceiptSchema.parse(receipt);
}
