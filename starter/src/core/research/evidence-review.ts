import { z } from "zod";
import { EvidencePassageReceiptSchema } from "@/core/research/evidence-passage";
import { ExecutionMetadataSchema, ExecutionModelMetadataSchema, ExecutionPromptMetadataSchema, ExecutionSchemaMetadataSchema } from "@/core/research-runs/schemas";
import { EntityIdSchema, IsoDateTimeSchema, Sha256Schema, SlugSchema, VersionTagSchema } from "@/core/shared/schemas";

export const EvidenceRiskFlagSchema = z.enum([
  "MATERIAL_ALLEGATION", "SAFETY_SENSITIVE", "RIGHTS_AMBIGUOUS", "SOURCE_IDENTITY_UNCERTAIN",
]);
export const EvidenceFindingKindSchema = z.enum(["FACTUAL_CLAIM", "ATTRIBUTED_ACCOUNT", "INTERPRETATION"]);
const exactText = (max: number) => z.string().min(1).max(max).refine((value) => value.trim().length > 0);

/** Proposed prose remains private and immutable during review. */
export const EvidenceReviewCandidateSchema = z.object({
  id: EntityIdSchema,
  finding: exactText(4_000),
  whySurfaced: exactText(2_000),
  shortQuote: exactText(500).nullable(),
  epistemicKind: EvidenceFindingKindSchema,
  attributedSourceId: EntityIdSchema.nullable(),
  declaredRisks: z.array(EvidenceRiskFlagSchema).max(4),
  limitations: z.array(exactText(1_000)).max(30),
  reviewState: z.literal("PROPOSED"),
  publicationAuthority: z.literal("NONE"),
}).strict().superRefine((candidate, context) => {
  if ((candidate.epistemicKind === "ATTRIBUTED_ACCOUNT") !== (candidate.attributedSourceId !== null)) {
    context.addIssue({ code: "custom", path: ["attributedSourceId"], message: "Only attributed accounts must identify their source" });
  }
  if (new Set(candidate.declaredRisks).size !== candidate.declaredRisks.length) {
    context.addIssue({ code: "custom", path: ["declaredRisks"], message: "Risk flags must be unique" });
  }
});

/** Reviewer assesses meaning. It cannot rewrite the candidate or grant acceptance. */
export const EvidenceSemanticAssessmentSchema = z.object({
  support: z.enum(["SUPPORTED", "PARTIAL", "UNSUPPORTED", "CONTRADICTED"]),
  sourceBasis: z.enum(["DOCUMENT_OBSERVATION", "SOURCE_ACCOUNT", "ANALYSIS", "COMMUNITY_LEAD", "UNKNOWN"]),
  recommendedEpistemicKind: EvidenceFindingKindSchema,
  contextSufficient: z.boolean(),
  reasoning: exactText(2_000),
  limitations: z.array(exactText(1_000)).max(30),
  detectedRisks: z.array(EvidenceRiskFlagSchema).max(4),
  supportRanges: z.array(z.object({
    start: z.number().int().nonnegative().max(499),
    end: z.number().int().positive().max(500),
  }).strict().refine((range) => range.end > range.start)).max(20),
  reviewState: z.literal("PROPOSED"),
  instructionAuthority: z.literal("NONE"),
  publicationAuthority: z.literal("NONE"),
}).strict().superRefine((assessment, context) => {
  if (assessment.support === "SUPPORTED" && assessment.supportRanges.length === 0) {
    context.addIssue({ code: "custom", path: ["supportRanges"], message: "Supported findings require exact supporting ranges" });
  }
  if (new Set(assessment.detectedRisks).size !== assessment.detectedRisks.length) {
    context.addIssue({ code: "custom", path: ["detectedRisks"], message: "Risk flags must be unique" });
  }
  assessment.supportRanges.forEach((range, index) => {
    if (index > 0 && range.start < assessment.supportRanges[index - 1]!.end) {
      context.addIssue({ code: "custom", path: ["supportRanges", index], message: "Support ranges must be ordered and disjoint" });
    }
  });
});

export const EvidenceReviewerIdentitySchema = z.object({
  id: SlugSchema, version: VersionTagSchema,
  model: ExecutionModelMetadataSchema.nullable(),
  prompt: ExecutionPromptMetadataSchema.nullable(),
  schema: ExecutionSchemaMetadataSchema,
}).strict().refine((identity) => (identity.model === null) === (identity.prompt === null),
  "A model reviewer needs both model and prompt identities");

