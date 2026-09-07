import { z } from "zod";
import { PdfTextAnchorSchema } from "@/core/research/pdf-normalization";
import { SourceLocatorSchema } from "@/core/research/schemas";
import {
  EntityIdSchema,
  IsoDateTimeSchema,
  Sha256Schema,
  SlugSchema,
  VersionTagSchema,
} from "@/core/shared/schemas";

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

export type ExactLocatorProposal = z.infer<typeof ExactLocatorProposalSchema>;
export type ExactLocatorVerificationReceipt = z.infer<typeof ExactLocatorVerificationReceiptSchema>;
export type ExactLocatorVerificationFailureCode = z.infer<typeof ExactLocatorVerificationFailureCodeSchema>;
