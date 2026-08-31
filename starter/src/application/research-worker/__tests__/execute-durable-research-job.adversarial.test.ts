import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  createDurableResearchWorkerService,
} from "@/application/research-worker/execute-durable-research-job";
import type {
  AcceptResearchProviderRunInput,
  AcceptSourceResolutionInput,
  AcceptSourceRetrievalInput,
  CheckpointResearchJobInput,
  ClaimResearchJobInput,
  CompleteDurableResearchJobInput,
  DurableResearchStageExecutor,
  DurableResearchStageExecutionInput,
  DurableResearchWorkerStore,
  FailDurableResearchJobInput,
  HeartbeatResearchJobInput,
  ReleaseResearchJobInput,
  ResearchRunFingerprintPort,
} from "@/core/research-runs/ports";
import type { ResearchProviderAcceptanceResult } from "@/core/research-runs/provider-runs";
import { ResearchAttemptRecordSchema } from "@/core/research-runs/schemas";
import {
  ClaimedResearchJobSchema,
  ResearchWorkerExecutionTelemetrySchema,
  ResearchWorkerFailureEnvelopeSchema,
  type ClaimedResearchJob,
  type ResearchJobCheckpointResult,
  type ResearchJobCompletionResult,
  type ResearchJobFailureResult,
  type ResearchJobHeartbeatResult,
  type ResearchJobReleaseResult,
} from "@/core/research-runs/worker-schemas";
import {
  startResearchJob,
  transitionResearchRun,
} from "@/core/research-runs/transitions";
import {
  BLACK_HAWK_DOWN_RESEARCH_BUNDLE,
  blackHawkDownStageResult,
} from "@/fixtures/black-hawk-down/research-run.fixture";

const T1 = "2026-08-08T17:01:00.000Z";
const T2 = "2026-08-08T17:02:00.000Z";
const T4 = "2026-08-08T17:04:00.000Z";
const ATTEMPT_ID = "34000000-0000-4000-8000-000000000001";
const CHECKPOINT_ID = "34000000-0000-4000-8000-000000000002";
const REPLAYED_CHECKPOINT_ID = "34000000-0000-4000-8000-000000000003";
const WORKER_ID = "worker-checkpoint-03";
const SECRET = "private curiosity and provider body must never persist";
const DB_REQUEST_FINGERPRINT = "c".repeat(64);
const SUBJECT_REF_FINGERPRINT = "4".repeat(64);
const INPUT_MANIFEST_FINGERPRINT = "e".repeat(64);

const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");

const fingerprints: ResearchRunFingerprintPort = {
  fingerprintStartRequest: (_actorId, input) => hash(JSON.stringify(input)),
  fingerprintObjective: hash,
  fingerprintPlan: (plan) => hash(JSON.stringify(plan)),
  fingerprintStageInput: (input) => hash(JSON.stringify(input)),
  fingerprintAttemptRequest: (runId, jobId, key) =>
    hash(`${runId}:${jobId}:${key}`),
  fingerprintExecutionOutput: (output) => hash(JSON.stringify(output)),
};

const executorIdentity = {
  stage: "IDENTITY",
  execution: {
    executorId: "identity-resolver",
    executorVersion: "1",
    configurationFingerprint: "a".repeat(64),
    executionKind: "RESOLVER",
    model: null,
    prompt: null,
    schema: {
      id: "research-stage-output",
      version: "1",
      schemaFingerprint: "b".repeat(64),
    },
    tool: { id: "movie-identity", version: "1" },
    privateContentIncluded: false,
    automaticRetrySafety: "IDEMPOTENT_PROVIDER_REQUEST",
  },
} as const;

const telemetry = {
  telemetryState: "COMPLETE",
  providerRunId: "tmdb-request-1",
  usage: {
    inputTokens: 0,
    outputTokens: 0,
    toolCalls: 1,
    inputBytes: 40,
    outputBytes: 200,
  },
  cost: {
    currency: "USD",
    pricingState: "UNPRICED",
    amountMicros: null,
  },
} as const;

const retryableProviderFailure = {
  schemaVersion: 1,
  code: "provider-timeout",
  category: "TIMEOUT",
  phase: "EXTERNAL_CALL",
  retryDirective: "RETRY_WITH_BACKOFF",
  retryAfterMs: 1_000,
  providerStatusCode: null,
  diagnosticFingerprint: null,
  redactionState: "BODY_FREE",
} as const;

function providerRunFor(
  input: DurableResearchStageExecutionInput,
  providerResponseId: string,
) {
  return {
    schemaVersion: 1 as const,
    runId: input.claim.run.id,
    jobId: input.claim.job.id,
    attemptId: input.claim.attempt.id,
    caseId: input.claim.run.caseId,
    provider: "openai" as const,
    providerResponseId,
    state: "IN_PROGRESS" as const,
    requestedModel: "gpt-test",
    providerModel: "gpt-test-2026-08-01",
    traceId: `trace-${providerResponseId}`,
    manifestFingerprint: input.claim.inputManifest.manifestFingerprint,
    externalIdempotencyKey: input.externalIdempotencyKey,
    startedAt: T1,
    acceptedAt: T2,
    lastObservedAt: T2,
    inputBytes: 1_000,
    dataControlMode: "MODIFIED_ABUSE_MONITORING" as const,
    projectIdFingerprint: "f".repeat(64),
    privateContentIncluded: true as const,
    publicationAuthority: "NONE" as const,
  };
}

