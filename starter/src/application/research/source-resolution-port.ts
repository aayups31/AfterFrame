import { z } from "zod";
import { SourceCandidateRecordSchema } from "@/core/research-runs/schemas";
import {
  ResolverIdentitySchema,
  SourceLocatorSchema,
  SourceRecordSchema,
} from "@/core/research/schemas";
import {
  EntityIdSchema,
  HttpUrlSchema,
  IsoDateTimeSchema,
  OpaqueReferenceSchema,
  Sha256Schema,
} from "@/core/shared/schemas";
import {
  ResearchJobLeaseCursorSchema,
  type ResearchJobLeaseCursor,
} from "@/core/research-runs/worker-schemas";

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
      proposal.locator.status !== "SOURCE_ONLY" ||
      proposal.source.medium === "USER_ASSET" ||
      proposal.source.medium === "OTHER"
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

/**
 * One candidate's body-free resolution decision, bound to the exact durable
 * RESOLUTION attempt. Acceptance persists this record with any proposed
 * source and locator in one lease-fenced transaction.
 */
export const DurableSourceResolutionRecordSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: EntityIdSchema,
    runId: EntityIdSchema,
    jobId: EntityIdSchema,
    attemptId: EntityIdSchema,
    caseId: EntityIdSchema,
    manifestFingerprint: Sha256Schema,
    idempotencyKey: OpaqueReferenceSchema,
    resolver: ResolverIdentitySchema,
    result: SourceResolutionResultSchema,
    createdAt: IsoDateTimeSchema,
  })
  .strict()
  .superRefine((record, context) => {
    if (record.result.status !== "RESOLVED") return;
    const { source, locator } = record.result.proposal;
    if (
      locator.resolver.id !== record.resolver.id ||
      locator.resolver.version !== record.resolver.version ||
      source.origin.kind !== "RESOLVER" ||
      source.origin.version !== record.resolver.version
    ) {
      context.addIssue({
        code: "custom",
        path: ["resolver"],
        message:
          "Durable resolution authority must match the source and locator resolver provenance",
      });
    }
    if (
      source.canonicalUrl === null ||
      locator.openUrl !== source.canonicalUrl ||
      locator.kind !== source.medium
    ) {
      context.addIssue({
        code: "custom",
        path: ["result", "proposal", "locator"],
        message:
          "Resolved source identity, medium, and source-level locator must agree",
      });
    }
  });

export const StoredSourceResolutionRecordSchema =
  DurableSourceResolutionRecordSchema.safeExtend({
    resolutionFingerprint: Sha256Schema,
    acceptedAt: IsoDateTimeSchema,
  }).strict();

export const SourceResolutionAcceptanceResultSchema = z.discriminatedUnion(
  "status",
  [
    z
      .object({
        status: z.enum(["COMMITTED", "REPLAY"]),
        lease: ResearchJobLeaseCursorSchema,
        record: StoredSourceResolutionRecordSchema,
      })
      .strict(),
    z.object({ status: z.literal("LEASE_LOST") }).strict(),
    z.object({ status: z.literal("CANCELLED") }).strict(),
  ],
);

export const DurableSourceResolutionContextSchema = z
  .object({
    schemaVersion: z.literal(1),
    runId: EntityIdSchema,
    jobId: EntityIdSchema,
    attemptId: EntityIdSchema,
    caseId: EntityIdSchema,
    manifestFingerprint: Sha256Schema,
    candidates: z.array(SourceCandidateRecordSchema).max(500),
  })
  .strict()
  .superRefine((resolution, context) => {
    const candidateIds = new Set<string>();
    resolution.candidates.forEach((candidate, index) => {
      if (candidateIds.has(candidate.id)) {
        context.addIssue({
          code: "custom",
          path: ["candidates", index, "id"],
          message: "Resolution candidates must be unique",
        });
      }
      candidateIds.add(candidate.id);
      if (candidate.runId !== resolution.runId) {
        context.addIssue({
          code: "custom",
          path: ["candidates", index, "runId"],
          message: "Resolution candidates must belong to the active run",
        });
      }
    });
  });

export type SourceResolutionInput = z.infer<typeof SourceResolutionInputSchema>;
export type SourceResolutionProbe = z.infer<typeof SourceResolutionProbeSchema>;
export type SourceResolutionFailureCode = z.infer<
  typeof SourceResolutionFailureCodeSchema
>;
export type SourceResolutionResult = z.infer<typeof SourceResolutionResultSchema>;
export type DurableSourceResolutionRecord = z.infer<
  typeof DurableSourceResolutionRecordSchema
>;
export type StoredSourceResolutionRecord = z.infer<
  typeof StoredSourceResolutionRecordSchema
>;
export type SourceResolutionAcceptanceResult = z.infer<
  typeof SourceResolutionAcceptanceResultSchema
>;
export type DurableSourceResolutionContext = z.infer<
  typeof DurableSourceResolutionContextSchema
>;

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

export interface DurableSourceResolutionStore {
  acceptResolution(input: Readonly<{
    actorId: string;
    lease: ResearchJobLeaseCursor;
    record: DurableSourceResolutionRecord;
    leaseDurationSeconds: number;
  }>): Promise<SourceResolutionAcceptanceResult>;
  listAcceptedResolutions(input: Readonly<{
    actorId: string;
    runId: string;
    jobId: string;
    attemptId: string;
  }>): Promise<readonly StoredSourceResolutionRecord[]>;
}
