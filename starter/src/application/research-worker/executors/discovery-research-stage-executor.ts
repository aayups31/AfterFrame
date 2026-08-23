import { createHash } from "node:crypto";
import {
  DurableResearchDiscoveryContextSchema,
  DurableResearchDiscoveryHandleSchema,
  parseDurableResearchDiscoveryOutputForInput,
  providerRunRecordFromAcceptedHandle,
  type DurableResearchDiscoveryContextReader,
  type DurableResearchDiscoveryInput,
  type DurableResearchDiscoveryProvider,
  type DurableResearchDiscoveryHandle,
} from "@/application/research/durable-discovery-port";
import type {
  DurableResearchStageExecutionInput,
  DurableResearchStageExecutor,
  ResearchProviderRunReader,
  ResearchRunFingerprintPort,
} from "@/core/research-runs/ports";
import { ResearchProviderRunRecordSchema } from "@/core/research-runs/provider-runs";
import { ResearchStageExecutionResultSchema } from "@/core/research-runs/schemas";
import {
  ClaimedResearchJobSchema,
  ResearchWorkerExecutionOutcomeSchema,
  ResearchWorkerExecutionPlanSchema,
  ResearchWorkerExecutorIdentitySchema,
  ResearchWorkerFailureEnvelopeSchema,
  type ClaimedResearchJob,
  type ResearchWorkerExecutionOutcome,
  type ResearchWorkerExecutionPlan,
  type ResearchWorkerExecutionTelemetry,
} from "@/core/research-runs/worker-schemas";
import { EntityIdSchema, IsoDateTimeSchema, Sha256Schema } from "@/core/shared/schemas";

export type DiscoveryResearchStageExecutorDependencies = Readonly<{
  context: DurableResearchDiscoveryContextReader;
  providerRuns: ResearchProviderRunReader;
  provider: DurableResearchDiscoveryProvider;
  fingerprints: ResearchRunFingerprintPort;
  execution: ResearchWorkerExecutionPlan;
  now: () => string;
  pollIntervalMs?: number;
  maxPollsPerExecution?: number;
  delay?: (milliseconds: number, signal: AbortSignal) => Promise<void>;
}>;

function unavailableTelemetry(): ResearchWorkerExecutionTelemetry {
  return {
    telemetryState: "UNAVAILABLE",
    providerRunId: null,
    usage: null,
    cost: null,
  };
}

function partialTelemetry(providerRunId: string): ResearchWorkerExecutionTelemetry {
  return {
    telemetryState: "PARTIAL",
    providerRunId,
    usage: null,
    cost: null,
  };
}

function failureOutcome(input: Readonly<{
  code: string;
  category:
    | "TRANSIENT_UPSTREAM"
    | "INVALID_OUTPUT"
    | "POLICY"
    | "WORKER_INTERNAL";
  phase: "PREPARATION" | "EXTERNAL_CALL" | "VALIDATION" | "CHECKPOINT";
  retryAfterMs: number | null;
  telemetry: ResearchWorkerExecutionTelemetry;
}>): ResearchWorkerExecutionOutcome {
  return ResearchWorkerExecutionOutcomeSchema.parse({
    status: "FAILED",
    failure: ResearchWorkerFailureEnvelopeSchema.parse({
      schemaVersion: 1,
      code: input.code,
      category: input.category,
      phase: input.phase,
      retryDirective:
        input.retryAfterMs === null ? "DO_NOT_RETRY" : "RETRY_WITH_BACKOFF",
      retryAfterMs: input.retryAfterMs,
      providerStatusCode: null,
      diagnosticFingerprint: null,
      redactionState: "BODY_FREE",
    }),
    telemetry: input.telemetry,
  });
}