function claimedWork(input: ClaimResearchJobInput): ClaimedResearchJob {
  const run = transitionResearchRun(BLACK_HAWK_DOWN_RESEARCH_BUNDLE.run, {
    targetStatus: "PLANNING",
    currentStage: "IDENTITY",
    expectedVersion: 0,
    occurredAt: T1,
  });
  const initialJob = BLACK_HAWK_DOWN_RESEARCH_BUNDLE.jobs[0];
  if (initialJob === undefined) throw new Error("Fixture has no identity job");
  const job = startResearchJob(initialJob, {
    attemptId: input.attemptId,
    expectedVersion: 0,
    occurredAt: T1,
  });
  const attempt = ResearchAttemptRecordSchema.parse({
    schemaVersion: 1,
    id: input.attemptId,
    runId: run.id,
    jobId: job.id,
    attemptNumber: 1,
    requestFingerprint: DB_REQUEST_FINGERPRINT,
    status: "RUNNING",
    execution: {
      executionKind: input.execution.executionKind,
      traceId: run.traceId,
      providerRunId: null,
      model: input.execution.model,
      prompt: input.execution.prompt,
      schema: input.execution.schema,
      tool: input.execution.tool,
      telemetryState: "UNAVAILABLE",
      usage: null,
      cost: null,
      latencyMs: null,
      provenanceInputs: [
        { recordType: "RUN", recordId: run.id },
        { recordType: "PLAN", recordId: run.planId },
        { recordType: "JOB", recordId: job.id },
      ],
      privateContentIncluded: input.execution.privateContentIncluded,
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
      workerId: input.workerId,
      leaseToken: "lease-token-1",
      leaseEpoch: 1,
      runVersion: run.aggregateVersion,
      jobVersion: job.aggregateVersion,
      attemptVersion: attempt.aggregateVersion,
      claimedAt: T1,
      heartbeatAt: T1,
      expiresAt: T4,
      externalIdempotencyKey: DB_REQUEST_FINGERPRINT,
    },
    execution: input.execution,
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
        stage: job.stage,
        subjectRefFingerprint: SUBJECT_REF_FINGERPRINT,
        objectiveFingerprint: run.objectiveFingerprint,
        runRequestFingerprint: run.requestFingerprint,
        planFingerprint: BLACK_HAWK_DOWN_RESEARCH_BUNDLE.plan.planFingerprint,
        stageSeedFingerprint: job.stageInputFingerprint,
        dependency: { state: "ROOT" },
        subjectIdentity: { state: "UNBOUND" },
      },
      manifestFingerprint: INPUT_MANIFEST_FINGERPRINT,
      authoredAt: T1,
    },
    latestCheckpoint: null,
    providerCheckpoint: null,
    resumed: false,
    replayed: false,
  });
}

class Store implements DurableResearchWorkerStore {
  calls: string[] = [];
  claimTransform: (claim: ClaimedResearchJob) => unknown = (claim) => ({
    status: "CLAIMED",
    claim,
  });
  heartbeatResult: ResearchJobHeartbeatResult | null = null;
  checkpointInput: CheckpointResearchJobInput | null = null;
  acceptanceInput: AcceptResearchProviderRunInput | null = null;
  acceptanceTransform:
    | ((input: AcceptResearchProviderRunInput) => ResearchProviderAcceptanceResult)
    | null = null;
  checkpointTransform:
    | ((input: CheckpointResearchJobInput) => ResearchJobCheckpointResult)
    | null = null;
  completeInput: CompleteDurableResearchJobInput | null = null;
  failureInput: FailDurableResearchJobInput | null = null;
  releaseInput: ReleaseResearchJobInput | null = null;
  releaseTransform:
    | ((input: ReleaseResearchJobInput) => ResearchJobReleaseResult)
    | null = null;

  async claimResearchJob(input: ClaimResearchJobInput) {
    this.calls.push("claim");
    return this.claimTransform(claimedWork(input)) as never;
  }

  async heartbeatResearchJob(input: HeartbeatResearchJobInput) {
    this.calls.push("heartbeat");
    return (
      this.heartbeatResult ?? {
        status: "RENEWED",
        lease: {
          ...input.lease,
          heartbeatAt: T2,
          expiresAt: T4,
        },
      }
    );
  }

  async checkpointResearchJob(
    input: CheckpointResearchJobInput,
  ): Promise<ResearchJobCheckpointResult> {
    this.calls.push("checkpoint");
    this.checkpointInput = input;
    if (this.checkpointTransform !== null) {
      return this.checkpointTransform(input);
    }
    return {
      status: "COMMITTED",
      checkpoint: input.checkpoint,
      lease: {
        ...input.lease,
        jobVersion: input.lease.jobVersion + 1,
        attemptVersion: input.lease.attemptVersion + 1,
        heartbeatAt: T2,
        expiresAt: T4,
      },
    };
  }

  async acceptResearchProviderRun(input: AcceptResearchProviderRunInput) {
    this.calls.push("accept-provider");
    this.acceptanceInput = input;
    this.checkpointInput = input;
    if (this.acceptanceTransform !== null) {
      return this.acceptanceTransform(input);
    }
    return {
      status: "COMMITTED" as const,
      checkpoint: input.checkpoint,
      providerRun: input.providerRun,
      lease: {
        ...input.lease,
        jobVersion: input.lease.jobVersion + 1,
        heartbeatAt: T2,
        expiresAt: T4,
      },
    };
  }

