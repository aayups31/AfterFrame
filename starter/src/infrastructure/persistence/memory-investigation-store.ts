import { OutboxEventSchema, type OutboxEvent } from "@/contracts/domain-events";
import {
  DirectionEventSchema,
  InvestigationBranchSchema,
  isChildBranchRouteCoherent,
  isRequestedChildBranchActionSatisfied,
  type DirectionEvent,
  type InvestigationBranch,
} from "@/core/branches/schemas";
import {
  InvestigationCaseSchema,
  type InvestigationCase,
} from "@/core/cases/schemas";
import {
  InvestigationStoreError,
  type CommitDirectionInput,
  type CommitDirectionOutcome,
  type DirectionIdempotencyScope,
  type DirectionReservationInput,
  type DirectionReservationOutcome,
  type InvestigationStore,
  type ReleaseDirectionReservationInput,
  type StoredDirectionReplay,
} from "@/core/ports/investigation-store";
import {
  ProvenanceEdgeSchema,
  type ProvenanceEdge,
} from "@/core/provenance/schemas";
import { Sha256Schema } from "@/core/shared/schemas";

export type MemoryInvestigationSeed = Readonly<{
  cases: readonly InvestigationCase[];
  branches: readonly InvestigationBranch[];
}>;

function copy<T>(value: T): T {
  return structuredClone(value);
}

function scopeKey(scope: DirectionIdempotencyScope): string {
  return JSON.stringify([
    scope.actorId,
    scope.commandName,
    scope.idempotencyKey,
  ]);
}

/**
 * Deterministic test adapter. It models the atomic contract required from the
 * future Postgres adapter; it is not shared process persistence.
 */
