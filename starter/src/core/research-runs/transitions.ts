import {
  RESEARCH_STAGES,
  ResearchAttemptRecordSchema,
  ResearchJobRecordSchema,
  ResearchRunBundleSchema,
  ResearchRunRecordSchema,
  researchStageIndex,
  type ResearchAttemptRecord,
  type ResearchAttemptStatus,
  type ResearchJobRecord,
  type ResearchJobStatus,
  type ResearchRunBundle,
  type ResearchRunHealth,
  type ResearchRunRecord,
  type ResearchRunStatus,
  type ResearchStage,
} from "@/core/research-runs/schemas";
import {
  EntityIdSchema,
  IsoDateTimeSchema,
  Sha256Schema,
  SlugSchema,
} from "@/core/shared/schemas";

export type ResearchTransitionErrorCode =
  | "INVALID_TRANSITION"
  | "VERSION_CONFLICT"
  | "TIME_REGRESSION"
  | "STAGE_ORDER_VIOLATION"
  | "DEPENDENCY_INCOMPLETE"
  | "RETRY_EXHAUSTED"
  | "ATTEMPT_MISMATCH"
  | "JOB_NOT_FOUND";

export class ResearchTransitionError extends Error {
  constructor(
    readonly code: ResearchTransitionErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ResearchTransitionError";
  }
}

const ALLOWED_RUN_TRANSITIONS: Readonly<
  Record<ResearchRunStatus, readonly ResearchRunStatus[]>
> = {
  QUEUED: ["PLANNING", "FAILED", "CANCELLED"],
  PLANNING: ["RUNNING", "FAILED", "CANCELLED"],
  RUNNING: ["SYNTHESIZING", "FAILED", "CANCELLED"],
  SYNTHESIZING: ["SUCCEEDED", "DEGRADED", "FAILED", "CANCELLED"],
  SUCCEEDED: [],
  DEGRADED: [],
  FAILED: [],
  CANCELLED: [],
};

const terminalRunStatuses = new Set<ResearchRunStatus>([
  "SUCCEEDED",
  "DEGRADED",
  "FAILED",
  "CANCELLED",
]);

function assertExpectedVersion(
  aggregate: "run" | "job" | "attempt",
  currentVersion: number,
  expectedVersion: number,
) {
  if (currentVersion !== expectedVersion) {
    throw new ResearchTransitionError(
      "VERSION_CONFLICT",
      `Expected ${aggregate} version ${expectedVersion}, received ${currentVersion}`,
    );
  }
}

function assertMonotonicTime(currentUpdatedAt: string, occurredAt: string) {
  if (
    new Date(occurredAt).getTime() < new Date(currentUpdatedAt).getTime()
  ) {
    throw new ResearchTransitionError(
      "TIME_REGRESSION",
      `Transition time ${occurredAt} precedes current time ${currentUpdatedAt}`,
    );
  }
}

function requiredRunPhase(stage: ResearchStage): ResearchRunStatus {
  if (stage === "IDENTITY" || stage === "SCOPING") return "PLANNING";
  if (stage === "SEQUENCING") return "SYNTHESIZING";
  return "RUNNING";
}

export type ResearchRunTransitionInput = Readonly<{
  targetStatus: ResearchRunStatus;
  currentStage: ResearchStage | null;
  expectedVersion: number;
  occurredAt: string;
}>;

