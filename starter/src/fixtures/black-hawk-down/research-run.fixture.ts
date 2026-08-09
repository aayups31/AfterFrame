import {
  ResearchDiscoveryInputSchema,
  ResolvedPublicSubjectIdentitySchema,
} from "@/application/research/discovery-port";
import { StartResearchRunCommandSchema } from "@/contracts/research-runs";
import {
  RESEARCH_STAGES,
  ResearchRunBundleSchema,
  ResearchStageExecutionResultSchema,
  type ResearchStage,
  type ResearchStageExecutionResult,
} from "@/core/research-runs/schemas";
import {
  BLACK_HAWK_DOWN_CASE,
  BLACK_HAWK_DOWN_ROOT_BRANCH,
} from "@/fixtures/black-hawk-down/deterministic-spine.fixture";
import { afterFrameV1SpecialistRegistry } from "@/specialists/registry";

export const BLACK_HAWK_DOWN_RESEARCH_IDS = {
  run: "20000000-0000-4000-8000-000000000001",
  plan: "20000000-0000-4000-8000-000000000002",
  trace: "20000000-0000-4000-8000-000000000003",
  jobs: {
    IDENTITY: "20000000-0000-4000-8000-000000000010",
    SCOPING: "20000000-0000-4000-8000-000000000011",
    DISCOVERY: "20000000-0000-4000-8000-000000000012",
    RESOLUTION: "20000000-0000-4000-8000-000000000013",
    NORMALIZATION: "20000000-0000-4000-8000-000000000014",
    CORROBORATION: "20000000-0000-4000-8000-000000000015",
    SEQUENCING: "20000000-0000-4000-8000-000000000016",
  },
  outputs: {
    IDENTITY: "20000000-0000-4000-8000-000000000020",
    SCOPING: "20000000-0000-4000-8000-000000000021",
    DISCOVERY: "20000000-0000-4000-8000-000000000022",
    RESOLUTION: "20000000-0000-4000-8000-000000000023",
    NORMALIZATION: "20000000-0000-4000-8000-000000000024",
    CORROBORATION: "20000000-0000-4000-8000-000000000025",
    SEQUENCING: "20000000-0000-4000-8000-000000000026",
  },
  candidate: "20000000-0000-4000-8000-000000000030",
  sequenceProposal: "20000000-0000-4000-8000-000000000031",
} as const;

export const BLACK_HAWK_DOWN_RESEARCH_TIME = "2026-08-08T17:00:00.000Z";
export const BLACK_HAWK_DOWN_RESEARCH_OBJECTIVE =
  `${BLACK_HAWK_DOWN_CASE.exactCuriosity}\n\nBranch objective: ${BLACK_HAWK_DOWN_ROOT_BRANCH.normalizedObjective}`;

const HASHES = {
  request: "1".repeat(64),
  objective: "2".repeat(64),
  plan: "3".repeat(64),
  identity: "4".repeat(64),
  scoping: "5".repeat(64),
  discovery: "6".repeat(64),
  resolution: "7".repeat(64),
  normalization: "8".repeat(64),
  corroboration: "9".repeat(64),
  sequencing: "a".repeat(64),
  publicIdentity: "b".repeat(64),
} as const;

const specialist = afterFrameV1SpecialistRegistry.resolve(
  BLACK_HAWK_DOWN_CASE.specialistId,
  BLACK_HAWK_DOWN_CASE.specialistVersion,
);
if (specialist === null) {
  throw new Error("Black Hawk Down fixture requires the V1 Movie specialist");
}
const preparation = specialist.prepareResearch(
  BLACK_HAWK_DOWN_CASE.subjectRef,
  BLACK_HAWK_DOWN_RESEARCH_OBJECTIVE,
);
if (!preparation.valid) {
  throw new Error("Black Hawk Down fixture subject must remain structurally valid");
}
const fixturePlan = preparation.plan;

const stageFingerprint = (stage: ResearchStage) =>
  ({
    IDENTITY: HASHES.identity,
    SCOPING: HASHES.scoping,
    DISCOVERY: HASHES.discovery,
    RESOLUTION: HASHES.resolution,
    NORMALIZATION: HASHES.normalization,
    CORROBORATION: HASHES.corroboration,
    SEQUENCING: HASHES.sequencing,
  })[stage];

export const BLACK_HAWK_DOWN_RESEARCH_COMMAND =
  StartResearchRunCommandSchema.parse({
    caseId: BLACK_HAWK_DOWN_CASE.id,
    branchId: BLACK_HAWK_DOWN_ROOT_BRANCH.id,
    expectedCaseVersion: BLACK_HAWK_DOWN_CASE.aggregateVersion,
    idempotencyKey: "golden-case:research-run:failure-cascade:v1",
  });

