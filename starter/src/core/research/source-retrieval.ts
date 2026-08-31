import { z } from "zod";
import { SourceLocatorSchema, SourceRecordSchema } from "@/core/research/schemas";
import { SourceCandidateRecordSchema } from "@/core/research-runs/schemas";
import { ResearchJobLeaseCursorSchema } from "@/core/research-runs/worker-schemas";
import {
  EntityIdSchema,
  HttpUrlSchema,
  IsoDateTimeSchema,
  OpaqueReferenceSchema,
  Sha256Schema,
  SlugSchema,
  VersionTagSchema,
} from "@/core/shared/schemas";

export const SourceRetrievalRetentionSchema = z.enum([
  "TRANSIENT_ONLY",
  "RETAINABLE",
]);

export const SourceRetrievalDenialCodeSchema = z.enum([
  "source-access-not-open",
  "source-rights-unknown",
  "source-rights-prohibited",
  "source-locator-mismatch",
  "source-url-unavailable",
  "medium-adapter-required",
  "medium-unsupported",
]);

export const SourceRetrievalPolicyInputSchema = z
  .object({
    schemaVersion: z.literal(1),
    caseId: EntityIdSchema,
    runId: EntityIdSchema,
    candidateId: EntityIdSchema,
    source: SourceRecordSchema,
    locator: SourceLocatorSchema,
  })
  .strict();

export const SourceRetrievalGrantSchema = z
  .object({
    status: z.literal("GRANTED"),
    retention: SourceRetrievalRetentionSchema,
    requestedUrl: HttpUrlSchema,
    allowedMediaTypes: z.array(z.string().trim().min(1).max(200)).min(1).max(20),
    maxWireBytes: z.number().int().positive().max(50_000_000),
    maxDecodedBytes: z.number().int().positive().max(100_000_000),
    contentEncodingPolicy: z.literal("IDENTITY_ONLY"),
    accessControlPolicy: z.literal("NO_CIRCUMVENTION"),
    instructionAuthority: z.literal("NONE"),
    publicationAuthority: z.literal("NONE"),
  })
  .strict();

export const SourceRetrievalDecisionSchema = z.discriminatedUnion("status", [
  SourceRetrievalGrantSchema,
  z
    .object({
      status: z.literal("DENIED"),
      code: SourceRetrievalDenialCodeSchema,
      instructionAuthority: z.literal("NONE"),
      publicationAuthority: z.literal("NONE"),
    })
    .strict(),
]);

export const SourceRetrievalReceiptSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: EntityIdSchema,
    snapshotId: EntityIdSchema,
    runId: EntityIdSchema,
    candidateId: EntityIdSchema,
    sourceId: EntityIdSchema,
    sourceLocatorId: EntityIdSchema,
    requestedUrl: HttpUrlSchema,
    finalUrl: HttpUrlSchema,
    redirectChainFingerprint: Sha256Schema,
    declaredMediaType: z.string().trim().min(1).max(200).nullable(),
    verifiedMediaType: z.string().trim().min(1).max(200),
    wireContentLength: z.number().int().nonnegative().max(50_000_000),
    decodedContentLength: z.number().int().nonnegative().max(100_000_000),
    contentFingerprint: Sha256Schema,
    retention: SourceRetrievalRetentionSchema,
    storageRef: OpaqueReferenceSchema.nullable(),
    accessState: z.literal("OPEN"),
    rightsState: z.enum([
      "LINK_ONLY",
      "PERMITTED",
      "USER_OWNED",
      "PUBLIC_DOMAIN",
      "LICENSED",
    ]),
    trustBoundary: z.literal("UNTRUSTED_SOURCE_DATA"),
    instructionAuthority: z.literal("NONE"),
    screeningState: z.enum(["UNSCREENED", "PASSED", "QUARANTINED"]),
    publicationAuthority: z.literal("NONE"),
    retriever: z
      .object({ id: SlugSchema, version: VersionTagSchema })
      .strict(),
    capturedAt: IsoDateTimeSchema,
  })
  .strict()
  .superRefine((receipt, context) => {
    if (receipt.retention === "TRANSIENT_ONLY" && receipt.storageRef !== null) {
      context.addIssue({
        code: "custom",
        path: ["storageRef"],
        message: "Transient retrieval cannot retain a source body reference",
      });
    }
    if (receipt.rightsState === "LINK_ONLY" && receipt.retention !== "TRANSIENT_ONLY") {
      context.addIssue({
        code: "custom",
        path: ["retention"],
        message: "LINK_ONLY retrieval must remain transient",
      });
    }
    if (receipt.retention === "RETAINABLE" && receipt.storageRef === null) {
      context.addIssue({
        code: "custom",
        path: ["storageRef"],
        message: "Retained source bodies require an opaque storage reference",
      });
    }
  });

export const SourceRetrievalFailureCodeSchema = z.enum([
  "retrieval-disabled",
  "retrieval-aborted",
  "retrieval-timeout",
  "retrieval-network-rejected",
  "retrieval-redirect-invalid",
  "retrieval-access-changed",
  "retrieval-content-encoding-rejected",
  "retrieval-content-type-rejected",
  "retrieval-size-exceeded",
  "retrieval-content-signature-mismatch",
  "retrieval-upstream-unavailable",
  "retrieval-contract-invalid",
]);

