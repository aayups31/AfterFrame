import type {
  DirectionEvent,
  InvestigationBranch,
} from "@/core/branches/schemas";
import type { InvestigationCase } from "@/core/cases/schemas";
import type { ProvenanceEdge } from "@/core/provenance/schemas";

export const SUBMIT_DIRECTION_COMMAND = "submit_direction" as const;

export type DirectionIdempotencyScope = Readonly<{
  actorId: string;
  commandName: typeof SUBMIT_DIRECTION_COMMAND;
  idempotencyKey: string;
}>;

export type StoredDirectionResult<TOutboxEvent = unknown> = Readonly<{
  investigationCase: InvestigationCase;
  direction: DirectionEvent;
  proposedBranch: InvestigationBranch;
  provenanceEdges: readonly ProvenanceEdge[];
  outboxEvents: readonly TOutboxEvent[];
}>;

export type StoredDirectionReplay<TOutboxEvent = unknown> = Readonly<{
  requestFingerprint: string;
  result: StoredDirectionResult<TOutboxEvent>;
}>;

export type DirectionReservationOutcome<TOutboxEvent = unknown> =
  | Readonly<{ status: "ACQUIRED"; reservationToken: string }>
  | Readonly<{ status: "IN_PROGRESS" }>
  | Readonly<{
      status: "REPLAY";
      replay: StoredDirectionReplay<TOutboxEvent>;
    }>;

export type DirectionReservationInput = Readonly<{
  scope: DirectionIdempotencyScope;
  requestFingerprint: string;
}>;

export type ReleaseDirectionReservationInput = DirectionReservationInput &
  Readonly<{ reservationToken: string }>;

export type CommitDirectionInput<TOutboxEvent = unknown> = Readonly<{
  scope: DirectionIdempotencyScope;
  requestFingerprint: string;
  reservationToken: string;
  expectedCaseVersion: number;
  result: StoredDirectionResult<TOutboxEvent>;
}>;

export type CommitDirectionOutcome<TOutboxEvent = unknown> = Readonly<{
  replayed: boolean;
  result: StoredDirectionResult<TOutboxEvent>;
}>;

/**
 * Persistence must implement commitDirection as one transaction: optimistic
 * case update, immutable direction, child branch, provenance, idempotency
 * result, and every outbox event either all commit or none do.
 */
export interface InvestigationStore<TOutboxEvent = unknown> {
  getCase(caseId: string): Promise<InvestigationCase | null>;
  getBranch(branchId: string): Promise<InvestigationBranch | null>;
  /** Production adapters must make this an atomic, expiring lease. */
  reserveDirection(
    input: DirectionReservationInput,
  ): Promise<DirectionReservationOutcome<TOutboxEvent>>;
  releaseDirectionReservation(
    input: ReleaseDirectionReservationInput,
  ): Promise<void>;
  commitDirection(
    input: CommitDirectionInput<TOutboxEvent>,
  ): Promise<CommitDirectionOutcome<TOutboxEvent>>;
}

export type InvestigationStoreErrorCode =
  | "CASE_VERSION_CONFLICT"
  | "IDEMPOTENCY_KEY_REUSED"
  | "IDENTIFIER_COLLISION"
  | "INVALID_ATOMIC_MUTATION";

export class InvestigationStoreError extends Error {
  constructor(
    readonly code: InvestigationStoreErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "InvestigationStoreError";
  }
}
