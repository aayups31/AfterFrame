import { describe, expect, it, vi } from "vitest";
import {
  DiscoveryResearchStageExecutor,
  type DiscoveryResearchStageExecutorDependencies,
} from "@/application/research-worker/executors/discovery-research-stage-executor";
import type {
  DurableResearchDiscoveryProvider,
  DurableResearchDiscoveryContextReader,
} from "@/application/research/durable-discovery-port";
import type {
  DurableResearchStageExecutionInput,
  ResearchProviderRunReader,
} from "@/core/research-runs/ports";
import { ResearchAttemptRecordSchema } from "@/core/research-runs/schemas";
import {
  ClaimedResearchJobSchema,
  type ClaimedResearchJob,
  type ResearchWorkerExecutionPlan,
} from "@/core/research-runs/worker-schemas";
import {
  BLACK_HAWK_DOWN_PUBLIC_SUBJECT_IDENTITY,
  BLACK_HAWK_DOWN_RESEARCH_BUNDLE,
  BLACK_HAWK_DOWN_RESEARCH_IDS,
  BLACK_HAWK_DOWN_RESEARCH_OBJECTIVE,
} from "@/fixtures/black-hawk-down/research-run.fixture";
import {
  BLACK_HAWK_DOWN_CASE,
  BLACK_HAWK_DOWN_SPINE_IDS,
} from "@/fixtures/black-hawk-down/deterministic-spine.fixture";
import { Sha256ResearchRunFingerprintAdapter } from "@/infrastructure/research/research-run-fingerprints";

const T1 = "2026-08-22T20:00:00.000Z";
const T2 = "2026-08-22T20:00:01.000Z";
const T3 = "2026-08-22T20:10:00.000Z";
const ATTEMPT_ID = "82000000-0000-4000-8000-000000000001";
const CHECKPOINT_ID = "82000000-0000-4000-8000-000000000002";
const OUTPUT_CHECKPOINT_ID = "82000000-0000-4000-8000-000000000003";
const ATTEMPT_FINGERPRINT = "a".repeat(64);
const MANIFEST_FINGERPRINT = "b".repeat(64);
const PROVIDER_RESPONSE_ID = "resp_discovery_executor_1";
const SECRET = "private research question and hostile provider body";

const execution: ResearchWorkerExecutionPlan = {
  executorId: "discovery-stage-executor",
  executorVersion: "1.0.0",
  configurationFingerprint: "c".repeat(64),
  executionKind: "MODEL_TOOL",
  model: {
    provider: "openai",
    model: "gpt-test",
    snapshot: "gpt-test-2026-08-01",
  },
  prompt: {
    id: "afterframe-background-source-discovery",
    version: "1.0.0",
    templateFingerprint: "d".repeat(64),
  },
  schema: {
    id: "research-discovery-candidates",
    version: "1",
    schemaFingerprint: "e".repeat(64),
  },
  tool: { id: "openai-web-search", version: "responses-v1" },
  privateContentIncluded: true,
  automaticRetrySafety: "RESUMABLE_PROVIDER_RUN",
};