export function transitionResearchRun(
  current: ResearchRunRecord,
  input: ResearchRunTransitionInput,
): ResearchRunRecord {
  const parsedCurrent = ResearchRunRecordSchema.parse(current);
  const occurredAt = IsoDateTimeSchema.parse(input.occurredAt);
  assertExpectedVersion(
    "run",
    parsedCurrent.aggregateVersion,
    input.expectedVersion,
  );
  assertMonotonicTime(parsedCurrent.updatedAt, occurredAt);

  const sameState =
    parsedCurrent.status === input.targetStatus &&
    parsedCurrent.currentStage === input.currentStage;
  if (sameState) return parsedCurrent;

  if (terminalRunStatuses.has(parsedCurrent.status)) {
    throw new ResearchTransitionError(
      "INVALID_TRANSITION",
      `Cannot transition terminal run ${parsedCurrent.status}`,
    );
  }

  if (
    parsedCurrent.status !== input.targetStatus &&
    !ALLOWED_RUN_TRANSITIONS[parsedCurrent.status].includes(input.targetStatus)
  ) {
    throw new ResearchTransitionError(
      "INVALID_TRANSITION",
      `Cannot transition run from ${parsedCurrent.status} to ${input.targetStatus}`,
    );
  }

  if (input.currentStage !== null) {
    const nextIndex = researchStageIndex(input.currentStage);
    const currentIndex =
      parsedCurrent.currentStage === null
        ? -1
        : researchStageIndex(parsedCurrent.currentStage);
    if (nextIndex < currentIndex || nextIndex > currentIndex + 1) {
      throw new ResearchTransitionError(
        "STAGE_ORDER_VIOLATION",
        `Cannot move run stage from ${parsedCurrent.currentStage ?? "none"} to ${input.currentStage}`,
      );
    }
  } else if (
    input.targetStatus !== "QUEUED" &&
    input.targetStatus !== "FAILED" &&
    input.targetStatus !== "CANCELLED"
  ) {
    throw new ResearchTransitionError(
      "STAGE_ORDER_VIOLATION",
      `${input.targetStatus} requires a current stage`,
    );
  }

  if (!terminalRunStatuses.has(input.targetStatus)) {
    if (input.currentStage === null) {
      throw new ResearchTransitionError(
        "STAGE_ORDER_VIOLATION",
        `${input.targetStatus} requires a current stage`,
      );
    }
    const requiredPhase = requiredRunPhase(input.currentStage);
    if (input.targetStatus !== requiredPhase) {
      throw new ResearchTransitionError(
        "INVALID_TRANSITION",
        `${input.currentStage} must execute while the run is ${requiredPhase}`,
      );
    }
  }

  if (
    (input.targetStatus === "SUCCEEDED" ||
      input.targetStatus === "DEGRADED") &&
    (parsedCurrent.status !== "SYNTHESIZING" ||
      input.currentStage !== "SEQUENCING")
  ) {
    throw new ResearchTransitionError(
      "STAGE_ORDER_VIOLATION",
      `${input.targetStatus} requires completed sequencing`,
    );
  }

  const health: ResearchRunHealth =
    input.targetStatus === "SUCCEEDED"
      ? "HEALTHY"
      : input.targetStatus === "DEGRADED"
        ? "DEGRADED"
        : input.targetStatus === "FAILED"
          ? "FAILED"
          : parsedCurrent.health;
  const terminal = terminalRunStatuses.has(input.targetStatus);

  return ResearchRunRecordSchema.parse({
    ...parsedCurrent,
    status: input.targetStatus,
    health,
    currentStage: input.currentStage,
    aggregateVersion: parsedCurrent.aggregateVersion + 1,
    updatedAt: occurredAt,
    startedAt:
      parsedCurrent.startedAt ??
      (input.targetStatus === "QUEUED" ? null : occurredAt),
    completedAt: terminal ? occurredAt : null,
  });
}

export type StartResearchJobInput = Readonly<{
  attemptId: string;
  expectedVersion: number;
  occurredAt: string;
}>;

export function startResearchJob(
  current: ResearchJobRecord,
  input: StartResearchJobInput,
): ResearchJobRecord {
  const parsedCurrent = ResearchJobRecordSchema.parse(current);
  const attemptId = EntityIdSchema.parse(input.attemptId);
  const occurredAt = IsoDateTimeSchema.parse(input.occurredAt);
  assertExpectedVersion(
    "job",
    parsedCurrent.aggregateVersion,
    input.expectedVersion,
  );
  assertMonotonicTime(parsedCurrent.updatedAt, occurredAt);

  if (
    parsedCurrent.status === "RUNNING" &&
    parsedCurrent.activeAttemptId === attemptId
  ) {
    return parsedCurrent;
  }
  if (parsedCurrent.status !== "QUEUED") {
    throw new ResearchTransitionError(
      "INVALID_TRANSITION",
      `Cannot start a ${parsedCurrent.status} job`,
    );
  }
  if (parsedCurrent.attemptCount >= parsedCurrent.maxAttempts) {
    throw new ResearchTransitionError(
      "RETRY_EXHAUSTED",
      `Job ${parsedCurrent.id} has exhausted ${parsedCurrent.maxAttempts} attempts`,
    );
  }

  return ResearchJobRecordSchema.parse({
    ...parsedCurrent,
    status: "RUNNING",
    attemptCount: parsedCurrent.attemptCount + 1,
    activeAttemptId: attemptId,
    firstStartedAt: parsedCurrent.firstStartedAt ?? occurredAt,
    aggregateVersion: parsedCurrent.aggregateVersion + 1,
    updatedAt: occurredAt,
  });
}