export const EvidenceReviewPolicyReasonSchema = z.enum([
  "SEMANTIC_SUPPORT_CONFIRMED", "UNSUPPORTED_FINDING", "CONTRADICTED_FINDING",
  "PARTIAL_SUPPORT", "INSUFFICIENT_CONTEXT", "COMMUNITY_LEAD_ONLY", "SOURCE_BASIS_UNKNOWN",
  "ATTRIBUTION_REQUIRED", "EPISTEMIC_KIND_MISMATCH", "HIGH_RISK_REVIEW_REQUIRED",
]);
export const EvidenceReviewPolicyDecisionSchema = z.object({
  status: z.enum(["ELIGIBLE_FOR_PERSISTENCE", "REJECTED", "NEEDS_MORE_CONTEXT", "NEEDS_HUMAN_REVIEW"]),
  reason: EvidenceReviewPolicyReasonSchema,
  riskFlags: z.array(EvidenceRiskFlagSchema).max(4),
  reviewState: z.literal("PROPOSED"),
  evidenceStatus: z.literal("NOT_EVIDENCE"),
  publicationAuthority: z.literal("NONE"),
}).strict();

export function decideEvidenceReview(candidateInput: unknown, assessmentInput: unknown) {
  const candidate = EvidenceReviewCandidateSchema.parse(candidateInput);
  const assessment = EvidenceSemanticAssessmentSchema.parse(assessmentInput);
  const riskFlags = [...new Set([...candidate.declaredRisks, ...assessment.detectedRisks])].sort();
  const decision = (status: z.infer<typeof EvidenceReviewPolicyDecisionSchema>["status"], reason: z.infer<typeof EvidenceReviewPolicyReasonSchema>) =>
    EvidenceReviewPolicyDecisionSchema.parse({ status, reason, riskFlags,
      reviewState: "PROPOSED", evidenceStatus: "NOT_EVIDENCE", publicationAuthority: "NONE" });
  if (assessment.support === "UNSUPPORTED") return decision("REJECTED", "UNSUPPORTED_FINDING");
  if (assessment.support === "CONTRADICTED") return decision("REJECTED", "CONTRADICTED_FINDING");
  if (riskFlags.length > 0) return decision("NEEDS_HUMAN_REVIEW", "HIGH_RISK_REVIEW_REQUIRED");
  if (assessment.sourceBasis === "COMMUNITY_LEAD") return decision("NEEDS_MORE_CONTEXT", "COMMUNITY_LEAD_ONLY");
  if (assessment.sourceBasis === "UNKNOWN") return decision("NEEDS_MORE_CONTEXT", "SOURCE_BASIS_UNKNOWN");
  if (!assessment.contextSufficient) return decision("NEEDS_MORE_CONTEXT", "INSUFFICIENT_CONTEXT");
  if (assessment.support === "PARTIAL") return decision("NEEDS_MORE_CONTEXT", "PARTIAL_SUPPORT");
  if (assessment.sourceBasis === "SOURCE_ACCOUNT" && candidate.epistemicKind === "FACTUAL_CLAIM") {
    return decision("REJECTED", "ATTRIBUTION_REQUIRED");
  }
  if (assessment.recommendedEpistemicKind !== candidate.epistemicKind) return decision("REJECTED", "EPISTEMIC_KIND_MISMATCH");
  return decision("ELIGIBLE_FOR_PERSISTENCE", "SEMANTIC_SUPPORT_CONFIRMED");
}

/** Text-free audit input for a future atomic acceptance boundary. No prose or
 * quotes, and no assertion that one passage establishes an objective fact. */
export const EvidenceReviewReceiptSchema = z.object({
  schemaVersion: z.literal(1),
  candidateId: EntityIdSchema,
  candidateFingerprint: Sha256Schema,
  requestFingerprint: Sha256Schema,
  assessmentFingerprint: Sha256Schema,
  passage: EvidencePassageReceiptSchema,
  reviewer: EvidenceReviewerIdentitySchema,
  decision: EvidenceReviewPolicyDecisionSchema,
  execution: ExecutionMetadataSchema,
  reviewedAt: IsoDateTimeSchema,
}).strict();

export type EvidenceReviewCandidate = z.infer<typeof EvidenceReviewCandidateSchema>;
export type EvidenceSemanticAssessment = z.infer<typeof EvidenceSemanticAssessmentSchema>;
export type EvidenceReviewerIdentity = z.infer<typeof EvidenceReviewerIdentitySchema>;
export type EvidenceReviewReceipt = z.infer<typeof EvidenceReviewReceiptSchema>;
