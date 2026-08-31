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

const PdfFiniteNumberSchema = z.number().finite().min(-1_000_000).max(1_000_000);

export const PdfExtractionFailureCodeSchema = z.enum([
  "pdf-unsupported-media",
  "pdf-empty",
  "pdf-size-exceeded",
  "pdf-page-limit-exceeded",
  "pdf-item-limit-exceeded",
  "pdf-text-limit-exceeded",
  "pdf-encrypted",
  "pdf-malformed",
  "pdf-timeout",
  "pdf-contract-invalid",
]);

export const PdfObjectReferenceSchema = z
  .object({ objectNumber: z.number().int().positive(), generation: z.number().int().nonnegative() })
  .strict();

export const PdfTextAnchorSchema = z
  .object({
    schemaVersion: z.literal(1),
    pageNumber: z.number().int().positive(),
    pageObject: PdfObjectReferenceSchema.nullable(),
    itemStart: z.number().int().nonnegative(),
    itemEnd: z.number().int().positive(),
    boundingBox: z
      .object({
        x: PdfFiniteNumberSchema,
        y: PdfFiniteNumberSchema,
        width: PdfFiniteNumberSchema.nonnegative(),
        height: PdfFiniteNumberSchema.nonnegative(),
      })
      .strict(),
    pageTextFingerprint: Sha256Schema,
    anchorFingerprint: Sha256Schema,
  })
  .strict()
  .superRefine((anchor, context) => {
    if (anchor.itemEnd <= anchor.itemStart) {
      context.addIssue({ code: "custom", path: ["itemEnd"], message: "PDF item range must be non-empty" });
    }
  });

export const PdfNormalizedBlockSchema = z
  .object({
    schemaVersion: z.literal(1),
    ordinal: z.number().int().nonnegative().max(99_999),
    kind: z.literal("PARAGRAPH"),
    text: z.string().trim().min(1).max(20_000),
    textFingerprint: Sha256Schema,
    anchor: PdfTextAnchorSchema,
    trustBoundary: z.literal("UNTRUSTED_SOURCE_DATA"),
    instructionAuthority: z.literal("NONE"),
    evidenceStatus: z.literal("NOT_EVIDENCE"),
    reviewState: z.literal("PROPOSED"),
    publicationAuthority: z.literal("NONE"),
  })
  .strict();

export const PdfHostileContentSignalSchema = z
  .object({
    schemaVersion: z.literal(1),
    code: z.enum([
      "INSTRUCTION_OVERRIDE",
      "ROLE_IMPERSONATION",
      "TOOL_COMMAND",
      "SECRET_EXFILTRATION",
      "ENCODED_INSTRUCTION",
      "ACTIVE_CONTENT",
      "CREDENTIAL_FORM",
    ]),
    severity: z.enum(["MEDIUM", "HIGH"]),
    anchorScope: z.enum(["DOCUMENT", "PAGE_TEXT"]),
    anchor: PdfTextAnchorSchema.nullable(),
    detectorId: SlugSchema,
    detectorVersion: VersionTagSchema,
    instructionAuthority: z.literal("NONE"),
    publicationAuthority: z.literal("NONE"),
  })
  .strict()
  .superRefine((signal, context) => {
    if ((signal.anchorScope === "PAGE_TEXT") !== (signal.anchor !== null)) {
      context.addIssue({ code: "custom", path: ["anchor"], message: "Page-text signals require a PDF text anchor" });
    }
  });

export const ExtractedPdfPageSchema = z
  .object({
    schemaVersion: z.literal(1),
    pageNumber: z.number().int().positive(),
    pageObject: PdfObjectReferenceSchema.nullable(),
    rotation: z.number().int().min(0).max(359),
    width: PdfFiniteNumberSchema.positive(),
    height: PdfFiniteNumberSchema.positive(),
    textItemCount: z.number().int().nonnegative().max(100_000),
    blockStart: z.number().int().nonnegative(),
    blockEnd: z.number().int().nonnegative(),
    pageTextFingerprint: Sha256Schema,
    pageStructureFingerprint: Sha256Schema,
  })
  .strict()
  .superRefine((page, context) => {
    if (page.blockEnd < page.blockStart) {
      context.addIssue({ code: "custom", path: ["blockEnd"], message: "PDF page block range is invalid" });
    }
  });

