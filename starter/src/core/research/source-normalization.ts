import { z } from "zod";
import { AccessStateSchema, RightsStateSchema } from "@/core/research/schemas";
import { ResearchJobLeaseCursorSchema } from "@/core/research-runs/worker-schemas";
import {
  EntityIdSchema,
  IsoDateTimeSchema,
  OpaqueReferenceSchema,
  Sha256Schema,
  SlugSchema,
  VersionTagSchema,
} from "@/core/shared/schemas";

export const NormalizedDocumentKindSchema = z.enum(["HTML", "PLAIN_TEXT", "PDF"]);

export const NormalizedDocumentBlockKindSchema = z.enum([
  "TITLE",
  "HEADING",
  "PARAGRAPH",
  "LIST_ITEM",
  "QUOTE",
  "PREFORMATTED",
]);

export const HostileContentSignalCodeSchema = z.enum([
  "INSTRUCTION_OVERRIDE",
  "ROLE_IMPERSONATION",
  "TOOL_COMMAND",
  "SECRET_EXFILTRATION",
  "ENCODED_INSTRUCTION",
  "HIDDEN_CONTENT",
  "ACTIVE_CONTENT",
  "EXTERNAL_EMBED",
  "CREDENTIAL_FORM",
]);

export const HostileContentSignalSchema = z
  .object({
    schemaVersion: z.literal(1),
    code: HostileContentSignalCodeSchema,
    severity: z.enum(["MEDIUM", "HIGH"]),
    sourceByteStart: z.number().int().nonnegative(),
    sourceByteEnd: z.number().int().positive(),
    sourceRangeFingerprint: Sha256Schema,
    detectorId: SlugSchema,
    detectorVersion: VersionTagSchema,
    instructionAuthority: z.literal("NONE"),
    publicationAuthority: z.literal("NONE"),
  })
  .strict()
  .superRefine((signal, context) => {
    if (signal.sourceByteEnd <= signal.sourceByteStart) {
      context.addIssue({
        code: "custom",
        path: ["sourceByteEnd"],
        message: "Hostile signal byte range must be non-empty",
      });
    }
  });

export const NormalizedDocumentBlockSchema = z
  .object({
    schemaVersion: z.literal(1),
    ordinal: z.number().int().nonnegative().max(9_999),
    kind: NormalizedDocumentBlockKindSchema,
    headingLevel: z.number().int().min(1).max(6).nullable(),
    headingPath: z.array(z.string().trim().min(1).max(500)).max(20),
    text: z.string().trim().min(1).max(20_000),
    sourceByteStart: z.number().int().nonnegative(),
    sourceByteEnd: z.number().int().positive(),
    sourceRangeFingerprint: Sha256Schema,
    textFingerprint: Sha256Schema,
    trustBoundary: z.literal("UNTRUSTED_SOURCE_DATA"),
    instructionAuthority: z.literal("NONE"),
    evidenceStatus: z.literal("NOT_EVIDENCE"),
    reviewState: z.literal("PROPOSED"),
    publicationAuthority: z.literal("NONE"),
  })
  .strict()
  .superRefine((block, context) => {
    if (block.sourceByteEnd <= block.sourceByteStart) {
      context.addIssue({
        code: "custom",
        path: ["sourceByteEnd"],
        message: "Normalized block byte range must be non-empty",
      });
    }
    if (
      (block.kind === "HEADING") !== (block.headingLevel !== null)
    ) {
      context.addIssue({
        code: "custom",
        path: ["headingLevel"],
        message: "Only heading blocks carry a heading level",
      });
    }
  });

export const NormalizedSourceDocumentSchema = z
  .object({
    schemaVersion: z.literal(1),
    snapshotId: EntityIdSchema,
    sourceId: EntityIdSchema,
    sourceLocatorId: EntityIdSchema,
    contentFingerprint: Sha256Schema,
    documentFingerprint: Sha256Schema,
    documentKind: NormalizedDocumentKindSchema,
    verifiedMediaType: z.string().trim().min(1).max(200),
    sourceByteLength: z.number().int().positive().max(100_000_000),
    normalizedTextLength: z.number().int().nonnegative().max(5_000_000),
    title: z.string().trim().min(1).max(1_000).nullable(),
    blocks: z.array(NormalizedDocumentBlockSchema).max(10_000),
    screeningState: z.enum(["PASSED", "QUARANTINED"]),
    hostileSignals: z.array(HostileContentSignalSchema).max(100),
    normalizer: z
      .object({ id: SlugSchema, version: VersionTagSchema })
      .strict(),
    normalizedAt: IsoDateTimeSchema,
    trustBoundary: z.literal("UNTRUSTED_SOURCE_DATA"),
    instructionAuthority: z.literal("NONE"),
    evidenceStatus: z.literal("NOT_EVIDENCE"),
    reviewState: z.literal("PROPOSED"),
    publicationAuthority: z.literal("NONE"),
  })
  .strict()
  .superRefine((document, context) => {
    if (
      (document.screeningState === "PASSED") !==
      (document.hostileSignals.length === 0)
    ) {
      context.addIssue({
        code: "custom",
        path: ["screeningState"],
        message: "Only signal-free documents may pass hostile-content screening",
      });
    }
    let expectedOrdinal = 0;
    let textLength = 0;
    for (const [index, block] of document.blocks.entries()) {
      if (block.ordinal !== expectedOrdinal) {
        context.addIssue({
          code: "custom",
          path: ["blocks", index, "ordinal"],
          message: "Normalized block ordinals must be contiguous",
        });
      }
      if (block.sourceByteEnd > document.sourceByteLength) {
        context.addIssue({
          code: "custom",
          path: ["blocks", index, "sourceByteEnd"],
          message: "Normalized block exceeds the source byte boundary",
        });
      }
      expectedOrdinal += 1;
      textLength += block.text.length;
    }
    if (textLength !== document.normalizedTextLength) {
      context.addIssue({
        code: "custom",
        path: ["normalizedTextLength"],
        message: "Normalized text length must equal the accepted block text",
      });
    }
    document.hostileSignals.forEach((signal, index) => {
      if (signal.sourceByteEnd > document.sourceByteLength) {
        context.addIssue({
          code: "custom",
          path: ["hostileSignals", index, "sourceByteEnd"],
          message: "Hostile signal exceeds the source byte boundary",
        });
      }
    });
  });

