import type {
  DurableSourceNormalizationRecord,
  NormalizedDocumentReceipt,
  NormalizedSourceDocument,
  SourceNormalizationAcceptanceResult,
  StoredSourceNormalizationRecord,
} from "@/core/research/source-normalization";

/**
 * Ephemeral validated bytes entering the hostile parser. Implementations may
 * not log, serialize, or persist `body` through this boundary.
 */
export type SourceDocumentNormalizationInput = Readonly<{
  snapshotId: string;
  sourceId: string;
  sourceLocatorId: string;
  contentFingerprint: string;
  verifiedMediaType: string;
  body: Uint8Array;
  normalizedAt: string;
}>;

export interface SourceDocumentNormalizer {
  normalize(
    input: SourceDocumentNormalizationInput,
  ): NormalizedSourceDocument;
}

export interface NormalizedDocumentRetentionStore {
  retain(input: Readonly<{
    caseId: string;
    sourceId: string;
    documentFingerprint: string;
    document: NormalizedSourceDocument;
  }>): Promise<Readonly<{ storageRef: string }>>;
}

export interface DurableSourceNormalizationRecordReader {
  listAcceptedNormalizations(input: Readonly<{
    actorId: string;
    runId: string;
    jobId: string;
    attemptId: string;
  }>): Promise<readonly StoredSourceNormalizationRecord[]>;
}

export interface SourceNormalizationAcceptanceStore {
  acceptSourceNormalization(input: Readonly<{
    actorId: string;
    lease: unknown;
    record: DurableSourceNormalizationRecord;
    leaseDurationSeconds: number;
  }>): Promise<SourceNormalizationAcceptanceResult>;
}

export type NormalizedDocumentReceiptFactory = (
  input: Readonly<{
    id: string;
    runId: string;
    candidateId: string;
    retrievalRecordId: string;
    document: NormalizedSourceDocument;
    accessState: string;
    rightsState: string;
    retention: "TRANSIENT_ONLY" | "RETAINABLE";
    storageRef: string | null;
  }>,
) => NormalizedDocumentReceipt;