export const ExtractedPdfDocumentSchema = z
  .object({
    schemaVersion: z.literal(1),
    snapshotId: z.string().uuid(),
    sourceId: z.string().uuid(),
    sourceLocatorId: z.string().uuid(),
    contentFingerprint: Sha256Schema,
    documentFingerprint: Sha256Schema,
    documentKind: z.literal("PDF"),
    verifiedMediaType: z.literal("application/pdf"),
    sourceByteLength: z.number().int().positive().max(50_000_000),
    pageCount: z.number().int().positive().max(2_000),
    normalizedTextLength: z.number().int().nonnegative().max(5_000_000),
    pages: z.array(ExtractedPdfPageSchema).min(1).max(2_000),
    blocks: z.array(PdfNormalizedBlockSchema).max(100_000),
    screeningState: z.enum(["PASSED", "QUARANTINED"]),
    hostileSignals: z.array(PdfHostileContentSignalSchema).max(100),
    extractor: z.object({ id: SlugSchema, version: VersionTagSchema, libraryVersion: VersionTagSchema }).strict(),
    extractedAt: IsoDateTimeSchema,
    trustBoundary: z.literal("UNTRUSTED_SOURCE_DATA"),
    instructionAuthority: z.literal("NONE"),
    evidenceStatus: z.literal("NOT_EVIDENCE"),
    reviewState: z.literal("PROPOSED"),
    publicationAuthority: z.literal("NONE"),
  })
  .strict()
  .superRefine((document, context) => {
    if (document.pages.length !== document.pageCount) {
      context.addIssue({ code: "custom", path: ["pages"], message: "PDF page manifest must be complete" });
    }
    if ((document.screeningState === "PASSED") !== (document.hostileSignals.length === 0)) {
      context.addIssue({ code: "custom", path: ["screeningState"], message: "Only signal-free PDFs may pass screening" });
    }
    const length = document.blocks.reduce((total, block, index) => {
      if (block.ordinal !== index) {
        context.addIssue({ code: "custom", path: ["blocks", index, "ordinal"], message: "PDF block ordinals must be contiguous" });
      }
      if (block.anchor.pageNumber > document.pageCount) {
        context.addIssue({ code: "custom", path: ["blocks", index, "anchor", "pageNumber"], message: "PDF block references an absent page" });
      }
      return total + block.text.length;
    }, 0);
    if (length !== document.normalizedTextLength) {
      context.addIssue({ code: "custom", path: ["normalizedTextLength"], message: "PDF text length must equal accepted blocks" });
    }
  });

export const PdfBlockManifestSchema = PdfNormalizedBlockSchema.omit({
  text: true,
  trustBoundary: true,
  reviewState: true,
}).safeExtend({ textLength: z.number().int().positive().max(20_000) }).strict();

