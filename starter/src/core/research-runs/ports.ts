import type { InvestigationBranch } from "@/core/branches/schemas";
import type { InvestigationCase } from "@/core/cases/schemas";
import type {
  DeterministicResearchExecutorIdentity,
  ResearchJobRecord,
  ResearchRunBundle,
  ResearchRunRecord,
  ResearchScopePlanRecord,
} from "@/core/research-runs/schemas";

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
