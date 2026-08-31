import type { NormalizedSourceDocument } from "@/core/research/source-normalization";

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