export type CompleteResearchJobInput = Readonly<{
  attemptId: string;
  targetStatus: Extract<
    ResearchJobStatus,
    | "SUCCEEDED"
    | "DEGRADED"
    | "FAILED_RETRYABLE"
    | "FAILED_TERMINAL"
    | "CANCELLED"
  >;
  expectedVersion: number;
  occurredAt: string;
}>;

export function completeResearchJob(
  current: ResearchJobRecord,
  input: CompleteResearchJobInput,
): ResearchJobRecord {
  const parsedCurrent = ResearchJobRecordSchema.parse(current);
  const attemptId = EntityIdSchema.parse(input.attemptId);
  const occurredAt = IsoDateTimeSchema.parse(input.occurredAt);
  assertExpectedVersion(
    "job",
    parsedCurrent.aggregateVersion,
    input.expectedVersion,
  );
  assertMonotonicTime(parsedCurrent.updatedAt, occurredAt);

  if (
    parsedCurrent.status !== "RUNNING" ||
    parsedCurrent.activeAttemptId !== attemptId
  ) {
    throw new ResearchTransitionError(
      "ATTEMPT_MISMATCH",
      "Only the active attempt may complete a running job",
    );
  }
  if (
    input.targetStatus === "FAILED_RETRYABLE" &&
    parsedCurrent.attemptCount >= parsedCurrent.maxAttempts
  ) {
    throw new ResearchTransitionError(
      "RETRY_EXHAUSTED",
      "The final allowed attempt must fail terminally",
    );
  }

  const terminal = input.targetStatus !== "FAILED_RETRYABLE";
  return ResearchJobRecordSchema.parse({
    ...parsedCurrent,
    status: input.targetStatus,
    activeAttemptId: null,
    terminalAt: terminal ? occurredAt : null,
    aggregateVersion: parsedCurrent.aggregateVersion + 1,
    updatedAt: occurredAt,
  });
}

export type RequeueResearchJobInput = Readonly<{
  expectedVersion: number;
  occurredAt: string;
}>;

export function requeueResearchJob(
  current: ResearchJobRecord,
  input: RequeueResearchJobInput,
): ResearchJobRecord {
  const parsedCurrent = ResearchJobRecordSchema.parse(current);
  const occurredAt = IsoDateTimeSchema.parse(input.occurredAt);
  assertExpectedVersion(
    "job",
    parsedCurrent.aggregateVersion,
    input.expectedVersion,
  );
  assertMonotonicTime(parsedCurrent.updatedAt, occurredAt);

  if (parsedCurrent.status === "QUEUED") return parsedCurrent;
  if (parsedCurrent.status !== "FAILED_RETRYABLE") {
    throw new ResearchTransitionError(
      "INVALID_TRANSITION",
      `Cannot requeue a ${parsedCurrent.status} job`,
    );
  }
  if (parsedCurrent.attemptCount >= parsedCurrent.maxAttempts) {
    throw new ResearchTransitionError(
      "RETRY_EXHAUSTED",
      `Job ${parsedCurrent.id} has no retry budget remaining`,
    );
  }

  return ResearchJobRecordSchema.parse({
    ...parsedCurrent,
    status: "QUEUED",
    aggregateVersion: parsedCurrent.aggregateVersion + 1,
    updatedAt: occurredAt,
  });
}

export type CheckpointResearchJobInput = Readonly<{
  attemptId: string;
  expectedVersion: number;
  occurredAt: string;
}>;

