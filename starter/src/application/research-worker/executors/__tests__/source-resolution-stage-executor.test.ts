import { describe, expect, it, vi } from "vitest";
import {
  SourceResolutionStageExecutor,
  type SourceResolutionStageExecutorDependencies,
} from "@/application/research-worker/executors/source-resolution-stage-executor";
import type {
  DurableSourceResolutionContextReader,
  DurableSourceResolutionRecordReader,
  SourceCandidateResolver,
} from "@/application/research/source-resolution-port";
import type { DurableResearchStageExecutionInput } from "@/core/research-runs/ports";
import { ResearchAttemptRecordSchema } from "@/core/research-runs/schemas";
import {
  ClaimedResearchJobSchema,
  type ClaimedResearchJob,
  type ResearchWorkerExecutionPlan,
} from "@/core/research-runs/worker-schemas";
import type {
  DurableSourceResolutionRecord,
  StoredSourceResolutionRecord,
} from "@/core/research/source-resolution";
import {
  BLACK_HAWK_DOWN_RESEARCH_BUNDLE,
  BLACK_HAWK_DOWN_RESEARCH_IDS,
} from "@/fixtures/black-hawk-down/research-run.fixture";
import { BLACK_HAWK_DOWN_SPINE_IDS } from "@/fixtures/black-hawk-down/deterministic-spine.fixture";
import { Sha256ResearchRunFingerprintAdapter } from "@/infrastructure/research/research-run-fingerprints";

const T1 = "2026-08-25T18:00:00.000Z";
const T2 = "2026-08-25T18:00:01.000Z";
const T3 = "2026-08-25T18:10:00.000Z";
const ATTEMPT_ID = "91000000-0000-4000-8000-000000000001";
const DISCOVERY_ATTEMPT_ID = "91000000-0000-4000-8000-000000000002";
const CANDIDATE_A = "91000000-0000-4000-8000-000000000003";
const CANDIDATE_B = "91000000-0000-4000-8000-000000000004";
const SOURCE_ID = "91000000-0000-4000-8000-000000000005";
const LOCATOR_ID = "91000000-0000-4000-8000-000000000006";
const MANIFEST_FINGERPRINT = "a".repeat(64);
const ATTEMPT_FINGERPRINT = "b".repeat(64);

const execution: ResearchWorkerExecutionPlan = {
  executorId: "source-resolution-stage-executor",
  executorVersion: "1.0.0",
  configurationFingerprint: "c".repeat(64),
  executionKind: "RESOLVER",
  model: null,
  prompt: null,
  schema: {
    id: "source-resolution-stage-result",
    version: "1.0.0",
    schemaFingerprint: "d".repeat(64),
  },
  tool: { id: "http-source-metadata", version: "1.0.0" },
  privateContentIncluded: false,
  automaticRetrySafety: "IDEMPOTENT_PROVIDER_REQUEST",
};

