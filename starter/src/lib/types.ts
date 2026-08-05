export type BeatType =
  | "opening"
  | "context"
  | "evidence"
  | "turn"
  | "question"
  | "contradiction"
  | "connection"
  | "lead"
  | "resolution";

export type ExplorationBeat = {
  id: string;
  type: BeatType;
  kicker?: string;
  body: string;
  prompt?: string;
  evidenceIds: string[];
};

export type Evidence = {
  id: string;
  index: string;
  shortLabel: string;
  type: string;
  locator: string;
  whySurfaced: string;
  status: "VERIFIED" | "APPROXIMATE" | "MOCK";
  url: string;
};

export type DirectionType =
  | "THEORY"
  | "QUESTION"
  | "LEAD"
  | "FOCUS"
  | "WIDEN"
  | "CHALLENGE"
  | "COMPARE"
  | "CONNECT"
  | "STYLE"
  | "RETURN";

export type TheorySupportState =
  | "STRONG"
  | "PLAUSIBLE"
  | "FRAGILE"
  | "UNDERDETERMINED"
  | "UNSUPPORTED"
  | "CONTRADICTED"
  | "RESEARCHING";

export type InvestigationBranch = {
  id: string;
  parentBranchId?: string;
  originText: string;
  title: string;
  objective: string;
  directionType: DirectionType;
  acknowledgement: string;
  supportState: TheorySupportState;
  beats: ExplorationBeat[];
  evidenceIds: string[];
};


export type ClosureMode =
  | "case_world"
  | "visual_script"
  | "research_dossier"
  | "outline"
  | "director_brief"
  | "evidence_appendix";

export type VisualScriptBlock = {
  id: string;
  sequence: string;
  purpose: string;
  narration: string;
  visualDirection: string;
  sourceLabels: string[];
  caveat?: string;
};

export type Investigation = {
  id: string;
  film: string;
  curiosity: string;
  intent: string;
  currentTrail: string;
  beats: ExplorationBeat[];
  evidence: Evidence[];
};
