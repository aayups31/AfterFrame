import type { DirectionType, TheorySupportState } from "@/lib/types";

export type MovieResearchAxis =
  | "film_text"
  | "script_development"
  | "authorship_collaboration"
  | "versions_cuts"
  | "adaptation"
  | "history_politics"
  | "science_technology"
  | "mythology_religion"
  | "reception_criticism"
  | "influence_intertext";

export type SourceCandidate = {
  id: string;
  title: string;
  sourceClass: string;
  relevance: string;
  independenceGroup?: string;
  accessState: "open" | "restricted" | "unknown";
  rightsState: "permitted" | "link_only" | "unknown";
  expectedLocatorQuality: "exact" | "approximate" | "unknown";
  concerns: string[];
};

export type DirectionPlan = {
  preservedUserText: string;
  directionType: DirectionType;
  branchAction: "create" | "redirect" | "deepen" | "detour" | "compare" | "propose_merge" | "return";
  branchTitle: string;
  normalizedObjective: string;
  researchAxes: MovieResearchAxis[];
  requiredSourceClasses: string[];
  initialQueries: string[];
  adversarialQuery?: string;
  acknowledgement: string;
};

export type TheoryAssessment = {
  supportState: TheorySupportState;
  supportClaimIds: string[];
  pressureClaimIds: string[];
  contradictionClaimIds: string[];
  alternatives: string[];
  unknowns: string[];
  calibratedResponse: string;
};

export interface DirectionRouter {
  route(input: {
    caseId: string;
    activeBranchId?: string;
    userText: string;
    anchor?: Record<string, unknown>;
  }): Promise<DirectionPlan>;
}

export interface FilmSourceScout {
  discover(input: {
    filmId: string;
    filmVersionId?: string;
    objective: string;
    axes: MovieResearchAxis[];
    sourceClasses: string[];
    adversarialQuery?: string;
  }): Promise<SourceCandidate[]>;
}

export interface TheoryBranchEvaluator {
  assess(input: {
    branchId: string;
    originalTheory: string;
    verifiedClaimIds: string[];
    evidenceIds: string[];
  }): Promise<TheoryAssessment>;
}

export interface ClosureSynthesizer {
  create(input: {
    caseId: string;
    mode: "case_world" | "visual_script" | "research_dossier" | "outline" | "director_brief" | "evidence_appendix";
    branchIds: string[];
    noteIds: string[];
    preserveOpenQuestions: boolean;
  }): Promise<{ closureSessionId: string; artifactId?: string }>;
}
