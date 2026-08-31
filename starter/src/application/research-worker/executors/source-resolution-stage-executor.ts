import { createHash } from "node:crypto";
import type {
  DurableSourceResolutionContextReader,
  DurableSourceResolutionRecordReader,
  SourceCandidateResolver,
} from "@/application/research/source-resolution-port";
import type {
  DurableResearchStageExecutionInput,
  DurableResearchStageExecutor,
  ResearchRunFingerprintPort,
} from "@/core/research-runs/ports";
import { ResearchStageExecutionResultSchema } from "@/core/research-runs/schemas";
import {
  ClaimedResearchJobSchema,
  ResearchWorkerExecutionOutcomeSchema,
  ResearchWorkerExecutionPlanSchema,
  ResearchWorkerExecutorIdentitySchema,
  ResearchWorkerFailureEnvelopeSchema,
  type ResearchWorkerExecutionOutcome,
  type ResearchWorkerExecutionPlan,
  type ResearchWorkerExecutionTelemetry,
} from "@/core/research-runs/worker-schemas";
import {
  DurableSourceResolutionContextSchema,
  DurableSourceResolutionRecordSchema,
  StoredSourceResolutionRecordSchema,
  type StoredSourceResolutionRecord,
} from "@/core/research/source-resolution";
import { EntityIdSchema, IsoDateTimeSchema } from "@/core/shared/schemas";

export type SourceResolutionStageExecutorDependencies = Readonly<{
  context: DurableSourceResolutionContextReader;
  records: DurableSourceResolutionRecordReader;
  resolver: SourceCandidateResolver;
  fingerprints: ResearchRunFingerprintPort;
  execution: ResearchWorkerExecutionPlan;
  now: () => string;
  maxCandidatesPerExecution?: number;
}>;

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

function latestTime(...values: readonly string[]) {
  return values
    .map((value) => IsoDateTimeSchema.parse(value))
    .reduce((latest, candidate) =>
      new Date(candidate).getTime() > new Date(latest).getTime()
        ? candidate
        : latest,
    );
}

function unavailableTelemetry(): ResearchWorkerExecutionTelemetry {
  return {
    telemetryState: "UNAVAILABLE",
    providerRunId: null,
    usage: null,
    cost: null,
  };
}

function measuredTelemetry(toolCalls: number): ResearchWorkerExecutionTelemetry {
  return {
    telemetryState: "COMPLETE",
    providerRunId: null,
    usage: {
      inputTokens: 0,
      outputTokens: 0,
      toolCalls,
      inputBytes: 0,
      outputBytes: 0,
    },
    cost: {
      currency: "USD",
      pricingState: "UNPRICED",
      amountMicros: null,
    },
  };
}

