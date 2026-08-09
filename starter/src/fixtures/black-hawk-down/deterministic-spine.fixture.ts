import { SubmitDirectionCommandSchema } from "@/contracts/directions";
import { DirectionRouteProposalSchema } from "@/application/submit-direction";
import { InvestigationBranchSchema } from "@/core/branches/schemas";
import { InvestigationCaseSchema } from "@/core/cases/schemas";

/**
 * Golden regression input, never a runtime knowledge base or training set.
 * It contains no source assertions and cannot be rendered as researched truth.
 */
export const BLACK_HAWK_DOWN_SPINE_IDS = {
  case: "10000000-0000-4000-8000-000000000001",
  owner: "10000000-0000-4000-8000-000000000002",
  rootBranch: "10000000-0000-4000-8000-000000000003",
  direction: "10000000-0000-4000-8000-000000000004",
  childBranch: "10000000-0000-4000-8000-000000000005",
  provenanceDirection: "10000000-0000-4000-8000-000000000006",
  provenanceScope: "10000000-0000-4000-8000-000000000007",
  directionEvent: "10000000-0000-4000-8000-000000000008",
  branchEvent: "10000000-0000-4000-8000-000000000009",
  directionOutbox: "10000000-0000-4000-8000-000000000010",
  branchOutbox: "10000000-0000-4000-8000-000000000011",
} as const;

export const BLACK_HAWK_DOWN_SPINE_TIME = "2026-08-08T16:00:00.000Z";

export const BLACK_HAWK_DOWN_CASE = InvestigationCaseSchema.parse({
  id: BLACK_HAWK_DOWN_SPINE_IDS.case,
  ownerId: BLACK_HAWK_DOWN_SPINE_IDS.owner,
  specialistId: "movie-investigator",
  specialistVersion: "0.1.0",
  subjectRef: {
    type: "film",
    id: "tmdb:movie:855",
    versionId: null,
  },
  exactCuriosity: "I want to understand why everything went wrong.",
  status: "ACTIVE",
  health: "HEALTHY",
  activeBranchId: BLACK_HAWK_DOWN_SPINE_IDS.rootBranch,
  aggregateVersion: 4,
  eventSequence: 8,
  createdAt: "2026-08-08T15:00:00.000Z",
  updatedAt: "2026-08-08T15:30:00.000Z",
});

export const BLACK_HAWK_DOWN_ROOT_BRANCH = InvestigationBranchSchema.parse({
  id: BLACK_HAWK_DOWN_SPINE_IDS.rootBranch,
  caseId: BLACK_HAWK_DOWN_SPINE_IDS.case,
  parentBranchId: null,
  originDirectionId: null,
  kind: "ROOT",
  title: "The failure cascade",
  normalizedObjective:
    "Investigate the dependencies and changing conditions without collapsing them into one answer.",
  status: "OPEN",
  researchAxisIds: ["history-context", "adaptation-source"],
  unresolvedQuestions: [
    "Which assumptions made the operation unable to absorb ordinary failures?",
  ],
  returnAnchor: null,
  aggregateVersion: 2,
  createdAt: "2026-08-08T15:00:00.000Z",
  updatedAt: "2026-08-08T15:30:00.000Z",
});

export const BLACK_HAWK_DOWN_DIRECTION_COMMAND =
  SubmitDirectionCommandSchema.parse({
    caseId: BLACK_HAWK_DOWN_SPINE_IDS.case,
    idempotencyKey: "golden-case:direction:fragility-before-contact:v1",
    expectedCaseVersion: 4,
    sourceBranchId: BLACK_HAWK_DOWN_SPINE_IDS.rootBranch,
    userText:
      "  The mission was structurally fragile before the first helicopter was hit.  ",
    anchor: null,
    requestedAction: "theory",
  });

export const BLACK_HAWK_DOWN_DIRECTION_PROPOSAL =
  DirectionRouteProposalSchema.parse({
    directionType: "THEORY",
    branchAction: "CREATE",
    branchKind: "THEORY",
    title: "Fragility before contact",
    normalizedObjective:
      "Pressure-test whether the mission was structurally fragile before the first helicopter was hit.",
    acknowledgement: "I’ll pressure-test that as a theory.",
    researchAxisIds: ["history-context"],
    unresolvedQuestions: [
      "What evidence supports fragility before contact?",
      "Which evidence weakens or contradicts that interpretation?",
      "What alternative explanation fits the same sequence?",
      "Does the film reshape the causal structure found in historical sources?",
    ],
  });

export const BLACK_HAWK_DOWN_DIRECTION_SEED = {
  cases: [BLACK_HAWK_DOWN_CASE],
  branches: [BLACK_HAWK_DOWN_ROOT_BRANCH],
} as const;