export class MemoryInvestigationStore
  implements InvestigationStore<OutboxEvent>
{
  readonly #cases = new Map<string, InvestigationCase>();
  readonly #branches = new Map<string, InvestigationBranch>();
  readonly #directions = new Map<string, DirectionEvent>();
  readonly #provenance = new Map<string, ProvenanceEdge>();
  readonly #outbox = new Map<string, OutboxEvent>();
  readonly #domainEventIds = new Set<string>();
  readonly #idempotency = new Map<string, StoredDirectionReplay<OutboxEvent>>();
  readonly #reservations = new Map<
    string,
    Readonly<{ requestFingerprint: string; reservationToken: string }>
  >();
  #reservationSequence = 0;

  constructor(seed: MemoryInvestigationSeed) {
    for (const investigationCase of seed.cases) {
      const parsed = InvestigationCaseSchema.parse(investigationCase);
      this.#cases.set(parsed.id, copy(parsed));
    }
    for (const branch of seed.branches) {
      const parsed = InvestigationBranchSchema.parse(branch);
      this.#branches.set(parsed.id, copy(parsed));
    }
  }

  async getCase(caseId: string): Promise<InvestigationCase | null> {
    const investigationCase = this.#cases.get(caseId);
    return investigationCase === undefined ? null : copy(investigationCase);
  }

  async getBranch(branchId: string): Promise<InvestigationBranch | null> {
    const branch = this.#branches.get(branchId);
    return branch === undefined ? null : copy(branch);
  }

  async reserveDirection(
    input: DirectionReservationInput,
  ): Promise<DirectionReservationOutcome<OutboxEvent>> {
    const key = scopeKey(input.scope);
    const fingerprint = Sha256Schema.parse(input.requestFingerprint);
    const replay = this.#idempotency.get(key);
    if (replay !== undefined) {
      if (replay.requestFingerprint !== fingerprint) {
        throw new InvestigationStoreError(
          "IDEMPOTENCY_KEY_REUSED",
          "The idempotency key already identifies a different request",
        );
      }
      return { status: "REPLAY", replay: copy(replay) };
    }

    const reservation = this.#reservations.get(key);
    if (reservation !== undefined) {
      if (reservation.requestFingerprint !== fingerprint) {
        throw new InvestigationStoreError(
          "IDEMPOTENCY_KEY_REUSED",
          "The idempotency key is in progress for a different request",
        );
      }
      return { status: "IN_PROGRESS" };
    }

    this.#reservationSequence += 1;
    const reservationToken = `memory-reservation:${this.#reservationSequence}`;
    this.#reservations.set(key, {
      requestFingerprint: fingerprint,
      reservationToken,
    });
    return { status: "ACQUIRED", reservationToken };
  }

  async releaseDirectionReservation(
    input: ReleaseDirectionReservationInput,
  ): Promise<void> {
    const key = scopeKey(input.scope);
    const reservation = this.#reservations.get(key);
    if (
      reservation?.requestFingerprint === input.requestFingerprint &&
      reservation.reservationToken === input.reservationToken
    ) {
      this.#reservations.delete(key);
    }
  }

  async commitDirection(
    input: CommitDirectionInput<OutboxEvent>,
  ): Promise<CommitDirectionOutcome<OutboxEvent>> {
    const key = scopeKey(input.scope);
    const fingerprint = Sha256Schema.parse(input.requestFingerprint);
    const existing = this.#idempotency.get(key);

    if (existing !== undefined) {
      if (existing.requestFingerprint !== fingerprint) {
        throw new InvestigationStoreError(
          "IDEMPOTENCY_KEY_REUSED",
          "The idempotency key already identifies a different request",
        );
      }
      return { replayed: true, result: copy(existing.result) };
    }

    const reservation = this.#reservations.get(key);
    if (
      reservation?.requestFingerprint !== fingerprint ||
      reservation.reservationToken !== input.reservationToken
    ) {
      throw new InvestigationStoreError(
        "INVALID_ATOMIC_MUTATION",
        "Direction commit requires the matching active reservation",
      );
    }

    const currentCase = this.#cases.get(input.result.investigationCase.id);
    if (
      currentCase === undefined ||
      currentCase.aggregateVersion !== input.expectedCaseVersion
    ) {
      throw new InvestigationStoreError(
        "CASE_VERSION_CONFLICT",
        `Case version changed before direction commit`,
      );
    }

    const nextCase = InvestigationCaseSchema.parse(
      input.result.investigationCase,
    );
    const direction = DirectionEventSchema.parse(input.result.direction);
    const proposedBranch = InvestigationBranchSchema.parse(
      input.result.proposedBranch,
    );
    const provenanceEdges = input.result.provenanceEdges.map((edge) =>
      ProvenanceEdgeSchema.parse(edge),
    );
    const outboxEvents = input.result.outboxEvents.map((event) =>
      OutboxEventSchema.parse(event),
    );

    const sourceBranch = this.#branches.get(direction.sourceBranchId);
    const directionOutbox = outboxEvents[0];
    const branchOutbox = outboxEvents[1];
    const eventAnchorMatches =
      (direction.anchor === null &&
        directionOutbox?.event.type === "direction.submitted" &&
        directionOutbox.event.payload.anchor === null) ||
      (direction.anchor !== null &&
        directionOutbox?.event.type === "direction.submitted" &&
        directionOutbox.event.payload.anchor !== null &&
        (directionOutbox.event.payload.anchor.beatId ?? null) ===
          direction.anchor.beatId &&
        (directionOutbox.event.payload.anchor.evidenceId ?? null) ===
          direction.anchor.evidenceId);
    const requiredProvenance =
      provenanceEdges.length === 2 &&
      provenanceEdges.some(
        (edge) =>
          edge.output.type === "BRANCH" &&
          edge.output.id === proposedBranch.id &&
          edge.input.type === "DIRECTION" &&
          edge.input.id === direction.id &&
          edge.relationship === "TRIGGERED_BY",
      ) &&
      provenanceEdges.some(
        (edge) =>
          edge.output.type === "DIRECTION" &&
          edge.output.id === direction.id &&
          edge.input.type === "BRANCH" &&
          edge.input.id === direction.sourceBranchId &&
          edge.relationship === "SCOPED_TO",
      );
    const requiredEvents =
      outboxEvents.length === 2 &&
      directionOutbox?.event.type === "direction.submitted" &&
      directionOutbox.event.payload.directionId === direction.id &&
      directionOutbox.event.payload.sourceBranchId ===
        direction.sourceBranchId &&
      directionOutbox.event.payload.requestedAction ===
        direction.requestedAction.toLowerCase() &&
      eventAnchorMatches &&
      branchOutbox?.event.type === "branch.proposed" &&
      branchOutbox.event.payload.branchId === proposedBranch.id &&
      branchOutbox.event.payload.parentBranchId === direction.sourceBranchId &&
      branchOutbox.event.payload.originDirectionId === direction.id;
    const hasConsistentReferences =
      nextCase.id === currentCase.id &&
      currentCase.ownerId === input.scope.actorId &&
      nextCase.ownerId === input.scope.actorId &&
      nextCase.specialistId === currentCase.specialistId &&
      nextCase.specialistVersion === currentCase.specialistVersion &&
      nextCase.subjectRef.type === currentCase.subjectRef.type &&
      nextCase.subjectRef.id === currentCase.subjectRef.id &&
      nextCase.subjectRef.versionId === currentCase.subjectRef.versionId &&
      nextCase.exactCuriosity === currentCase.exactCuriosity &&
      nextCase.status === currentCase.status &&
      nextCase.health === currentCase.health &&
      nextCase.createdAt === currentCase.createdAt &&
      new Date(nextCase.updatedAt).getTime() >=
        new Date(currentCase.updatedAt).getTime() &&
      nextCase.aggregateVersion === currentCase.aggregateVersion + 1 &&
      nextCase.eventSequence ===
        currentCase.eventSequence + outboxEvents.length &&
      nextCase.activeBranchId === proposedBranch.id &&
      direction.caseId === currentCase.id &&
      direction.actorId === input.scope.actorId &&
      sourceBranch !== undefined &&
      sourceBranch.caseId === currentCase.id &&
      proposedBranch.caseId === currentCase.id &&
      proposedBranch.parentBranchId === sourceBranch.id &&
      proposedBranch.originDirectionId === direction.id &&
      proposedBranch.createdAt === nextCase.updatedAt &&
      proposedBranch.updatedAt === nextCase.updatedAt &&
      direction.createdAt === nextCase.updatedAt &&
      proposedBranch.status === "PROPOSED" &&
      proposedBranch.aggregateVersion === 0 &&
      direction.requestedAction !== "RETURN" &&
      isChildBranchRouteCoherent({
        directionType: direction.directionType,
        branchAction: direction.branchAction,
        branchKind: proposedBranch.kind,
      }) &&
      isRequestedChildBranchActionSatisfied({
        requestedAction: direction.requestedAction,
        directionType: direction.directionType,
        branchAction: direction.branchAction,
        branchKind: proposedBranch.kind,
      }) &&
      requiredProvenance &&
      requiredEvents &&
      provenanceEdges.every((edge) => edge.caseId === currentCase.id) &&
      outboxEvents.every(
        ({ event }, index) =>
          event.aggregateId === currentCase.id &&
          event.aggregateVersion === nextCase.aggregateVersion &&
          event.sequence === currentCase.eventSequence + index + 1 &&
          event.occurredAt === nextCase.updatedAt &&
          outboxEvents[index]?.recordedAt === nextCase.updatedAt,
      );

    if (!hasConsistentReferences) {
      throw new InvestigationStoreError(
        "INVALID_ATOMIC_MUTATION",
        "Direction mutation failed aggregate and reference invariants",
      );
    }

    const hasUniqueBatchIds =
      new Set(provenanceEdges.map((edge) => edge.id)).size ===
        provenanceEdges.length &&
      new Set(outboxEvents.map((event) => event.id)).size ===
        outboxEvents.length &&
      new Set(outboxEvents.map((event) => event.event.id)).size ===
        outboxEvents.length;
    if (!hasUniqueBatchIds) {
      throw new InvestigationStoreError(
        "IDENTIFIER_COLLISION",
        "A direction mutation contains duplicate generated identifiers",
      );
    }

    const identifiers = [
      [this.#directions, direction.id],
      [this.#branches, proposedBranch.id],
      ...provenanceEdges.map((edge) => [this.#provenance, edge.id] as const),
      ...outboxEvents.map((event) => [this.#outbox, event.id] as const),
    ] as const;
    if (identifiers.some(([records, id]) => records.has(id))) {
      throw new InvestigationStoreError(
        "IDENTIFIER_COLLISION",
        "A generated record identifier already exists",
      );
    }
    if (
      outboxEvents.some((event) => this.#domainEventIds.has(event.event.id))
    ) {
      throw new InvestigationStoreError(
        "IDENTIFIER_COLLISION",
        "A generated domain-event identifier already exists",
      );
    }

    // No asynchronous boundary occurs below this line: the mutation is atomic
    // within this deterministic adapter.
    this.#cases.set(nextCase.id, copy(nextCase));
    this.#directions.set(direction.id, copy(direction));
    this.#branches.set(proposedBranch.id, copy(proposedBranch));
    for (const edge of provenanceEdges)
      this.#provenance.set(edge.id, copy(edge));
    for (const event of outboxEvents) {
      this.#outbox.set(event.id, copy(event));
      this.#domainEventIds.add(event.event.id);
    }

    const result = copy({
      investigationCase: nextCase,
      direction,
      proposedBranch,
      provenanceEdges,
      outboxEvents,
    });
    this.#idempotency.set(key, {
      requestFingerprint: fingerprint,
      result,
    });
    this.#reservations.delete(key);

    return { replayed: false, result: copy(result) };
  }

  get directionCount(): number {
    return this.#directions.size;
  }

  get provenanceCount(): number {
    return this.#provenance.size;
  }

  get outboxCount(): number {
    return this.#outbox.size;
  }

  listOutboxEvents(): readonly OutboxEvent[] {
    return [...this.#outbox.values()]
      .sort((left, right) => left.event.sequence - right.event.sequence)
      .map(copy);
  }
}
