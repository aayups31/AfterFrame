import { describe, expect, it } from "vitest";
import { ScopingResearchStageExecutor } from "@/application/research-worker/executors/scoping-research-stage-executor";
import type { DurableResearchStageExecutionInput } from "@/core/research-runs/ports";
import { ResearchAttemptRecordSchema } from "@/core/research-runs/schemas";
import {
  ClaimedResearchJobSchema,
  type ClaimedResearchJob,
  type ResearchWorkerExecutionPlan,
} from "@/core/research-runs/worker-schemas";
import {
  startResearchJob,
  transitionResearchRun,
} from "@/core/research-runs/transitions";
import { BLACK_HAWK_DOWN_RESEARCH_BUNDLE } from "@/fixtures/black-hawk-down/research-run.fixture";
import { BLACK_HAWK_DOWN_SPINE_IDS } from "@/fixtures/black-hawk-down/deterministic-spine.fixture";

const T1 = "2026-08-22T18:00:00.000Z";
const T2 = "2026-08-22T18:02:00.000Z";
const ATTEMPT_ID = "75000000-0000-4000-8000-000000000001";
const IDENTITY_ID = "75000000-0000-4000-8000-000000000002";
const PREDECESSOR_ATTEMPT_ID = "75000000-0000-4000-8000-000000000003";
const PREDECESSOR_OUTPUT_ID = "75000000-0000-4000-8000-000000000004";
const ATTEMPT_FINGERPRINT = "c".repeat(64);

const execution: ResearchWorkerExecutionPlan = {
  executorId: "scoping-stage-executor",
  executorVersion: "1.0.0",
  configurationFingerprint: "d".repeat(64),
  executionKind: "DETERMINISTIC",
  model: null,
  prompt: null,
  schema: {
    id: "scoping-stage-result",
    version: "1.0.0",
    schemaFingerprint: "e".repeat(64),
  },
  tool: null,
  privateContentIncluded: false,
  automaticRetrySafety: "IDEMPOTENT_PROVIDER_REQUEST",
};

function makeClaim(input: Readonly<{
  coverageGaps?: readonly string[];
  duplicateSourceClass?: boolean;
}> = {}): ClaimedResearchJob {
  const identityRun = transitionResearchRun(BLACK_HAWK_DOWN_RESEARCH_BUNDLE.run, {
    targetStatus: "PLANNING",
    currentStage: "IDENTITY",
    expectedVersion: 0,
    occurredAt: T1,
  });
  const run = transitionResearchRun(identityRun, {
    targetStatus: "PLANNING",
    currentStage: "SCOPING",
    expectedVersion: identityRun.aggregateVersion,
    occurredAt: T1,
  });
  const initialJob = BLACK_HAWK_DOWN_RESEARCH_BUNDLE.jobs[1];
  if (initialJob === undefined || initialJob.stage !== "SCOPING") {
    throw new Error("Fixture has no SCOPING job");
  }
  const job = startResearchJob(initialJob, {
    attemptId: ATTEMPT_ID,
    expectedVersion: 0,
    occurredAt: T1,
  });
  const sourceClassIds = [...BLACK_HAWK_DOWN_RESEARCH_BUNDLE.plan.plan.sourceClassIds];
  if (input.duplicateSourceClass) sourceClassIds.push(sourceClassIds[0] ?? "books");
  const plan = {
    ...BLACK_HAWK_DOWN_RESEARCH_BUNDLE.plan,
    plan: {
      ...BLACK_HAWK_DOWN_RESEARCH_BUNDLE.plan.plan,
      sourceClassIds,
      coverageGaps: [...(input.coverageGaps ?? [])],
    },
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
      model: null,
      prompt: null,
      schema: execution.schema,
      tool: null,
      telemetryState: "UNAVAILABLE",
      usage: null,
      cost: null,
      latencyMs: null,
      provenanceInputs: [
        { recordType: "RUN", recordId: run.id },
        { recordType: "PLAN", recordId: plan.id },
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
    plan,
    attempt,
    lease: {
      schemaVersion: 1,
      runId: run.id,
      jobId: job.id,
      attemptId: attempt.id,
      workerId: "scoping-worker-1",
      leaseToken: "scoping-lease-1",
      leaseEpoch: 1,
      runVersion: run.aggregateVersion,
      jobVersion: job.aggregateVersion,
      attemptVersion: attempt.aggregateVersion,
      claimedAt: T1,
      heartbeatAt: T1,
      expiresAt: T2,
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
        planId: plan.id,
        jobId: job.id,
        stage: "SCOPING",
        subjectRefFingerprint: "1".repeat(64),
        objectiveFingerprint: run.objectiveFingerprint,
        runRequestFingerprint: run.requestFingerprint,
        planFingerprint: plan.planFingerprint,
        stageSeedFingerprint: job.stageInputFingerprint,
        dependency: {
          state: "BOUND",
          predecessorJobId: job.dependsOnJobId,
          predecessorAttemptId: PREDECESSOR_ATTEMPT_ID,
          predecessorOutputId: PREDECESSOR_OUTPUT_ID,
          predecessorOutputFingerprint: "2".repeat(64),
        },
        subjectIdentity: {
          state: "BOUND",
          subjectIdentityId: IDENTITY_ID,
          identityFingerprint: "3".repeat(64),
        },
      },
      manifestFingerprint: "4".repeat(64),
      authoredAt: T1,
    },
    latestCheckpoint: null,
    providerCheckpoint: null,
    resumed: false,
    replayed: false,
  });
}