  async acceptSourceResolution(input: AcceptSourceResolutionInput) {
    this.calls.push("accept-resolution");
    return {
      status: "COMMITTED" as const,
      record: {
        ...input.record,
        resolutionFingerprint: "9".repeat(64),
        acceptedAt: T2,
      },
      lease: {
        ...input.lease,
        heartbeatAt: T2,
        expiresAt: T4,
      },
    };
  }

  async acceptSourceRetrieval(input: AcceptSourceRetrievalInput) {
    this.calls.push("accept-retrieval");
    return {
      status: "COMMITTED" as const,
      record: {
        ...input.record,
        retrievalFingerprint: "8".repeat(64),
        acceptedAt: T2,
      },
      lease: {
        ...input.lease,
        heartbeatAt: T2,
        expiresAt: T4,
      },
    };
  }

  async completeResearchJob(
    input: CompleteDurableResearchJobInput,
  ): Promise<ResearchJobCompletionResult> {
    this.calls.push("complete");
    this.completeInput = input;
    return {
      status: "COMMITTED",
      outcome: input.result.outcome,
      terminal: {
        runId: input.lease.runId,
        jobId: input.lease.jobId,
        attemptId: input.lease.attemptId,
        jobStatus: input.result.outcome,
      },
    };
  }

  async failResearchJob(
    input: FailDurableResearchJobInput,
  ): Promise<ResearchJobFailureResult> {
    this.calls.push("fail");
    this.failureInput = input;
    if (input.failure.retryDirective === "RETRY_WITH_BACKOFF") {
      return {
        status: "RETRY_SCHEDULED",
        attemptId: input.lease.attemptId,
        retryAt: T4,
      };
    }
    return {
      status: "FAILED_TERMINAL",
      terminal: {
        runId: input.lease.runId,
        jobId: input.lease.jobId,
        attemptId: input.lease.attemptId,
        jobStatus: "FAILED_TERMINAL",
      },
      replayed: false,
    };
  }

  async releaseResearchJob(
    input: ReleaseResearchJobInput,
  ): Promise<ResearchJobReleaseResult> {
    this.calls.push("release");
    this.releaseInput = input;
    if (this.releaseTransform !== null) {
      return this.releaseTransform(input);
    }
    return {
      status: "RELEASED",
      attemptId: input.lease.attemptId,
      retryAt: T4,
    };
  }
}

function dormantDelay(_milliseconds: number, signal: AbortSignal) {
  return new Promise<void>((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    signal.addEventListener("abort", () => resolve(), { once: true });
  });
}

function service(store: Store, executor: DurableResearchStageExecutor, delay = dormantDelay) {
  return createDurableResearchWorkerService({
    store,
    executors: {
      resolve(stage) {
        return stage === "IDENTITY" ? executor : null;
      },
    },
    fingerprints,
    workerId: WORKER_ID,
    leaseDurationSeconds: 60,
    heartbeatIntervalMs: 1_000,
    createId: (kind) =>
      kind === "research_attempt" ? ATTEMPT_ID : CHECKPOINT_ID,
    now: () => T2,
    delay,
  });
}

const command = {
  runId: BLACK_HAWK_DOWN_RESEARCH_BUNDLE.run.id,
  jobId: BLACK_HAWK_DOWN_RESEARCH_BUNDLE.jobs[0]!.id,
  stage: "IDENTITY",
  expectedRunVersion: 0,
  expectedJobVersion: 0,
  idempotencyKey: "identity-attempt-once",
} as const;

