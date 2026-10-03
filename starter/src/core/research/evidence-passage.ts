import { z } from "zod";
import { VerifiedExactTargetSchema } from "@/core/research/exact-locator-verification";
import { RightsStateSchema } from "@/core/research/schemas";
import { EntityIdSchema, IsoDateTimeSchema, Sha256Schema } from "@/core/shared/schemas";

/** Offsets refer to normalized UTF-16 text, never to raw PDF or HTML bytes. */
export const EvidencePassageSelectionSchema = z.object({
  start: z.number().int().nonnegative(),
  end: z.number().int().positive(),
  expectedTextFingerprint: Sha256Schema,
}).strict().refine((value) => value.end > value.start && value.end - value.start <= 500,
  "A passage must select between 1 and 500 UTF-16 code units");

export const PrepareEvidencePassageCommandSchema = z.object({
  caseId: EntityIdSchema,
  runId: EntityIdSchema,
  jobId: EntityIdSchema,
  attemptId: EntityIdSchema,
  manifestFingerprint: Sha256Schema,
  verificationRecordId: EntityIdSchema,
  selection: EvidencePassageSelectionSchema,
}).strict();

export const EvidencePassageFailureCodeSchema = z.enum([
  "invalid-contract", "cancelled", "context-unavailable", "lineage-mismatch",
  "locator-unavailable", "normalization-unavailable", "rights-unavailable",
  "source-quarantined", "source-changed", "target-mismatch", "selection-invalid",
  "passage-mismatch", "dependency-unavailable",
]);

/** Safe persistence candidate: no excerpt, title, URL, source text or model prose. */
export const EvidencePassageReceiptSchema = z.object({
  schemaVersion: z.literal(1),
  caseId: EntityIdSchema,
  runId: EntityIdSchema,
  jobId: EntityIdSchema,
  attemptId: EntityIdSchema,
  manifestFingerprint: Sha256Schema,
  verificationRecordId: EntityIdSchema,
  verificationFingerprint: Sha256Schema,
  normalizationRecordId: EntityIdSchema,
  retrievalRecordId: EntityIdSchema,
  snapshotId: EntityIdSchema,
  sourceId: EntityIdSchema,
  locatorId: EntityIdSchema,
  contentFingerprint: Sha256Schema,
  target: VerifiedExactTargetSchema,
  selection: EvidencePassageSelectionSchema,
  passageFingerprint: Sha256Schema,
  rightsState: RightsStateSchema,
  retention: z.literal("TRANSIENT_ONLY"),
  trustBoundary: z.literal("UNTRUSTED_SOURCE_DATA"),
  instructionAuthority: z.literal("NONE"),
  evidenceStatus: z.literal("NOT_EVIDENCE"),
  reviewState: z.literal("PROPOSED"),
  publicationAuthority: z.literal("NONE"),
  preparedAt: IsoDateTimeSchema,
}).strict().refine((receipt) => receipt.selection.expectedTextFingerprint === receipt.passageFingerprint,
  "The selected passage must match its fingerprint");

export const EvidencePassageTelemetrySchema = z.object({
  operation: z.literal("prepare-evidence-passage"),
  version: z.literal("1.0.0"),
  outcome: z.enum(["PREPARED", "UNAVAILABLE"]),
  code: EvidencePassageFailureCodeSchema.nullable(),
  latencyMs: z.number().finite().nonnegative(),
  model: z.null(),
  modelCalls: z.literal(0),
  providerCostUsd: z.literal(0),
  privateContentIncluded: z.literal(false),
}).strict();

export type PrepareEvidencePassageCommand = z.infer<typeof PrepareEvidencePassageCommandSchema>;
export type EvidencePassageReceipt = z.infer<typeof EvidencePassageReceiptSchema>;
export type EvidencePassageTelemetry = z.infer<typeof EvidencePassageTelemetrySchema>;
export type EvidencePassageFailureCode = z.infer<typeof EvidencePassageFailureCodeSchema>;
export type PrepareEvidencePassageResult =
  | Readonly<{ status: "PREPARED"; passage: string; receipt: EvidencePassageReceipt; telemetry: EvidencePassageTelemetry }>
  | Readonly<{ status: "UNAVAILABLE"; code: EvidencePassageFailureCode; telemetry: EvidencePassageTelemetry }>;
