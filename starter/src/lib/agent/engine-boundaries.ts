import type { InvestigatorCalibration } from "@/lib/agent/investigator-profile";
import type { SourceCandidate } from "@/lib/agent/contracts";

export type InvestigationSeed = {
  subjectType: string;
  subjectId?: string;
  title: string;
  userCuriosity: string;
  declaredUseCase?: string;
  calibration: InvestigatorCalibration;
};

export type SpecialistFit = {
  supported: boolean;
  confidence: number;
  reason: string;
};

export type SpecialistIntent = {
  objective: string;
  scope: string[];
  excludedForNow: string[];
  openingQuestion: string;
};

export type ResearchAxisPlan = {
  axisId: string;
  objective: string;
  requiredSourceClasses: string[];
  initialQueries: string[];
  adversarialQuery?: string;
};

export type SpecialistSourcePolicy = {
  preferredSourceClasses: string[];
  disallowedSourceClasses: string[];
  versionIdentityRequiredFor: string[];
  communityEvidenceRole: "lead_only" | "interpretation" | "disabled";
};

export type EvidenceEvaluationInput = {
  intent: SpecialistIntent;
  candidate: SourceCandidate;
  boundedExtract: string;
  sourceMetadata: Record<string, unknown>;
};

export type SpecialistEvaluation = {
  relevance: number;
  sourceRole: "primary" | "secondary" | "community" | "lead";
  claimTypes: string[];
  limitations: string[];
  versionWarnings: string[];
};

export type SequenceContext = {
  objective: string;
  activeBranchId: string;
  verifiedClaimIds: string[];
  unresolvedQuestions: string[];
  calibration: InvestigatorCalibration;
};

export type SequenceHint = {
  beatType: string;
  purpose: string;
  claimIds: string[];
  preserveUserInference: boolean;
};

/**
 * Domain-neutral contract. Core orchestration depends on this interface and
 * must not import a concrete specialist implementation.
 */
export interface InvestigationSpecialist {
  readonly id: string;
  readonly version: string;
  canHandle(input: InvestigationSeed): Promise<SpecialistFit>;
  interpretIntent(input: InvestigationSeed): Promise<SpecialistIntent>;
  planAxes(input: SpecialistIntent): Promise<ResearchAxisPlan[]>;
  sourcePolicy(): SpecialistSourcePolicy;
  evaluateEvidence(input: EvidenceEvaluationInput): Promise<SpecialistEvaluation>;
  sequenceHints(input: SequenceContext): Promise<SequenceHint[]>;
  evaluationSuite(): string;
}

export const MOVIE_INVESTIGATOR_MANIFEST = {
  id: "movie-investigator",
  version: "0.1.0",
  supportedSubjectTypes: ["film"],
  evaluationSuite: "evals/movie-investigator-eval-set.jsonl",
  v1Only: true,
} as const;
