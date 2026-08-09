import { describe, expect, it } from "vitest";
import {
  createSubmitDirectionService,
  type DirectionIdentifierKind,
  type DirectionPlanningPort,
  type SubmitDirectionResult,
} from "@/application/submit-direction";
import type { OutboxEvent } from "@/contracts/domain-events";
import {
  SUBMIT_DIRECTION_COMMAND,
  type CommitDirectionInput,
  type DirectionIdempotencyScope,
} from "@/core/ports/investigation-store";
import {
  BLACK_HAWK_DOWN_DIRECTION_COMMAND,
  BLACK_HAWK_DOWN_DIRECTION_PROPOSAL,
  BLACK_HAWK_DOWN_DIRECTION_SEED,
  BLACK_HAWK_DOWN_SPINE_IDS,
  BLACK_HAWK_DOWN_SPINE_TIME,
} from "@/fixtures/black-hawk-down/deterministic-spine.fixture";
import { MemoryInvestigationStore } from "@/infrastructure/persistence/memory-investigation-store";
import { Sha256DirectionFingerprint } from "@/infrastructure/security/sha256-direction-fingerprint";
import { afterFrameV1SpecialistRegistry } from "@/specialists/registry";

function deterministicIds() {
  const byKind: Record<DirectionIdentifierKind, string[]> = {
    direction: [BLACK_HAWK_DOWN_SPINE_IDS.direction],
    branch: [BLACK_HAWK_DOWN_SPINE_IDS.childBranch],
    provenance: [
      BLACK_HAWK_DOWN_SPINE_IDS.provenanceDirection,
      BLACK_HAWK_DOWN_SPINE_IDS.provenanceScope,
    ],
    domain_event: [
      BLACK_HAWK_DOWN_SPINE_IDS.directionEvent,
      BLACK_HAWK_DOWN_SPINE_IDS.branchEvent,
    ],
    outbox_event: [
      BLACK_HAWK_DOWN_SPINE_IDS.directionOutbox,
      BLACK_HAWK_DOWN_SPINE_IDS.branchOutbox,
    ],
  };

  return (kind: DirectionIdentifierKind) => {
    const id = byKind[kind].shift();
    if (id === undefined)
      throw new Error(`No deterministic ${kind} ID remains`);
    return id;
  };
}

async function produceValidResult(): Promise<SubmitDirectionResult> {
  const store = new MemoryInvestigationStore(BLACK_HAWK_DOWN_DIRECTION_SEED);
  const planner: DirectionPlanningPort = {
    identity: {
      kind: "DETERMINISTIC_FIXTURE",
      fixtureId: "black-hawk-down-direction-router",
      fixtureVersion: "1.0.0",
    },
    async proposeDirection() {
      return BLACK_HAWK_DOWN_DIRECTION_PROPOSAL;
    },
  };
  const submitDirection = createSubmitDirectionService({
    store,
    specialists: afterFrameV1SpecialistRegistry,
    planner,
    fingerprints: new Sha256DirectionFingerprint(),
    createId: deterministicIds(),
    now: () => BLACK_HAWK_DOWN_SPINE_TIME,
  });

  return submitDirection(
    BLACK_HAWK_DOWN_SPINE_IDS.owner,
    BLACK_HAWK_DOWN_DIRECTION_COMMAND,
  );
}

const scope: DirectionIdempotencyScope = {
  actorId: BLACK_HAWK_DOWN_SPINE_IDS.owner,
  commandName: SUBMIT_DIRECTION_COMMAND,
  idempotencyKey: BLACK_HAWK_DOWN_DIRECTION_COMMAND.idempotencyKey,
};

const requestFingerprint = new Sha256DirectionFingerprint().fingerprintCommand(
  BLACK_HAWK_DOWN_SPINE_IDS.owner,
  BLACK_HAWK_DOWN_DIRECTION_COMMAND,
);

async function commitInput(
  store: MemoryInvestigationStore,
  result: SubmitDirectionResult,
  reserve = true,
): Promise<CommitDirectionInput<OutboxEvent>> {
  let reservationToken = "missing-reservation";
  if (reserve) {
    const reservation = await store.reserveDirection({
      scope,
      requestFingerprint,
    });
    if (reservation.status !== "ACQUIRED") {
      throw new Error(`Expected ACQUIRED, received ${reservation.status}`);
    }
    reservationToken = reservation.reservationToken;
  }

  return {
    scope,
    requestFingerprint,
    reservationToken,
    expectedCaseVersion: BLACK_HAWK_DOWN_DIRECTION_COMMAND.expectedCaseVersion,
    result,
  };
}

function expectNoPartialWrite(store: MemoryInvestigationStore) {
  expect(store.directionCount).toBe(0);
  expect(store.provenanceCount).toBe(0);
  expect(store.outboxCount).toBe(0);
}