function failureOutcome(input: Readonly<{
  code: string;
  category: "TRANSIENT_UPSTREAM" | "POLICY" | "WORKER_INTERNAL";
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

function candidateId(record: StoredSourceResolutionRecord) {
  return record.result.status === "RESOLVED"
    ? record.result.proposal.candidateId
    : record.result.candidateId;
}

/**
 * Resumable, body-free candidate resolver. Each decision is accepted through
 * the worker's serialized lease boundary before it can contribute to output.
 */
export class SourceResolutionStageExecutor
  implements DurableResearchStageExecutor
{
  readonly identity;
  readonly #context: DurableSourceResolutionContextReader;
  readonly #records: DurableSourceResolutionRecordReader;
  readonly #resolver: SourceCandidateResolver;
  readonly #fingerprints: ResearchRunFingerprintPort;
  readonly #now: () => string;
  readonly #maxCandidatesPerExecution: number;

  constructor(dependencies: SourceResolutionStageExecutorDependencies) {
    const execution = ResearchWorkerExecutionPlanSchema.parse(
      dependencies.execution,
    );
    if (
      execution.executionKind !== "RESOLVER" ||
      execution.tool?.id !== "http-source-metadata" ||
      execution.privateContentIncluded ||
      execution.automaticRetrySafety !== "IDEMPOTENT_PROVIDER_REQUEST"
    ) {
      throw new Error(
        "Source resolution requires the body-free idempotent metadata resolver plan",
      );
    }
    const maxCandidates = dependencies.maxCandidatesPerExecution ?? 20;
    if (
      !Number.isInteger(maxCandidates) ||
      maxCandidates < 1 ||
      maxCandidates > 500
    ) {
      throw new Error("Source-resolution execution budget is invalid");
    }
    this.identity = ResearchWorkerExecutorIdentitySchema.parse({
      stage: "RESOLUTION",
      execution,
    });
    this.#context = dependencies.context;
    this.#records = dependencies.records;
    this.#resolver = dependencies.resolver;
    this.#fingerprints = dependencies.fingerprints;
    this.#now = dependencies.now;
    this.#maxCandidatesPerExecution = maxCandidates;
  }

  async execute(
    workerInput: DurableResearchStageExecutionInput,
  ): Promise<ResearchWorkerExecutionOutcome> {
    const parsedClaim = ClaimedResearchJobSchema.safeParse(workerInput.claim);
    if (!parsedClaim.success || parsedClaim.data.job.stage !== "RESOLUTION") {
      return failureOutcome({
        code: "resolution-claim-invalid",
        category: "POLICY",
        phase: "PREPARATION",
        retryAfterMs: null,
        telemetry: unavailableTelemetry(),
      });
    }
    if (workerInput.acceptSourceResolution === undefined) {
      return failureOutcome({
        code: "resolution-acceptance-boundary-unavailable",
        category: "POLICY",
        phase: "PREPARATION",
        retryAfterMs: null,
        telemetry: unavailableTelemetry(),
      });
    }
    const claim = parsedClaim.data;
    let contextValue: unknown;
    let acceptedValue: unknown;
    try {
      [contextValue, acceptedValue] = await Promise.all([
        this.#context.getResolutionContext({
          actorId: workerInput.actorId,
          runId: claim.run.id,
          jobId: claim.job.id,
          attemptId: claim.attempt.id,
        }),
        this.#records.listAcceptedResolutions({
          actorId: workerInput.actorId,
          runId: claim.run.id,
          jobId: claim.job.id,
          attemptId: claim.attempt.id,
        }),
      ]);
    } catch {
      return failureOutcome({
        code: "resolution-recovery-unavailable",
        category: "TRANSIENT_UPSTREAM",
        phase: "PREPARATION",
        retryAfterMs: 1_000,
        telemetry: unavailableTelemetry(),
      });
    }
    const context = DurableSourceResolutionContextSchema.safeParse(contextValue);
    const accepted = StoredSourceResolutionRecordSchema.array().safeParse(
      acceptedValue,
    );
    if (
      !context.success ||
      !accepted.success ||
      context.data.runId !== claim.run.id ||
      context.data.jobId !== claim.job.id ||
      context.data.attemptId !== claim.attempt.id ||
      context.data.caseId !== claim.run.caseId ||
      context.data.manifestFingerprint !==
        claim.inputManifest.manifestFingerprint ||
      claim.inputManifest.manifest.stage !== "RESOLUTION"
    ) {
      return failureOutcome({
        code: "resolution-recovery-mismatch",
        category: "POLICY",
        phase: "VALIDATION",
        retryAfterMs: null,
        telemetry: unavailableTelemetry(),
      });
    }
    const candidates = new Map(
      context.data.candidates.map((candidate) => [candidate.id, candidate]),
    );
    const acceptedByCandidate = new Map<string, StoredSourceResolutionRecord>();
    for (const record of accepted.data) {
      const id = candidateId(record);
      if (
        !candidates.has(id) ||
        acceptedByCandidate.has(id) ||
        record.runId !== claim.run.id ||
        record.jobId !== claim.job.id ||
        record.attemptId !== claim.attempt.id ||
        record.caseId !== claim.run.caseId ||
        record.manifestFingerprint !== context.data.manifestFingerprint ||
        record.resolver.id !== this.identity.execution.tool?.id ||
        record.resolver.version !== this.identity.execution.tool.version
      ) {
        return failureOutcome({
          code: "resolution-ledger-invariant",
          category: "POLICY",
          phase: "VALIDATION",
          retryAfterMs: null,
          telemetry: unavailableTelemetry(),
        });
      }
      acceptedByCandidate.set(id, record);
    }

    const pending = context.data.candidates.filter(
      (candidate) => !acceptedByCandidate.has(candidate.id),
    );
    const scheduled = pending.slice(0, this.#maxCandidatesPerExecution);
    let toolCalls = 0;
    for (const candidate of scheduled) {
      if (workerInput.signal.aborted) throw workerInput.signal.reason;
      let result;
      try {
        result = await this.#resolver.resolve(
          {
            schemaVersion: 1,
            runId: claim.run.id,
            jobId: claim.job.id,
            attemptId: claim.attempt.id,
            caseId: claim.run.caseId,
            manifestFingerprint: context.data.manifestFingerprint,
            candidate,
          },
          workerInput.signal,
        );
        toolCalls += 1;
      } catch (error) {
        if (workerInput.signal.aborted) throw error;
        return failureOutcome({
          code: "resolution-resolver-unavailable",
          category: "TRANSIENT_UPSTREAM",
          phase: "EXTERNAL_CALL",
          retryAfterMs: 1_000,
          telemetry: measuredTelemetry(toolCalls),
        });
      }
      const resultCandidateId =
        result.status === "RESOLVED"
          ? result.proposal.candidateId
          : result.candidateId;
      if (resultCandidateId !== candidate.id) {
        return failureOutcome({
          code: "resolution-result-candidate-mismatch",
          category: "POLICY",
          phase: "VALIDATION",
          retryAfterMs: null,
          telemetry: measuredTelemetry(toolCalls),
        });
      }
      const sourceTimes =
        result.status === "RESOLVED"
          ? [result.proposal.source.createdAt, result.proposal.locator.createdAt]
          : [];
      const record = DurableSourceResolutionRecordSchema.parse({
        schemaVersion: 1,
        id: deterministicEntityId(
          "source-resolution-record",
          claim.attempt.id,
          candidate.id,
        ),
        runId: claim.run.id,
        jobId: claim.job.id,
        attemptId: claim.attempt.id,
        caseId: claim.run.caseId,
        manifestFingerprint: context.data.manifestFingerprint,
        idempotencyKey: `${claim.attempt.id}:resolve:${candidate.id}`,
        resolver: this.identity.execution.tool,
        result,
        createdAt: latestTime(
          claim.attempt.startedAt,
          this.#now(),
          ...sourceTimes,
        ),
      });
      let stored: StoredSourceResolutionRecord;
      try {
        stored = await workerInput.acceptSourceResolution(record);
      } catch (error) {
        if (workerInput.signal.aborted) throw error;
        return failureOutcome({
          code: "resolution-acceptance-uncertain",
          category: "WORKER_INTERNAL",
          phase: "CHECKPOINT",
          retryAfterMs: null,
          telemetry: measuredTelemetry(toolCalls),
        });
      }
      acceptedByCandidate.set(candidate.id, stored);
    }

    if (acceptedByCandidate.size < context.data.candidates.length) {
      return failureOutcome({
        code: "resolution-execution-budget-reached",
        category: "TRANSIENT_UPSTREAM",
        phase: "EXTERNAL_CALL",
        retryAfterMs: 100,
        telemetry: measuredTelemetry(toolCalls),
      });
    }

    const ordered = context.data.candidates.map((candidate) => {
      const record = acceptedByCandidate.get(candidate.id);
      if (record === undefined) {
        throw new Error("resolution-ledger-partition-incomplete");
      }
      return record;
    });
    const sourceIds: string[] = [];
    const locatorIds: string[] = [];
    const unresolvedCandidateIds: string[] = [];
    const seenSourceIds = new Set<string>();
    const seenLocatorIds = new Set<string>();
    for (const record of ordered) {
      if (record.result.status === "RESOLVED") {
        const sourceId = record.result.proposal.source.id;
        const locatorId = record.result.proposal.locator.id;
        if (!seenSourceIds.has(sourceId)) sourceIds.push(sourceId);
        if (!seenLocatorIds.has(locatorId)) locatorIds.push(locatorId);
        seenSourceIds.add(sourceId);
        seenLocatorIds.add(locatorId);
      } else {
        unresolvedCandidateIds.push(record.result.candidateId);
      }
    }
    const createdAt = latestTime(
      claim.attempt.startedAt,
      ...ordered.map((record) => record.createdAt),
    );
    const result = ResearchStageExecutionResultSchema.parse({
      outcome: unresolvedCandidateIds.length === 0 ? "SUCCEEDED" : "DEGRADED",
      boundedReasonCodes:
        unresolvedCandidateIds.length === 0
          ? []
          : ["source-candidates-unresolved"],
      output: {
        schemaVersion: 1,
        id: deterministicEntityId("source-resolution-output", claim.attempt.id),
        runId: claim.run.id,
        jobId: claim.job.id,
        attemptId: claim.attempt.id,
        kind: "RESOLUTION_RESULT",
        stage: "RESOLUTION",
        sourceIds,
        locatorIds,
        unresolvedCandidateIds,
        reviewState: "PROPOSED",
        publicationAuthority: "NONE",
        provenanceInputs: [
          { recordType: "JOB", recordId: claim.job.id },
          { recordType: "ATTEMPT", recordId: claim.attempt.id },
        ],
        createdAt,
      },
      subjectIdentities: [],
      sourceCandidates: [],
      untrustedContent: [],
    });
    const outputFingerprint = this.#fingerprints.fingerprintExecutionOutput(result);
    const existingOutputCheckpoint =
      claim.latestCheckpoint?.kind === "OUTPUT_VALIDATED"
        ? claim.latestCheckpoint
        : null;
    if (
      existingOutputCheckpoint !== null &&
      existingOutputCheckpoint.outputFingerprint !== outputFingerprint
    ) {
      return failureOutcome({
        code: "resolution-output-replay-mismatch",
        category: "POLICY",
        phase: "VALIDATION",
        retryAfterMs: null,
        telemetry: measuredTelemetry(toolCalls),
      });
    }
    if (existingOutputCheckpoint === null) {
      try {
        await workerInput.checkpoint({
          idempotencyKey: `${claim.attempt.id}:output-validated`,
          sequence: (claim.latestCheckpoint?.sequence ?? 0) + 1,
          kind: "OUTPUT_VALIDATED",
          completedUnits: ordered.length,
          totalUnits: ordered.length === 0 ? null : ordered.length,
          providerRunId: null,
          resumeTokenFingerprint: null,
          outputFingerprint,
        });
      } catch (error) {
        if (workerInput.signal.aborted) throw error;
        return failureOutcome({
          code: "resolution-output-checkpoint-unavailable",
          category: "WORKER_INTERNAL",
          phase: "CHECKPOINT",
          retryAfterMs: 1_000,
          telemetry: measuredTelemetry(toolCalls),
        });
      }
    }
    return ResearchWorkerExecutionOutcomeSchema.parse({
      status: "COMPLETED",
      result,
      telemetry: measuredTelemetry(toolCalls),
    });
  }
}

export function createSourceResolutionStageExecutor(
  dependencies: SourceResolutionStageExecutorDependencies,
) {
  return new SourceResolutionStageExecutor(dependencies);
}
