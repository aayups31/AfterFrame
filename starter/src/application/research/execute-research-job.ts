import { z } from "zod";
import {
  ExecuteResearchJobCommandSchema,
  type ExecuteResearchJobCommand,
} from "@/contracts/research-runs";
import type {
  DeterministicResearchStageExecutor,
  ResearchRunFingerprintPort,
} from "@/core/research-runs/ports";
import {
  DeterministicResearchExecutorIdentitySchema,
  ResearchAttemptRecordSchema,
  ResearchRunBundleSchema,
  ResearchStageExecutionResultSchema,
  type ResearchAttemptRecord,
  type ResearchRunBundle,
  type ResearchRunStatus,
  type ResearchStage,
} from "@/core/research-runs/schemas";
import {
  ResearchTransitionError,
  assertResearchJobRunnable,
  completeResearchAttempt,
  completeResearchJob,
  requeueResearchJob,
  startResearchJob,
  transitionResearchRun,
} from "@/core/research-runs/transitions";
import { Sha256Schema } from "@/core/shared/schemas";

export type ResearchExecutionIdentifierKind = "research_attempt";

export type ExecuteResearchJobDependencies = Readonly<{
  executor: DeterministicResearchStageExecutor;
  fingerprints: ResearchRunFingerprintPort;
  createId: (kind: ResearchExecutionIdentifierKind) => string;
  now: () => string;
}>;

export type ExecuteResearchJobErrorCode =
  | "RUN_MISMATCH"
  | "JOB_NOT_FOUND"
  | "RUN_VERSION_CONFLICT"
  | "JOB_VERSION_CONFLICT"
  | "IDEMPOTENCY_KEY_REUSED"
  | "RUN_NOT_EXECUTABLE"
  | "JOB_NOT_EXECUTABLE"
  | "STAGE_OUTPUT_MISMATCH"
  | "SOURCE_POLICY_MISMATCH";

export class ExecuteResearchJobError extends Error {
  constructor(
    readonly code: ExecuteResearchJobErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ExecuteResearchJobError";
  }
}

export type ExecuteResearchJobResult = Readonly<{
  disposition:
    | "SUCCEEDED"
    | "DEGRADED"
    | "FAILED_RETRYABLE"
    | "FAILED_TERMINAL"
    | "IN_PROGRESS"
    | "REPLAY";
  bundle: ResearchRunBundle;
  attempt: ResearchAttemptRecord;
  replayed: boolean;
}>;

function runPhaseForStage(stage: ResearchStage): ResearchRunStatus {
  if (stage === "IDENTITY" || stage === "SCOPING") return "PLANNING";
  if (stage === "SEQUENCING") return "SYNTHESIZING";
  return "RUNNING";
}

function replaceJob(
  bundle: ResearchRunBundle,
  replacement: ResearchRunBundle["jobs"][number],
) {
  return bundle.jobs.map((job) =>
    job.id === replacement.id ? replacement : job,
  );
}

function findIdempotentAttempt(
  bundle: ResearchRunBundle,
  command: ExecuteResearchJobCommand,
  requestFingerprint: string,
): ExecuteResearchJobResult | null {
  const attempt = bundle.attempts.find(
    (candidate) => candidate.requestFingerprint === requestFingerprint,
  );
  if (attempt === undefined) return null;
  if (attempt.runId !== command.runId || attempt.jobId !== command.jobId) {
    throw new ExecuteResearchJobError(
      "IDEMPOTENCY_KEY_REUSED",
      "The execution idempotency key belongs to different logical work",
    );
  }
  if (attempt.status === "RUNNING") {
    return {
      disposition: "IN_PROGRESS",
      bundle,
      attempt,
      replayed: true,
    };
  }
  return {
    disposition: "REPLAY",
    bundle,
    attempt,
    replayed: true,
  };
}

function assertCommandVersions(
  bundle: ResearchRunBundle,
  command: ExecuteResearchJobCommand,
) {
  if (bundle.run.aggregateVersion !== command.expectedRunVersion) {
    throw new ExecuteResearchJobError(
      "RUN_VERSION_CONFLICT",
      `Expected run version ${command.expectedRunVersion}, received ${bundle.run.aggregateVersion}`,
    );
  }
  const job = bundle.jobs.find(({ id }) => id === command.jobId);
  if (job === undefined) {
    throw new ExecuteResearchJobError(
      "JOB_NOT_FOUND",
      `Job ${command.jobId} was not found`,
    );
  }
  if (job.aggregateVersion !== command.expectedJobVersion) {
    throw new ExecuteResearchJobError(
      "JOB_VERSION_CONFLICT",
      `Expected job version ${command.expectedJobVersion}, received ${job.aggregateVersion}`,
    );
  }
  return job;
}

