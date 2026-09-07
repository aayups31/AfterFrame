import { z } from "zod";
import { PdfTextAnchorSchema } from "@/core/research/pdf-normalization";
import { SourceLocatorSchema } from "@/core/research/schemas";
import {
  EntityIdSchema,
  IsoDateTimeSchema,
  OpaqueReferenceSchema,
  Sha256Schema,
  SlugSchema,
  VersionTagSchema,
} from "@/core/shared/schemas";
import { ResearchJobLeaseCursorSchema } from "@/core/research-runs/worker-schemas";

export const ExactLocatorVerificationFailureCodeSchema = z.enum([
  "locator-unsupported-medium",
  "locator-source-mismatch",
  "locator-normalization-mismatch",
  "locator-target-not-found",
  "locator-target-mismatch",
  "locator-document-quarantined",
  "locator-open-target-invalid",
  "locator-reparse-failed",
  "locator-contract-invalid",
]);

export const ExactLocatorProposalSchema = z
  .object({
    schemaVersion: z.literal(1),
    normalizationRecordId: EntityIdSchema,
    blockOrdinal: z.number().int().nonnegative().max(99_999),
    expectedDocumentFingerprint: Sha256Schema,
    expectedTextFingerprint: Sha256Schema,
    expectedAnchorFingerprint: Sha256Schema,
    instructionAuthority: z.literal("NONE"),
    publicationAuthority: z.literal("NONE"),
  })
  .strict();

export const VerifiedWebTargetSchema = z
  .object({
    kind: z.enum(["ARTICLE", "WEBPAGE"]),
    documentFingerprint: Sha256Schema,
    blockOrdinal: z.number().int().nonnegative().max(9_999),
    paragraphIndex: z.number().int().nonnegative(),
    textFingerprint: Sha256Schema,
    sourceByteStart: z.number().int().nonnegative(),
    sourceByteEnd: z.number().int().positive(),
    sourceRangeFingerprint: Sha256Schema,
    headingPathFingerprints: z.array(Sha256Schema).max(20),
  })
  .strict()
  .superRefine((target, context) => {
    if (target.sourceByteEnd <= target.sourceByteStart) {
      context.addIssue({ code: "custom", path: ["sourceByteEnd"], message: "Verified web range must be non-empty" });
    }
  });

export const VerifiedPdfTargetSchema = z
  .object({
    kind: z.literal("PDF"),
    documentFingerprint: Sha256Schema,
    blockOrdinal: z.number().int().nonnegative().max(99_999),
    textFingerprint: Sha256Schema,
    pageStructureFingerprint: Sha256Schema,
    anchor: PdfTextAnchorSchema,
  })
  .strict();

export const VerifiedExactTargetSchema = z.discriminatedUnion("kind", [
  VerifiedWebTargetSchema,
  VerifiedPdfTargetSchema,
]);

export const ExactLocatorVerificationReceiptSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: EntityIdSchema,
    normalizationRecordId: EntityIdSchema,
    retrievalRecordId: EntityIdSchema,
    snapshotId: EntityIdSchema,
    sourceId: EntityIdSchema,
    previousLocatorId: EntityIdSchema,
    verifiedLocator: SourceLocatorSchema,
    target: VerifiedExactTargetSchema,
    status: z.literal("VERIFIED_EXACT"),
    verifier: z.object({ id: SlugSchema, version: VersionTagSchema }).strict(),
    verifiedAt: IsoDateTimeSchema,
    trustBoundary: z.literal("UNTRUSTED_SOURCE_DATA"),
    instructionAuthority: z.literal("NONE"),
    evidenceStatus: z.literal("NOT_EVIDENCE"),
    reviewState: z.literal("PROPOSED"),
    publicationAuthority: z.literal("NONE"),
  })
  .strict()
  .superRefine((receipt, context) => {
    if (
      receipt.verifiedLocator.id === receipt.previousLocatorId ||
      receipt.verifiedLocator.supersedesLocatorId !== receipt.previousLocatorId ||
      receipt.verifiedLocator.sourceId !== receipt.sourceId ||
      receipt.verifiedLocator.status !== "VERIFIED_EXACT" ||
      receipt.verifiedLocator.kind !== receipt.target.kind ||
      receipt.verifiedLocator.lastVerifiedAt !== receipt.verifiedAt
    ) {
      context.addIssue({ code: "custom", path: ["verifiedLocator"], message: "Verified locator revision does not match its receipt" });
    }
    if (
      (receipt.target.kind === "ARTICLE" || receipt.target.kind === "WEBPAGE") &&
      receipt.verifiedLocator.kind === receipt.target.kind &&
      (receipt.verifiedLocator.paragraphIndex !== receipt.target.paragraphIndex ||
        receipt.verifiedLocator.textFingerprint !== receipt.target.textFingerprint)
    ) {
      context.addIssue({ code: "custom", path: ["target"], message: "Web locator does not match the verified target" });
    }
    if (
      receipt.target.kind === "PDF" && receipt.verifiedLocator.kind === "PDF" &&
      (receipt.verifiedLocator.pageIndex !== receipt.target.anchor.pageNumber ||
        receipt.verifiedLocator.textFingerprint !== receipt.target.textFingerprint)
    ) {
      context.addIssue({ code: "custom", path: ["target"], message: "PDF locator does not match the verified target" });
    }
  });

export const ExactLocatorVerificationResultSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("VERIFIED_EXACT"), receipt: ExactLocatorVerificationReceiptSchema }).strict(),
  z.object({
    status: z.literal("UNAVAILABLE"),
    normalizationRecordId: EntityIdSchema,
    retrievalRecordId: EntityIdSchema,
    sourceId: EntityIdSchema,
    previousLocatorId: EntityIdSchema,
    code: ExactLocatorVerificationFailureCodeSchema,
    instructionAuthority: z.literal("NONE"),
    publicationAuthority: z.literal("NONE"),
  }).strict(),
]);

export const DurableExactLocatorVerificationRecordSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: EntityIdSchema,
    runId: EntityIdSchema,
    jobId: EntityIdSchema,
    attemptId: EntityIdSchema,
    caseId: EntityIdSchema,
    manifestFingerprint: Sha256Schema,
    normalizationRecordId: EntityIdSchema,
    targetBlockOrdinal: z.number().int().nonnegative().max(99_999),
    idempotencyKey: OpaqueReferenceSchema,
    verifier: z.object({ id: SlugSchema, version: VersionTagSchema }).strict(),
    result: ExactLocatorVerificationResultSchema,
    createdAt: IsoDateTimeSchema,
  })
  .strict()
  .superRefine((record, context) => {
    const resultNormalizationId = record.result.status === "VERIFIED_EXACT"
      ? record.result.receipt.normalizationRecordId
      : record.result.normalizationRecordId;
    if (resultNormalizationId !== record.normalizationRecordId) {
      context.addIssue({ code: "custom", path: ["normalizationRecordId"], message: "Locator verification must match its normalization lineage" });
    }
    if (
      record.result.status === "VERIFIED_EXACT" &&
      record.result.receipt.target.blockOrdinal !== record.targetBlockOrdinal
    ) {
      context.addIssue({ code: "custom", path: ["targetBlockOrdinal"], message: "Locator verification must match its target block" });
    }
    if (record.result.status === "VERIFIED_EXACT" && (
      record.result.receipt.verifier.id !== record.verifier.id ||
      record.result.receipt.verifier.version !== record.verifier.version
    )) {
      context.addIssue({ code: "custom", path: ["verifier"], message: "Locator receipt must match the durable verifier identity" });
    }
  });

export const StoredExactLocatorVerificationRecordSchema =
  DurableExactLocatorVerificationRecordSchema.safeExtend({
    verificationFingerprint: Sha256Schema,
    acceptedAt: IsoDateTimeSchema,
  }).strict();

export const ExactLocatorVerificationAcceptanceResultSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.enum(["COMMITTED", "REPLAY"]),
    lease: ResearchJobLeaseCursorSchema,
    record: StoredExactLocatorVerificationRecordSchema,
  }).strict(),
  z.object({ status: z.literal("LEASE_LOST") }).strict(),
  z.object({ status: z.literal("CANCELLED") }).strict(),
]);

export type ExactLocatorProposal = z.infer<typeof ExactLocatorProposalSchema>;
export type ExactLocatorVerificationReceipt = z.infer<typeof ExactLocatorVerificationReceiptSchema>;
export type ExactLocatorVerificationFailureCode = z.infer<typeof ExactLocatorVerificationFailureCodeSchema>;
export type DurableExactLocatorVerificationRecord = z.infer<typeof DurableExactLocatorVerificationRecordSchema>;
export type StoredExactLocatorVerificationRecord = z.infer<typeof StoredExactLocatorVerificationRecordSchema>;
export type ExactLocatorVerificationAcceptanceResult = z.infer<typeof ExactLocatorVerificationAcceptanceResultSchema>;