export const SourceNormalizationFailureCodeSchema = z.enum([
  "normalization-unsupported-media",
  "normalization-empty",
  "normalization-size-exceeded",
  "normalization-complexity-exceeded",
  "normalization-block-size-exceeded",
  "normalization-malformed-content",
  "normalization-fingerprint-mismatch",
  "normalization-contract-invalid",
]);

export const NormalizedDocumentBlockManifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    ordinal: z.number().int().nonnegative().max(9_999),
    kind: NormalizedDocumentBlockKindSchema,
    headingLevel: z.number().int().min(1).max(6).nullable(),
    textLength: z.number().int().positive().max(20_000),
    headingPathFingerprints: z.array(Sha256Schema).max(20),
    sourceByteStart: z.number().int().nonnegative(),
    sourceByteEnd: z.number().int().positive(),
    sourceRangeFingerprint: Sha256Schema,
    textFingerprint: Sha256Schema,
    instructionAuthority: z.literal("NONE"),
    evidenceStatus: z.literal("NOT_EVIDENCE"),
    publicationAuthority: z.literal("NONE"),
  })
  .strict()
  .superRefine((block, context) => {
    if (block.sourceByteEnd <= block.sourceByteStart) {
      context.addIssue({
        code: "custom",
        path: ["sourceByteEnd"],
        message: "Block manifest byte range must be non-empty",
      });
    }
    if ((block.kind === "HEADING") !== (block.headingLevel !== null)) {
      context.addIssue({
        code: "custom",
        path: ["headingLevel"],
        message: "Only heading manifests carry a heading level",
      });
    }
  });

export const NormalizedDocumentReceiptSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: EntityIdSchema,
    runId: EntityIdSchema,
    candidateId: EntityIdSchema,
    retrievalRecordId: EntityIdSchema,
    snapshotId: EntityIdSchema,
    sourceId: EntityIdSchema,
    sourceLocatorId: EntityIdSchema,
    contentFingerprint: Sha256Schema,
    documentFingerprint: Sha256Schema,
    documentKind: NormalizedDocumentKindSchema,
    verifiedMediaType: z.string().trim().min(1).max(200),
    sourceByteLength: z.number().int().positive().max(100_000_000),
    normalizedTextLength: z.number().int().nonnegative().max(5_000_000),
    blockManifests: z.array(NormalizedDocumentBlockManifestSchema).max(10_000),
    screeningState: z.enum(["PASSED", "QUARANTINED"]),
    hostileSignals: z.array(HostileContentSignalSchema).max(100),
    retention: z.enum(["TRANSIENT_ONLY", "RETAINABLE"]),
    storageRef: OpaqueReferenceSchema.nullable(),
    accessState: AccessStateSchema,
    rightsState: RightsStateSchema,
    normalizer: z.object({ id: SlugSchema, version: VersionTagSchema }).strict(),
    normalizedAt: IsoDateTimeSchema,
    trustBoundary: z.literal("UNTRUSTED_SOURCE_DATA"),
    instructionAuthority: z.literal("NONE"),
    evidenceStatus: z.literal("NOT_EVIDENCE"),
    reviewState: z.literal("PROPOSED"),
    publicationAuthority: z.literal("NONE"),
  })
  .strict()
  .superRefine((receipt, context) => {
    const storageEligibleRights = new Set([
      "PERMITTED",
      "USER_OWNED",
      "PUBLIC_DOMAIN",
      "LICENSED",
    ]);
    if (
      receipt.retention === "TRANSIENT_ONLY" &&
      receipt.storageRef !== null
    ) {
      context.addIssue({
        code: "custom",
        path: ["storageRef"],
        message: "Transient normalized documents cannot retain storage",
      });
    }
    if (
      receipt.retention === "RETAINABLE" &&
      (receipt.storageRef === null ||
        !storageEligibleRights.has(receipt.rightsState))
    ) {
      context.addIssue({
        code: "custom",
        path: ["storageRef"],
        message: "Retained normalized documents require storage-eligible rights",
      });
    }
    if (
      receipt.rightsState === "LINK_ONLY" &&
      receipt.retention !== "TRANSIENT_ONLY"
    ) {
      context.addIssue({
        code: "custom",
        path: ["retention"],
        message: "LINK_ONLY normalized documents must remain transient",
      });
    }
    if (
      receipt.screeningState === "QUARANTINED" &&
      (receipt.retention !== "TRANSIENT_ONLY" || receipt.storageRef !== null)
    ) {
      context.addIssue({
        code: "custom",
        path: ["screeningState"],
        message: "Quarantined normalized output cannot be retained",
      });
    }
    if (
      (receipt.screeningState === "PASSED") !==
      (receipt.hostileSignals.length === 0)
    ) {
      context.addIssue({
        code: "custom",
        path: ["screeningState"],
        message: "Only signal-free normalized receipts may pass screening",
      });
    }
    const totalLength = receipt.blockManifests.reduce(
      (total, block) => total + block.textLength,
      0,
    );
    if (totalLength !== receipt.normalizedTextLength) {
      context.addIssue({
        code: "custom",
        path: ["normalizedTextLength"],
        message: "Receipt text length must equal its block manifest",
      });
    }
    receipt.blockManifests.forEach((block, index) => {
      if (
        block.ordinal !== index ||
        block.sourceByteEnd > receipt.sourceByteLength
      ) {
        context.addIssue({
          code: "custom",
          path: ["blockManifests", index],
          message: "Receipt block manifest order or byte range is invalid",
        });
      }
    });
  });