function assertExecutionResultMatches(
  bundle: ResearchRunBundle,
  job: ResearchRunBundle["jobs"][number],
  attemptId: string,
  result: z.infer<typeof ResearchStageExecutionResultSchema>,
) {
  if (
    result.output.runId !== bundle.run.id ||
    result.output.jobId !== job.id ||
    result.output.attemptId !== attemptId ||
    result.output.stage !== job.stage
  ) {
    throw new ExecuteResearchJobError(
      "STAGE_OUTPUT_MISMATCH",
      "Executor output does not belong to the active run, job, attempt, and stage",
    );
  }

  const permittedSourceClasses = new Set(bundle.plan.plan.sourceClassIds);
  if (
    result.sourceCandidates.some(
      (candidate) =>
        !permittedSourceClasses.has(candidate.sourceClass) ||
        candidate.discoveryInputFingerprint !== job.stageInputFingerprint,
    )
  ) {
    throw new ExecuteResearchJobError(
      "SOURCE_POLICY_MISMATCH",
      "Discovery produced a candidate outside the specialist plan or stage input",
    );
  }
}

function elapsedMilliseconds(startedAt: string, completedAt: string) {
  const elapsed =
    new Date(completedAt).getTime() - new Date(startedAt).getTime();
  if (elapsed < 0) {
    throw new ResearchTransitionError(
      "TIME_REGRESSION",
      "Attempt completion cannot precede its start",
    );
  }
  return elapsed;
}