export const SourceRetrievalResultSchema = z.discriminatedUnion("status", [
  z
    .object({
      status: z.literal("RETRIEVED"),
      receipt: SourceRetrievalReceiptSchema,
    })
    .strict(),
  z
    .object({
      status: z.literal("UNAVAILABLE"),
      candidateId: EntityIdSchema,
      sourceId: EntityIdSchema,
      sourceLocatorId: EntityIdSchema,
      code: SourceRetrievalFailureCodeSchema,
      instructionAuthority: z.literal("NONE"),
      publicationAuthority: z.literal("NONE"),
    })
    .strict(),
]);

export const DurableSourceRetrievalRecordSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: EntityIdSchema,
    runId: EntityIdSchema,
    jobId: EntityIdSchema,
    attemptId: EntityIdSchema,
    caseId: EntityIdSchema,
    manifestFingerprint: Sha256Schema,
    resolutionRecordId: EntityIdSchema,
    idempotencyKey: OpaqueReferenceSchema,
    policy: z.object({ id: SlugSchema, version: VersionTagSchema }).strict(),
    retriever: z.object({ id: SlugSchema, version: VersionTagSchema }).strict(),
    result: SourceRetrievalResultSchema,
    createdAt: IsoDateTimeSchema,
  })
  .strict()
  .superRefine((record, context) => {
    if (
      record.result.status === "RETRIEVED" &&
      (record.result.receipt.runId !== record.runId ||
        record.result.receipt.retriever.id !== record.retriever.id ||
        record.result.receipt.retriever.version !== record.retriever.version ||
        record.result.receipt.screeningState !== "UNSCREENED")
    ) {
      context.addIssue({
        code: "custom",
        path: ["result", "receipt"],
        message: "Retrieval receipt must match its durable run and retriever",
      });
    }
  });

export const StoredSourceRetrievalRecordSchema =
  DurableSourceRetrievalRecordSchema.safeExtend({
    retrievalFingerprint: Sha256Schema,
    acceptedAt: IsoDateTimeSchema,
  }).strict();

export const SourceRetrievalAcceptanceResultSchema = z.discriminatedUnion(
  "status",
  [
    z
      .object({
        status: z.enum(["COMMITTED", "REPLAY"]),
        lease: ResearchJobLeaseCursorSchema,
        record: StoredSourceRetrievalRecordSchema,
      })
      .strict(),
    z.object({ status: z.literal("LEASE_LOST") }).strict(),
    z.object({ status: z.literal("CANCELLED") }).strict(),
  ],
);

export const NormalizationRetrievalSourceSchema = z
  .object({
    candidate: SourceCandidateRecordSchema,
    resolutionRecordId: EntityIdSchema,
    resolutionFingerprint: Sha256Schema,
    source: SourceRecordSchema,
    locator: SourceLocatorSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.candidate.id === "" ||
      value.source.id !== value.locator.sourceId ||
      value.source.medium !== value.locator.kind ||
      value.source.canonicalUrl !== value.locator.openUrl
    ) {
      context.addIssue({
        code: "custom",
        message: "Normalization source, locator, and candidate lineage must agree",
      });
    }
  });

export const DurableNormalizationRetrievalContextSchema = z
  .object({
    schemaVersion: z.literal(1),
    runId: EntityIdSchema,
    jobId: EntityIdSchema,
    attemptId: EntityIdSchema,
    caseId: EntityIdSchema,
    manifestFingerprint: Sha256Schema,
    sources: z.array(NormalizationRetrievalSourceSchema).max(500),
  })
  .strict()
  .superRefine((value, context) => {
    const candidateIds = new Set<string>();
    value.sources.forEach((source, index) => {
      if (
        candidateIds.has(source.candidate.id) ||
        source.candidate.runId !== value.runId
      ) {
        context.addIssue({
          code: "custom",
          path: ["sources", index],
          message: "Normalization retrieval sources must be unique and belong to the run",
        });
      }
      candidateIds.add(source.candidate.id);
    });
  });

export type SourceRetrievalPolicyInput = z.infer<
  typeof SourceRetrievalPolicyInputSchema
>;
export type SourceRetrievalDecision = z.infer<
  typeof SourceRetrievalDecisionSchema
>;
export type SourceRetrievalGrant = z.infer<typeof SourceRetrievalGrantSchema>;
export type SourceRetrievalReceipt = z.infer<
  typeof SourceRetrievalReceiptSchema
>;
export type SourceRetrievalFailureCode = z.infer<
  typeof SourceRetrievalFailureCodeSchema
>;
export type SourceRetrievalResult = z.infer<typeof SourceRetrievalResultSchema>;
export type DurableSourceRetrievalRecord = z.infer<
  typeof DurableSourceRetrievalRecordSchema
>;
export type StoredSourceRetrievalRecord = z.infer<
  typeof StoredSourceRetrievalRecordSchema
>;
export type SourceRetrievalAcceptanceResult = z.infer<
  typeof SourceRetrievalAcceptanceResultSchema
>;
export type DurableNormalizationRetrievalContext = z.infer<
  typeof DurableNormalizationRetrievalContextSchema
>;