export const BLACK_HAWK_DOWN_RESEARCH_BUNDLE = ResearchRunBundleSchema.parse({
  run: {
    schemaVersion: 1,
    id: BLACK_HAWK_DOWN_RESEARCH_IDS.run,
    caseId: BLACK_HAWK_DOWN_CASE.id,
    branchId: BLACK_HAWK_DOWN_ROOT_BRANCH.id,
    planId: BLACK_HAWK_DOWN_RESEARCH_IDS.plan,
    specialistId: BLACK_HAWK_DOWN_CASE.specialistId,
    specialistVersion: BLACK_HAWK_DOWN_CASE.specialistVersion,
    objectiveFingerprint: HASHES.objective,
    requestFingerprint: HASHES.request,
    traceId: BLACK_HAWK_DOWN_RESEARCH_IDS.trace,
    status: "QUEUED",
    health: "HEALTHY",
    currentStage: null,
    publicationAuthority: "NONE",
    aggregateVersion: 0,
    createdAt: BLACK_HAWK_DOWN_RESEARCH_TIME,
    updatedAt: BLACK_HAWK_DOWN_RESEARCH_TIME,
    startedAt: null,
    completedAt: null,
  },
  plan: {
    id: BLACK_HAWK_DOWN_RESEARCH_IDS.plan,
    runId: BLACK_HAWK_DOWN_RESEARCH_IDS.run,
    specialistId: BLACK_HAWK_DOWN_CASE.specialistId,
    specialistVersion: BLACK_HAWK_DOWN_CASE.specialistVersion,
    inputFingerprint: HASHES.objective,
    planFingerprint: HASHES.plan,
    plan: fixturePlan,
    publicationAuthority: "NONE",
    createdAt: BLACK_HAWK_DOWN_RESEARCH_TIME,
  },
  jobs: RESEARCH_STAGES.map((stage, index) => ({
    schemaVersion: 1,
    id: BLACK_HAWK_DOWN_RESEARCH_IDS.jobs[stage],
    runId: BLACK_HAWK_DOWN_RESEARCH_IDS.run,
    caseId: BLACK_HAWK_DOWN_CASE.id,
    stage,
    stageOrdinal: index,
    dependsOnJobId:
      index === 0
        ? null
        : BLACK_HAWK_DOWN_RESEARCH_IDS.jobs[
            RESEARCH_STAGES[index - 1] as ResearchStage
          ],
    logicalJobKey: `${BLACK_HAWK_DOWN_RESEARCH_IDS.run}:${stage}:${stageFingerprint(stage)}`,
    stageInputFingerprint: stageFingerprint(stage),
    status: "QUEUED",
    attemptCount: 0,
    maxAttempts: 3,
    checkpointCount: 0,
    activeAttemptId: null,
    firstStartedAt: null,
    terminalAt: null,
    publicationAuthority: "NONE",
    aggregateVersion: 0,
    createdAt: BLACK_HAWK_DOWN_RESEARCH_TIME,
    updatedAt: BLACK_HAWK_DOWN_RESEARCH_TIME,
  })),
  attempts: [],
  outputs: [],
  sourceCandidates: [],
  untrustedContent: [],
});

export const BLACK_HAWK_DOWN_PUBLIC_SUBJECT_IDENTITY =
  ResolvedPublicSubjectIdentitySchema.parse({
    displayName: "Black Hawk Down",
    alternateNames: [],
    disambiguators: [
      { label: "release-year", value: "2001" },
      { label: "subject-kind", value: "feature film" },
    ],
    identityFingerprint: HASHES.publicIdentity,
    dataClass: "PUBLIC",
    verificationState: "RESOLVER_VERIFIED",
    resolver: { id: "tmdb-metadata", version: "fixture-1" },
    resolvedAt: BLACK_HAWK_DOWN_RESEARCH_TIME,
  });

const discoveryAxis = fixturePlan.axes[0];
if (discoveryAxis === undefined) {
  throw new Error("Fixture research plan requires at least one axis");
}

export const BLACK_HAWK_DOWN_DISCOVERY_INPUT =
  ResearchDiscoveryInputSchema.parse({
    runId: BLACK_HAWK_DOWN_RESEARCH_IDS.run,
    jobId: BLACK_HAWK_DOWN_RESEARCH_IDS.jobs.DISCOVERY,
    caseId: BLACK_HAWK_DOWN_CASE.id,
    stageInputFingerprint: HASHES.discovery,
    subjectRef: BLACK_HAWK_DOWN_CASE.subjectRef,
    publicSubjectIdentity: BLACK_HAWK_DOWN_PUBLIC_SUBJECT_IDENTITY,
    exactQuestion: BLACK_HAWK_DOWN_RESEARCH_OBJECTIVE,
    axis: {
      axisId: discoveryAxis.axisId,
      objective: discoveryAxis.objective,
      sourceClassIds: discoveryAxis.sourceClassIds,
    },
  });