describe("durable research worker", () => {
  it("persists a claimed attempt before external work and commits from the fenced cursor", async () => {
    const store = new Store();
    const executor: DurableResearchStageExecutor = {
      identity: executorIdentity,
      async execute(input) {
        store.calls.push("execute");
        expect(store.calls[0]).toBe("claim");
        expect(input.actorId).toBe(
          BLACK_HAWK_DOWN_RESEARCH_BUNDLE.run.caseId,
        );
        expect(input.claim.attempt.status).toBe("RUNNING");
        expect(input.externalIdempotencyKey).toBe(
          input.claim.attempt.requestFingerprint,
        );
        return {
          status: "COMPLETED",
          result: blackHawkDownStageResult("IDENTITY", ATTEMPT_ID, T2),
          telemetry,
        };
      },
    };

    const execution = await service(store, executor)(
      BLACK_HAWK_DOWN_RESEARCH_BUNDLE.run.caseId,
      command,
    );

    expect(execution.disposition).toBe("DEGRADED");
    expect(store.calls).toEqual(["claim", "execute", "complete"]);
    expect(store.completeInput?.lease.attemptId).toBe(ATTEMPT_ID);
    expect(store.completeInput?.execution.latencyMs).toBe(60_000);
  });

  it("serializes a body-free checkpoint and advances the fencing cursor before completion", async () => {
    const store = new Store();
    const executor: DurableResearchStageExecutor = {
      identity: executorIdentity,
      async execute(input) {
        await input.checkpoint({
          idempotencyKey: "identity-provider-accepted",
          sequence: 1,
          kind: "PROGRESS",
          completedUnits: 0,
          totalUnits: 1,
          providerRunId: null,
          resumeTokenFingerprint: null,
          outputFingerprint: null,
        });
        return {
          status: "COMPLETED",
          result: blackHawkDownStageResult("IDENTITY", ATTEMPT_ID, T2),
          telemetry,
        };
      },
    };

    await service(store, executor)(
      BLACK_HAWK_DOWN_RESEARCH_BUNDLE.run.caseId,
      command,
    );

    expect(store.calls).toEqual(["claim", "checkpoint", "complete"]);
    expect(store.checkpointInput?.checkpoint.publicationAuthority).toBe("NONE");
    expect(store.completeInput?.lease.attemptVersion).toBe(1);
    expect(JSON.stringify(store.checkpointInput)).not.toContain(SECRET);
  });

  it("uses the canonical persisted checkpoint when a lost commit response replays", async () => {
    const store = new Store();
    store.checkpointTransform = (input) => ({
      status: "REPLAY",
      checkpoint: {
        ...input.checkpoint,
        id: REPLAYED_CHECKPOINT_ID,
        createdAt: T1,
      },
      lease: {
        ...input.lease,
        jobVersion: input.lease.jobVersion + 1,
        attemptVersion: input.lease.attemptVersion + 1,
        heartbeatAt: T2,
        expiresAt: T4,
      },
    });
    let returnedCheckpointId: string | null = null;
    const executor: DurableResearchStageExecutor = {
      identity: executorIdentity,
      async execute(input) {
        const checkpoint = await input.checkpoint({
          idempotencyKey: "identity-provider-replay",
          sequence: 1,
          kind: "PROGRESS",
          completedUnits: 0,
          totalUnits: 1,
          providerRunId: null,
          resumeTokenFingerprint: null,
          outputFingerprint: null,
        });
        returnedCheckpointId = checkpoint.id;
        return {
          status: "COMPLETED",
          result: blackHawkDownStageResult("IDENTITY", ATTEMPT_ID, T2),
          telemetry,
        };
      },
    };

    const execution = await service(store, executor)(
      BLACK_HAWK_DOWN_RESEARCH_BUNDLE.run.caseId,
      command,
    );

    expect(execution.disposition).toBe("DEGRADED");
    expect(returnedCheckpointId).toBe(REPLAYED_CHECKPOINT_ID);
    expect(store.calls).toEqual(["claim", "checkpoint", "complete"]);
  });

  it("rejects provider acceptance through the non-atomic checkpoint path", async () => {
    const store = new Store();
    const executor: DurableResearchStageExecutor = {
      identity: executorIdentity,
      async execute(input) {
        await input.checkpoint({
          idempotencyKey: "unsafe-provider-acceptance",
          sequence: 1,
          kind: "PROVIDER_ACCEPTED",
          completedUnits: 0,
          totalUnits: 1,
          providerRunId: "provider-run-without-recovery-state",
          resumeTokenFingerprint: null,
          outputFingerprint: null,
        });
        throw new Error("unreachable");
      },
    };

    const execution = await service(store, executor)(
      BLACK_HAWK_DOWN_RESEARCH_BUNDLE.run.caseId,
      command,
    );

    expect(execution.disposition).toBe("FAILED_TERMINAL");
    expect(store.calls).toEqual(["claim", "fail"]);
    expect(store.checkpointInput).toBeNull();
  });

  it("aborts work on heartbeat cancellation and never commits stale output or failure", async () => {
    const store = new Store();
    store.heartbeatResult = { status: "CANCELLED" };
    let firstDelay = true;
    const fastFirstHeartbeat = (milliseconds: number, signal: AbortSignal) => {
      if (firstDelay) {
        firstDelay = false;
        return Promise.resolve();
      }
      return dormantDelay(milliseconds, signal);
    };
    const executor: DurableResearchStageExecutor = {
      identity: executorIdentity,
      execute(input) {
        return new Promise((resolve) => {
          if (input.signal.aborted) {
            resolve({
              status: "FAILED",
              failure: {
                schemaVersion: 1,
                code: "cancelled",
                category: "WORKER_INTERNAL",
                phase: "EXTERNAL_CALL",
                retryDirective: "DO_NOT_RETRY",
                retryAfterMs: null,
                providerStatusCode: null,
                diagnosticFingerprint: null,
                redactionState: "BODY_FREE",
              },
              telemetry: {
                telemetryState: "UNAVAILABLE",
                providerRunId: null,
                usage: null,
                cost: null,
              },
            });
            return;
          }
          input.signal.addEventListener(
            "abort",
            () =>
              resolve({
                status: "FAILED",
                failure: unexpectedFailureForTest(),
                telemetry: {
                  telemetryState: "UNAVAILABLE",
                  providerRunId: null,
                  usage: null,
                  cost: null,
                },
              }),
            { once: true },
          );
        });
      },
    };

    const execution = await service(store, executor, fastFirstHeartbeat)(
      BLACK_HAWK_DOWN_RESEARCH_BUNDLE.run.caseId,
      command,
    );

    expect(execution.disposition).toBe("CANCELLED");
    expect(store.calls).toEqual(["claim", "heartbeat"]);
  });

  it("rejects a claim that flips trusted retry safety before invoking the executor", async () => {
    const store = new Store();
    store.claimTransform = (claim) => ({
      status: "CLAIMED",
      claim: {
        ...claim,
        execution: {
          ...claim.execution,
          automaticRetrySafety: "NOT_GUARANTEED",
        },
      },
    });
    let executions = 0;
    const executor: DurableResearchStageExecutor = {
      identity: executorIdentity,
      async execute() {
        executions += 1;
        throw new Error("must not execute");
      },
    };

    await expect(
      service(store, executor)(
        BLACK_HAWK_DOWN_RESEARCH_BUNDLE.run.caseId,
        command,
      ),
    ).rejects.toMatchObject({
      code: "CLAIM_MISMATCH",
    });
    expect(executions).toBe(0);
    expect(store.calls).toEqual(["claim", "fail"]);
    expect(store.failureInput?.failure.code).toBe("claimed-work-mismatch");
  });

  it("reduces malformed executor data to a bounded failure envelope", async () => {
    const store = new Store();
    const executor = {
      identity: executorIdentity,
      async execute() {
        return { status: "COMPLETED", privateBody: SECRET } as never;
      },
    } satisfies DurableResearchStageExecutor;

    const execution = await service(store, executor)(
      BLACK_HAWK_DOWN_RESEARCH_BUNDLE.run.caseId,
      command,
    );

    expect(execution.disposition).toBe("FAILED_RETRYABLE");
    expect(store.failureInput?.failure.code).toBe("stage-output-invalid");
    expect(JSON.stringify(store.failureInput)).not.toContain(SECRET);
  });

  it("rejects an identity result that omits an authoritative plan requirement", async () => {
    const store = new Store();
    const executor: DurableResearchStageExecutor = {
      identity: executorIdentity,
      async execute() {
        const result = blackHawkDownStageResult(
          "IDENTITY",
          ATTEMPT_ID,
          T2,
        );
        if (result.output.kind !== "IDENTITY_RESULT") {
          throw new Error("Fixture did not produce identity output");
        }
        return {
          status: "COMPLETED",
          result: {
            ...result,
            outcome: "SUCCEEDED",
            boundedReasonCodes: [],
            output: {
              ...result.output,
              unresolvedRequirementIds: [],
            },
          },
          telemetry,
        };
      },
    };

    const execution = await service(store, executor)(
      BLACK_HAWK_DOWN_RESEARCH_BUNDLE.run.caseId,
      command,
    );

    expect(execution.disposition).toBe("FAILED_RETRYABLE");
    expect(store.calls).toEqual(["claim", "fail"]);
    expect(store.failureInput?.failure).toMatchObject({
      code: "stage-output-invalid",
      category: "INVALID_OUTPUT",
      redactionState: "BODY_FREE",
    });
  });

  it("refuses automatic retry when provider-start idempotency is not guaranteed", async () => {
    const store = new Store();
    const executor: DurableResearchStageExecutor = {
      identity: {
        ...executorIdentity,
        execution: {
          ...executorIdentity.execution,
          automaticRetrySafety: "NOT_GUARANTEED",
        },
      },
      async execute() {
        return {
          status: "FAILED",
          failure: {
            schemaVersion: 1,
            code: "provider-timeout",
            category: "TIMEOUT",
            phase: "EXTERNAL_CALL",
            retryDirective: "RETRY_WITH_BACKOFF",
            retryAfterMs: 1_000,
            providerStatusCode: null,
            diagnosticFingerprint: null,
            redactionState: "BODY_FREE",
          },
          telemetry: {
            telemetryState: "UNAVAILABLE",
            providerRunId: null,
            usage: null,
            cost: null,
          },
        };
      },
    };

    const execution = await service(store, executor)(
      BLACK_HAWK_DOWN_RESEARCH_BUNDLE.run.caseId,
      command,
    );

    expect(execution.disposition).toBe("FAILED_TERMINAL");
    expect(store.failureInput?.failure.code).toBe(
      "provider-start-uncertain",
    );
    expect(store.failureInput?.failure.retryDirective).toBe("DO_NOT_RETRY");
  });

  it("does not mistake a generic progress checkpoint for durable provider resume authority", async () => {
    const store = new Store();
    const executor: DurableResearchStageExecutor = {
      identity: {
        ...executorIdentity,
        execution: {
          ...executorIdentity.execution,
          automaticRetrySafety: "RESUMABLE_PROVIDER_RUN",
        },
      },
      async execute(input) {
        await input.checkpoint({
          idempotencyKey: "progress-with-provider-reference",
          sequence: 1,
          kind: "PROGRESS",
          completedUnits: 1,
          totalUnits: 2,
          providerRunId: "provider-run-not-yet-accepted",
          resumeTokenFingerprint: null,
          outputFingerprint: null,
        });
        return {
          status: "FAILED",
          failure: retryableProviderFailure,
          telemetry: {
            telemetryState: "UNAVAILABLE",
            providerRunId: null,
            usage: null,
            cost: null,
          },
        };
      },
    };

    const execution = await service(store, executor)(
      BLACK_HAWK_DOWN_RESEARCH_BUNDLE.run.caseId,
      command,
    );

    expect(execution.disposition).toBe("FAILED_TERMINAL");
    expect(store.failureInput?.failure.code).toBe(
      "provider-start-uncertain",
    );
  });

  it.each([
    "NOT_GUARANTEED",
    "RESUMABLE_PROVIDER_RUN",
  ] as const)(
    "terminally reconciles an expired ambiguous %s attempt without calling its executor",
    async (automaticRetrySafety) => {
      const store = new Store();
      store.claimTransform = (originalClaim) => ({
        status: "CLAIMED",
        claim: {
          ...originalClaim,
          resumed: true,
          replayed: true,
        },
      });
      let executions = 0;
      const executor: DurableResearchStageExecutor = {
        identity: {
          ...executorIdentity,
          execution: {
            ...executorIdentity.execution,
            automaticRetrySafety,
          },
        },
        async execute() {
          executions += 1;
          throw new Error("ambiguous external work must not repeat");
        },
      };

      const execution = await service(store, executor)(
        BLACK_HAWK_DOWN_RESEARCH_BUNDLE.run.caseId,
        command,
      );

      expect(execution.disposition).toBe("FAILED_TERMINAL");
      expect(executions).toBe(0);
      expect(store.calls).toEqual(["claim", "fail"]);
      expect(store.failureInput?.failure.code).toBe(
        "provider-start-uncertain",
      );
      expect(store.failureInput?.failure.redactionState).toBe("BODY_FREE");
    },
  );

  it("resumes only from the separately persisted provider-accepted checkpoint", async () => {
    const store = new Store();
    store.claimTransform = (originalClaim) => {
      const providerCheckpoint = {
        schemaVersion: 1 as const,
        id: CHECKPOINT_ID,
        runId: originalClaim.run.id,
        jobId: originalClaim.job.id,
        attemptId: originalClaim.attempt.id,
        idempotencyKey: "provider-accepted-before-takeover",
        sequence: 1,
        kind: "PROVIDER_ACCEPTED" as const,
        completedUnits: 0,
        totalUnits: 1,
        providerRunId: "provider-run-resumable",
        resumeTokenFingerprint: null,
        outputFingerprint: null,
        publicationAuthority: "NONE" as const,
        createdAt: T2,
      };
      return {
        status: "CLAIMED",
        claim: {
          ...originalClaim,
          job: {
            ...originalClaim.job,
            checkpointCount: 1,
            aggregateVersion: originalClaim.job.aggregateVersion + 1,
          },
          lease: {
            ...originalClaim.lease,
            jobVersion: originalClaim.lease.jobVersion + 1,
          },
          latestCheckpoint: providerCheckpoint,
          providerCheckpoint,
          resumed: true,
          replayed: true,
        },
      };
    };
    const executor: DurableResearchStageExecutor = {
      identity: {
        ...executorIdentity,
        execution: {
          ...executorIdentity.execution,
          automaticRetrySafety: "RESUMABLE_PROVIDER_RUN",
        },
      },
      async execute() {
        return {
          status: "FAILED",
          failure: retryableProviderFailure,
          telemetry: {
            telemetryState: "PARTIAL",
            providerRunId: "provider-run-resumable",
            usage: null,
            cost: null,
          },
        };
      },
    };

    const execution = await service(store, executor)(
      BLACK_HAWK_DOWN_RESEARCH_BUNDLE.run.caseId,
      command,
    );

    expect(execution.disposition).toBe("RELEASED");
    expect(store.failureInput).toBeNull();
    expect(store.releaseInput?.failure.code).toBe("provider-timeout");
    expect(store.releaseInput?.lease.attemptId).toBe(ATTEMPT_ID);
  });

  it("hands a resumable provider run back to the same attempt and reclaims it with a higher lease epoch", async () => {
    const store = new Store();
    let claimNumber = 0;
    store.claimTransform = (originalClaim) => {
      claimNumber += 1;
      if (claimNumber === 1) {
        return { status: "CLAIMED", claim: originalClaim };
      }
      const checkpoint = store.checkpointInput?.checkpoint;
      const handedOffLease = store.releaseInput?.lease;
      if (checkpoint === undefined || handedOffLease === undefined) {
        throw new Error("The first attempt was not durably handed off");
      }
      return {
        status: "CLAIMED",
        claim: {
          ...originalClaim,
          run: {
            ...originalClaim.run,
            aggregateVersion: handedOffLease.runVersion,
          },
          job: {
            ...originalClaim.job,
            checkpointCount: checkpoint.sequence,
            aggregateVersion: handedOffLease.jobVersion,
          },
          attempt: {
            ...originalClaim.attempt,
            aggregateVersion: handedOffLease.attemptVersion,
          },
          lease: {
            ...handedOffLease,
            workerId: WORKER_ID,
            leaseToken: "lease-token-2",
            leaseEpoch: handedOffLease.leaseEpoch + 1,
            heartbeatAt: T2,
            expiresAt: T4,
          },
          latestCheckpoint: checkpoint,
          providerCheckpoint: checkpoint,
          resumed: true,
          replayed: true,
        },
      };
    };
    let executions = 0;
    const executor: DurableResearchStageExecutor = {
      identity: {
        ...executorIdentity,
        execution: {
          ...executorIdentity.execution,
          automaticRetrySafety: "RESUMABLE_PROVIDER_RUN",
        },
      },
      async execute(input) {
        executions += 1;
        store.calls.push(`execute-${executions}`);
        if (executions === 1) {
          await input.acceptProviderRun(
            {
              idempotencyKey: "provider-accepted-for-handoff",
              sequence: 1,
              kind: "PROVIDER_ACCEPTED",
              completedUnits: 0,
              totalUnits: 1,
              providerRunId: "provider-run-same-attempt",
              resumeTokenFingerprint: INPUT_MANIFEST_FINGERPRINT,
              outputFingerprint: null,
            },
            providerRunFor(input, "provider-run-same-attempt"),
          );
          return {
            status: "FAILED",
            failure: retryableProviderFailure,
            telemetry: {
              telemetryState: "PARTIAL",
              providerRunId: "provider-run-same-attempt",
              usage: null,
              cost: null,
            },
          };
        }
        expect(input.claim.resumed).toBe(true);
        expect(input.claim.attempt.id).toBe(ATTEMPT_ID);
        expect(input.claim.providerCheckpoint?.providerRunId).toBe(
          "provider-run-same-attempt",
        );
        expect(input.claim.lease.leaseEpoch).toBe(2);
        return {
          status: "COMPLETED",
          result: blackHawkDownStageResult("IDENTITY", ATTEMPT_ID, T2),
          telemetry,
        };
      },
    };
    const execute = service(store, executor);

    const handedOff = await execute(
      BLACK_HAWK_DOWN_RESEARCH_BUNDLE.run.caseId,
      command,
    );
    const completed = await execute(
      BLACK_HAWK_DOWN_RESEARCH_BUNDLE.run.caseId,
      command,
    );

    expect(handedOff.disposition).toBe("RELEASED");
    expect(completed.disposition).toBe("DEGRADED");
    expect(store.releaseInput?.idempotencyKey).toBe(
      `${ATTEMPT_ID}:retry-handoff:1`,
    );
    expect(store.completeInput?.lease.attemptId).toBe(ATTEMPT_ID);
    expect(store.completeInput?.lease.leaseEpoch).toBe(2);
    expect(store.acceptanceInput?.providerRun.traceId).toBe(
      "trace-provider-run-same-attempt",
    );
  });

  it("accepts Postgres-normalized equivalent provider timestamps", async () => {
    const store = new Store();
    store.acceptanceTransform = (input) => ({
      status: "COMMITTED",
      checkpoint: {
        ...input.checkpoint,
        createdAt: input.checkpoint.createdAt.replace("Z", "+00:00"),
      },
      providerRun: {
        ...input.providerRun,
        startedAt: input.providerRun.startedAt.replace("Z", "+00:00"),
        acceptedAt: input.providerRun.acceptedAt.replace("Z", "+00:00"),
        lastObservedAt: input.providerRun.lastObservedAt.replace(
          "Z",
          "+00:00",
        ),
      },
      lease: {
        ...input.lease,
        jobVersion: input.lease.jobVersion + 1,
        heartbeatAt: T2,
        expiresAt: T4,
      },
    });
    const executor: DurableResearchStageExecutor = {
      identity: {
        ...executorIdentity,
        execution: {
          ...executorIdentity.execution,
          automaticRetrySafety: "RESUMABLE_PROVIDER_RUN",
        },
      },
      async execute(input) {
        await input.acceptProviderRun(
          {
            idempotencyKey: "provider-accepted-normalized-time",
            sequence: 1,
            kind: "PROVIDER_ACCEPTED",
            completedUnits: 0,
            totalUnits: 1,
            providerRunId: "provider-run-normalized-time",
            resumeTokenFingerprint: INPUT_MANIFEST_FINGERPRINT,
            outputFingerprint: null,
          },
          providerRunFor(input, "provider-run-normalized-time"),
        );
        return {
          status: "FAILED",
          failure: retryableProviderFailure,
          telemetry: {
            telemetryState: "PARTIAL",
            providerRunId: "provider-run-normalized-time",
            usage: null,
            cost: null,
          },
        };
      },
    };

    const execution = await service(store, executor)(
      BLACK_HAWK_DOWN_RESEARCH_BUNDLE.run.caseId,
      command,
    );

    expect(execution.disposition).toBe("RELEASED");
    expect(store.calls).toContain("accept-provider");
  });

  it("accepts the database's terminal fail-closed result when the persisted handoff budget is exhausted", async () => {
    const store = new Store();
    store.releaseTransform = (input) => ({
      status: "FAILED_TERMINAL",
      terminal: {
        runId: input.lease.runId,
        jobId: input.lease.jobId,
        attemptId: input.lease.attemptId,
        jobStatus: "FAILED_TERMINAL",
      },
      replayed: false,
    });
    const executor: DurableResearchStageExecutor = {
      identity: {
        ...executorIdentity,
        execution: {
          ...executorIdentity.execution,
          automaticRetrySafety: "RESUMABLE_PROVIDER_RUN",
        },
      },
      async execute(input) {
        await input.acceptProviderRun(
          {
            idempotencyKey: "provider-accepted-before-budget-exhaustion",
            sequence: 1,
            kind: "PROVIDER_ACCEPTED",
            completedUnits: 0,
            totalUnits: 1,
            providerRunId: "provider-run-budgeted",
            resumeTokenFingerprint: INPUT_MANIFEST_FINGERPRINT,
            outputFingerprint: null,
          },
          providerRunFor(input, "provider-run-budgeted"),
        );
        return {
          status: "FAILED",
          failure: retryableProviderFailure,
          telemetry: {
            telemetryState: "PARTIAL",
            providerRunId: "provider-run-budgeted",
            usage: null,
            cost: null,
          },
        };
      },
    };

    const execution = await service(store, executor)(
      BLACK_HAWK_DOWN_RESEARCH_BUNDLE.run.caseId,
      command,
    );

    expect(execution.disposition).toBe("FAILED_TERMINAL");
    expect(store.calls).toEqual(["claim", "accept-provider", "release"]);
    expect(store.failureInput).toBeNull();
  });

  it("closes checkpoint writes before releasing a lease on shutdown", async () => {
    const store = new Store();
    const shutdown = new AbortController();
    let lateCheckpointRejected = false;
    const executor: DurableResearchStageExecutor = {
      identity: executorIdentity,
      execute(input) {
        store.calls.push("execute");
        shutdown.abort();
        return new Promise((resolve) => {
          input.signal.addEventListener(
            "abort",
            () => {
              void input
                .checkpoint({
                  idempotencyKey: "too-late-after-shutdown",
                  sequence: 1,
                  kind: "PROGRESS",
                  completedUnits: 0,
                  totalUnits: 1,
                  providerRunId: null,
                  resumeTokenFingerprint: null,
                  outputFingerprint: null,
                })
                .catch(() => {
                  lateCheckpointRejected = true;
                })
                .finally(() =>
                  resolve({
                    status: "FAILED",
                    failure: unexpectedFailureForTest(),
                    telemetry: {
                      telemetryState: "UNAVAILABLE",
                      providerRunId: null,
                      usage: null,
                      cost: null,
                    },
                  }),
                );
            },
            { once: true },
          );
        });
      },
    };

    const execution = await service(store, executor)(
      BLACK_HAWK_DOWN_RESEARCH_BUNDLE.run.caseId,
      command,
      { shutdownSignal: shutdown.signal },
    );

    await Promise.resolve();
    expect(execution.disposition).toBe("RELEASED");
    expect(lateCheckpointRejected).toBe(true);
    expect(store.calls).toEqual(["claim", "execute", "release"]);
  });

  it.each([
    "NOT_GUARANTEED",
    "RESUMABLE_PROVIDER_RUN",
  ] as const)(
    "fails an uncertain %s shutdown closed instead of scheduling an unsafe retry",
    async (automaticRetrySafety) => {
      const store = new Store();
      const shutdown = new AbortController();
      const executor: DurableResearchStageExecutor = {
        identity: {
          ...executorIdentity,
          execution: {
            ...executorIdentity.execution,
            automaticRetrySafety,
          },
        },
        execute(input) {
          store.calls.push("execute");
          shutdown.abort();
          return new Promise((resolve) => {
            const finish = () =>
              resolve({
                status: "FAILED",
                failure: unexpectedFailureForTest(),
                telemetry: {
                  telemetryState: "UNAVAILABLE",
                  providerRunId: null,
                  usage: null,
                  cost: null,
                },
              });
            if (input.signal.aborted) finish();
            else input.signal.addEventListener("abort", finish, { once: true });
          });
        },
      };

      const execution = await service(store, executor)(
        BLACK_HAWK_DOWN_RESEARCH_BUNDLE.run.caseId,
        command,
        { shutdownSignal: shutdown.signal },
      );

      expect(execution.disposition).toBe("FAILED_TERMINAL");
      expect(store.calls).toEqual(["claim", "execute", "fail"]);
      expect(store.failureInput?.failure.code).toBe(
        "provider-start-uncertain",
      );
    },
  );
});