function makeClaim(latestCheckpoint: ClaimedResearchJob["latestCheckpoint"] = null) {
  const fixtureJob = BLACK_HAWK_DOWN_RESEARCH_BUNDLE.jobs.find(
    ({ stage }) => stage === "RESOLUTION",
  );
  if (fixtureJob === undefined) throw new Error("Fixture has no RESOLUTION job");
  const run = {
    ...BLACK_HAWK_DOWN_RESEARCH_BUNDLE.run,
    status: "RUNNING" as const,
    currentStage: "RESOLUTION" as const,
    aggregateVersion: 1,
    startedAt: T1,
    updatedAt: T2,
  };
  const job = {
    ...fixtureJob,
    status: "RUNNING" as const,
    attemptCount: 1,
    checkpointCount: latestCheckpoint?.sequence ?? 0,
    activeAttemptId: ATTEMPT_ID,
    firstStartedAt: T1,
    aggregateVersion: latestCheckpoint === null ? 1 : 2,
    updatedAt: T2,
  };
  const attempt = ResearchAttemptRecordSchema.parse({
    schemaVersion: 1,
    id: ATTEMPT_ID,
    runId: run.id,
    jobId: job.id,
    attemptNumber: 1,
    requestFingerprint: ATTEMPT_FINGERPRINT,
    status: "RUNNING",
    execution: {
      executionKind: "RESOLVER",
      traceId: run.traceId,
      providerRunId: null,
      model: null,
      prompt: null,
      schema: execution.schema,
      tool: execution.tool,
      telemetryState: "UNAVAILABLE",
      usage: null,
      cost: null,
      latencyMs: null,
      provenanceInputs: [
        { recordType: "RUN", recordId: run.id },
        { recordType: "PLAN", recordId: run.planId },
        { recordType: "JOB", recordId: job.id },
      ],
      privateContentIncluded: false,
    },
    outputFingerprint: null,
    errorCode: null,
    publicationAuthority: "NONE",
    aggregateVersion: 0,
    startedAt: T1,
    completedAt: null,
  });
  return ClaimedResearchJobSchema.parse({
    run,
    job,
    plan: BLACK_HAWK_DOWN_RESEARCH_BUNDLE.plan,
    attempt,
    lease: {
      schemaVersion: 1,
      runId: run.id,
      jobId: job.id,
      attemptId: attempt.id,
      workerId: "resolution-worker-1",
      leaseToken: "resolution-lease-1",
      leaseEpoch: 1,
      runVersion: run.aggregateVersion,
      jobVersion: job.aggregateVersion,
      attemptVersion: attempt.aggregateVersion,
      claimedAt: T1,
      heartbeatAt: T1,
      expiresAt: T3,
      externalIdempotencyKey: ATTEMPT_FINGERPRINT,
    },
    execution,
    inputManifest: {
      schemaVersion: 1,
      authority: "POSTGRES",
      manifest: {
        schemaVersion: 1,
        runId: run.id,
        caseId: run.caseId,
        branchId: run.branchId,
        planId: run.planId,
        jobId: job.id,
        stage: "RESOLUTION",
        subjectRefFingerprint: "e".repeat(64),
        objectiveFingerprint: run.objectiveFingerprint,
        runRequestFingerprint: run.requestFingerprint,
        planFingerprint: BLACK_HAWK_DOWN_RESEARCH_BUNDLE.plan.planFingerprint,
        stageSeedFingerprint: job.stageInputFingerprint,
        dependency: {
          state: "BOUND",
          predecessorJobId: job.dependsOnJobId,
          predecessorAttemptId: DISCOVERY_ATTEMPT_ID,
          predecessorOutputId: BLACK_HAWK_DOWN_RESEARCH_IDS.outputs.DISCOVERY,
          predecessorOutputFingerprint: "f".repeat(64),
        },
        subjectIdentity: {
          state: "BOUND",
          subjectIdentityId: BLACK_HAWK_DOWN_RESEARCH_IDS.subjectIdentity,
          identityFingerprint: "1".repeat(64),
        },
      },
      manifestFingerprint: MANIFEST_FINGERPRINT,
      authoredAt: T1,
    },
    latestCheckpoint,
    providerCheckpoint: null,
    resumed: latestCheckpoint !== null,
    replayed: latestCheckpoint !== null,
  });
}

function candidate(claim: ClaimedResearchJob, id: string, url: string | null) {
  const axis = claim.plan.plan.axes[0];
  const sourceClass = axis?.sourceClassIds[0];
  if (axis === undefined || sourceClass === undefined) {
    throw new Error("Fixture plan has no source policy");
  }
  return {
    schemaVersion: 1 as const,
    id,
    runId: claim.run.id,
    jobId: claim.inputManifest.manifest.dependency.state === "BOUND"
      ? claim.inputManifest.manifest.dependency.predecessorJobId
      : claim.job.id,
    attemptId: DISCOVERY_ATTEMPT_ID,
    candidateKey: `candidate:${id}`,
    title: `Candidate ${id}`,
    canonicalUrl: url,
    medium: "ARTICLE" as const,
    sourceClass,
    axisIds: [axis.axisId],
    accessState: "UNKNOWN" as const,
    rightsState: "UNKNOWN" as const,
    discoveryInputFingerprint: "f".repeat(64),
    contentTrust: "UNTRUSTED" as const,
    evidenceStatus: "NOT_EVIDENCE" as const,
    reviewState: "PROPOSED" as const,
    publicationAuthority: "NONE" as const,
    createdAt: T1,
  };
}

function unresolved(candidateId: string) {
  return {
    status: "UNRESOLVED" as const,
    candidateId,
    code: "candidate-url-missing" as const,
    publicationAuthority: "NONE" as const,
  };
}

