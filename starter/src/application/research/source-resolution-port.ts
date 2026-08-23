import { z } from "zod";
import { SourceCandidateRecordSchema } from "@/core/research-runs/schemas";
import { SourceLocatorSchema, SourceRecordSchema } from "@/core/research/schemas";
import {
  EntityIdSchema,
  HttpUrlSchema,
  IsoDateTimeSchema,
  Sha256Schema,
} from "@/core/shared/schemas";

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

export const SourceResolutionFailureCodeSchema = z.enum([
  "candidate-url-missing",
  "network-target-rejected",
  "probe-unavailable",
  "probe-contract-invalid",
  "redirect-chain-invalid",
  "source-unavailable",
  "source-medium-unsupported",
]);

export const ResolvedSourceProposalSchema = z
  .object({
    candidateId: EntityIdSchema,
    source: SourceRecordSchema,
    locator: SourceLocatorSchema,
    reviewState: z.literal("PROPOSED"),
    metadataTrust: z.literal("UNTRUSTED_SOURCE_DATA"),
    evidenceStatus: z.literal("NOT_EVIDENCE"),
    publicationAuthority: z.literal("NONE"),
    contentBodyIncluded: z.literal(false),
  })
  .strict()
  .superRefine((proposal, context) => {
    if (proposal.locator.sourceId !== proposal.source.id) {
      context.addIssue({
        code: "custom",
        path: ["locator", "sourceId"],
        message: "A resolved locator must belong to its proposed source",
      });
    }
    if (
      proposal.source.accessState !== "OPEN" ||
      proposal.source.rightsState !== "LINK_ONLY" ||
      proposal.locator.status !== "SOURCE_ONLY"
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Metadata-only resolution may create only open, link-only, source-level proposals",
      });
    }
  });

export const SourceResolutionResultSchema = z.discriminatedUnion("status", [
  z
    .object({
      status: z.literal("RESOLVED"),
      proposal: ResolvedSourceProposalSchema,
    })
    .strict(),
  z
    .object({
      status: z.literal("UNRESOLVED"),
      candidateId: EntityIdSchema,
      code: SourceResolutionFailureCodeSchema,
      publicationAuthority: z.literal("NONE"),
    })
    .strict(),
]);

export type SourceResolutionInput = z.infer<typeof SourceResolutionInputSchema>;
export type SourceResolutionProbe = z.infer<typeof SourceResolutionProbeSchema>;
export type SourceResolutionFailureCode = z.infer<
  typeof SourceResolutionFailureCodeSchema
>;
export type SourceResolutionResult = z.infer<typeof SourceResolutionResultSchema>;

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
