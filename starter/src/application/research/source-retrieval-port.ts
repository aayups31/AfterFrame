import { z } from "zod";
import {
  SourceRetrievalDecisionSchema,
  SourceRetrievalGrantSchema,
  SourceRetrievalPolicyInputSchema,
  SourceRetrievalReceiptSchema,
  DurableNormalizationRetrievalContextSchema,
  DurableSourceRetrievalRecordSchema,
  SourceRetrievalAcceptanceResultSchema,
  SourceRetrievalResultSchema,
  StoredSourceRetrievalRecordSchema,
  type DurableNormalizationRetrievalContext,
  type DurableSourceRetrievalRecord,
  type SourceRetrievalAcceptanceResult,
  type SourceRetrievalResult,
  type StoredSourceRetrievalRecord,
  type SourceRetrievalDecision,
  type SourceRetrievalGrant,
  type SourceRetrievalPolicyInput,
  type SourceRetrievalReceipt,
} from "@/core/research/source-retrieval";
import { HttpUrlSchema, IsoDateTimeSchema, Sha256Schema } from "@/core/shared/schemas";

export {
  SourceRetrievalDecisionSchema,
  SourceRetrievalGrantSchema,
  SourceRetrievalPolicyInputSchema,
  SourceRetrievalReceiptSchema,
  DurableNormalizationRetrievalContextSchema,
  DurableSourceRetrievalRecordSchema,
  SourceRetrievalAcceptanceResultSchema,
  SourceRetrievalResultSchema,
  StoredSourceRetrievalRecordSchema,
};
export type {
  SourceRetrievalDecision,
  SourceRetrievalGrant,
  SourceRetrievalPolicyInput,
  SourceRetrievalReceipt,
  DurableNormalizationRetrievalContext,
  DurableSourceRetrievalRecord,
  SourceRetrievalAcceptanceResult,
  SourceRetrievalResult,
  StoredSourceRetrievalRecord,
};

export const RetrievedSourcePayloadMetadataSchema = z
  .object({
    requestedUrl: HttpUrlSchema,
    finalUrl: HttpUrlSchema,
    redirectChainFingerprint: Sha256Schema,
    declaredMediaType: z.string().trim().min(1).max(200).nullable(),
    contentEncoding: z.string().trim().min(1).max(100).nullable(),
    wireContentLength: z.number().int().nonnegative().max(50_000_000),
    capturedAt: IsoDateTimeSchema,
  })
  .strict();

/**
 * Ephemeral hostile bytes. This shape is intentionally not JSON serializable,
 * accepted by persistence, or safe for logs/telemetry.
 */
export type RetrievedSourcePayload = Readonly<{
  metadata: z.infer<typeof RetrievedSourcePayloadMetadataSchema>;
  body: Uint8Array;
}>;

export interface SourceRetrievalPolicy {
  decide(input: SourceRetrievalPolicyInput): SourceRetrievalDecision;
}

export interface SourcePayloadRetriever {
  retrieve(
    input: Readonly<{
      grant: SourceRetrievalGrant;
    }>,
    signal: AbortSignal,
  ): Promise<RetrievedSourcePayload>;
}

export interface SourcePayloadRetentionStore {
  retain(input: Readonly<{
    caseId: string | null;
    sourceId: string;
    contentFingerprint: string;
    body: Uint8Array;
  }>): Promise<Readonly<{ storageRef: string }>>;
}

export interface DurableNormalizationRetrievalContextReader {
  getNormalizationRetrievalContext(input: Readonly<{
    actorId: string;
    runId: string;
    jobId: string;
    attemptId: string;
  }>): Promise<DurableNormalizationRetrievalContext | null>;
}

export interface DurableSourceRetrievalRecordReader {
  listAcceptedRetrievals(input: Readonly<{
    actorId: string;
    runId: string;
    jobId: string;
    attemptId: string;
  }>): Promise<readonly StoredSourceRetrievalRecord[]>;
}