export const SourceNormalizationResultSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("NORMALIZED"), receipt: NormalizedDocumentReceiptSchema }).strict(),
  z
    .object({
      status: z.literal("UNAVAILABLE"),
      candidateId: EntityIdSchema,
      retrievalRecordId: EntityIdSchema,
      sourceId: EntityIdSchema,
      sourceLocatorId: EntityIdSchema,
      code: SourceNormalizationFailureCodeSchema,
      instructionAuthority: z.literal("NONE"),
      publicationAuthority: z.literal("NONE"),
    })
    .strict(),
]);

export const DurableSourceNormalizationRecordSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: EntityIdSchema,
    runId: EntityIdSchema,
    jobId: EntityIdSchema,
    attemptId: EntityIdSchema,
    caseId: EntityIdSchema,
    manifestFingerprint: Sha256Schema,
    retrievalRecordId: EntityIdSchema,
    idempotencyKey: OpaqueReferenceSchema,
    normalizer: z.object({ id: SlugSchema, version: VersionTagSchema }).strict(),
    result: SourceNormalizationResultSchema,
    createdAt: IsoDateTimeSchema,
  })
  .strict()
  .superRefine((record, context) => {
    if (
      record.result.status === "NORMALIZED" &&
      (record.result.receipt.runId !== record.runId ||
        record.result.receipt.retrievalRecordId !== record.retrievalRecordId ||
        record.result.receipt.normalizer.id !== record.normalizer.id ||
        record.result.receipt.normalizer.version !== record.normalizer.version)
    ) {
      context.addIssue({
        code: "custom",
        path: ["result", "receipt"],
        message: "Normalization receipt must match its durable lineage",
      });
    }
  });

export const StoredSourceNormalizationRecordSchema =
  DurableSourceNormalizationRecordSchema.safeExtend({
    normalizationFingerprint: Sha256Schema,
    acceptedAt: IsoDateTimeSchema,
  }).strict();

export const SourceNormalizationAcceptanceResultSchema = z.discriminatedUnion(
  "status",
  [
    z
      .object({
        status: z.enum(["COMMITTED", "REPLAY"]),
        lease: ResearchJobLeaseCursorSchema,
        record: StoredSourceNormalizationRecordSchema,
      })
      .strict(),
    z.object({ status: z.literal("LEASE_LOST") }).strict(),
    z.object({ status: z.literal("CANCELLED") }).strict(),
  ],
);

export type NormalizedSourceDocument = z.infer<
  typeof NormalizedSourceDocumentSchema
>;
export type NormalizedDocumentBlock = z.infer<
  typeof NormalizedDocumentBlockSchema
>;
export type HostileContentSignal = z.infer<typeof HostileContentSignalSchema>;
export type SourceNormalizationFailureCode = z.infer<
  typeof SourceNormalizationFailureCodeSchema
>;
export type NormalizedDocumentReceipt = z.infer<
  typeof NormalizedDocumentReceiptSchema
>;
export type DurableSourceNormalizationRecord = z.infer<
  typeof DurableSourceNormalizationRecordSchema
>;
export type StoredSourceNormalizationRecord = z.infer<
  typeof StoredSourceNormalizationRecordSchema
>;
export type SourceNormalizationAcceptanceResult = z.infer<
  typeof SourceNormalizationAcceptanceResultSchema
>;