function makeClaim(withProviderCheckpoint = false): ClaimedResearchJob {
  const fixtureJob = BLACK_HAWK_DOWN_RESEARCH_BUNDLE.jobs.find(
    ({ stage }) => stage === "DISCOVERY",
  );
  if (fixtureJob === undefined) throw new Error("Fixture has no DISCOVERY job");
  const checkpoint = withProviderCheckpoint
    ? {
        schemaVersion: 1 as const,
        id: CHECKPOINT_ID,
        runId: BLACK_HAWK_DOWN_RESEARCH_IDS.run,
        jobId: fixtureJob.id,
        attemptId: ATTEMPT_ID,
        idempotencyKey: `${ATTEMPT_ID}:provider-accepted`,
        sequence: 1,
        kind: "PROVIDER_ACCEPTED" as const,
        completedUnits: 0,
        totalUnits: 1,
        providerRunId: PROVIDER_RESPONSE_ID,
        resumeTokenFingerprint: "f".repeat(64),
        outputFingerprint: null,
        publicationAuthority: "NONE" as const,
        createdAt: T2,
      }
    : null;
  const run = {
    ...BLACK_HAWK_DOWN_RESEARCH_BUNDLE.run,
    status: "RUNNING" as const,
    currentStage: "DISCOVERY" as const,
    aggregateVersion: 1,
    startedAt: T1,
    updatedAt: T2,
  };
  const job = {
    ...fixtureJob,
    status: "RUNNING" as const,
    attemptCount: 1,
    checkpointCount: checkpoint?.sequence ?? 0,
    activeAttemptId: ATTEMPT_ID,
    firstStartedAt: T1,
    aggregateVersion: withProviderCheckpoint ? 2 : 1,
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
      executionKind: execution.executionKind,
      traceId: run.traceId,
      providerRunId: null,
      model: execution.model,
      prompt: execution.prompt,
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
      privateContentIncluded: true,
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
      workerId: "discovery-worker-1",
      leaseToken: "discovery-lease-1",
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
        stage: "DISCOVERY",
        subjectRefFingerprint: "1".repeat(64),
        objectiveFingerprint: run.objectiveFingerprint,
        runRequestFingerprint: run.requestFingerprint,
        planFingerprint: BLACK_HAWK_DOWN_RESEARCH_BUNDLE.plan.planFingerprint,
        stageSeedFingerprint: job.stageInputFingerprint,
        dependency: {
          state: "BOUND",
          predecessorJobId: job.dependsOnJobId,
          predecessorAttemptId: "82000000-0000-4000-8000-000000000010",
          predecessorOutputId: BLACK_HAWK_DOWN_RESEARCH_IDS.outputs.SCOPING,
          predecessorOutputFingerprint: "2".repeat(64),
        },
        subjectIdentity: {
          state: "BOUND",
          subjectIdentityId: BLACK_HAWK_DOWN_RESEARCH_IDS.subjectIdentity,
          identityFingerprint:
            BLACK_HAWK_DOWN_PUBLIC_SUBJECT_IDENTITY.identityFingerprint,
        },
      },
      manifestFingerprint: MANIFEST_FINGERPRINT,
      authoredAt: T1,
    },
    latestCheckpoint: checkpoint,
    providerCheckpoint: checkpoint,
    resumed: withProviderCheckpoint,
    replayed: withProviderCheckpoint,
  });
}

function context(claim: ClaimedResearchJob) {
  return {
    schemaVersion: 1 as const,
    runId: claim.run.id,
    jobId: claim.job.id,
    caseId: claim.run.caseId,
    subjectRef: BLACK_HAWK_DOWN_CASE.subjectRef,
    publicSubjectIdentity: BLACK_HAWK_DOWN_PUBLIC_SUBJECT_IDENTITY,
    exactQuestion: BLACK_HAWK_DOWN_RESEARCH_OBJECTIVE,
    axes: claim.plan.plan.axes,
    sourceClassIds: claim.plan.plan.sourceClassIds,
  };
}

function handle(
  state:
    | "QUEUED"
    | "IN_PROGRESS"
    | "COMPLETED"
    | "FAILED"
    | "INCOMPLETE"
    | "CANCELLED" = "QUEUED",
) {
  return {
    providerResponseId: PROVIDER_RESPONSE_ID,
    state,
    requestedModel: "gpt-test",
    providerModel: "gpt-test-2026-08-01",
    traceId: "trace-discovery-provider-1",
    binding: {
      runId: BLACK_HAWK_DOWN_RESEARCH_IDS.run,
      jobId: BLACK_HAWK_DOWN_RESEARCH_IDS.jobs.DISCOVERY,
      attemptId: ATTEMPT_ID,
      caseId: BLACK_HAWK_DOWN_CASE.id,
      manifestFingerprint: MANIFEST_FINGERPRINT,
      externalIdempotencyKey: ATTEMPT_FINGERPRINT,
    },
    startedAt: T1,
    lastObservedAt: T2,
    inputBytes: 1_000,
    dataControlMode: "MODIFIED_ABUSE_MONITORING" as const,
    projectIdFingerprint: "3".repeat(64),
    privateContentIncluded: true as const,
  };
}

