import type { SourceDocumentNormalizationInput } from "@/application/research/source-normalization-port";
import type { ExtractedPdfDocument } from "@/core/research/pdf-normalization";

/** Binary source data is ephemeral and must not be logged or persisted here. */
export interface PdfDocumentExtractor {
  extract(input: SourceDocumentNormalizationInput): Promise<ExtractedPdfDocument>;
}
