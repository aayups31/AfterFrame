import { z } from "zod";
import {
  DurableResearchWorkerResultSchema,
  ExecuteDurableResearchJobCommandSchema,
  type DurableResearchWorkerResult,
} from "@/contracts/research-worker";
import type {
  DurableResearchStageExecutionInput,
  DurableResearchStageExecutorRegistry,
  DurableResearchWorkerStore,
  ResearchRunFingerprintPort,
} from "@/core/research-runs/ports";
import {
  ResearchStageExecutionResultSchema,
  type ResearchStageExecutionResult,
} from "@/core/research-runs/schemas";
import {
  ResearchProviderAcceptanceResultSchema,
  ResearchProviderRunRecordSchema,
  type ResearchProviderRunRecord,
} from "@/core/research-runs/provider-runs";
import {
  ClaimedResearchJobSchema,
  ResearchJobCheckpointResultSchema,
  ResearchJobClaimResultSchema,
  ResearchJobCompletionResultSchema,
  ResearchJobFailureResultSchema,
  ResearchJobHeartbeatResultSchema,
  ResearchJobReleaseResultSchema,
  ResearchWorkerCheckpointProposalSchema,
  ResearchWorkerCheckpointRecordSchema,
  ResearchWorkerExecutionCompletionSchema,
  ResearchWorkerExecutionOutcomeSchema,
  ResearchWorkerExecutorIdentitySchema,
  ResearchWorkerFailureEnvelopeSchema,
  type ClaimedResearchJob,
  type ResearchJobLeaseCursor,
  type ResearchWorkerCheckpointProposal,
  type ResearchWorkerCheckpointRecord,
  type ResearchWorkerExecutionPlan,
  type ResearchWorkerExecutionTelemetry,
  type ResearchWorkerFailureEnvelope,
} from "@/core/research-runs/worker-schemas";
import {
  EntityIdSchema,
  IsoDateTimeSchema,
  OpaqueReferenceSchema,
  Sha256Schema,
} from "@/core/shared/schemas";
import {
  DurableSourceResolutionRecordSchema,
  SourceResolutionAcceptanceResultSchema,
  type DurableSourceResolutionRecord,
  type StoredSourceResolutionRecord,
} from "@/core/research/source-resolution";
import {
  DurableSourceRetrievalRecordSchema,
  SourceRetrievalAcceptanceResultSchema,
  type DurableSourceRetrievalRecord,
  type StoredSourceRetrievalRecord,
} from "@/core/research/source-retrieval";

export type ResearchWorkerIdentifierKind =
  | "research_attempt"
  | "research_checkpoint";

export type ResearchWorkerDelay = (
  milliseconds: number,
  signal: AbortSignal,
) => Promise<void>;

export type DurableResearchWorkerDependencies = Readonly<{
  store: DurableResearchWorkerStore;
  executors: DurableResearchStageExecutorRegistry;
  fingerprints: ResearchRunFingerprintPort;
  workerId: string;
  leaseDurationSeconds: number;
  heartbeatIntervalMs: number;
  createId: (kind: ResearchWorkerIdentifierKind) => string;
  now: () => string;
  delay?: ResearchWorkerDelay;
}>;

export type ExecuteDurableResearchJobOptions = Readonly<{
  shutdownSignal?: AbortSignal;
}>;

export type DurableResearchWorkerErrorCode =
  | "CONFIGURATION_INVALID"
  | "EXECUTOR_NOT_AVAILABLE"
  | "EXECUTOR_STAGE_MISMATCH"
  | "CLAIM_REJECTED"
  | "CLAIM_INVALID"
  | "CLAIM_MISMATCH"
  | "STORE_UNAVAILABLE"
  | "COMMIT_UNCERTAIN"
  | "STAGE_OUTPUT_MISMATCH"
  | "SOURCE_POLICY_MISMATCH";

/** Error messages remain bounded and never interpolate provider/source/private bodies. */
export class DurableResearchWorkerError extends Error {
  constructor(
    readonly code: DurableResearchWorkerErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "DurableResearchWorkerError";
  }
}

class LeaseAuthorityError extends Error {
  constructor(readonly authority: "CANCELLED" | "LEASE_LOST") {
    super("Research job lease authority is no longer active");
    this.name = "LeaseAuthorityError";
  }
}

const WorkerConfigurationSchema = z
  .object({
    workerId: OpaqueReferenceSchema,
    leaseDurationSeconds: z.number().int().min(5).max(900),
    heartbeatIntervalMs: z.number().int().min(100).max(300_000),
  })
  .strict()
  .superRefine((configuration, context) => {
    if (
      configuration.heartbeatIntervalMs >=
      configuration.leaseDurationSeconds * 1_000
    ) {
      context.addIssue({
        code: "custom",
        path: ["heartbeatIntervalMs"],
        message: "Heartbeat interval must be shorter than the lease",
      });
    }
  });

