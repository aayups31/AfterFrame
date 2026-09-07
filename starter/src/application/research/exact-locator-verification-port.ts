import type { PdfDocumentReceipt } from "@/core/research/pdf-normalization";
import type { NormalizedDocumentReceipt } from "@/core/research/source-normalization";
import type { SourceLocator, SourceRecord } from "@/core/research/schemas";
import type {
  ExactLocatorProposal,
  ExactLocatorVerificationReceipt,
  DurableExactLocatorVerificationRecord,
  ExactLocatorVerificationAcceptanceResult,
  StoredExactLocatorVerificationRecord,
} from "@/core/research/exact-locator-verification";

type ExactLocatorVerificationBase = Readonly<{
  id: string;
  normalizationRecordId: string;
  source: SourceRecord;
  currentLocator: SourceLocator;
  proposal: ExactLocatorProposal;
  body: Uint8Array;
  verifiedAt: string;
}>;

export type WebExactLocatorVerificationInput = ExactLocatorVerificationBase & Readonly<{
  normalizationReceipt: NormalizedDocumentReceipt;
}>;

export type PdfExactLocatorVerificationInput = ExactLocatorVerificationBase & Readonly<{
  normalizationReceipt: PdfDocumentReceipt;
}>;

/** Source bytes are ephemeral and may not be logged or persisted through this port. */
export interface ExactLocatorVerifier {
  verifyWeb(input: WebExactLocatorVerificationInput): ExactLocatorVerificationReceipt;
  verifyPdf(input: PdfExactLocatorVerificationInput): Promise<ExactLocatorVerificationReceipt>;
}

export interface ExactLocatorVerificationAcceptanceStore {
  acceptExactLocatorVerification(input: Readonly<{
    actorId: string;
    lease: unknown;
    record: DurableExactLocatorVerificationRecord;
    leaseDurationSeconds: number;
  }>): Promise<ExactLocatorVerificationAcceptanceResult>;
}

export interface ExactLocatorVerificationRecordReader {
  listAcceptedExactLocatorVerifications(input: Readonly<{
    actorId: string;
    runId: string;
    jobId: string;
    attemptId: string;
  }>): Promise<readonly StoredExactLocatorVerificationRecord[]>;
}
