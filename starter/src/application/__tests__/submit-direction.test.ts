import { describe, expect, it } from "vitest";
import {
  createSubmitDirectionService,
  type DirectionIdentifierKind,
  type DirectionPlanningPort,
} from "@/application/submit-direction";
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

function setup(proposal: unknown = BLACK_HAWK_DOWN_DIRECTION_PROPOSAL) {
  const store = new MemoryInvestigationStore(BLACK_HAWK_DOWN_DIRECTION_SEED);
  let plannerCalls = 0;
  const planner: DirectionPlanningPort = {
    identity: {
      kind: "DETERMINISTIC_FIXTURE",
      fixtureId: "black-hawk-down-direction-router",
      fixtureVersion: "1.0.0",
    },
    async proposeDirection() {
      plannerCalls += 1;
      return proposal;
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

  return { store, submitDirection, plannerCalls: () => plannerCalls };
}

describe("submit direction application slice", () => {
  it("turns exact user input into a proposed main-screen branch with provenance", async () => {
    const { store, submitDirection } = setup();

    const result = await submitDirection(
      BLACK_HAWK_DOWN_SPINE_IDS.owner,
      BLACK_HAWK_DOWN_DIRECTION_COMMAND,
    );

    expect(result.replayed).toBe(false);
    expect(result.direction.exactUserText).toBe(
      BLACK_HAWK_DOWN_DIRECTION_COMMAND.userText,
    );
    expect(result.proposedBranch.status).toBe("PROPOSED");
    expect(result.proposedBranch.parentBranchId).toBe(
      BLACK_HAWK_DOWN_SPINE_IDS.rootBranch,
    );
    expect(result.investigationCase.activeBranchId).toBe(
      result.proposedBranch.id,
    );
    expect(result.investigationCase.aggregateVersion).toBe(5);
    expect(result.investigationCase.eventSequence).toBe(10);
    expect(result.provenanceEdges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          output: { type: "BRANCH", id: result.proposedBranch.id },
          input: { type: "DIRECTION", id: result.direction.id },
          relationship: "TRIGGERED_BY",
        }),
      ]),
    );
    expect(store.directionCount).toBe(1);
    expect(store.provenanceCount).toBe(2);
    expect(store.outboxCount).toBe(2);
  });

  it("emits ordered semantic events without private direction text", async () => {
    const { store, submitDirection } = setup();

    await submitDirection(
      BLACK_HAWK_DOWN_SPINE_IDS.owner,
      BLACK_HAWK_DOWN_DIRECTION_COMMAND,
    );

    const events = store.listOutboxEvents();
    expect(events.map(({ event }) => [event.sequence, event.type])).toEqual([
      [9, "direction.submitted"],
      [10, "branch.proposed"],
    ]);
    expect(JSON.stringify(events)).not.toContain(
      BLACK_HAWK_DOWN_DIRECTION_COMMAND.userText.trim(),
    );
  });

  it("replays the original result without routing or duplicating state", async () => {
    const { store, submitDirection, plannerCalls } = setup();

    const first = await submitDirection(
      BLACK_HAWK_DOWN_SPINE_IDS.owner,
      BLACK_HAWK_DOWN_DIRECTION_COMMAND,
    );
    const replay = await submitDirection(
      BLACK_HAWK_DOWN_SPINE_IDS.owner,
      BLACK_HAWK_DOWN_DIRECTION_COMMAND,
    );

    expect(first.replayed).toBe(false);
    expect(replay.replayed).toBe(true);
    expect(replay.direction.id).toBe(first.direction.id);
    expect(replay.proposedBranch.id).toBe(first.proposedBranch.id);
    expect(plannerCalls()).toBe(1);
    expect(store.directionCount).toBe(1);
    expect(store.outboxCount).toBe(2);
  });

  it("rejects an idempotency key reused for different private input", async () => {
    const { store, submitDirection, plannerCalls } = setup();

    await submitDirection(
      BLACK_HAWK_DOWN_SPINE_IDS.owner,
      BLACK_HAWK_DOWN_DIRECTION_COMMAND,
    );

    await expect(
      submitDirection(BLACK_HAWK_DOWN_SPINE_IDS.owner, {
        ...BLACK_HAWK_DOWN_DIRECTION_COMMAND,
        userText: "Challenge the theory from the Somali perspective.",
      }),
    ).rejects.toMatchObject({
      code: "IDEMPOTENCY_KEY_REUSED",
    });
    expect(plannerCalls()).toBe(1);
    expect(store.directionCount).toBe(1);
  });

  it("rejects stale case state before asking the agent to route", async () => {
    const { store, submitDirection, plannerCalls } = setup();

    await expect(
      submitDirection(BLACK_HAWK_DOWN_SPINE_IDS.owner, {
        ...BLACK_HAWK_DOWN_DIRECTION_COMMAND,
        expectedCaseVersion: 3,
      }),
    ).rejects.toMatchObject({
      code: "CASE_VERSION_CONFLICT",
    });
    expect(plannerCalls()).toBe(0);
    expect(store.directionCount).toBe(0);
    expect(store.outboxCount).toBe(0);
  });

  it("does not misrepresent return navigation as a new child branch", async () => {
    const { store, submitDirection, plannerCalls } = setup();

    await expect(
      submitDirection(BLACK_HAWK_DOWN_SPINE_IDS.owner, {
        ...BLACK_HAWK_DOWN_DIRECTION_COMMAND,
        requestedAction: "return",
      }),
    ).rejects.toMatchObject({
      code: "RETURN_DIRECTION_NOT_IMPLEMENTED",
    });
    expect(plannerCalls()).toBe(0);
    expect(store.directionCount).toBe(0);
    expect(store.outboxCount).toBe(0);
  });

  it("rejects malformed agent output before any state is committed", async () => {
    const { store, submitDirection } = setup({
      ...BLACK_HAWK_DOWN_DIRECTION_PROPOSAL,
      branchAction: "RETURN",
      inventedEvidenceStatus: "VERIFIED",
    });

    await expect(
      submitDirection(
        BLACK_HAWK_DOWN_SPINE_IDS.owner,
        BLACK_HAWK_DOWN_DIRECTION_COMMAND,
      ),
    ).rejects.toThrow();
    expect(store.directionCount).toBe(0);
    expect(store.provenanceCount).toBe(0);
    expect(store.outboxCount).toBe(0);
  });
});
