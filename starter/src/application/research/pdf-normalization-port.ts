import type { SourceDocumentNormalizationInput } from "@/application/research/source-normalization-port";
import type {
  ExtractedPdfDocument,
  PdfNormalizationAcceptanceResult,
  StoredPdfNormalizationRecord,
  DurablePdfNormalizationRecord,
} from "@/core/research/pdf-normalization";

/** Binary source data is ephemeral and must not be logged or persisted here. */
export interface PdfDocumentExtractor {
  extract(input: SourceDocumentNormalizationInput): Promise<ExtractedPdfDocument>;
}

export interface PdfNormalizationAcceptanceStore {
  acceptPdfNormalization(input: Readonly<{
    actorId: string;
    lease: unknown;
    record: DurablePdfNormalizationRecord;
    leaseDurationSeconds: number;
  }>): Promise<PdfNormalizationAcceptanceResult>;
}

export interface DurablePdfNormalizationRecordReader {
  listAcceptedPdfNormalizations(input: Readonly<{
    actorId: string;
    runId: string;
    jobId: string;
    attemptId: string;
  }>): Promise<readonly StoredPdfNormalizationRecord[]>;
}
