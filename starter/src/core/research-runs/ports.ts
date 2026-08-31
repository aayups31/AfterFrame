import type { InvestigationBranch } from "@/core/branches/schemas";
import type { InvestigationCase } from "@/core/cases/schemas";
import type {
  DeterministicResearchExecutorIdentity,
  ResearchJobRecord,
  ResearchRunBundle,
  ResearchRunRecord,
  ResearchScopePlanRecord,
  ResearchStage,
  ResearchStageExecutionResult,
} from "@/core/research-runs/schemas";
import type {
  ClaimedResearchJob,
  ResearchJobClaimResult,
  ResearchJobCompletionResult,
  ResearchJobFailureResult,
  ResearchJobHeartbeatResult,
  ResearchJobLeaseCursor,
  ResearchJobCheckpointResult,
  ResearchJobReleaseResult,
  ResearchWorkerCheckpointProposal,
  ResearchWorkerCheckpointRecord,
  ResearchWorkerExecutionCompletion,
  ResearchWorkerExecutionOutcome,
  ResearchWorkerExecutionPlan,
  ResearchWorkerExecutorIdentity,
  ResearchWorkerFailureEnvelope,
} from "@/core/research-runs/worker-schemas";
import type {
  ResearchProviderAcceptanceResult,
  ResearchProviderRunRecord,
} from "@/core/research-runs/provider-runs";
import type {
  DurableSourceResolutionRecord,
  SourceResolutionAcceptanceResult,
  StoredSourceResolutionRecord,
} from "@/core/research/source-resolution";
import type {
  DurableSourceRetrievalRecord,
  SourceRetrievalAcceptanceResult,
  StoredSourceRetrievalRecord,
} from "@/core/research/source-retrieval";

export const START_RESEARCH_RUN_COMMAND = "start_research_run" as const;

export type ResearchRunIdempotencyScope = Readonly<{
  actorId: string;
  commandName: typeof START_RESEARCH_RUN_COMMAND;
  idempotencyKey: string;
}>;

export type StoredResearchRunStart<TOutboxEvent = unknown> = Readonly<{
  bundle: ResearchRunBundle;
  outboxEvents: readonly TOutboxEvent[];
}>;

export type ResearchRunStartReservation<TOutboxEvent = unknown> =
  | Readonly<{ status: "ACQUIRED"; reservationToken: string }>
  | Readonly<{ status: "IN_PROGRESS" }>
  | Readonly<{
      status: "REPLAY";
      requestFingerprint: string;
      result: StoredResearchRunStart<TOutboxEvent>;
    }>;

export type ReserveResearchRunStartInput = Readonly<{
  scope: ResearchRunIdempotencyScope;
  requestFingerprint: string;
}>;

export type ReleaseResearchRunStartInput = ReserveResearchRunStartInput &
  Readonly<{ reservationToken: string }>;

export type CommitResearchRunStartInput<TOutboxEvent = unknown> = Readonly<{
  scope: ResearchRunIdempotencyScope;
  requestFingerprint: string;
  reservationToken: string;
  expectedCaseVersion: number;
  result: StoredResearchRunStart<TOutboxEvent>;
}>;

/**
 * Production adapters commit run, plan, all logical jobs, idempotency result,
 * and outbox events in one transaction. Reservation leases must expire.
 */
export interface ResearchRunStartStore<TOutboxEvent = unknown> {
  reserveResearchRunStart(
    input: ReserveResearchRunStartInput,
  ): Promise<ResearchRunStartReservation<TOutboxEvent>>;
  releaseResearchRunStart(
    input: ReleaseResearchRunStartInput,
  ): Promise<void>;
  commitResearchRunStart(
    input: CommitResearchRunStartInput<TOutboxEvent>,
  ): Promise<Readonly<{
    replayed: boolean;
    result: StoredResearchRunStart<TOutboxEvent>;
  }>>;
}

/** Authorization remains an application concern; adapters return full records. */
export interface ResearchContextReader {
  getCase(caseId: string): Promise<InvestigationCase | null>;
  getBranch(branchId: string): Promise<InvestigationBranch | null>;
}

export interface ResearchProviderRunReader {
  getAcceptedProviderRun(input: Readonly<{
    actorId: string;
    runId: string;
    jobId: string;
    attemptId: string;
  }>): Promise<ResearchProviderRunRecord | null>;
}

export interface ResearchRunFingerprintPort {
  fingerprintStartRequest(
    actorId: string,
    input: Readonly<{
      caseId: string;
      branchId: string | null;
      expectedCaseVersion: number;
      idempotencyKey: string;
    }>,
  ): string;
  fingerprintObjective(exactObjective: string): string;
  fingerprintPlan(plan: unknown): string;
  fingerprintStageInput(input: Readonly<{
    runId: string;
    stage: string;
    objectiveFingerprint: string;
    planFingerprint: string;
  }>): string;
  fingerprintAttemptRequest(
    runId: string,
    jobId: string,
    idempotencyKey: string,
  ): string;
  fingerprintExecutionOutput(output: unknown): string;
}

/**
 * Checkpoint-02 executor is deterministic and side-effect free. A live worker
 * uses narrower adapter ports after an attempt lease has durably committed.
 */
export interface DeterministicResearchStageExecutor {
  readonly identity: DeterministicResearchExecutorIdentity;
  execute(input: Readonly<{
    run: ResearchRunRecord;
    job: ResearchJobRecord;
    plan: ResearchScopePlanRecord;
    attemptId: string;
  }>): Promise<unknown>;
}