export function createExecuteResearchJobService(
  dependencies: ExecuteResearchJobDependencies,
) {
  const executorIdentity = DeterministicResearchExecutorIdentitySchema.parse(
    dependencies.executor.identity,
  );

  return async function executeResearchJob(
    bundleInput: unknown,
    commandInput: unknown,
  ): Promise<ExecuteResearchJobResult> {
    let bundle = ResearchRunBundleSchema.parse(bundleInput);
    const command = ExecuteResearchJobCommandSchema.parse(commandInput);
    if (bundle.run.id !== command.runId) {
      throw new ExecuteResearchJobError(
        "RUN_MISMATCH",
        "Command run does not match the supplied durable bundle",
      );
    }
    const requestFingerprint = Sha256Schema.parse(
      dependencies.fingerprints.fingerprintAttemptRequest(
        command.runId,
        command.jobId,
        command.idempotencyKey,
      ),
    );
    const replay = findIdempotentAttempt(
      bundle,
      command,
      requestFingerprint,
    );
    if (replay !== null) return replay;

    let job = assertCommandVersions(bundle, command);
    if (
      bundle.run.status === "SUCCEEDED" ||
      bundle.run.status === "DEGRADED" ||
      bundle.run.status === "FAILED" ||
      bundle.run.status === "CANCELLED"
    ) {
      throw new ExecuteResearchJobError(
        "RUN_NOT_EXECUTABLE",
        `Cannot execute work for a ${bundle.run.status} run`,
      );
    }

    const startedAt = dependencies.now();
    if (job.status === "FAILED_RETRYABLE") {
      job = requeueResearchJob(job, {
        expectedVersion: command.expectedJobVersion,
        occurredAt: startedAt,
      });
      bundle = ResearchRunBundleSchema.parse({
        ...bundle,
        jobs: replaceJob(bundle, job),
      });
    }

    try {
      job = assertResearchJobRunnable(bundle, job.id);
    } catch (error) {
      if (error instanceof ResearchTransitionError) {
        throw new ExecuteResearchJobError(
          "JOB_NOT_EXECUTABLE",
          error.message,
        );
      }
      throw error;
    }

    const attemptId = dependencies.createId("research_attempt");
    const startedRun = transitionResearchRun(bundle.run, {
      targetStatus: runPhaseForStage(job.stage),
      currentStage: job.stage,
      expectedVersion: command.expectedRunVersion,
      occurredAt: startedAt,
    });
    const startedJob = startResearchJob(job, {
      attemptId,
      expectedVersion: job.aggregateVersion,
      occurredAt: startedAt,
    });
    const runningAttempt = ResearchAttemptRecordSchema.parse({
      schemaVersion: 1,
      id: attemptId,
      runId: bundle.run.id,
      jobId: startedJob.id,
      attemptNumber: startedJob.attemptCount,
      requestFingerprint,
      status: "RUNNING",
      execution: {
        executionKind: "DETERMINISTIC",
        traceId: bundle.run.traceId,
        providerRunId: null,
        model: null,
        prompt: null,
        schema: executorIdentity.schema,
        tool: null,
        telemetryState: "UNAVAILABLE",
        usage: null,
        cost: null,
        latencyMs: null,
        provenanceInputs: [
          { recordType: "RUN", recordId: bundle.run.id },
          { recordType: "PLAN", recordId: bundle.plan.id },
          { recordType: "JOB", recordId: startedJob.id },
        ],
        privateContentIncluded: false,
      },
      outputFingerprint: null,
      errorCode: null,
      publicationAuthority: "NONE",
      aggregateVersion: 0,
      startedAt,
      completedAt: null,
    });
    const runningBundle = ResearchRunBundleSchema.parse({
      ...bundle,
      run: startedRun,
      jobs: replaceJob(bundle, startedJob),
      attempts: [...bundle.attempts, runningAttempt],
    });

    try {
      const result = ResearchStageExecutionResultSchema.parse(
        await dependencies.executor.execute({
          run: startedRun,
          job: startedJob,
          plan: bundle.plan,
          attemptId,
        }),
      );
      assertExecutionResultMatches(runningBundle, startedJob, attemptId, result);
      const completedAt = dependencies.now();
      const outputFingerprint = Sha256Schema.parse(
        dependencies.fingerprints.fingerprintExecutionOutput(result),
      );
      const attempt = completeResearchAttempt(runningAttempt, {
        targetStatus: result.outcome,
        outputFingerprint,
        errorCode: null,
        telemetryState: "COMPLETE",
        providerRunId: null,
        usage: {
          inputTokens: 0,
          outputTokens: 0,
          toolCalls: 0,
          inputBytes: 0,
          outputBytes: 0,
        },
        cost: {
          currency: "USD",
          pricingState: "PRICED",
          amountMicros: 0,
        },
        latencyMs: elapsedMilliseconds(startedAt, completedAt),
        expectedVersion: runningAttempt.aggregateVersion,
        occurredAt: completedAt,
      });
      const completedJob = completeResearchJob(startedJob, {
        attemptId,
        targetStatus: result.outcome,
        expectedVersion: startedJob.aggregateVersion,
        occurredAt: completedAt,
      });
      const attempts = runningBundle.attempts.map((record) =>
        record.id === attempt.id ? attempt : record,
      );
      let completedRun = startedRun;
      if (completedJob.stage === "SEQUENCING") {
        const degraded = runningBundle.jobs
          .map((record) =>
            record.id === completedJob.id ? completedJob : record,
          )
          .some(({ status }) => status === "DEGRADED");
        completedRun = transitionResearchRun(startedRun, {
          targetStatus: degraded ? "DEGRADED" : "SUCCEEDED",
          currentStage: "SEQUENCING",
          expectedVersion: startedRun.aggregateVersion,
          occurredAt: completedAt,
        });
      }
      const completedBundle = ResearchRunBundleSchema.parse({
        ...runningBundle,
        run: completedRun,
        jobs: replaceJob(runningBundle, completedJob),
        attempts,
        outputs: [...runningBundle.outputs, result.output],
        sourceCandidates: [
          ...runningBundle.sourceCandidates,
          ...result.sourceCandidates,
        ],
        untrustedContent: [
          ...runningBundle.untrustedContent,
          ...result.untrustedContent,
        ],
      });
      return {
        disposition: result.outcome,
        bundle: completedBundle,
        attempt,
        replayed: false,
      };
    } catch (error) {
      const completedAt = dependencies.now();
      const retryable = startedJob.attemptCount < startedJob.maxAttempts;
      const targetStatus = retryable
        ? ("FAILED_RETRYABLE" as const)
        : ("FAILED_TERMINAL" as const);
      const errorCode =
        error instanceof ExecuteResearchJobError
          ? "stage-policy-rejected"
          : error instanceof z.ZodError
            ? "stage-output-invalid"
            : "executor-failed";
      const attempt = completeResearchAttempt(runningAttempt, {
        targetStatus,
        outputFingerprint: null,
        errorCode,
        telemetryState: "UNAVAILABLE",
        providerRunId: null,
        usage: null,
        cost: null,
        latencyMs: elapsedMilliseconds(startedAt, completedAt),
        expectedVersion: runningAttempt.aggregateVersion,
        occurredAt: completedAt,
      });
      const completedJob = completeResearchJob(startedJob, {
        attemptId,
        targetStatus,
        expectedVersion: startedJob.aggregateVersion,
        occurredAt: completedAt,
      });
      const failedRun = retryable
        ? startedRun
        : transitionResearchRun(startedRun, {
            targetStatus: "FAILED",
            currentStage: startedJob.stage,
            expectedVersion: startedRun.aggregateVersion,
            occurredAt: completedAt,
          });
      const failedBundle = ResearchRunBundleSchema.parse({
        ...runningBundle,
        run: failedRun,
        jobs: replaceJob(runningBundle, completedJob),
        attempts: runningBundle.attempts.map((record) =>
          record.id === attempt.id ? attempt : record,
        ),
      });
      return {
        disposition: targetStatus,
        bundle: failedBundle,
        attempt,
        replayed: false,
      };
    }
  };
}
