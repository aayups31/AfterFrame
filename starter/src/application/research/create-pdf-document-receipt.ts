import {
  PdfDocumentReceiptSchema,
  type ExtractedPdfDocument,
  type PdfDocumentReceipt,
} from "@/core/research/pdf-normalization";

/** Converts ephemeral PDF text into a text-free page/item provenance receipt. */
export function createPdfDocumentReceipt(input: Readonly<{
  id: string;
  runId: string;
  candidateId: string;
  retrievalRecordId: string;
  document: ExtractedPdfDocument;
  accessState: string;
  rightsState: string;
  retention: "TRANSIENT_ONLY" | "RETAINABLE";
  storageRef: string | null;
}>): PdfDocumentReceipt {
  return PdfDocumentReceiptSchema.parse({
    schemaVersion: 1,
    id: input.id,
    runId: input.runId,
    candidateId: input.candidateId,
    retrievalRecordId: input.retrievalRecordId,
    snapshotId: input.document.snapshotId,
    sourceId: input.document.sourceId,
    sourceLocatorId: input.document.sourceLocatorId,
    contentFingerprint: input.document.contentFingerprint,
    documentFingerprint: input.document.documentFingerprint,
    documentKind: "PDF",
    verifiedMediaType: "application/pdf",
    sourceByteLength: input.document.sourceByteLength,
    pageCount: input.document.pageCount,
    normalizedTextLength: input.document.normalizedTextLength,
    pageManifests: input.document.pages,
    blockManifests: input.document.blocks.map((block) => ({
      schemaVersion: block.schemaVersion,
      ordinal: block.ordinal,
      kind: block.kind,
      textFingerprint: block.textFingerprint,
      anchor: block.anchor,
      instructionAuthority: block.instructionAuthority,
      evidenceStatus: block.evidenceStatus,
      publicationAuthority: block.publicationAuthority,
      textLength: block.text.length,
    })),
    screeningState: input.document.screeningState,
    hostileSignals: input.document.hostileSignals,
    retention: input.retention,
    storageRef: input.storageRef,
    accessState: input.accessState,
    rightsState: input.rightsState,
    normalizer: {
      id: input.document.extractor.id,
      version: input.document.extractor.version,
    },
    libraryVersion: input.document.extractor.libraryVersion,
    normalizedAt: input.document.extractedAt,
    trustBoundary: "UNTRUSTED_SOURCE_DATA",
    instructionAuthority: "NONE",
    evidenceStatus: "NOT_EVIDENCE",
    reviewState: "PROPOSED",
    publicationAuthority: "NONE",
  });
}
