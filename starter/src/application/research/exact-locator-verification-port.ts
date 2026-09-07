import type { PdfDocumentReceipt } from "@/core/research/pdf-normalization";
import type { NormalizedDocumentReceipt } from "@/core/research/source-normalization";
import type { SourceLocator, SourceRecord } from "@/core/research/schemas";
import type {
  ExactLocatorProposal,
  ExactLocatorVerificationReceipt,
} from "@/core/research/exact-locator-verification";

type ExactLocatorVerificationBase = Readonly<{
  id: string;
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
