import { z } from "zod";
import { IsoDateTimeSchema, Sha256Schema, SlugSchema, VersionTagSchema } from "@/core/shared/schemas";

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

export type ExtractedPdfDocument = z.infer<typeof ExtractedPdfDocumentSchema>;
export type PdfExtractionFailureCode = z.infer<typeof PdfExtractionFailureCodeSchema>;