function providerRecord() {
  const value = handle("IN_PROGRESS");
  return {
    schemaVersion: 1 as const,
    runId: value.binding.runId,
    jobId: value.binding.jobId,
    attemptId: value.binding.attemptId,
    caseId: value.binding.caseId,
    provider: "openai" as const,
    providerResponseId: value.providerResponseId,
    state: value.state,
    requestedModel: value.requestedModel,
    providerModel: value.providerModel,
    traceId: value.traceId,
    manifestFingerprint: value.binding.manifestFingerprint,
    externalIdempotencyKey: value.binding.externalIdempotencyKey,
    startedAt: value.startedAt,
    acceptedAt: T2,
    lastObservedAt: value.lastObservedAt,
    inputBytes: value.inputBytes,
    dataControlMode: value.dataControlMode,
    projectIdFingerprint: value.projectIdFingerprint,
    privateContentIncluded: true as const,
    publicationAuthority: "NONE" as const,
  };
}

function completedOutput() {
  const axis = BLACK_HAWK_DOWN_RESEARCH_BUNDLE.plan.plan.axes[0];
  if (axis === undefined) throw new Error("Fixture has no research axis");
  const sourceClass = axis.sourceClassIds[0];
  if (sourceClass === undefined) throw new Error("Fixture axis has no source class");
  return {
    candidates: [
      {
        candidateKey: "sha256:search-backed-candidate",
        title: "Search-backed original source",
        canonicalUrl: "https://example.org/original",
        medium: "ARTICLE" as const,
        sourceClass,
        axisIds: [axis.axisId],
        accessState: "UNKNOWN" as const,
        rightsState: "UNKNOWN" as const,
        discoveryInputFingerprint: MANIFEST_FINGERPRINT,
        contentTrust: "UNTRUSTED" as const,
        evidenceStatus: "NOT_EVIDENCE" as const,
        reviewState: "PROPOSED" as const,
        publicationAuthority: "NONE" as const,
      },
    ],
    execution: {
      executionKind: "MODEL_TOOL" as const,
      traceId: "trace-discovery-provider-1",
      providerRunId: PROVIDER_RESPONSE_ID,
      model: execution.model,
      prompt: execution.prompt,
      schema: execution.schema,
      tool: execution.tool,
      telemetryState: "COMPLETE" as const,
      usage: {
        inputTokens: 1_000,
        outputTokens: 200,
        toolCalls: 3,
        inputBytes: 1_000,
        outputBytes: 500,
      },
      cost: {
        currency: "USD" as const,
        pricingState: "UNPRICED" as const,
        amountMicros: null,
      },
      latencyMs: 1_000,
      provenanceInputs: [
        { recordType: "JOB" as const, recordId: BLACK_HAWK_DOWN_RESEARCH_IDS.jobs.DISCOVERY },
        { recordType: "ATTEMPT" as const, recordId: ATTEMPT_ID },
      ],
      privateContentIncluded: true as const,
    },
  };
}