export type ClaimResearchJobInput = Readonly<{
  actorId: string;
  runId: string;
  jobId: string;
  stage: ResearchStage;
  expectedRunVersion: number;
  expectedJobVersion: number;
  idempotencyKey: string;
  attemptId: string;
  workerId: string;
  execution: ResearchWorkerExecutionPlan;
  leaseDurationSeconds: number;
}>;

export type HeartbeatResearchJobInput = Readonly<{
  actorId: string;
  lease: ResearchJobLeaseCursor;
  leaseDurationSeconds: number;
  occurredAt: string;
}>;

export type CheckpointResearchJobInput = Readonly<{
  actorId: string;
  lease: ResearchJobLeaseCursor;
  checkpoint: ResearchWorkerCheckpointRecord;
  leaseDurationSeconds: number;
}>;

export type AcceptResearchProviderRunInput = CheckpointResearchJobInput &
  Readonly<{ providerRun: ResearchProviderRunRecord }>;

export type AcceptSourceResolutionInput = Readonly<{
  actorId: string;
  lease: ResearchJobLeaseCursor;
  record: DurableSourceResolutionRecord;
  leaseDurationSeconds: number;
}>;

export type AcceptSourceRetrievalInput = Readonly<{
  actorId: string;
  lease: ResearchJobLeaseCursor;
  record: DurableSourceRetrievalRecord;
  leaseDurationSeconds: number;
}>;

export type CompleteDurableResearchJobInput = Readonly<{
  actorId: string;
  lease: ResearchJobLeaseCursor;
  idempotencyKey: string;
  result: ResearchStageExecutionResult;
  outputFingerprint: string;
  execution: ResearchWorkerExecutionCompletion;
}>;

export type FailDurableResearchJobInput = Readonly<{
  actorId: string;
  lease: ResearchJobLeaseCursor;
  idempotencyKey: string;
  failure: ResearchWorkerFailureEnvelope;
  execution: ResearchWorkerExecutionCompletion;
}>;

export type ReleaseResearchJobInput = FailDurableResearchJobInput;

/**
 * Every mutating method is implemented as a single token-fenced transaction.
 * In particular, claimResearchJob must persist the RUNNING attempt before it
 * returns CLAIMED; adapters must never emulate these operations with reads
 * followed by independent writes. An expired lease on a RUNNING attempt is
 * resumed with the same attempt, external idempotency key, and latest durable
 * checkpoint. A new attempt is legal only after the previous attempt has a
 * durably committed failure/release outcome.
 */
export interface DurableResearchWorkerStore {
  claimResearchJob(input: ClaimResearchJobInput): Promise<ResearchJobClaimResult>;
  heartbeatResearchJob(
    input: HeartbeatResearchJobInput,
  ): Promise<ResearchJobHeartbeatResult>;
  checkpointResearchJob(
    input: CheckpointResearchJobInput,
  ): Promise<ResearchJobCheckpointResult>;
  acceptResearchProviderRun(
    input: AcceptResearchProviderRunInput,
  ): Promise<ResearchProviderAcceptanceResult>;
  acceptSourceResolution(
    input: AcceptSourceResolutionInput,
  ): Promise<SourceResolutionAcceptanceResult>;
  acceptSourceRetrieval(
    input: AcceptSourceRetrievalInput,
  ): Promise<SourceRetrievalAcceptanceResult>;
  completeResearchJob(
    input: CompleteDurableResearchJobInput,
  ): Promise<ResearchJobCompletionResult>;
  failResearchJob(
    input: FailDurableResearchJobInput,
  ): Promise<ResearchJobFailureResult>;
  releaseResearchJob(
    input: ReleaseResearchJobInput,
  ): Promise<ResearchJobReleaseResult>;
}

export type DurableResearchStageExecutionInput = Readonly<{
  actorId: string;
  claim: ClaimedResearchJob;
  /** Must be forwarded to providers that support request idempotency. */
  externalIdempotencyKey: string;
  signal: AbortSignal;
  checkpoint: (
    checkpoint: ResearchWorkerCheckpointProposal,
  ) => Promise<ResearchWorkerCheckpointRecord>;
  acceptProviderRun: (
    checkpoint: ResearchWorkerCheckpointProposal,
    providerRun: ResearchProviderRunRecord,
  ) => Promise<ResearchWorkerCheckpointRecord>;
  /** Serialized with heartbeat and all other lease-fenced mutations. */
  acceptSourceResolution?: (
    record: DurableSourceResolutionRecord,
  ) => Promise<StoredSourceResolutionRecord>;
  /** Serialized hostile-source receipt acceptance for NORMALIZATION only. */
  acceptSourceRetrieval?: (
    record: DurableSourceRetrievalRecord,
  ) => Promise<StoredSourceRetrievalRecord>;
}>;

/** External adapters sit behind this port; the application worker calls no provider directly. */
export interface DurableResearchStageExecutor {
  readonly identity: ResearchWorkerExecutorIdentity;
  execute(input: DurableResearchStageExecutionInput): Promise<ResearchWorkerExecutionOutcome>;
}

export interface DurableResearchStageExecutorRegistry {
  resolve(stage: ResearchStage): DurableResearchStageExecutor | null;
}
