import { z } from "zod";
import { SourceCandidateRecordSchema } from "@/core/research-runs/schemas";
import {
  EntityIdSchema,
  HttpUrlSchema,
  IsoDateTimeSchema,
  Sha256Schema,
} from "@/core/shared/schemas";
import type {
  DurableSourceResolutionContext,
  SourceResolutionResult,
  StoredSourceResolutionRecord,
} from "@/core/research/source-resolution";

export {
  DurableSourceResolutionContextSchema,
  DurableSourceResolutionRecordSchema,
  ResolvedSourceProposalSchema,
  SourceResolutionAcceptanceResultSchema,
  SourceResolutionFailureCodeSchema,
  SourceResolutionResultSchema,
  StoredSourceResolutionRecordSchema,
} from "@/core/research/source-resolution";
export type {
  DurableSourceResolutionContext,
  DurableSourceResolutionRecord,
  SourceResolutionAcceptanceResult,
  SourceResolutionFailureCode,
  SourceResolutionResult,
  StoredSourceResolutionRecord,
} from "@/core/research/source-resolution";

export const SourceResolutionInputSchema = z
  .object({
    schemaVersion: z.literal(1),
    runId: EntityIdSchema,
    jobId: EntityIdSchema,
    attemptId: EntityIdSchema,
    caseId: EntityIdSchema,
    manifestFingerprint: Sha256Schema,
    candidate: SourceCandidateRecordSchema,
  })
  .strict()
  .superRefine((input, context) => {
    if (input.candidate.runId !== input.runId) {
      context.addIssue({
        code: "custom",
        path: ["candidate", "runId"],
        message: "Resolution candidates must belong to the active run",
      });
    }
  });

export const SourceResolutionHopSchema = z
  .object({
    url: HttpUrlSchema,
    statusCode: z.number().int().min(100).max(599),
    resolvedAddresses: z.array(z.string().trim().min(2).max(64)).min(1).max(16),
    contentType: z.string().trim().min(1).max(500).nullable(),
    contentLength: z.number().int().nonnegative().max(100_000_000).nullable(),
    title: z.string().max(2_000).nullable(),
    observedAt: IsoDateTimeSchema,
  })
  .strict();

/** Body-free transport result. HTML, transcripts, excerpts and headers are absent. */
export const SourceResolutionProbeSchema = z
  .object({
    requestedUrl: HttpUrlSchema,
    hops: z.array(SourceResolutionHopSchema).min(1).max(6),
    bodyIncluded: z.literal(false),
  })
  .strict();

export type SourceResolutionInput = z.infer<typeof SourceResolutionInputSchema>;
export type SourceResolutionProbe = z.infer<typeof SourceResolutionProbeSchema>;

export interface SourceMetadataProbeTransport {
  probe(
    url: string,
    options: Readonly<{ maxRedirects: number; signal: AbortSignal }>,
  ): Promise<unknown>;
}

export interface SourceCandidateResolver {
  resolve(
    input: SourceResolutionInput,
    signal: AbortSignal,
  ): Promise<SourceResolutionResult>;
}

export interface DurableSourceResolutionContextReader {
  getResolutionContext(input: Readonly<{
    actorId: string;
    runId: string;
    jobId: string;
    attemptId: string;
  }>): Promise<DurableSourceResolutionContext | null>;
}

export interface DurableSourceResolutionRecordReader {
  listAcceptedResolutions(input: Readonly<{
    actorId: string;
    runId: string;
    jobId: string;
    attemptId: string;
  }>): Promise<readonly StoredSourceResolutionRecord[]>;
}