function makeSetup(input: Readonly<{
  claim?: ClaimedResearchJob;
  recovery?: ReturnType<typeof providerRecord> | null;
  start?: DurableResearchDiscoveryProvider["start"];
  retrieve?: DurableResearchDiscoveryProvider["retrieve"];
  maxPollsPerExecution?: number;
}> = {}) {
  const claim = input.claim ?? makeClaim(false);
  const contextReader = {
    getDiscoveryContext: vi.fn(async () => context(claim)),
  } satisfies DurableResearchDiscoveryContextReader;
  const providerRuns = {
    getAcceptedProviderRun: vi.fn(async () => input.recovery ?? null),
  } satisfies ResearchProviderRunReader;
  const provider = {
    start:
      input.start ??
      vi.fn(async () => ({
        kind: "STARTED" as const,
        state: "QUEUED" as const,
        handle: handle("QUEUED"),
      })),
    retrieve:
      input.retrieve ??
      vi.fn(async () => ({
        kind: "COMPLETED" as const,
        state: "COMPLETED" as const,
        handle: handle("COMPLETED"),
        output: completedOutput(),
      })),
  } satisfies DurableResearchDiscoveryProvider;
  const dependencies: DiscoveryResearchStageExecutorDependencies = {
    context: contextReader,
    providerRuns,
    provider,
    fingerprints: new Sha256ResearchRunFingerprintAdapter(),
    execution,
    now: () => T2,
    pollIntervalMs: 100,
    maxPollsPerExecution: input.maxPollsPerExecution ?? 2,
    delay: vi.fn(async () => undefined),
  };
  return {
    claim,
    contextReader,
    providerRuns,
    provider,
    executor: new DiscoveryResearchStageExecutor(dependencies),
  };
}

