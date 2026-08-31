import { z } from "zod";
import { SourceCandidateRecordSchema } from "@/core/research-runs/schemas";
import { ResearchJobLeaseCursorSchema } from "@/core/research-runs/worker-schemas";
import {
  ResolverIdentitySchema,
  SourceLocatorSchema,
  SourceRecordSchema,
} from "@/core/research/schemas";
import {
  EntityIdSchema,
  IsoDateTimeSchema,
  OpaqueReferenceSchema,
  Sha256Schema,
} from "@/core/shared/schemas";

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