function executionInput(claim: ClaimedResearchJob): DurableResearchStageExecutionInput {
  return {
    actorId: BLACK_HAWK_DOWN_SPINE_IDS.owner,
    claim,
    externalIdempotencyKey: ATTEMPT_FINGERPRINT,
    signal: new AbortController().signal,
    async checkpoint() {
      throw new Error("Deterministic scoping does not checkpoint");
    },
    async acceptProviderRun() {
      throw new Error("Deterministic scoping does not accept provider runs");
    },
  };
}

describe("ScopingResearchStageExecutor", () => {
  it("projects the pinned plan without a model, candidates, or private content", async () => {
    const claim = makeClaim();
    const executor = new ScopingResearchStageExecutor({ execution });

    const outcome = await executor.execute(executionInput(claim));

    expect(outcome.status).toBe("COMPLETED");
    if (outcome.status !== "COMPLETED") throw new Error("Expected completion");
    expect(outcome.result).toMatchObject({
      outcome: "SUCCEEDED",
      boundedReasonCodes: [],
      output: {
        kind: "SCOPE_RESULT",
        stage: "SCOPING",
        axisIds: claim.plan.plan.axes.map(({ axisId }) => axisId),
        sourceClassIds: claim.plan.plan.sourceClassIds,
        coverageGapCodes: [],
        createdAt: claim.attempt.startedAt,
        publicationAuthority: "NONE",
      },
      subjectIdentities: [],
      sourceCandidates: [],
      untrustedContent: [],
    });
    expect(outcome.telemetry).toEqual({
      telemetryState: "COMPLETE",
      providerRunId: null,
      usage: {
        inputTokens: 0,
        outputTokens: 0,
        toolCalls: 0,
        inputBytes: 0,
        outputBytes: 0,
      },
      cost: { currency: "USD", pricingState: "PRICED", amountMicros: 0 },
    });
  });

  it("is byte-stable when the same durable attempt is replayed", async () => {
    const claim = makeClaim();
    const executor = new ScopingResearchStageExecutor({ execution });

    const first = await executor.execute(executionInput(claim));
    const replay = await executor.execute(executionInput(claim));

    expect(replay).toEqual(first);
  });

  it("degrades with one bounded code while discarding coverage-gap prose", async () => {
    const secretGap = "Private unresolved angle that must not enter output";
    const claim = makeClaim({ coverageGaps: [secretGap] });
    const executor = new ScopingResearchStageExecutor({ execution });

    const outcome = await executor.execute(executionInput(claim));

    expect(outcome).toMatchObject({
      status: "COMPLETED",
      result: {
        outcome: "DEGRADED",
        boundedReasonCodes: ["specialist-plan-coverage-gaps"],
        output: { coverageGapCodes: ["specialist-plan-coverage-gaps"] },
      },
    });
    expect(JSON.stringify(outcome)).not.toContain(secretGap);
  });

  it("fails closed on a non-unique specialist scope", async () => {
    const claim = makeClaim({ duplicateSourceClass: true });
    const executor = new ScopingResearchStageExecutor({ execution });

    await expect(executor.execute(executionInput(claim))).resolves.toMatchObject({
      status: "FAILED",
      failure: {
        code: "scoping-specialist-plan-invalid",
        category: "POLICY",
        retryDirective: "DO_NOT_RETRY",
      },
    });
  });

  it("rejects model-backed or private scoping configuration", () => {
    expect(
      () =>
        new ScopingResearchStageExecutor({
          execution: {
            ...execution,
            executionKind: "MODEL",
            model: { provider: "openai", model: "test", snapshot: "test" },
            prompt: {
              id: "wrong-scoping-prompt",
              version: "1",
              templateFingerprint: "5".repeat(64),
            },
            privateContentIncluded: true,
          },
        }),
    ).toThrow("body-free deterministic replay-safe");
  });
});