function resolved(candidateId: string) {
  return {
    status: "RESOLVED" as const,
    proposal: {
      candidateId,
      source: {
        id: SOURCE_ID,
        canonicalKey: `url-sha256:${"4".repeat(64)}`,
        canonicalUrl: "https://example.org/shared-source",
        title: "Shared source",
        contributors: [],
        publisher: null,
        publishedAt: null,
        medium: "ARTICLE" as const,
        sourceClass: "editorial-analysis",
        accessState: "OPEN" as const,
        rightsState: "LINK_ONLY" as const,
        independenceGroupId: null,
        origin: {
          kind: "RESOLVER" as const,
          actorId: null,
          version: "1.0.0",
        },
        createdAt: T2,
      },
      locator: {
        id: LOCATOR_ID,
        sourceId: SOURCE_ID,
        kind: "ARTICLE" as const,
        status: "SOURCE_ONLY" as const,
        resolver: { id: "http-source-metadata", version: "1.0.0" },
        revision: 1,
        supersedesLocatorId: null,
        openUrl: "https://example.org/shared-source",
        resolvedAt: T2,
        lastVerifiedAt: null,
        createdAt: T2,
        headingPath: [],
        paragraphIndex: null,
        textFingerprint: null,
        textFragmentUrl: null,
      },
      reviewState: "PROPOSED" as const,
      metadataTrust: "UNTRUSTED_SOURCE_DATA" as const,
      evidenceStatus: "NOT_EVIDENCE" as const,
      publicationAuthority: "NONE" as const,
      contentBodyIncluded: false as const,
    },
  };
}

function stored(
  claim: ClaimedResearchJob,
  candidateId: string,
): StoredSourceResolutionRecord {
  return {
    schemaVersion: 1,
    id: "91000000-0000-4000-8000-000000000020",
    runId: claim.run.id,
    jobId: claim.job.id,
    attemptId: claim.attempt.id,
    caseId: claim.run.caseId,
    manifestFingerprint: MANIFEST_FINGERPRINT,
    idempotencyKey: `${claim.attempt.id}:resolve:${candidateId}`,
    resolver: execution.tool!,
    result: unresolved(candidateId),
    createdAt: T2,
    resolutionFingerprint: "2".repeat(64),
    acceptedAt: T2,
  };
}

function setup(input: Readonly<{
  accepted?: StoredSourceResolutionRecord[];
  maxCandidatesPerExecution?: number;
  resolver?: SourceCandidateResolver;
}> = {}) {
  const claim = makeClaim();
  const candidates = [
    candidate(claim, CANDIDATE_A, null),
    candidate(claim, CANDIDATE_B, null),
  ];
  const context = {
    getResolutionContext: vi.fn(async () => ({
      schemaVersion: 1 as const,
      runId: claim.run.id,
      jobId: claim.job.id,
      attemptId: claim.attempt.id,
      caseId: claim.run.caseId,
      manifestFingerprint: MANIFEST_FINGERPRINT,
      candidates,
    })),
  } satisfies DurableSourceResolutionContextReader;
  const records = {
    listAcceptedResolutions: vi.fn(async () => input.accepted ?? []),
  } satisfies DurableSourceResolutionRecordReader;
  const resolver =
    input.resolver ??
    ({
      resolve: vi.fn(async ({ candidate: value }) => unresolved(value.id)),
    } satisfies SourceCandidateResolver);
  const dependencies: SourceResolutionStageExecutorDependencies = {
    context,
    records,
    resolver,
    fingerprints: new Sha256ResearchRunFingerprintAdapter(),
    execution,
    now: () => T2,
    ...(input.maxCandidatesPerExecution === undefined
      ? {}
      : { maxCandidatesPerExecution: input.maxCandidatesPerExecution }),
  };
  return {
    claim,
    candidates,
    context,
    records,
    resolver,
    executor: new SourceResolutionStageExecutor(dependencies),
  };
}

function executionInput(claim: ClaimedResearchJob) {
  const accepted: StoredSourceResolutionRecord[] = [];
  const acceptSourceResolution = vi.fn(
    async (record: DurableSourceResolutionRecord) => {
      const value = {
        ...record,
        resolutionFingerprint: "3".repeat(64),
        acceptedAt: T2,
      } satisfies StoredSourceResolutionRecord;
      accepted.push(value);
      return value;
    },
  );
  const checkpoint = vi.fn(async (proposal) => ({
    schemaVersion: 1 as const,
    id: "91000000-0000-4000-8000-000000000030",
    runId: claim.run.id,
    jobId: claim.job.id,
    attemptId: claim.attempt.id,
    ...proposal,
    publicationAuthority: "NONE" as const,
    createdAt: T2,
  }));
  const value = {
    actorId: BLACK_HAWK_DOWN_SPINE_IDS.owner,
    claim,
    externalIdempotencyKey: ATTEMPT_FINGERPRINT,
    signal: new AbortController().signal,
    checkpoint,
    acceptProviderRun: vi.fn(),
    acceptSourceResolution,
  } satisfies DurableResearchStageExecutionInput;
  return { value, accepted, acceptSourceResolution, checkpoint };
}