function defaultDelay(milliseconds: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason ?? new Error("discovery-poll-aborted"));
      return;
    }
    const timeout = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, milliseconds);
    const onAbort = () => {
      clearTimeout(timeout);
      reject(signal.reason ?? new Error("discovery-poll-aborted"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function deterministicEntityId(purpose: string, ...parts: readonly string[]) {
  const digest = createHash("sha256")
    .update(`afterframe:${purpose}:v1\0${parts.join("\0")}`, "utf8")
    .digest("hex");
  const variant = ((Number.parseInt(digest[16] ?? "0", 16) & 0x3) | 0x8)
    .toString(16);
  return EntityIdSchema.parse(
    `${digest.slice(0, 8)}-${digest.slice(8, 12)}-5${digest.slice(13, 16)}-${variant}${digest.slice(17, 20)}-${digest.slice(20, 32)}`,
  );
}

function fingerprintProviderResponseId(providerResponseId: string) {
  return Sha256Schema.parse(
    createHash("sha256")
      .update("afterframe:provider-response-resume:v1\0", "utf8")
      .update(providerResponseId, "utf8")
      .digest("hex"),
  );
}

function latestTime(...values: readonly string[]) {
  return values
    .map((value) => IsoDateTimeSchema.parse(value))
    .reduce((latest, candidate) =>
      new Date(candidate).getTime() > new Date(latest).getTime()
        ? candidate
        : latest,
    );
}

function contextMatchesClaim(
  context: ReturnType<typeof DurableResearchDiscoveryContextSchema.parse>,
  claim: ClaimedResearchJob,
) {
  const manifest = claim.inputManifest.manifest;
  return (
    claim.job.stage === "DISCOVERY" &&
    manifest.stage === "DISCOVERY" &&
    manifest.dependency.state === "BOUND" &&
    manifest.subjectIdentity.state === "BOUND" &&
    context.runId === claim.run.id &&
    context.jobId === claim.job.id &&
    context.caseId === claim.run.caseId &&
    context.publicSubjectIdentity.identityFingerprint ===
      manifest.subjectIdentity.identityFingerprint &&
    JSON.stringify(context.axes) === JSON.stringify(claim.plan.plan.axes) &&
    JSON.stringify(context.sourceClassIds) ===
      JSON.stringify(claim.plan.plan.sourceClassIds)
  );
}

function handleFromRecord(
  value: unknown,
): DurableResearchDiscoveryHandle {
  const record = ResearchProviderRunRecordSchema.parse(value);
  return DurableResearchDiscoveryHandleSchema.parse({
    providerResponseId: record.providerResponseId,
    state: record.state,
    requestedModel: record.requestedModel,
    providerModel: record.providerModel,
    traceId: record.traceId,
    binding: {
      runId: record.runId,
      jobId: record.jobId,
      attemptId: record.attemptId,
      caseId: record.caseId,
      manifestFingerprint: record.manifestFingerprint,
      externalIdempotencyKey: record.externalIdempotencyKey,
    },
    startedAt: record.startedAt,
    lastObservedAt: record.lastObservedAt,
    inputBytes: record.inputBytes,
    dataControlMode: record.dataControlMode,
    projectIdFingerprint: record.projectIdFingerprint,
    privateContentIncluded: record.privateContentIncluded,
  });
}

function recoveryMatches(
  input: DurableResearchDiscoveryInput,
  handle: DurableResearchDiscoveryHandle,
) {
  return (
    handle.binding.runId === input.runId &&
    handle.binding.jobId === input.jobId &&
    handle.binding.attemptId === input.attemptId &&
    handle.binding.caseId === input.caseId &&
    handle.binding.manifestFingerprint === input.manifestFingerprint &&
    handle.binding.externalIdempotencyKey === input.externalIdempotencyKey
  );
}

/**
 * Durable source-discovery executor. It creates no claims or evidence: its only
 * successful output is a deterministic set of search-backed, untrusted source
 * candidates bound to the exact Postgres-authored attempt manifest.
 */
export class DiscoveryResearchStageExecutor
  implements DurableResearchStageExecutor
{
  readonly identity;
  readonly #context: DurableResearchDiscoveryContextReader;
  readonly #providerRuns: ResearchProviderRunReader;
  readonly #provider: DurableResearchDiscoveryProvider;
  readonly #fingerprints: ResearchRunFingerprintPort;
  readonly #now: () => string;
  readonly #pollIntervalMs: number;
  readonly #maxPollsPerExecution: number;
  readonly #delay: (milliseconds: number, signal: AbortSignal) => Promise<void>;

  constructor(dependencies: DiscoveryResearchStageExecutorDependencies) {
    const execution = ResearchWorkerExecutionPlanSchema.parse(
      dependencies.execution,
    );
    if (
      execution.executionKind !== "MODEL_TOOL" ||
      execution.model?.provider !== "openai" ||
      execution.tool?.id !== "openai-web-search" ||
      !execution.privateContentIncluded ||
      execution.automaticRetrySafety !== "RESUMABLE_PROVIDER_RUN"
    ) {
      throw new Error(
        "Discovery executor requires a private resumable OpenAI web-search execution plan",
      );
    }
    const pollIntervalMs = dependencies.pollIntervalMs ?? 5_000;
    const maxPolls = dependencies.maxPollsPerExecution ?? 12;
    if (
      !Number.isInteger(pollIntervalMs) ||
      pollIntervalMs < 100 ||
      pollIntervalMs > 300_000 ||
      !Number.isInteger(maxPolls) ||
      maxPolls < 1 ||
      maxPolls > 1_000
    ) {
      throw new Error("Discovery polling configuration is invalid");
    }
    this.identity = ResearchWorkerExecutorIdentitySchema.parse({
      stage: "DISCOVERY",
      execution,
    });
    this.#context = dependencies.context;
    this.#providerRuns = dependencies.providerRuns;
    this.#provider = dependencies.provider;
    this.#fingerprints = dependencies.fingerprints;
    this.#now = dependencies.now;
    this.#pollIntervalMs = pollIntervalMs;
    this.#maxPollsPerExecution = maxPolls;
    this.#delay = dependencies.delay ?? defaultDelay;
  }

  async execute(
    workerInput: DurableResearchStageExecutionInput,
  ): Promise<ResearchWorkerExecutionOutcome> {
    const parsedClaim = ClaimedResearchJobSchema.safeParse(workerInput.claim);
    if (!parsedClaim.success) {
      return failureOutcome({
        code: "discovery-claim-invalid",
        category: "POLICY",
        phase: "PREPARATION",
        retryAfterMs: null,
        telemetry: unavailableTelemetry(),
      });
    }
    const claim = parsedClaim.data;

    let contextValue: unknown;
    try {
      contextValue = await this.#context.getDiscoveryContext({
        actorId: workerInput.actorId,
        runId: claim.run.id,
        jobId: claim.job.id,
      });
    } catch {
      return failureOutcome({
        code: "discovery-context-unavailable",
        category: "TRANSIENT_UPSTREAM",
        phase: "PREPARATION",
        retryAfterMs: 1_000,
        telemetry: unavailableTelemetry(),
      });
    }
    const context = DurableResearchDiscoveryContextSchema.safeParse(contextValue);
    if (!context.success || !contextMatchesClaim(context.data, claim)) {
      return failureOutcome({
        code: "discovery-context-mismatch",
        category: "POLICY",
        phase: "PREPARATION",
        retryAfterMs: null,
        telemetry: unavailableTelemetry(),
      });
    }

    const discoveryInput: DurableResearchDiscoveryInput = {
      ...context.data,
      attemptId: claim.attempt.id,
      manifestFingerprint: claim.inputManifest.manifestFingerprint,
      externalIdempotencyKey: workerInput.externalIdempotencyKey,
    };

    let recoveryValue: unknown;
    try {
      recoveryValue = await this.#providerRuns.getAcceptedProviderRun({
        actorId: workerInput.actorId,
        runId: claim.run.id,
        jobId: claim.job.id,
        attemptId: claim.attempt.id,
      });
    } catch {
      return failureOutcome({
        code: "discovery-provider-recovery-unavailable",
        category: "TRANSIENT_UPSTREAM",
        phase: "PREPARATION",
        retryAfterMs: 1_000,
        telemetry: unavailableTelemetry(),
      });
    }

    const hasCheckpoint = claim.providerCheckpoint !== null;
    const hasRecovery = recoveryValue !== null;
    if (hasCheckpoint !== hasRecovery) {
      return failureOutcome({
        code: "discovery-provider-recovery-invariant",
        category: "POLICY",
        phase: "PREPARATION",
        retryAfterMs: null,
        telemetry: unavailableTelemetry(),
      });
    }

    let handle: DurableResearchDiscoveryHandle;
    let checkpointSequence = claim.latestCheckpoint?.sequence ?? 0;
    if (hasRecovery) {
      try {
        handle = handleFromRecord(recoveryValue);
      } catch {
        return failureOutcome({
          code: "discovery-provider-recovery-invalid",
          category: "POLICY",
          phase: "PREPARATION",
          retryAfterMs: null,
          telemetry: unavailableTelemetry(),
        });
      }
      if (
        !recoveryMatches(discoveryInput, handle) ||
        claim.providerCheckpoint?.providerRunId !== handle.providerResponseId
      ) {
        return failureOutcome({
          code: "discovery-provider-recovery-mismatch",
          category: "POLICY",
          phase: "PREPARATION",
          retryAfterMs: null,
          telemetry: unavailableTelemetry(),
        });
      }
    } else {
      let started: Awaited<ReturnType<DurableResearchDiscoveryProvider["start"]>>;
      try {
        started = await this.#provider.start(discoveryInput);
      } catch {
        return failureOutcome({
          code: "discovery-provider-start-outcome-unknown",
          category: "POLICY",
          phase: "EXTERNAL_CALL",
          retryAfterMs: null,
          telemetry: unavailableTelemetry(),
        });
      }
      handle = DurableResearchDiscoveryHandleSchema.parse(started.handle);
      let providerRun;
      try {
        providerRun = providerRunRecordFromAcceptedHandle(
          discoveryInput,
          handle,
          latestTime(this.#now(), handle.startedAt, handle.lastObservedAt),
        );
      } catch {
        return failureOutcome({
          code: "discovery-provider-start-contract-invalid",
          category: "POLICY",
          phase: "VALIDATION",
          retryAfterMs: null,
          telemetry: partialTelemetry(handle.providerResponseId),
        });
      }
      checkpointSequence += 1;
      try {
        const accepted = await workerInput.acceptProviderRun(
          {
            idempotencyKey: `${claim.attempt.id}:provider-accepted`,
            sequence: checkpointSequence,
            kind: "PROVIDER_ACCEPTED",
            completedUnits: 0,
            totalUnits: 1,
            providerRunId: handle.providerResponseId,
            resumeTokenFingerprint: fingerprintProviderResponseId(
              handle.providerResponseId,
            ),
            outputFingerprint: null,
          },
          providerRun,
        );
        checkpointSequence = accepted.sequence;
      } catch (error) {
        if (workerInput.signal.aborted) throw error;
        return failureOutcome({
          code: "discovery-provider-acceptance-uncertain",
          category: "WORKER_INTERNAL",
          phase: "CHECKPOINT",
          retryAfterMs: null,
          telemetry: partialTelemetry(handle.providerResponseId),
        });
      }
    }

    for (let poll = 0; poll < this.#maxPollsPerExecution; poll += 1) {
      let observation: Awaited<
        ReturnType<DurableResearchDiscoveryProvider["retrieve"]>
      >;
      try {
        observation = await this.#provider.retrieve(discoveryInput, handle);
      } catch (error) {
        if (workerInput.signal.aborted) throw error;
        return failureOutcome({
          code: "discovery-provider-retrieve-unavailable",
          category: "TRANSIENT_UPSTREAM",
          phase: "EXTERNAL_CALL",
          retryAfterMs: 1_000,
          telemetry: partialTelemetry(handle.providerResponseId),
        });
      }
      const previousProviderResponseId = handle.providerResponseId;
      const observedHandle = DurableResearchDiscoveryHandleSchema.safeParse(
        observation.handle,
      );
      if (
        !observedHandle.success ||
        observedHandle.data.providerResponseId !== previousProviderResponseId ||
        !recoveryMatches(discoveryInput, observedHandle.data) ||
        observation.state !== observedHandle.data.state
      ) {
        return failureOutcome({
          code: "discovery-provider-observation-mismatch",
          category: "POLICY",
          phase: "VALIDATION",
          retryAfterMs: null,
          telemetry: partialTelemetry(previousProviderResponseId),
        });
      }
      handle = observedHandle.data;
      if (observation.kind === "PENDING") {
        if (poll + 1 < this.#maxPollsPerExecution) {
          await this.#delay(this.#pollIntervalMs, workerInput.signal);
        }
        continue;
      }
      if (observation.kind === "TERMINAL") {
        return failureOutcome({
          code: `discovery-${observation.failure.reasonCode}`,
          category: "TRANSIENT_UPSTREAM",
          phase: "EXTERNAL_CALL",
          retryAfterMs: null,
          telemetry: partialTelemetry(handle.providerResponseId),
        });
      }

      let providerOutput;
      try {
        providerOutput = parseDurableResearchDiscoveryOutputForInput(
          discoveryInput,
          observation.output,
        );
      } catch {
        return failureOutcome({
          code: "discovery-provider-output-invalid",
          category: "INVALID_OUTPUT",
          phase: "VALIDATION",
          retryAfterMs: null,
          telemetry: partialTelemetry(handle.providerResponseId),
        });
      }
      const execution = providerOutput.execution;
      if (
        execution.providerRunId !== handle.providerResponseId ||
        execution.executionKind !== this.identity.execution.executionKind ||
        execution.model?.provider !== this.identity.execution.model?.provider ||
        execution.model?.model !== this.identity.execution.model?.model ||
        execution.model?.snapshot !== this.identity.execution.model?.snapshot ||
        JSON.stringify(execution.prompt) !==
          JSON.stringify(this.identity.execution.prompt) ||
        JSON.stringify(execution.schema) !==
          JSON.stringify(this.identity.execution.schema) ||
        JSON.stringify(execution.tool) !==
          JSON.stringify(this.identity.execution.tool) ||
        !execution.privateContentIncluded ||
        execution.telemetryState !== "COMPLETE" ||
        execution.usage === null ||
        execution.cost === null
      ) {
        return failureOutcome({
          code: "discovery-provider-provenance-mismatch",
          category: "POLICY",
          phase: "VALIDATION",
          retryAfterMs: null,
          telemetry: partialTelemetry(handle.providerResponseId),
        });
      }

      const createdAt = latestTime(
        this.#now(),
        claim.attempt.startedAt,
        handle.lastObservedAt,
      );
      const sourceCandidates = providerOutput.candidates.map(
        (candidate) => ({
          schemaVersion: 1 as const,
          id: deterministicEntityId(
            "discovery-candidate",
            claim.attempt.id,
            candidate.candidateKey,
          ),
          runId: claim.run.id,
          jobId: claim.job.id,
          attemptId: claim.attempt.id,
          ...candidate,
          createdAt,
        }),
      );
      const result = ResearchStageExecutionResultSchema.parse({
        outcome: sourceCandidates.length === 0 ? "DEGRADED" : "SUCCEEDED",
        boundedReasonCodes:
          sourceCandidates.length === 0
            ? ["discovery-no-search-backed-candidates"]
            : [],
        output: {
          schemaVersion: 1,
          id: deterministicEntityId("discovery-output", claim.attempt.id),
          runId: claim.run.id,
          jobId: claim.job.id,
          attemptId: claim.attempt.id,
          kind: "DISCOVERY_RESULT",
          stage: "DISCOVERY",
          candidateIds: sourceCandidates.map(({ id }) => id),
          reviewState: "PROPOSED",
          publicationAuthority: "NONE",
          provenanceInputs: [
            { recordType: "JOB", recordId: claim.job.id },
            { recordType: "ATTEMPT", recordId: claim.attempt.id },
          ],
          createdAt,
        },
        subjectIdentities: [],
        sourceCandidates,
        untrustedContent: [],
      });
      const outputFingerprint = this.#fingerprints.fingerprintExecutionOutput(result);
      const existingOutputCheckpoint =
        claim.latestCheckpoint?.kind === "OUTPUT_VALIDATED"
          ? claim.latestCheckpoint
          : null;
      if (
        existingOutputCheckpoint !== null &&
        (existingOutputCheckpoint.outputFingerprint !== outputFingerprint ||
          existingOutputCheckpoint.providerRunId !== handle.providerResponseId)
      ) {
        return failureOutcome({
          code: "discovery-output-replay-mismatch",
          category: "POLICY",
          phase: "VALIDATION",
          retryAfterMs: null,
          telemetry: {
            telemetryState: "COMPLETE",
            providerRunId: handle.providerResponseId,
            usage: execution.usage,
            cost: execution.cost,
          },
        });
      }
      try {
        if (existingOutputCheckpoint === null) {
          await workerInput.checkpoint({
            idempotencyKey: `${claim.attempt.id}:output-validated`,
            sequence: checkpointSequence + 1,
            kind: "OUTPUT_VALIDATED",
            completedUnits: 1,
            totalUnits: 1,
            providerRunId: handle.providerResponseId,
            resumeTokenFingerprint: fingerprintProviderResponseId(
              handle.providerResponseId,
            ),
            outputFingerprint,
          });
        }
      } catch (error) {
        if (workerInput.signal.aborted) throw error;
        return failureOutcome({
          code: "discovery-output-checkpoint-unavailable",
          category: "WORKER_INTERNAL",
          phase: "CHECKPOINT",
          retryAfterMs: 1_000,
          telemetry: {
            telemetryState: "COMPLETE",
            providerRunId: handle.providerResponseId,
            usage: execution.usage,
            cost: execution.cost,
          },
        });
      }
      return ResearchWorkerExecutionOutcomeSchema.parse({
        status: "COMPLETED",
        result,
        telemetry: {
          telemetryState: "COMPLETE",
          providerRunId: handle.providerResponseId,
          usage: execution.usage,
          cost: execution.cost,
        },
      });
    }

    return failureOutcome({
      code: "discovery-provider-still-pending",
      category: "TRANSIENT_UPSTREAM",
      phase: "EXTERNAL_CALL",
      retryAfterMs: this.#pollIntervalMs,
      telemetry: partialTelemetry(handle.providerResponseId),
    });
  }
}

export function createDiscoveryResearchStageExecutor(
  dependencies: DiscoveryResearchStageExecutorDependencies,
) {
  return new DiscoveryResearchStageExecutor(dependencies);
}