function unexpectedFailureForTest() {
  return {
    schemaVersion: 1,
    code: "cancelled-after-authority-loss",
    category: "WORKER_INTERNAL",
    phase: "EXTERNAL_CALL",
    retryDirective: "DO_NOT_RETRY",
    retryAfterMs: null,
    providerStatusCode: null,
    diagnosticFingerprint: null,
    redactionState: "BODY_FREE",
  } as const;
}

describe("worker failure envelope", () => {
  it("rejects raw messages and blind policy retries", () => {
    const safe = unexpectedFailureForTest();
    expect(ResearchWorkerFailureEnvelopeSchema.safeParse(safe).success).toBe(
      true,
    );
    expect(
      ResearchWorkerFailureEnvelopeSchema.safeParse({
        ...safe,
        message: SECRET,
      }).success,
    ).toBe(false);
    expect(
      ResearchWorkerFailureEnvelopeSchema.safeParse({
        ...safe,
        category: "RIGHTS",
        retryDirective: "RETRY_WITH_BACKOFF",
        retryAfterMs: 1_000,
      }).success,
    ).toBe(false);
  });

  it("requires partial telemetry to contain at least one known provider field", () => {
    expect(
      ResearchWorkerExecutionTelemetrySchema.safeParse({
        telemetryState: "PARTIAL",
        providerRunId: null,
        usage: null,
        cost: null,
      }).success,
    ).toBe(false);
    expect(
      ResearchWorkerExecutionTelemetrySchema.safeParse({
        telemetryState: "PARTIAL",
        providerRunId: "provider-run-known",
        usage: null,
        cost: null,
      }).success,
    ).toBe(true);
  });
});