describe("memory investigation store adversarial atomicity", () => {
  it("rejects missing provenance", async () => {
    const valid = await produceValidResult();
    const store = new MemoryInvestigationStore(BLACK_HAWK_DOWN_DIRECTION_SEED);
    const input = await commitInput(store, {
      ...valid,
      provenanceEdges: valid.provenanceEdges.slice(0, 1),
    });

    await expect(store.commitDirection(input)).rejects.toMatchObject({
      code: "INVALID_ATOMIC_MUTATION",
    });
    expectNoPartialWrite(store);
  });

  it("rejects provenance wired to the wrong record", async () => {
    const valid = await produceValidResult();
    const store = new MemoryInvestigationStore(BLACK_HAWK_DOWN_DIRECTION_SEED);
    const [trigger, scopeEdge] = valid.provenanceEdges;
    if (trigger === undefined || scopeEdge === undefined) {
      throw new Error(
        "Golden direction result must contain two provenance edges",
      );
    }
    const input = await commitInput(store, {
      ...valid,
      provenanceEdges: [
        {
          ...trigger,
          input: {
            type: "DIRECTION" as const,
            id: BLACK_HAWK_DOWN_SPINE_IDS.rootBranch,
          },
        },
        scopeEdge,
      ],
    });

    await expect(store.commitDirection(input)).rejects.toMatchObject({
      code: "INVALID_ATOMIC_MUTATION",
    });
    expectNoPartialWrite(store);
  });

  it("rejects duplicate provenance IDs", async () => {
    const valid = await produceValidResult();
    const store = new MemoryInvestigationStore(BLACK_HAWK_DOWN_DIRECTION_SEED);
    const [first, second] = valid.provenanceEdges;
    if (first === undefined || second === undefined) {
      throw new Error(
        "Golden direction result must contain two provenance edges",
      );
    }
    const input = await commitInput(store, {
      ...valid,
      provenanceEdges: [first, { ...second, id: first.id }],
    });

    await expect(store.commitDirection(input)).rejects.toMatchObject({
      code: "IDENTIFIER_COLLISION",
    });
    expectNoPartialWrite(store);
  });

  it("rejects duplicate outbox IDs", async () => {
    const valid = await produceValidResult();
    const store = new MemoryInvestigationStore(BLACK_HAWK_DOWN_DIRECTION_SEED);
    const [first, second] = valid.outboxEvents;
    if (first === undefined || second === undefined) {
      throw new Error("Golden direction result must contain two outbox events");
    }
    const input = await commitInput(store, {
      ...valid,
      outboxEvents: [first, { ...second, id: first.id }],
    });

    await expect(store.commitDirection(input)).rejects.toMatchObject({
      code: "IDENTIFIER_COLLISION",
    });
    expectNoPartialWrite(store);
  });

  it("rejects duplicate domain-event IDs", async () => {
    const valid = await produceValidResult();
    const store = new MemoryInvestigationStore(BLACK_HAWK_DOWN_DIRECTION_SEED);
    const [first, second] = valid.outboxEvents;
    if (first === undefined || second === undefined) {
      throw new Error("Golden direction result must contain two outbox events");
    }
    const input = await commitInput(store, {
      ...valid,
      outboxEvents: [
        first,
        { ...second, event: { ...second.event, id: first.event.id } },
      ],
    });

    await expect(store.commitDirection(input)).rejects.toMatchObject({
      code: "IDENTIFIER_COLLISION",
    });
    expectNoPartialWrite(store);
  });

  it("rejects commit without an active reservation", async () => {
    const valid = await produceValidResult();
    const store = new MemoryInvestigationStore(BLACK_HAWK_DOWN_DIRECTION_SEED);
    const input = await commitInput(store, valid, false);

    await expect(store.commitDirection(input)).rejects.toMatchObject({
      code: "INVALID_ATOMIC_MUTATION",
    });
    expectNoPartialWrite(store);
  });

  it("rejects a direction mutation that rewrites immutable case input", async () => {
    const valid = await produceValidResult();
    const store = new MemoryInvestigationStore(BLACK_HAWK_DOWN_DIRECTION_SEED);
    const input = await commitInput(store, {
      ...valid,
      investigationCase: {
        ...valid.investigationCase,
        exactCuriosity: "A silently rewritten curiosity",
      },
    });

    await expect(store.commitDirection(input)).rejects.toMatchObject({
      code: "INVALID_ATOMIC_MUTATION",
    });
    expectNoPartialWrite(store);
  });

  it("rejects a direction mutation whose case clock moves backwards", async () => {
    const valid = await produceValidResult();
    const store = new MemoryInvestigationStore(BLACK_HAWK_DOWN_DIRECTION_SEED);
    const input = await commitInput(store, {
      ...valid,
      investigationCase: {
        ...valid.investigationCase,
        updatedAt: "2026-08-08T15:15:00.000Z",
      },
    });

    await expect(store.commitDirection(input)).rejects.toMatchObject({
      code: "INVALID_ATOMIC_MUTATION",
    });
    expectNoPartialWrite(store);
  });
});