function executionInput(claim: ClaimedResearchJob) {
  let sequence = claim.latestCheckpoint?.sequence ?? 0;
  const acceptProviderRun = vi.fn(async (proposal, providerRun) => {
    sequence = proposal.sequence;
    return {
      schemaVersion: 1 as const,
      id: CHECKPOINT_ID,
      runId: claim.run.id,
      jobId: claim.job.id,
      attemptId: claim.attempt.id,
      ...proposal,
      publicationAuthority: "NONE" as const,
      createdAt: T2,
      providerRun,
    };
  });
  const checkpoint = vi.fn(async (proposal) => ({
    schemaVersion: 1 as const,
    id: OUTPUT_CHECKPOINT_ID,
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
    acceptProviderRun,
    checkpoint,
  } satisfies DurableResearchStageExecutionInput;
  return { value, acceptProviderRun, checkpoint, sequence: () => sequence };
}

describe("DiscoveryResearchStageExecutor", () => {
  it("starts once, atomically accepts before retrieval, and emits deterministic untrusted candidates", async () => {
    const setup = makeSetup();
    const input = executionInput(setup.claim);
    const outcome = await setup.executor.execute(input.value);

    expect(outcome.status).toBe("COMPLETED");
    if (outcome.status !== "COMPLETED") throw new Error("Expected completion");
    expect(setup.provider.start).toHaveBeenCalledTimes(1);
    expect(input.acceptProviderRun).toHaveBeenCalledTimes(1);
    expect(setup.provider.retrieve).toHaveBeenCalledTimes(1);
    expect(
      input.acceptProviderRun.mock.invocationCallOrder[0],
    ).toBeLessThan(
      vi.mocked(setup.provider.retrieve).mock.invocationCallOrder[0] ?? 0,
    );
    expect(outcome.result.output).toMatchObject({
      kind: "DISCOVERY_RESULT",
      stage: "DISCOVERY",
    });
    expect(outcome.result.sourceCandidates).toHaveLength(1);
    expect(outcome.result.sourceCandidates[0]).toMatchObject({
      contentTrust: "UNTRUSTED",
      evidenceStatus: "NOT_EVIDENCE",
      publicationAuthority: "NONE",
      discoveryInputFingerprint: MANIFEST_FINGERPRINT,
    });
    expect(input.checkpoint).toHaveBeenCalledWith(
      expect.objectContaining({
        sequence: 2,
        kind: "OUTPUT_VALIDATED",
        providerRunId: PROVIDER_RESPONSE_ID,
      }),
    );

    const repeated = makeSetup();
    const repeatedOutcome = await repeated.executor.execute(
      executionInput(repeated.claim).value,
    );
    expect(repeatedOutcome.status).toBe("COMPLETED");
    if (repeatedOutcome.status !== "COMPLETED") {
      throw new Error("Expected replay completion");
    }
    expect(repeatedOutcome.result.output.id).toBe(outcome.result.output.id);
    expect(repeatedOutcome.result.sourceCandidates[0]?.id).toBe(
      outcome.result.sourceCandidates[0]?.id,
    );
  });

  it("recovers the exact accepted response and never starts replacement work", async () => {
    const claim = makeClaim(true);
    const start = vi.fn(async () => {
      throw new Error("must not start");
    });
    const setup = makeSetup({ claim, recovery: providerRecord(), start });
    const input = executionInput(claim);

    const outcome = await setup.executor.execute(input.value);

    expect(outcome.status).toBe("COMPLETED");
    expect(start).not.toHaveBeenCalled();
    expect(input.acceptProviderRun).not.toHaveBeenCalled();
    expect(setup.provider.retrieve).toHaveBeenCalledWith(
      expect.objectContaining({ attemptId: ATTEMPT_ID }),
      expect.objectContaining({ providerResponseId: PROVIDER_RESPONSE_ID }),
    );
    expect(input.checkpoint).toHaveBeenCalledWith(
      expect.objectContaining({ sequence: 2, kind: "OUTPUT_VALIDATED" }),
    );
  });

  it("replays an already validated deterministic output without writing a conflicting checkpoint", async () => {
    const first = makeSetup();
    const firstOutcome = await first.executor.execute(
      executionInput(first.claim).value,
    );
    if (firstOutcome.status !== "COMPLETED") {
      throw new Error("Expected initial completion");
    }
    const outputFingerprint = new Sha256ResearchRunFingerprintAdapter()
      .fingerprintExecutionOutput(firstOutcome.result);
    const recovered = makeClaim(true);
    const outputCheckpoint = {
      schemaVersion: 1 as const,
      id: OUTPUT_CHECKPOINT_ID,
      runId: recovered.run.id,
      jobId: recovered.job.id,
      attemptId: recovered.attempt.id,
      idempotencyKey: `${ATTEMPT_ID}:output-validated`,
      sequence: 2,
      kind: "OUTPUT_VALIDATED" as const,
      completedUnits: 1,
      totalUnits: 1,
      providerRunId: PROVIDER_RESPONSE_ID,
      resumeTokenFingerprint: "4".repeat(64),
      outputFingerprint,
      publicationAuthority: "NONE" as const,
      createdAt: T2,
    };
    const replayClaim = ClaimedResearchJobSchema.parse({
      ...recovered,
      job: {
        ...recovered.job,
        checkpointCount: 2,
        aggregateVersion: 3,
      },
      lease: { ...recovered.lease, jobVersion: 3 },
      latestCheckpoint: outputCheckpoint,
    });
    const setup = makeSetup({ claim: replayClaim, recovery: providerRecord() });
    const input = executionInput(replayClaim);

    const replay = await setup.executor.execute(input.value);

    expect(replay.status).toBe("COMPLETED");
    expect(input.checkpoint).not.toHaveBeenCalled();
    if (replay.status !== "COMPLETED") throw new Error("Expected replay");
    expect(replay.result).toEqual(firstOutcome.result);
  });

  it("hands still-pending work back to the same attempt after bounded polling", async () => {
    const retrieve = vi.fn(async () => ({
      kind: "PENDING" as const,
      state: "IN_PROGRESS" as const,
      handle: handle("IN_PROGRESS"),
    }));
    const setup = makeSetup({ retrieve, maxPollsPerExecution: 2 });
    const input = executionInput(setup.claim);

    const outcome = await setup.executor.execute(input.value);

    expect(outcome).toMatchObject({
      status: "FAILED",
      failure: {
        code: "discovery-provider-still-pending",
        retryDirective: "RETRY_WITH_BACKOFF",
      },
      telemetry: {
        telemetryState: "PARTIAL",
        providerRunId: PROVIDER_RESPONSE_ID,
      },
    });
    expect(retrieve).toHaveBeenCalledTimes(2);
    expect(input.acceptProviderRun).toHaveBeenCalledTimes(1);
  });

  it("fails terminally on an ambiguous start and does not authorize retry", async () => {
    const start = vi.fn(async () => {
      throw new Error(`${SECRET}: socket closed after provider acceptance`);
    });
    const setup = makeSetup({ start });
    const input = executionInput(setup.claim);

    const outcome = await setup.executor.execute(input.value);

    expect(outcome).toMatchObject({
      status: "FAILED",
      failure: {
        code: "discovery-provider-start-outcome-unknown",
        category: "POLICY",
        retryDirective: "DO_NOT_RETRY",
        redactionState: "BODY_FREE",
      },
    });
    expect(JSON.stringify(outcome)).not.toContain(SECRET);
    expect(input.acceptProviderRun).not.toHaveBeenCalled();
    expect(setup.provider.retrieve).not.toHaveBeenCalled();
  });

  it("fails closed when checkpoint and recovery state disagree", async () => {
    const setup = makeSetup({ recovery: providerRecord() });
    const outcome = await setup.executor.execute(executionInput(setup.claim).value);

    expect(outcome).toMatchObject({
      status: "FAILED",
      failure: {
        code: "discovery-provider-recovery-invariant",
        category: "POLICY",
      },
    });
    expect(setup.provider.start).not.toHaveBeenCalled();
    expect(setup.provider.retrieve).not.toHaveBeenCalled();
  });

  it("turns provider terminal output into a bounded body-free failure", async () => {
    const retrieve = vi.fn(async () => ({
      kind: "TERMINAL" as const,
      state: "FAILED" as const,
      handle: handle("FAILED"),
      failure: {
        providerResponseId: PROVIDER_RESPONSE_ID,
        state: "FAILED" as const,
        reasonCode: "provider-failed" as const,
        providerReasonCode: "server_error",
        requestedModel: "gpt-test",
        providerModel: "gpt-test-2026-08-01",
        traceId: "trace-discovery-provider-1",
        startedAt: T1,
        observedAt: T2,
        latencyMs: 1_000,
        usage: null,
        privateContentIncluded: true as const,
        sourceBody: SECRET,
      } as never,
    }));
    const setup = makeSetup({ retrieve });
    const outcome = await setup.executor.execute(executionInput(setup.claim).value);

    expect(outcome).toMatchObject({
      status: "FAILED",
      failure: {
        code: "discovery-provider-failed",
        retryDirective: "DO_NOT_RETRY",
        redactionState: "BODY_FREE",
      },
    });
    expect(JSON.stringify(outcome)).not.toContain(SECRET);
  });

  it("degrades honestly when discovery finds no search-backed candidates", async () => {
    const retrieve = vi.fn(async () => ({
      kind: "COMPLETED" as const,
      state: "COMPLETED" as const,
      handle: handle("COMPLETED"),
      output: { ...completedOutput(), candidates: [] },
    }));
    const setup = makeSetup({ retrieve });
    const outcome = await setup.executor.execute(executionInput(setup.claim).value);

    expect(outcome).toMatchObject({
      status: "COMPLETED",
      result: {
        outcome: "DEGRADED",
        boundedReasonCodes: ["discovery-no-search-backed-candidates"],
        sourceCandidates: [],
        output: { candidateIds: [] },
      },
    });
  });

  it("rejects provider snapshot drift instead of laundering model provenance", async () => {
    const drifted = completedOutput();
    const retrieve = vi.fn(async () => ({
      kind: "COMPLETED" as const,
      state: "COMPLETED" as const,
      handle: {
        ...handle("COMPLETED"),
        providerModel: "gpt-test-unapproved-snapshot",
      },
      output: {
        ...drifted,
        execution: {
          ...drifted.execution,
          model: {
            provider: "openai" as const,
            model: "gpt-test",
            snapshot: "gpt-test-unapproved-snapshot",
          },
        },
      },
    }));
    const setup = makeSetup({ retrieve });
    const outcome = await setup.executor.execute(executionInput(setup.claim).value);

    expect(outcome).toMatchObject({
      status: "FAILED",
      failure: {
        code: "discovery-provider-provenance-mismatch",
        category: "POLICY",
        retryDirective: "DO_NOT_RETRY",
      },
    });
  });
});