function outputBase(
  stage: ResearchStage,
  attemptId: string,
  createdAt: string,
) {
  return {
    schemaVersion: 1 as const,
    id: BLACK_HAWK_DOWN_RESEARCH_IDS.outputs[stage],
    runId: BLACK_HAWK_DOWN_RESEARCH_IDS.run,
    jobId: BLACK_HAWK_DOWN_RESEARCH_IDS.jobs[stage],
    attemptId,
    reviewState: "PROPOSED" as const,
    publicationAuthority: "NONE" as const,
    provenanceInputs: [
      { recordType: "JOB" as const, recordId: BLACK_HAWK_DOWN_RESEARCH_IDS.jobs[stage] },
      { recordType: "ATTEMPT" as const, recordId: attemptId },
    ],
    createdAt,
  };
}

/**
 * Deterministic regression output only. Empty normalized collections are
 * intentional: this fixture proves orchestration, not researched truth.
 */
export function blackHawkDownStageResult(
  stage: ResearchStage,
  attemptId: string,
  createdAt: string,
): ResearchStageExecutionResult {
  const base = outputBase(stage, attemptId, createdAt);
  switch (stage) {
    case "IDENTITY":
      return ResearchStageExecutionResultSchema.parse({
        outcome: "SUCCEEDED",
        boundedReasonCodes: [],
        output: {
          ...base,
          kind: "IDENTITY_RESULT",
          stage,
          resolvedRequirementIds: ["tmdb-film"],
          unresolvedRequirementIds: ["film-version"],
        },
        sourceCandidates: [],
        untrustedContent: [],
      });
    case "SCOPING":
      return ResearchStageExecutionResultSchema.parse({
        outcome: "SUCCEEDED",
        boundedReasonCodes: [],
        output: {
          ...base,
          kind: "SCOPE_RESULT",
          stage,
          axisIds: fixturePlan.axes.map(({ axisId }) => axisId),
          sourceClassIds: fixturePlan.sourceClassIds,
          coverageGapCodes: ["film-version-unresolved"],
        },
        sourceCandidates: [],
        untrustedContent: [],
      });
    case "DISCOVERY":
      return ResearchStageExecutionResultSchema.parse({
        outcome: "SUCCEEDED",
        boundedReasonCodes: [],
        output: {
          ...base,
          kind: "DISCOVERY_RESULT",
          stage,
          candidateIds: [BLACK_HAWK_DOWN_RESEARCH_IDS.candidate],
        },
        sourceCandidates: [
          {
            schemaVersion: 1,
            id: BLACK_HAWK_DOWN_RESEARCH_IDS.candidate,
            runId: BLACK_HAWK_DOWN_RESEARCH_IDS.run,
            jobId: BLACK_HAWK_DOWN_RESEARCH_IDS.jobs.DISCOVERY,
            attemptId,
            candidateKey: "fixture:unverified-candidate:1",
            title: "Unverified official/archive candidate",
            canonicalUrl: null,
            medium: "OFFICIAL_RECORD",
            sourceClass: fixturePlan.sourceClassIds[0],
            accessState: "UNKNOWN",
            rightsState: "UNKNOWN",
            discoveryInputFingerprint: HASHES.discovery,
            contentTrust: "UNTRUSTED",
            evidenceStatus: "NOT_EVIDENCE",
            reviewState: "PROPOSED",
            publicationAuthority: "NONE",
            createdAt,
          },
        ],
        untrustedContent: [],
      });
    case "RESOLUTION":
      return ResearchStageExecutionResultSchema.parse({
        outcome: "DEGRADED",
        boundedReasonCodes: ["locator-unresolved"],
        output: {
          ...base,
          kind: "RESOLUTION_RESULT",
          stage,
          sourceIds: [],
          locatorIds: [],
          unresolvedCandidateIds: [BLACK_HAWK_DOWN_RESEARCH_IDS.candidate],
        },
        sourceCandidates: [],
        untrustedContent: [],
      });
    case "NORMALIZATION":
      return ResearchStageExecutionResultSchema.parse({
        outcome: "SUCCEEDED",
        boundedReasonCodes: [],
        output: {
          ...base,
          kind: "NORMALIZATION_RESULT",
          stage,
          proposedEvidenceIds: [],
          proposedClaimIds: [],
        },
        sourceCandidates: [],
        untrustedContent: [],
      });
    case "CORROBORATION":
      return ResearchStageExecutionResultSchema.parse({
        outcome: "SUCCEEDED",
        boundedReasonCodes: [],
        output: {
          ...base,
          kind: "CORROBORATION_RESULT",
          stage,
          assessedClaimIds: [],
          independenceGroupIds: [],
          contradictionIds: [],
          unresolvedClaimIds: [],
        },
        sourceCandidates: [],
        untrustedContent: [],
      });
    case "SEQUENCING":
      return ResearchStageExecutionResultSchema.parse({
        outcome: "SUCCEEDED",
        boundedReasonCodes: [],
        output: {
          ...base,
          kind: "SEQUENCING_RESULT",
          stage,
          sequenceProposalId: BLACK_HAWK_DOWN_RESEARCH_IDS.sequenceProposal,
          eligibleClaimIds: [],
          omittedClaimIds: [],
        },
        sourceCandidates: [],
        untrustedContent: [],
      });
  }
}