export function checkpointResearchJob(
  current: ResearchJobRecord,
  input: CheckpointResearchJobInput,
): ResearchJobRecord {
  const parsedCurrent = ResearchJobRecordSchema.parse(current);
  const attemptId = EntityIdSchema.parse(input.attemptId);
  const occurredAt = IsoDateTimeSchema.parse(input.occurredAt);
  assertExpectedVersion(
    "job",
    parsedCurrent.aggregateVersion,
    input.expectedVersion,
  );
  assertMonotonicTime(parsedCurrent.updatedAt, occurredAt);

  if (
    parsedCurrent.status !== "RUNNING" ||
    parsedCurrent.activeAttemptId !== attemptId
  ) {
    throw new ResearchTransitionError(
      "ATTEMPT_MISMATCH",
      "Only the active running attempt may checkpoint",
    );
  }
  return ResearchJobRecordSchema.parse({
    ...parsedCurrent,
    checkpointCount: parsedCurrent.checkpointCount + 1,
    aggregateVersion: parsedCurrent.aggregateVersion + 1,
    updatedAt: occurredAt,
  });
}

export function assertResearchJobRunnable(
  bundleInput: ResearchRunBundle,
  jobIdInput: string,
): ResearchJobRecord {
  const bundle = ResearchRunBundleSchema.parse(bundleInput);
  const jobId = EntityIdSchema.parse(jobIdInput);
  const index = bundle.jobs.findIndex(({ id }) => id === jobId);
  if (index < 0) {
    throw new ResearchTransitionError(
      "JOB_NOT_FOUND",
      `Research job ${jobId} was not found`,
    );
  }
  const job = bundle.jobs[index];
  if (job === undefined) {
    throw new ResearchTransitionError("JOB_NOT_FOUND", "Job was not found");
  }
  if (job.status !== "QUEUED") {
    throw new ResearchTransitionError(
      "INVALID_TRANSITION",
      `A ${job.status} job is not runnable`,
    );
  }
  if (index > 0) {
    const predecessor = bundle.jobs[index - 1];
    if (
      predecessor === undefined ||
      (predecessor.status !== "SUCCEEDED" &&
        predecessor.status !== "DEGRADED")
    ) {
      throw new ResearchTransitionError(
        "DEPENDENCY_INCOMPLETE",
        `${job.stage} cannot run before ${RESEARCH_STAGES[index - 1]} completes`,
      );
    }
  }
  return job;
}

export type CompleteResearchAttemptInput = Readonly<{
  targetStatus: Exclude<ResearchAttemptStatus, "RUNNING">;
  outputFingerprint: string | null;
  errorCode: string | null;
  latencyMs: number;
  expectedVersion: number;
  occurredAt: string;
}>;

export function completeResearchAttempt(
  current: ResearchAttemptRecord,
  input: CompleteResearchAttemptInput,
): ResearchAttemptRecord {
  const parsedCurrent = ResearchAttemptRecordSchema.parse(current);
  const occurredAt = IsoDateTimeSchema.parse(input.occurredAt);
  assertExpectedVersion(
    "attempt",
    parsedCurrent.aggregateVersion,
    input.expectedVersion,
  );
  assertMonotonicTime(parsedCurrent.startedAt, occurredAt);

  if (parsedCurrent.status !== "RUNNING") {
    if (
      parsedCurrent.status === input.targetStatus &&
      parsedCurrent.outputFingerprint === input.outputFingerprint &&
      parsedCurrent.errorCode === input.errorCode
    ) {
      return parsedCurrent;
    }
    throw new ResearchTransitionError(
      "INVALID_TRANSITION",
      `Cannot complete a ${parsedCurrent.status} attempt`,
    );
  }

  const outputFingerprint =
    input.outputFingerprint === null
      ? null
      : Sha256Schema.parse(input.outputFingerprint);
  const errorCode =
    input.errorCode === null ? null : SlugSchema.parse(input.errorCode);

  return ResearchAttemptRecordSchema.parse({
    ...parsedCurrent,
    status: input.targetStatus,
    execution: {
      ...parsedCurrent.execution,
      latencyMs: input.latencyMs,
    },
    outputFingerprint,
    errorCode,
    aggregateVersion: parsedCurrent.aggregateVersion + 1,
    completedAt: occurredAt,
  });
}