describe("SourceResolutionStageExecutor", () => {
  it("durably accepts every candidate before emitting a degraded exact partition", async () => {
    const state = setup();
    const input = executionInput(state.claim);
    const outcome = await state.executor.execute(input.value);

    expect(outcome.status).toBe("COMPLETED");
    if (outcome.status !== "COMPLETED") throw new Error("Expected completion");
    expect(outcome.result).toMatchObject({
      outcome: "DEGRADED",
      boundedReasonCodes: ["source-candidates-unresolved"],
      output: {
        kind: "RESOLUTION_RESULT",
        sourceIds: [],
        locatorIds: [],
        unresolvedCandidateIds: [CANDIDATE_A, CANDIDATE_B],
      },
    });
    expect(state.resolver.resolve).toHaveBeenCalledTimes(2);
    expect(input.acceptSourceResolution).toHaveBeenCalledTimes(2);
    expect(input.checkpoint).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "OUTPUT_VALIDATED",
        completedUnits: 2,
        totalUnits: 2,
      }),
    );
  });

  it("recovers accepted decisions and resolves only the missing partition", async () => {
    const initial = setup();
    const accepted = stored(initial.claim, CANDIDATE_A);
    const state = setup({ accepted: [accepted] });
    const input = executionInput(state.claim);
    const outcome = await state.executor.execute(input.value);

    expect(outcome.status).toBe("COMPLETED");
    expect(state.resolver.resolve).toHaveBeenCalledTimes(1);
    expect(state.resolver.resolve).toHaveBeenCalledWith(
      expect.objectContaining({ candidate: expect.objectContaining({ id: CANDIDATE_B }) }),
      expect.any(AbortSignal),
    );
    expect(input.acceptSourceResolution).toHaveBeenCalledTimes(1);
  });

  it("deduplicates canonical sources and locators while retaining both decisions", async () => {
    const resolver = {
      resolve: vi.fn(async ({ candidate: value }) => resolved(value.id)),
    } satisfies SourceCandidateResolver;
    const state = setup({ resolver });
    const input = executionInput(state.claim);
    const outcome = await state.executor.execute(input.value);

    expect(outcome.status).toBe("COMPLETED");
    if (outcome.status !== "COMPLETED") throw new Error("Expected completion");
    expect(outcome.result.output).toMatchObject({
      sourceIds: [SOURCE_ID],
      locatorIds: [LOCATOR_ID],
      unresolvedCandidateIds: [],
    });
    expect(outcome.result.outcome).toBe("SUCCEEDED");
    expect(input.acceptSourceResolution).toHaveBeenCalledTimes(2);
  });

  it("hands off safely after its bounded candidate budget", async () => {
    const state = setup({ maxCandidatesPerExecution: 1 });
    const input = executionInput(state.claim);
    const outcome = await state.executor.execute(input.value);

    expect(outcome).toMatchObject({
      status: "FAILED",
      failure: {
        code: "resolution-execution-budget-reached",
        retryDirective: "RETRY_WITH_BACKOFF",
      },
    });
    expect(input.acceptSourceResolution).toHaveBeenCalledTimes(1);
    expect(input.checkpoint).not.toHaveBeenCalled();
  });

  it("fails closed when the recovered ledger contains a foreign candidate", async () => {
    const initial = setup();
    const foreign = stored(
      initial.claim,
      "91000000-0000-4000-8000-000000000099",
    );
    const state = setup({ accepted: [foreign] });
    const input = executionInput(state.claim);
    const outcome = await state.executor.execute(input.value);

    expect(outcome).toMatchObject({
      status: "FAILED",
      failure: { code: "resolution-ledger-invariant", category: "POLICY" },
    });
    expect(state.resolver.resolve).not.toHaveBeenCalled();
    expect(input.acceptSourceResolution).not.toHaveBeenCalled();
  });

  it("fails closed without the worker-controlled lease mutation callback", async () => {
    const state = setup();
    const input = executionInput(state.claim);
    const outcome = await state.executor.execute({
      ...input.value,
      acceptSourceResolution: undefined,
    });

    expect(outcome).toMatchObject({
      status: "FAILED",
      failure: { code: "resolution-acceptance-boundary-unavailable" },
    });
  });
});