export const PdfDocumentReceiptSchema = z
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
    documentKind: z.literal("PDF"),
    verifiedMediaType: z.literal("application/pdf"),
    sourceByteLength: z.number().int().positive().max(50_000_000),
    pageCount: z.number().int().positive().max(2_000),
    normalizedTextLength: z.number().int().nonnegative().max(5_000_000),
    pageManifests: z.array(ExtractedPdfPageSchema).min(1).max(2_000),
    blockManifests: z.array(PdfBlockManifestSchema).max(100_000),
    screeningState: z.enum(["PASSED", "QUARANTINED"]),
    hostileSignals: z.array(PdfHostileContentSignalSchema).max(100),
    retention: z.enum(["TRANSIENT_ONLY", "RETAINABLE"]),
    storageRef: OpaqueReferenceSchema.nullable(),
    accessState: AccessStateSchema,
    rightsState: RightsStateSchema,
    normalizer: z.object({ id: SlugSchema, version: VersionTagSchema }).strict(),
    libraryVersion: VersionTagSchema,
    normalizedAt: IsoDateTimeSchema,
    trustBoundary: z.literal("UNTRUSTED_SOURCE_DATA"),
    instructionAuthority: z.literal("NONE"),
    evidenceStatus: z.literal("NOT_EVIDENCE"),
    reviewState: z.literal("PROPOSED"),
    publicationAuthority: z.literal("NONE"),
  })
  .strict()
  .superRefine((receipt, context) => {
    const storageEligibleRights = new Set(["PERMITTED", "USER_OWNED", "PUBLIC_DOMAIN", "LICENSED"]);
    if (receipt.pageManifests.length !== receipt.pageCount) {
      context.addIssue({ code: "custom", path: ["pageManifests"], message: "PDF receipt requires every page manifest" });
    }
    if (receipt.retention === "TRANSIENT_ONLY" && receipt.storageRef !== null) {
      context.addIssue({ code: "custom", path: ["storageRef"], message: "Transient PDF output cannot retain storage" });
    }
    if (receipt.retention === "RETAINABLE" && (receipt.storageRef === null || !storageEligibleRights.has(receipt.rightsState))) {
      context.addIssue({ code: "custom", path: ["storageRef"], message: "Retained PDF output requires storage-eligible rights" });
    }
    if (receipt.rightsState === "LINK_ONLY" && receipt.retention !== "TRANSIENT_ONLY") {
      context.addIssue({ code: "custom", path: ["retention"], message: "LINK_ONLY PDF output must remain transient" });
    }
    if (receipt.screeningState === "QUARANTINED" && (receipt.retention !== "TRANSIENT_ONLY" || receipt.storageRef !== null)) {
      context.addIssue({ code: "custom", path: ["screeningState"], message: "Quarantined PDF output cannot be retained" });
    }
    if ((receipt.screeningState === "PASSED") !== (receipt.hostileSignals.length === 0)) {
      context.addIssue({ code: "custom", path: ["screeningState"], message: "Only signal-free PDF receipts may pass screening" });
    }
    const pageFingerprints = new Map(receipt.pageManifests.map((page) => [page.pageNumber, page.pageTextFingerprint]));
    const totalLength = receipt.blockManifests.reduce((total, block, index) => {
      if (block.ordinal !== index || pageFingerprints.get(block.anchor.pageNumber) !== block.anchor.pageTextFingerprint) {
        context.addIssue({ code: "custom", path: ["blockManifests", index], message: "PDF block manifest does not match its page" });
      }
      return total + block.textLength;
    }, 0);
    if (totalLength !== receipt.normalizedTextLength) {
      context.addIssue({ code: "custom", path: ["normalizedTextLength"], message: "PDF receipt text length must equal its block manifest" });
    }
  });

export const PdfNormalizationResultSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("NORMALIZED"), receipt: PdfDocumentReceiptSchema }).strict(),
  z.object({
    status: z.literal("UNAVAILABLE"),
    candidateId: EntityIdSchema,
    retrievalRecordId: EntityIdSchema,
    sourceId: EntityIdSchema,
    sourceLocatorId: EntityIdSchema,
    code: PdfExtractionFailureCodeSchema,
    instructionAuthority: z.literal("NONE"),
    publicationAuthority: z.literal("NONE"),
  }).strict(),
]);

export const DurablePdfNormalizationRecordSchema = z
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
    result: PdfNormalizationResultSchema,
    createdAt: IsoDateTimeSchema,
  })
  .strict()
  .superRefine((record, context) => {
    if (record.result.status === "NORMALIZED" && (
      record.result.receipt.runId !== record.runId ||
      record.result.receipt.retrievalRecordId !== record.retrievalRecordId ||
      record.result.receipt.normalizer.id !== record.normalizer.id ||
      record.result.receipt.normalizer.version !== record.normalizer.version
    )) {
      context.addIssue({ code: "custom", path: ["result", "receipt"], message: "PDF receipt must match its durable lineage" });
    }
  });

export const StoredPdfNormalizationRecordSchema = DurablePdfNormalizationRecordSchema.safeExtend({
  normalizationFingerprint: Sha256Schema,
  acceptedAt: IsoDateTimeSchema,
}).strict();

export const PdfNormalizationAcceptanceResultSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.enum(["COMMITTED", "REPLAY"]),
    lease: ResearchJobLeaseCursorSchema,
    record: StoredPdfNormalizationRecordSchema,
  }).strict(),
  z.object({ status: z.literal("LEASE_LOST") }).strict(),
  z.object({ status: z.literal("CANCELLED") }).strict(),
]);

export type ExtractedPdfDocument = z.infer<typeof ExtractedPdfDocumentSchema>;
export type PdfExtractionFailureCode = z.infer<typeof PdfExtractionFailureCodeSchema>;
export type PdfDocumentReceipt = z.infer<typeof PdfDocumentReceiptSchema>;
export type DurablePdfNormalizationRecord = z.infer<typeof DurablePdfNormalizationRecordSchema>;
export type StoredPdfNormalizationRecord = z.infer<typeof StoredPdfNormalizationRecordSchema>;
export type PdfNormalizationAcceptanceResult = z.infer<typeof PdfNormalizationAcceptanceResultSchema>;