function defaultDelay(milliseconds: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(new Error("delay-aborted"));
      return;
    }
    const timeout = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, milliseconds);
    const onAbort = () => {
      clearTimeout(timeout);
      reject(new Error("delay-aborted"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function boundaryParse<T>(
  schema: z.ZodType<T>,
  value: unknown,
  code: DurableResearchWorkerErrorCode,
  message: string,
): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new DurableResearchWorkerError(code, message);
  return parsed.data;
}

function elapsedMilliseconds(startedAt: string, completedAt: string) {
  const elapsed =
    new Date(completedAt).getTime() - new Date(startedAt).getTime();
  if (!Number.isSafeInteger(elapsed) || elapsed < 0) {
    throw new DurableResearchWorkerError(
      "CONFIGURATION_INVALID",
      "Worker clock regressed during an attempt",
    );
  }
  return elapsed;
}

function monotonicNow(now: () => string, floor: string) {
  try {
    const candidate = IsoDateTimeSchema.safeParse(now());
    if (
      candidate.success &&
      new Date(candidate.data).getTime() >= new Date(floor).getTime()
    ) {
      return candidate.data;
    }
  } catch {
    // A body-free fallback keeps the durable attempt recoverable even if the
    // injected clock fails; adapters should alert on their own clock health.
  }
  return IsoDateTimeSchema.parse(floor);
}

function assertClaimMatches(
  claim: ClaimedResearchJob,
  input: Readonly<{
    runId: string;
    jobId: string;
    stage: string;
    workerId: string;
    execution: ResearchWorkerExecutionPlan;
  }>,
) {
  if (
    claim.run.id !== input.runId ||
    claim.job.id !== input.jobId ||
    claim.job.stage !== input.stage ||
    claim.lease.workerId !== input.workerId ||
    JSON.stringify(claim.execution) !== JSON.stringify(input.execution)
  ) {
    throw new DurableResearchWorkerError(
      "CLAIM_MISMATCH",
      "The claimed work does not match the requested logical job and executor",
    );
  }
}

function leaseContinues(
  previous: ResearchJobLeaseCursor,
  next: ResearchJobLeaseCursor,
) {
  return (
    next.runId === previous.runId &&
    next.jobId === previous.jobId &&
    next.attemptId === previous.attemptId &&
    next.workerId === previous.workerId &&
    next.leaseToken === previous.leaseToken &&
    next.externalIdempotencyKey === previous.externalIdempotencyKey &&
    next.claimedAt === previous.claimedAt &&
    next.leaseEpoch === previous.leaseEpoch &&
    next.runVersion >= previous.runVersion &&
    next.jobVersion >= previous.jobVersion &&
    next.attemptVersion >= previous.attemptVersion &&
    new Date(next.heartbeatAt).getTime() >=
      new Date(previous.heartbeatAt).getTime() &&
    new Date(next.expiresAt).getTime() >=
      new Date(previous.expiresAt).getTime()
  );
}

function checkpointMatchesProposal(
  checkpoint: ResearchWorkerCheckpointRecord,
  proposal: ResearchWorkerCheckpointProposal,
  claim: ClaimedResearchJob,
) {
  return (
    checkpoint.runId === claim.run.id &&
    checkpoint.jobId === claim.job.id &&
    checkpoint.attemptId === claim.attempt.id &&
    checkpoint.idempotencyKey === proposal.idempotencyKey &&
    checkpoint.sequence === proposal.sequence &&
    checkpoint.kind === proposal.kind &&
    checkpoint.completedUnits === proposal.completedUnits &&
    checkpoint.totalUnits === proposal.totalUnits &&
    checkpoint.providerRunId === proposal.providerRunId &&
    checkpoint.resumeTokenFingerprint === proposal.resumeTokenFingerprint &&
    checkpoint.outputFingerprint === proposal.outputFingerprint
  );
}

function providerRunMatches(
  returned: ResearchProviderRunRecord,
  proposed: ResearchProviderRunRecord,
) {
  const canonicalizeTimestamps = (record: ResearchProviderRunRecord) => ({
    ...record,
    startedAt: new Date(record.startedAt).toISOString(),
    acceptedAt: new Date(record.acceptedAt).toISOString(),
    lastObservedAt: new Date(record.lastObservedAt).toISOString(),
  });
  return (
    JSON.stringify(canonicalizeTimestamps(returned)) ===
    JSON.stringify(canonicalizeTimestamps(proposed))
  );
}

function terminalMatches(
  terminal: Readonly<{
    runId: string;
    jobId: string;
    attemptId: string | null;
    jobStatus: string;
  }>,
  expected: Readonly<{
    runId: string;
    jobId: string;
    attemptId?: string;
    jobStatus?: string;
  }>,
) {
  return (
    terminal.runId === expected.runId &&
    terminal.jobId === expected.jobId &&
    (expected.attemptId === undefined ||
      terminal.attemptId === expected.attemptId) &&
    (expected.jobStatus === undefined ||
      terminal.jobStatus === expected.jobStatus)
  );
}

function assertStageResultMatches(
  claim: ClaimedResearchJob,
  resultInput: unknown,
): ResearchStageExecutionResult {
  const result = boundaryParse(
    ResearchStageExecutionResultSchema,
    resultInput,
    "STAGE_OUTPUT_MISMATCH",
    "The executor returned an invalid stage result",
  );
  if (
    result.output.runId !== claim.run.id ||
    result.output.jobId !== claim.job.id ||
    result.output.attemptId !== claim.attempt.id ||
    result.output.stage !== claim.job.stage
  ) {
    throw new DurableResearchWorkerError(
      "STAGE_OUTPUT_MISMATCH",
      "The executor result does not belong to the active run, job, attempt, and stage",
    );
  }
  if (result.output.stage === "IDENTITY") {
    const identity = result.subjectIdentities[0];
    const expectedRequirementIds = new Set(
      claim.plan.plan.identityRequirements.map(({ id }) => id),
    );
    const reportedRequirementIds = new Set([
      ...result.output.resolvedRequirementIds,
      ...result.output.unresolvedRequirementIds,
    ]);
    if (
      identity === undefined ||
      identity.caseId !== claim.run.caseId ||
      identity.subjectRefFingerprint !==
        claim.inputManifest.manifest.subjectRefFingerprint ||
      reportedRequirementIds.size !== expectedRequirementIds.size ||
      [...reportedRequirementIds].some(
        (requirementId) => !expectedRequirementIds.has(requirementId),
      )
    ) {
      throw new DurableResearchWorkerError(
        "STAGE_OUTPUT_MISMATCH",
        "The resolved identity does not match the claimed case, subject, and specialist requirements",
      );
    }
  }

  const permittedSourceClasses = new Set(claim.plan.plan.sourceClassIds);
  const permittedAxes = new Map(
    claim.plan.plan.axes.map((axis) => [axis.axisId, axis]),
  );
  if (
    result.sourceCandidates.some(
      (candidate) =>
        !permittedSourceClasses.has(candidate.sourceClass) ||
        candidate.discoveryInputFingerprint !==
          claim.inputManifest.manifestFingerprint ||
        candidate.axisIds.some(
          (axisId) =>
            !permittedAxes
              .get(axisId)
              ?.sourceClassIds.includes(candidate.sourceClass),
        ),
    )
  ) {
    throw new DurableResearchWorkerError(
      "SOURCE_POLICY_MISMATCH",
      "The executor proposed a candidate outside the pinned specialist plan",
    );
  }
  return result;
}

function completion(
  telemetry: ResearchWorkerExecutionTelemetry,
  startedAt: string,
  completedAtInput: string,
) {
  const completedAt = IsoDateTimeSchema.parse(completedAtInput);
  return ResearchWorkerExecutionCompletionSchema.parse({
    ...telemetry,
    latencyMs: elapsedMilliseconds(startedAt, completedAt),
    completedAt,
  });
}

function unavailableTelemetry(): ResearchWorkerExecutionTelemetry {
  return {
    telemetryState: "UNAVAILABLE",
    providerRunId: null,
    usage: null,
    cost: null,
  };
}

function unexpectedFailure(): ResearchWorkerFailureEnvelope {
  return ResearchWorkerFailureEnvelopeSchema.parse({
    schemaVersion: 1,
    code: "worker-unexpected",
    category: "WORKER_INTERNAL",
    phase: "EXTERNAL_CALL",
    retryDirective: "DO_NOT_RETRY",
    retryAfterMs: null,
    providerStatusCode: null,
    diagnosticFingerprint: null,
    redactionState: "BODY_FREE",
  });
}

function invalidOutputFailure(): ResearchWorkerFailureEnvelope {
  return ResearchWorkerFailureEnvelopeSchema.parse({
    schemaVersion: 1,
    code: "stage-output-invalid",
    category: "INVALID_OUTPUT",
    phase: "VALIDATION",
    retryDirective: "RETRY_WITH_BACKOFF",
    retryAfterMs: 1_000,
    providerStatusCode: null,
    diagnosticFingerprint: null,
    redactionState: "BODY_FREE",
  });
}

function shutdownFailure(): ResearchWorkerFailureEnvelope {
  return ResearchWorkerFailureEnvelopeSchema.parse({
    schemaVersion: 1,
    code: "worker-shutdown",
    category: "WORKER_INTERNAL",
    phase: "EXTERNAL_CALL",
    retryDirective: "RETRY_WITH_BACKOFF",
    retryAfterMs: 1_000,
    providerStatusCode: null,
    diagnosticFingerprint: null,
    redactionState: "BODY_FREE",
  });
}

function claimMismatchFailure(): ResearchWorkerFailureEnvelope {
  return ResearchWorkerFailureEnvelopeSchema.parse({
    schemaVersion: 1,
    code: "claimed-work-mismatch",
    category: "WORKER_INTERNAL",
    phase: "PREPARATION",
    retryDirective: "DO_NOT_RETRY",
    retryAfterMs: null,
    providerStatusCode: null,
    diagnosticFingerprint: null,
    redactionState: "BODY_FREE",
  });
}

function providerStartUncertainFailure(): ResearchWorkerFailureEnvelope {
  return ResearchWorkerFailureEnvelopeSchema.parse({
    schemaVersion: 1,
    code: "provider-start-uncertain",
    category: "WORKER_INTERNAL",
    phase: "EXTERNAL_CALL",
    retryDirective: "DO_NOT_RETRY",
    retryAfterMs: null,
    providerStatusCode: null,
    diagnosticFingerprint: null,
    redactionState: "BODY_FREE",
  });
}

function requiresFailClosedResume(claim: ClaimedResearchJob) {
  return (
    claim.resumed &&
    (claim.execution.automaticRetrySafety === "NOT_GUARANTEED" ||
      (claim.execution.automaticRetrySafety === "RESUMABLE_PROVIDER_RUN" &&
        claim.providerCheckpoint === null))
  );
}

function outputFingerprintFailure(): ResearchWorkerFailureEnvelope {
  return ResearchWorkerFailureEnvelopeSchema.parse({
    schemaVersion: 1,
    code: "output-fingerprint-invalid",
    category: "WORKER_INTERNAL",
    phase: "VALIDATION",
    retryDirective: "DO_NOT_RETRY",
    retryAfterMs: null,
    providerStatusCode: null,
    diagnosticFingerprint: null,
    redactionState: "BODY_FREE",
  });
}

function result(value: DurableResearchWorkerResult) {
  return DurableResearchWorkerResultSchema.parse(value);
}

export function createDurableResearchWorkerService(
  dependencies: DurableResearchWorkerDependencies,
) {
  const configurationResult = WorkerConfigurationSchema.safeParse({
    workerId: dependencies.workerId,
    leaseDurationSeconds: dependencies.leaseDurationSeconds,
    heartbeatIntervalMs: dependencies.heartbeatIntervalMs,
  });
  if (!configurationResult.success) {
    throw new DurableResearchWorkerError(
      "CONFIGURATION_INVALID",
      "Durable worker lease configuration is invalid",
    );
  }
  const configuration = configurationResult.data;
  const delay = dependencies.delay ?? defaultDelay;

  return async function executeDurableResearchJob(
    actorIdInput: unknown,
    commandInput: unknown,
    options: ExecuteDurableResearchJobOptions = {},
  ): Promise<DurableResearchWorkerResult> {
    const actorId = EntityIdSchema.parse(actorIdInput);
    const command = ExecuteDurableResearchJobCommandSchema.parse(commandInput);
    const executor = dependencies.executors.resolve(command.stage);
    if (executor === null) {
      throw new DurableResearchWorkerError(
        "EXECUTOR_NOT_AVAILABLE",
        "No durable executor is registered for the requested stage",
      );
    }
    const executorIdentity = boundaryParse(
      ResearchWorkerExecutorIdentitySchema,
      executor.identity,
      "CONFIGURATION_INVALID",
      "The durable executor identity is invalid",
    );
    if (executorIdentity.stage !== command.stage) {
      throw new DurableResearchWorkerError(
        "EXECUTOR_STAGE_MISMATCH",
        "The durable executor is registered for a different stage",
      );
    }

    const attemptId = EntityIdSchema.parse(
      dependencies.createId("research_attempt"),
    );

    let claimedResult: z.infer<typeof ResearchJobClaimResultSchema>;
    try {
      claimedResult = boundaryParse(
        ResearchJobClaimResultSchema,
        await dependencies.store.claimResearchJob({
          actorId,
          runId: command.runId,
          jobId: command.jobId,
          stage: command.stage,
          expectedRunVersion: command.expectedRunVersion,
          expectedJobVersion: command.expectedJobVersion,
          idempotencyKey: command.idempotencyKey,
          attemptId,
          workerId: configuration.workerId,
          execution: executorIdentity.execution,
          leaseDurationSeconds: configuration.leaseDurationSeconds,
        }),
        "CLAIM_INVALID",
        "The research store returned an invalid claim response",
      );
    } catch (error) {
      if (error instanceof DurableResearchWorkerError) throw error;
      throw new DurableResearchWorkerError(
        "STORE_UNAVAILABLE",
        "The research job could not be claimed",
      );
    }

    if (claimedResult.status === "IN_PROGRESS") {
      return result({
        disposition: "IN_PROGRESS",
        runId: command.runId,
        jobId: command.jobId,
        attemptId: null,
        retryAfterMs: claimedResult.retryAfterMs,
      });
    }
    if (claimedResult.status === "TERMINAL") {
      if (
        !terminalMatches(claimedResult.terminal, {
          runId: command.runId,
          jobId: command.jobId,
        })
      ) {
        throw new DurableResearchWorkerError(
          "CLAIM_INVALID",
          "The terminal claim replay does not match the requested job",
        );
      }
      return result({
        disposition: "ALREADY_TERMINAL",
        runId: claimedResult.terminal.runId,
        jobId: claimedResult.terminal.jobId,
        attemptId: claimedResult.terminal.attemptId,
        jobStatus: claimedResult.terminal.jobStatus,
        replayed: claimedResult.replayed,
      });
    }
    if (claimedResult.status === "CANCELLED") {
      return result({
        disposition: "CANCELLED",
        runId: command.runId,
        jobId: command.jobId,
        attemptId: null,
      });
    }

    const claim = ClaimedResearchJobSchema.parse(claimedResult.claim);
    try {
      assertClaimMatches(claim, {
        runId: command.runId,
        jobId: command.jobId,
        stage: command.stage,
        workerId: configuration.workerId,
        execution: executorIdentity.execution,
      });
    } catch (error) {
      const completedAt = monotonicNow(
        dependencies.now,
        claim.lease.heartbeatAt,
      );
      try {
        await dependencies.store.failResearchJob({
          actorId,
          lease: claim.lease,
          idempotencyKey: `${claim.attempt.id}:claim-mismatch:${claim.lease.leaseEpoch}`,
          failure: claimMismatchFailure(),
          execution: completion(
            unavailableTelemetry(),
            claim.attempt.startedAt,
            completedAt,
          ),
        });
      } catch {
        // The original invariant failure is authoritative; a token-fenced
        // takeover will reconcile the still-running attempt if failure commit
        // could not be confirmed.
      }
      throw error;
    }

    // An expired lease may be taken over so it never remains stranded. If the
    // previous worker could have started non-idempotent external work without
    // durably recording a provider resume point, fail closed before invoking
    // any executor. A human can inspect/restart the investigation explicitly.
    if (requiresFailClosedResume(claim)) {
      const completedAt = monotonicNow(
        dependencies.now,
        claim.lease.heartbeatAt,
      );
      try {
        const failureResult = boundaryParse(
          ResearchJobFailureResultSchema,
          await dependencies.store.failResearchJob({
            actorId,
            lease: claim.lease,
            idempotencyKey: `${claim.attempt.id}:unsafe-resume:${claim.lease.leaseEpoch}`,
            failure: providerStartUncertainFailure(),
            execution: completion(
              unavailableTelemetry(),
              claim.attempt.startedAt,
              completedAt,
            ),
          }),
          "COMMIT_UNCERTAIN",
          "The research store returned an invalid reconciliation response",
        );
        if (failureResult.status === "FAILED_TERMINAL") {
          if (
            !terminalMatches(failureResult.terminal, {
              runId: claim.run.id,
              jobId: claim.job.id,
              attemptId: claim.attempt.id,
              jobStatus: "FAILED_TERMINAL",
            })
          ) {
            throw new DurableResearchWorkerError(
              "COMMIT_UNCERTAIN",
              "The reconciliation result does not match the ambiguous attempt",
            );
          }
          return result({
            disposition: "FAILED_TERMINAL",
            runId: claim.run.id,
            jobId: claim.job.id,
            attemptId: claim.attempt.id,
            replayed: failureResult.replayed,
          });
        }
        if (
          failureResult.status === "CANCELLED" ||
          failureResult.status === "LEASE_LOST"
        ) {
          return result({
            disposition: failureResult.status,
            runId: claim.run.id,
            jobId: claim.job.id,
            attemptId: claim.attempt.id,
          });
        }
        throw new DurableResearchWorkerError(
          "COMMIT_UNCERTAIN",
          "The ambiguous provider start was not terminally reconciled",
        );
      } catch (error) {
        if (error instanceof DurableResearchWorkerError) throw error;
        throw new DurableResearchWorkerError(
          "COMMIT_UNCERTAIN",
          "The ambiguous provider start could not be reconciled",
        );
      }
    }

    let lease: ResearchJobLeaseCursor = claim.lease;
    let authority: "ACTIVE" | "CANCELLED" | "LEASE_LOST" = "ACTIVE";
    let resolveAuthorityLoss:
      | ((reason: "CANCELLED" | "LEASE_LOST") => void)
      | null = null;
    const authorityLoss = new Promise<"CANCELLED" | "LEASE_LOST">(
      (resolve) => {
        resolveAuthorityLoss = resolve;
      },
    );
    const workAbort = new AbortController();
    const maintenanceAbort = new AbortController();
    let mutationQueue: Promise<void> = Promise.resolve();
    let checkpointSequence = claim.latestCheckpoint?.sequence ?? 0;
    let providerCheckpoint = claim.providerCheckpoint;
    let acceptingCheckpoints = true;

    const revoke = (reason: "CANCELLED" | "LEASE_LOST") => {
      if (authority !== "ACTIVE") return;
      authority = reason;
      workAbort.abort();
      maintenanceAbort.abort();
      resolveAuthorityLoss?.(reason);
    };

    const serialize = <T>(operation: () => Promise<T>): Promise<T> => {
      const pending = mutationQueue.then(operation, operation);
      mutationQueue = pending.then(
        () => undefined,
        () => undefined,
      );
      return pending;
    };

    const heartbeat = () =>
      serialize(async () => {
        if (authority !== "ACTIVE") return;
        let heartbeatResult: z.infer<typeof ResearchJobHeartbeatResultSchema>;
        try {
          heartbeatResult = boundaryParse(
            ResearchJobHeartbeatResultSchema,
            await dependencies.store.heartbeatResearchJob({
              actorId,
              lease,
              leaseDurationSeconds: configuration.leaseDurationSeconds,
              occurredAt: monotonicNow(dependencies.now, lease.heartbeatAt),
            }),
            "CLAIM_INVALID",
            "The research store returned an invalid heartbeat response",
          );
        } catch {
          revoke("LEASE_LOST");
          return;
        }
        if (heartbeatResult.status === "RENEWED") {
          if (!leaseContinues(lease, heartbeatResult.lease)) {
            revoke("LEASE_LOST");
            return;
          }
          lease = heartbeatResult.lease;
        } else {
          revoke(heartbeatResult.status);
        }
      });

    const checkpoint = async (
      proposalInput: ResearchWorkerCheckpointProposal,
    ): Promise<ResearchWorkerCheckpointRecord> => {
      const proposal = ResearchWorkerCheckpointProposalSchema.parse(
        proposalInput,
      );
      if (proposal.kind === "PROVIDER_ACCEPTED") {
        throw new DurableResearchWorkerError(
          "CLAIM_REJECTED",
          "Provider acceptance requires the atomic recovery-state boundary",
        );
      }
      return serialize(async () => {
        if (authority !== "ACTIVE" || !acceptingCheckpoints) {
          throw new LeaseAuthorityError(
            authority === "ACTIVE" ? "LEASE_LOST" : authority,
          );
        }
        if (proposal.sequence !== checkpointSequence + 1) {
          throw new DurableResearchWorkerError(
            "CLAIM_REJECTED",
            "Executor checkpoints must be contiguous and monotonic",
          );
        }
        const checkpointRecord = ResearchWorkerCheckpointRecordSchema.parse({
          schemaVersion: 1,
          id: EntityIdSchema.parse(
            dependencies.createId("research_checkpoint"),
          ),
          runId: claim.run.id,
          jobId: claim.job.id,
          attemptId: claim.attempt.id,
          ...proposal,
          publicationAuthority: "NONE",
          createdAt: monotonicNow(dependencies.now, lease.heartbeatAt),
        });
        let checkpointResult: z.infer<
          typeof ResearchJobCheckpointResultSchema
        >;
        try {
          checkpointResult = boundaryParse(
            ResearchJobCheckpointResultSchema,
            await dependencies.store.checkpointResearchJob({
              actorId,
              lease,
              checkpoint: checkpointRecord,
              leaseDurationSeconds: configuration.leaseDurationSeconds,
            }),
            "CLAIM_INVALID",
            "The research store returned an invalid checkpoint response",
          );
        } catch (error) {
          revoke("LEASE_LOST");
          if (error instanceof LeaseAuthorityError) throw error;
          throw new LeaseAuthorityError("LEASE_LOST");
        }
        if (
          checkpointResult.status === "COMMITTED" ||
          checkpointResult.status === "REPLAY"
        ) {
          if (
            !leaseContinues(lease, checkpointResult.lease) ||
            !checkpointMatchesProposal(
              checkpointResult.checkpoint,
              proposal,
              claim,
            )
          ) {
            revoke("LEASE_LOST");
            throw new LeaseAuthorityError("LEASE_LOST");
          }
          lease = checkpointResult.lease;
          checkpointSequence = checkpointResult.checkpoint.sequence;
          if (checkpointResult.checkpoint.kind === "PROVIDER_ACCEPTED") {
            providerCheckpoint = checkpointResult.checkpoint;
          }
          return checkpointResult.checkpoint;
        }
        revoke(checkpointResult.status);
        throw new LeaseAuthorityError(checkpointResult.status);
      });
    };

    const acceptProviderRun = async (
      proposalInput: ResearchWorkerCheckpointProposal,
      providerRunInput: Parameters<
        DurableResearchStageExecutionInput["acceptProviderRun"]
      >[1],
    ): Promise<ResearchWorkerCheckpointRecord> => {
      const proposal = ResearchWorkerCheckpointProposalSchema.parse(
        proposalInput,
      );
      const providerRun = ResearchProviderRunRecordSchema.parse(
        providerRunInput,
      );
      if (
        proposal.kind !== "PROVIDER_ACCEPTED" ||
        proposal.providerRunId !== providerRun.providerResponseId ||
        providerRun.runId !== claim.run.id ||
        providerRun.jobId !== claim.job.id ||
        providerRun.attemptId !== claim.attempt.id ||
        providerRun.caseId !== claim.run.caseId ||
        providerRun.manifestFingerprint !==
          claim.inputManifest.manifestFingerprint ||
        providerRun.externalIdempotencyKey !== lease.externalIdempotencyKey
      ) {
        throw new DurableResearchWorkerError(
          "CLAIM_REJECTED",
          "Provider recovery state does not match the active discovery attempt",
        );
      }
      return serialize(async () => {
        if (authority !== "ACTIVE" || !acceptingCheckpoints) {
          throw new LeaseAuthorityError(
            authority === "ACTIVE" ? "LEASE_LOST" : authority,
          );
        }
        if (proposal.sequence !== checkpointSequence + 1) {
          throw new DurableResearchWorkerError(
            "CLAIM_REJECTED",
            "Executor checkpoints must be contiguous and monotonic",
          );
        }
        const checkpointRecord = ResearchWorkerCheckpointRecordSchema.parse({
          schemaVersion: 1,
          id: EntityIdSchema.parse(
            dependencies.createId("research_checkpoint"),
          ),
          runId: claim.run.id,
          jobId: claim.job.id,
          attemptId: claim.attempt.id,
          ...proposal,
          publicationAuthority: "NONE",
          createdAt: monotonicNow(dependencies.now, lease.heartbeatAt),
        });
        let acceptanceResult;
        try {
          acceptanceResult = boundaryParse(
            ResearchProviderAcceptanceResultSchema,
            await dependencies.store.acceptResearchProviderRun({
              actorId,
              lease,
              checkpoint: checkpointRecord,
              providerRun,
              leaseDurationSeconds: configuration.leaseDurationSeconds,
            }),
            "CLAIM_INVALID",
            "The research store returned an invalid provider acceptance response",
          );
        } catch (error) {
          revoke("LEASE_LOST");
          if (error instanceof LeaseAuthorityError) throw error;
          throw new LeaseAuthorityError("LEASE_LOST");
        }
        if (
          acceptanceResult.status === "COMMITTED" ||
          acceptanceResult.status === "REPLAY"
        ) {
          if (
            !leaseContinues(lease, acceptanceResult.lease) ||
            !checkpointMatchesProposal(
              acceptanceResult.checkpoint,
              proposal,
              claim,
            ) ||
            !providerRunMatches(acceptanceResult.providerRun, providerRun)
          ) {
            revoke("LEASE_LOST");
            throw new LeaseAuthorityError("LEASE_LOST");
          }
          lease = acceptanceResult.lease;
          checkpointSequence = acceptanceResult.checkpoint.sequence;
          providerCheckpoint = acceptanceResult.checkpoint;
          return acceptanceResult.checkpoint;
        }
        revoke(acceptanceResult.status);
        throw new LeaseAuthorityError(acceptanceResult.status);
      });
    };

    const acceptSourceResolution = async (
      recordInput: DurableSourceResolutionRecord,
    ): Promise<StoredSourceResolutionRecord> => {
      const record = DurableSourceResolutionRecordSchema.parse(recordInput);
      if (
        claim.job.stage !== "RESOLUTION" ||
        record.runId !== claim.run.id ||
        record.jobId !== claim.job.id ||
        record.attemptId !== claim.attempt.id ||
        record.caseId !== claim.run.caseId ||
        record.manifestFingerprint !==
          claim.inputManifest.manifestFingerprint
      ) {
        throw new DurableResearchWorkerError(
          "CLAIM_REJECTED",
          "Source resolution does not match the active resolution attempt",
        );
      }
      const persistResolution = dependencies.store.acceptSourceResolution;
      return serialize(async () => {
        if (authority !== "ACTIVE" || !acceptingCheckpoints) {
          throw new LeaseAuthorityError(
            authority === "ACTIVE" ? "LEASE_LOST" : authority,
          );
        }
        let acceptanceResult;
        try {
          acceptanceResult = boundaryParse(
            SourceResolutionAcceptanceResultSchema,
            await persistResolution.call(dependencies.store, {
              actorId,
              lease,
              record,
              leaseDurationSeconds: configuration.leaseDurationSeconds,
            }),
            "CLAIM_INVALID",
            "The research store returned an invalid source-resolution acceptance",
          );
        } catch (error) {
          revoke("LEASE_LOST");
          if (error instanceof LeaseAuthorityError) throw error;
          throw new LeaseAuthorityError("LEASE_LOST");
        }
        if (
          acceptanceResult.status === "COMMITTED" ||
          acceptanceResult.status === "REPLAY"
        ) {
          const acceptedRecord = Object.fromEntries(
            Object.entries(acceptanceResult.record).filter(
              ([key]) =>
                key !== "resolutionFingerprint" && key !== "acceptedAt",
            ),
          );
          if (
            !leaseContinues(lease, acceptanceResult.lease) ||
            JSON.stringify(acceptedRecord) !== JSON.stringify(record)
          ) {
            revoke("LEASE_LOST");
            throw new LeaseAuthorityError("LEASE_LOST");
          }
          lease = acceptanceResult.lease;
          return acceptanceResult.record;
        }
        revoke(acceptanceResult.status);
        throw new LeaseAuthorityError(acceptanceResult.status);
      });
    };

    const acceptSourceRetrieval = async (
      recordInput: DurableSourceRetrievalRecord,
    ): Promise<StoredSourceRetrievalRecord> => {
      const record = DurableSourceRetrievalRecordSchema.parse(recordInput);
      if (
        claim.job.stage !== "NORMALIZATION" ||
        record.runId !== claim.run.id ||
        record.jobId !== claim.job.id ||
        record.attemptId !== claim.attempt.id ||
        record.caseId !== claim.run.caseId ||
        record.manifestFingerprint !==
          claim.inputManifest.manifestFingerprint
      ) {
        throw new DurableResearchWorkerError(
          "CLAIM_REJECTED",
          "Source retrieval does not match the active normalization attempt",
        );
      }
      const persistRetrieval = dependencies.store.acceptSourceRetrieval;
      return serialize(async () => {
        if (authority !== "ACTIVE" || !acceptingCheckpoints) {
          throw new LeaseAuthorityError(
            authority === "ACTIVE" ? "LEASE_LOST" : authority,
          );
        }
        let acceptanceResult;
        try {
          acceptanceResult = boundaryParse(
            SourceRetrievalAcceptanceResultSchema,
            await persistRetrieval.call(dependencies.store, {
              actorId,
              lease,
              record,
              leaseDurationSeconds: configuration.leaseDurationSeconds,
            }),
            "CLAIM_INVALID",
            "The research store returned an invalid source-retrieval acceptance",
          );
        } catch (error) {
          revoke("LEASE_LOST");
          if (error instanceof LeaseAuthorityError) throw error;
          throw new LeaseAuthorityError("LEASE_LOST");
        }
        if (
          acceptanceResult.status === "COMMITTED" ||
          acceptanceResult.status === "REPLAY"
        ) {
          const acceptedRecord = Object.fromEntries(
            Object.entries(acceptanceResult.record).filter(
              ([key]) =>
                key !== "retrievalFingerprint" && key !== "acceptedAt",
            ),
          );
          if (
            !leaseContinues(lease, acceptanceResult.lease) ||
            JSON.stringify(acceptedRecord) !== JSON.stringify(record)
          ) {
            revoke("LEASE_LOST");
            throw new LeaseAuthorityError("LEASE_LOST");
          }
          lease = acceptanceResult.lease;
          return acceptanceResult.record;
        }
        revoke(acceptanceResult.status);
        throw new LeaseAuthorityError(acceptanceResult.status);
      });
    };

    const maintenance = (async () => {
      while (authority === "ACTIVE") {
        try {
          await delay(
            configuration.heartbeatIntervalMs,
            maintenanceAbort.signal,
          );
        } catch {
          if (!maintenanceAbort.signal.aborted) revoke("LEASE_LOST");
          return;
        }
        if (maintenanceAbort.signal.aborted) return;
        if (authority === "ACTIVE") await heartbeat();
      }
    })();

    const shutdownListener: { detach: (() => void) | null } = {
      detach: null,
    };
    const shutdown = new Promise<"SHUTDOWN">((resolve) => {
      const signal = options.shutdownSignal;
      if (signal === undefined) return;
      const onShutdown = () => resolve("SHUTDOWN");
      if (signal.aborted) {
        resolve("SHUTDOWN");
        return;
      }
      signal.addEventListener("abort", onShutdown, { once: true });
      shutdownListener.detach = () =>
        signal.removeEventListener("abort", onShutdown);
    });

    const execution = Promise.resolve()
      .then(() =>
        executor.execute({
          actorId,
          claim,
          externalIdempotencyKey: lease.externalIdempotencyKey,
          signal: workAbort.signal,
          checkpoint,
          acceptProviderRun,
          acceptSourceResolution,
          acceptSourceRetrieval,
        }),
      )
      .then(
        (value) => ({ kind: "EXECUTED" as const, value }),
        () => ({ kind: "THREW" as const }),
      );

    const race = await Promise.race([
      execution,
      authorityLoss.then((reason) => ({ kind: "AUTHORITY" as const, reason })),
      shutdown.then(() => ({ kind: "SHUTDOWN" as const })),
    ]);
    shutdownListener.detach?.();

    if (race.kind === "AUTHORITY") {
      maintenanceAbort.abort();
      await maintenance;
      return result({
        disposition: race.reason,
        runId: claim.run.id,
        jobId: claim.job.id,
        attemptId: claim.attempt.id,
      });
    }

    if (race.kind === "SHUTDOWN") {
      // Close the executor-facing mutation boundary before releasing the
      // lease. An abort signal is cooperative: an executor may settle late,
      // but it must never checkpoint after the durable release begins.
      acceptingCheckpoints = false;
      workAbort.abort();
      maintenanceAbort.abort();
      await maintenance;
      await mutationQueue;
      if (authority !== "ACTIVE") {
        return result({
          disposition: authority,
          runId: claim.run.id,
          jobId: claim.job.id,
          attemptId: claim.attempt.id,
        });
      }
      const completedAt = monotonicNow(dependencies.now, lease.heartbeatAt);
      const shutdownRetryIsSafe =
        executorIdentity.execution.automaticRetrySafety ===
          "IDEMPOTENT_PROVIDER_REQUEST" ||
        (executorIdentity.execution.automaticRetrySafety ===
          "RESUMABLE_PROVIDER_RUN" &&
          providerCheckpoint !== null);
      if (!shutdownRetryIsSafe) {
        try {
          const failureResult = boundaryParse(
            ResearchJobFailureResultSchema,
            await dependencies.store.failResearchJob({
              actorId,
              lease,
              idempotencyKey: `${claim.attempt.id}:shutdown-uncertain:${lease.leaseEpoch}`,
              failure: providerStartUncertainFailure(),
              execution: completion(
                unavailableTelemetry(),
                claim.attempt.startedAt,
                completedAt,
              ),
            }),
            "COMMIT_UNCERTAIN",
            "The research store returned an invalid shutdown reconciliation response",
          );
          if (failureResult.status === "FAILED_TERMINAL") {
            if (
              !terminalMatches(failureResult.terminal, {
                runId: claim.run.id,
                jobId: claim.job.id,
                attemptId: claim.attempt.id,
                jobStatus: "FAILED_TERMINAL",
              })
            ) {
              throw new DurableResearchWorkerError(
                "COMMIT_UNCERTAIN",
                "The shutdown reconciliation does not match the active attempt",
              );
            }
            return result({
              disposition: "FAILED_TERMINAL",
              runId: claim.run.id,
              jobId: claim.job.id,
              attemptId: claim.attempt.id,
              replayed: failureResult.replayed,
            });
          }
          if (
            failureResult.status === "CANCELLED" ||
            failureResult.status === "LEASE_LOST"
          ) {
            return result({
              disposition: failureResult.status,
              runId: claim.run.id,
              jobId: claim.job.id,
              attemptId: claim.attempt.id,
            });
          }
          throw new DurableResearchWorkerError(
            "COMMIT_UNCERTAIN",
            "The uncertain shutdown was not terminally reconciled",
          );
        } catch (error) {
          if (error instanceof DurableResearchWorkerError) throw error;
          throw new DurableResearchWorkerError(
            "COMMIT_UNCERTAIN",
            "The uncertain shutdown could not be reconciled",
          );
        }
      }
      try {
        const releaseResult = boundaryParse(
          ResearchJobReleaseResultSchema,
          await dependencies.store.releaseResearchJob({
            actorId,
            lease,
            idempotencyKey: `${claim.attempt.id}:release:${lease.leaseEpoch}`,
            failure: shutdownFailure(),
            execution: completion(
              unavailableTelemetry(),
              claim.attempt.startedAt,
              completedAt,
            ),
          }),
          "COMMIT_UNCERTAIN",
          "The research store returned an invalid release response",
        );
        if (
          releaseResult.status === "RELEASED" ||
          releaseResult.status === "REPLAY"
        ) {
          if (releaseResult.attemptId !== claim.attempt.id) {
            throw new DurableResearchWorkerError(
              "COMMIT_UNCERTAIN",
              "The release replay does not match the active attempt",
            );
          }
          return result({
            disposition: "RELEASED",
            runId: claim.run.id,
            jobId: claim.job.id,
            attemptId: claim.attempt.id,
            retryAt: releaseResult.retryAt,
            replayed: releaseResult.status === "REPLAY",
          });
        }
        if (releaseResult.status === "FAILED_TERMINAL") {
          if (
            !terminalMatches(releaseResult.terminal, {
              runId: claim.run.id,
              jobId: claim.job.id,
              attemptId: claim.attempt.id,
              jobStatus: "FAILED_TERMINAL",
            })
          ) {
            throw new DurableResearchWorkerError(
              "COMMIT_UNCERTAIN",
              "The release budget result does not match the active attempt",
            );
          }
          return result({
            disposition: "FAILED_TERMINAL",
            runId: claim.run.id,
            jobId: claim.job.id,
            attemptId: claim.attempt.id,
            replayed: releaseResult.replayed,
          });
        }
        return result({
          disposition: releaseResult.status,
          runId: claim.run.id,
          jobId: claim.job.id,
          attemptId: claim.attempt.id,
        });
      } catch (error) {
        if (error instanceof DurableResearchWorkerError) throw error;
        throw new DurableResearchWorkerError(
          "COMMIT_UNCERTAIN",
          "Worker shutdown release could not be confirmed",
        );
      }
    }

    maintenanceAbort.abort();
    await maintenance;
    await mutationQueue;
    if (authority !== "ACTIVE") {
      return result({
        disposition: authority,
        runId: claim.run.id,
        jobId: claim.job.id,
        attemptId: claim.attempt.id,
      });
    }

    let executionOutcome: z.infer<typeof ResearchWorkerExecutionOutcomeSchema>;
    let policyFailure: ResearchWorkerFailureEnvelope | null = null;
    if (race.kind === "THREW") {
      executionOutcome = {
        status: "FAILED",
        failure: unexpectedFailure(),
        telemetry: unavailableTelemetry(),
      };
    } else {
      const parsed = ResearchWorkerExecutionOutcomeSchema.safeParse(race.value);
      if (parsed.success) {
        executionOutcome = parsed.data;
      } else {
        executionOutcome = {
          status: "FAILED",
          failure: invalidOutputFailure(),
          telemetry: unavailableTelemetry(),
        };
      }
    }

    let stageResult: ResearchStageExecutionResult | null = null;
    let outputFingerprint: string | null = null;
    if (executionOutcome.status === "COMPLETED") {
      try {
        stageResult = assertStageResultMatches(claim, executionOutcome.result);
      } catch (error) {
        if (error instanceof DurableResearchWorkerError) {
          policyFailure =
            error.code === "SOURCE_POLICY_MISMATCH"
              ? ResearchWorkerFailureEnvelopeSchema.parse({
                  schemaVersion: 1,
                  code: "source-policy-rejected",
                  category: "POLICY",
                  phase: "VALIDATION",
                  retryDirective: "DO_NOT_RETRY",
                  retryAfterMs: null,
                  providerStatusCode: null,
                  diagnosticFingerprint: null,
                  redactionState: "BODY_FREE",
                })
              : invalidOutputFailure();
        } else {
          policyFailure = invalidOutputFailure();
        }
      }
      if (stageResult !== null && policyFailure === null) {
        try {
          outputFingerprint = Sha256Schema.parse(
            dependencies.fingerprints.fingerprintExecutionOutput(stageResult),
          );
        } catch {
          policyFailure = outputFingerprintFailure();
        }
      }
    }

    const completedAt = monotonicNow(dependencies.now, lease.heartbeatAt);
    const executionCompletion = completion(
      executionOutcome.telemetry,
      claim.attempt.startedAt,
      completedAt,
    );

    if (
      executionOutcome.status === "COMPLETED" &&
      policyFailure === null &&
      stageResult !== null &&
      outputFingerprint !== null
    ) {
      try {
        const completionResult = boundaryParse(
          ResearchJobCompletionResultSchema,
          await dependencies.store.completeResearchJob({
            actorId,
            lease,
            idempotencyKey: `${claim.attempt.id}:complete`,
            result: stageResult,
            outputFingerprint,
            execution: executionCompletion,
          }),
          "COMMIT_UNCERTAIN",
          "The research store returned an invalid completion response",
        );
        if (
          completionResult.status === "COMMITTED" ||
          completionResult.status === "REPLAY"
        ) {
          if (
            completionResult.outcome !== stageResult.outcome ||
            !terminalMatches(completionResult.terminal, {
              runId: claim.run.id,
              jobId: claim.job.id,
              attemptId: claim.attempt.id,
              jobStatus: stageResult.outcome,
            })
          ) {
            throw new DurableResearchWorkerError(
              "COMMIT_UNCERTAIN",
              "The completion replay does not match the committed stage result",
            );
          }
          return result({
            disposition: completionResult.outcome,
            runId: claim.run.id,
            jobId: claim.job.id,
            attemptId: claim.attempt.id,
            replayed: completionResult.status === "REPLAY",
          });
        }
        return result({
          disposition: completionResult.status,
          runId: claim.run.id,
          jobId: claim.job.id,
          attemptId: claim.attempt.id,
        });
      } catch (error) {
        if (error instanceof DurableResearchWorkerError) throw error;
        throw new DurableResearchWorkerError(
          "COMMIT_UNCERTAIN",
          "Research completion could not be confirmed",
        );
      }
    }

    let failure =
      policyFailure ??
      (executionOutcome.status === "FAILED"
        ? executionOutcome.failure
        : invalidOutputFailure());
    const resumableHandoffIsSafe =
      failure.retryDirective === "RETRY_WITH_BACKOFF" &&
      ((claim.job.stage === "RESOLUTION" &&
        failure.code.startsWith("resolution-") &&
        executorIdentity.execution.automaticRetrySafety ===
          "IDEMPOTENT_PROVIDER_REQUEST") ||
        (executorIdentity.execution.automaticRetrySafety ===
          "RESUMABLE_PROVIDER_RUN" &&
          providerCheckpoint?.providerRunId !== null &&
          providerCheckpoint?.providerRunId !== undefined));
    if (resumableHandoffIsSafe) {
      try {
        const releaseResult = boundaryParse(
          ResearchJobReleaseResultSchema,
          await dependencies.store.releaseResearchJob({
            actorId,
            lease,
            idempotencyKey: `${claim.attempt.id}:retry-handoff:${lease.leaseEpoch}`,
            failure,
            execution: executionCompletion,
          }),
          "COMMIT_UNCERTAIN",
          "The research store returned an invalid retry handoff response",
        );
        if (
          releaseResult.status === "RELEASED" ||
          releaseResult.status === "REPLAY"
        ) {
          if (releaseResult.attemptId !== claim.attempt.id) {
            throw new DurableResearchWorkerError(
              "COMMIT_UNCERTAIN",
              "The retry handoff does not match the resumable attempt",
            );
          }
          return result({
            disposition: "RELEASED",
            runId: claim.run.id,
            jobId: claim.job.id,
            attemptId: claim.attempt.id,
            retryAt: releaseResult.retryAt,
            replayed: releaseResult.status === "REPLAY",
          });
        }
        if (releaseResult.status === "FAILED_TERMINAL") {
          if (
            !terminalMatches(releaseResult.terminal, {
              runId: claim.run.id,
              jobId: claim.job.id,
              attemptId: claim.attempt.id,
              jobStatus: "FAILED_TERMINAL",
            })
          ) {
            throw new DurableResearchWorkerError(
              "COMMIT_UNCERTAIN",
              "The handoff budget result does not match the resumable attempt",
            );
          }
          return result({
            disposition: "FAILED_TERMINAL",
            runId: claim.run.id,
            jobId: claim.job.id,
            attemptId: claim.attempt.id,
            replayed: releaseResult.replayed,
          });
        }
        return result({
          disposition: releaseResult.status,
          runId: claim.run.id,
          jobId: claim.job.id,
          attemptId: claim.attempt.id,
        });
      } catch (error) {
        if (error instanceof DurableResearchWorkerError) throw error;
        throw new DurableResearchWorkerError(
          "COMMIT_UNCERTAIN",
          "The resumable retry handoff could not be confirmed",
        );
      }
    }
    const retryIsSafe =
      executorIdentity.execution.automaticRetrySafety ===
      "IDEMPOTENT_PROVIDER_REQUEST";
    if (
      failure.retryDirective === "RETRY_WITH_BACKOFF" &&
      !retryIsSafe
    ) {
      failure = providerStartUncertainFailure();
    }
    try {
      const failureResult = boundaryParse(
        ResearchJobFailureResultSchema,
        await dependencies.store.failResearchJob({
          actorId,
          lease,
          idempotencyKey: `${claim.attempt.id}:failure:${lease.leaseEpoch}`,
          failure,
          execution: executionCompletion,
        }),
        "COMMIT_UNCERTAIN",
        "The research store returned an invalid failure response",
      );
      if (
        failureResult.status === "RETRY_SCHEDULED" ||
        failureResult.status === "REPLAY"
      ) {
        if (
          failureResult.attemptId !== claim.attempt.id ||
          failure.retryDirective !== "RETRY_WITH_BACKOFF"
        ) {
          throw new DurableResearchWorkerError(
            "COMMIT_UNCERTAIN",
            "The retry result does not match the failed attempt policy",
          );
        }
        return result({
          disposition: "FAILED_RETRYABLE",
          runId: claim.run.id,
          jobId: claim.job.id,
          attemptId: claim.attempt.id,
          retryAt: failureResult.retryAt,
          replayed: failureResult.status === "REPLAY",
        });
      }
      if (failureResult.status === "FAILED_TERMINAL") {
        if (
          !terminalMatches(failureResult.terminal, {
            runId: claim.run.id,
            jobId: claim.job.id,
            attemptId: claim.attempt.id,
            jobStatus: "FAILED_TERMINAL",
          })
        ) {
          throw new DurableResearchWorkerError(
            "COMMIT_UNCERTAIN",
            "The terminal failure does not match the failed attempt",
          );
        }
        return result({
          disposition: "FAILED_TERMINAL",
          runId: claim.run.id,
          jobId: claim.job.id,
          attemptId: claim.attempt.id,
          replayed: failureResult.replayed,
        });
      }
      return result({
        disposition: failureResult.status,
        runId: claim.run.id,
        jobId: claim.job.id,
        attemptId: claim.attempt.id,
      });
    } catch (error) {
      if (error instanceof DurableResearchWorkerError) throw error;
      throw new DurableResearchWorkerError(
        "COMMIT_UNCERTAIN",
        "Research failure could not be confirmed",
      );
    }
  };
}
