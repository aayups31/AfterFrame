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

function setup(proposal: unknown) {
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

describe("submit direction adversarial behavior", () => {
  it("serializes concurrent identical calls, then replays the committed result", async () => {
    const { store, submitDirection, plannerCalls } = setup(
      BLACK_HAWK_DOWN_DIRECTION_PROPOSAL,
    );

    const firstCall = submitDirection(
      BLACK_HAWK_DOWN_SPINE_IDS.owner,
      BLACK_HAWK_DOWN_DIRECTION_COMMAND,
    );
    const concurrentCall = submitDirection(
      BLACK_HAWK_DOWN_SPINE_IDS.owner,
      BLACK_HAWK_DOWN_DIRECTION_COMMAND,
    );

    await expect(concurrentCall).rejects.toMatchObject({
      code: "DIRECTION_IN_PROGRESS",
    });
    const committed = await firstCall;
    const replay = await submitDirection(
      BLACK_HAWK_DOWN_SPINE_IDS.owner,
      BLACK_HAWK_DOWN_DIRECTION_COMMAND,
    );

    expect(plannerCalls()).toBe(1);
    expect(replay.replayed).toBe(true);
    expect(replay.direction.id).toBe(committed.direction.id);
    expect(store.directionCount).toBe(1);
    expect(store.outboxCount).toBe(2);
  });

  it("rejects an explicit compare routed as a theory and releases its reservation", async () => {
    const { store, submitDirection, plannerCalls } = setup(
      BLACK_HAWK_DOWN_DIRECTION_PROPOSAL,
    );
    const compareCommand = {
      ...BLACK_HAWK_DOWN_DIRECTION_COMMAND,
      requestedAction: "compare" as const,
    };

    await expect(
      submitDirection(BLACK_HAWK_DOWN_SPINE_IDS.owner, compareCommand),
    ).rejects.toMatchObject({ code: "PLANNER_POLICY_MISMATCH" });
    await expect(
      submitDirection(BLACK_HAWK_DOWN_SPINE_IDS.owner, compareCommand),
    ).rejects.toMatchObject({ code: "PLANNER_POLICY_MISMATCH" });

    expect(plannerCalls()).toBe(2);
    expect(store.directionCount).toBe(0);
    expect(store.outboxCount).toBe(0);
  });

  it("rejects a planner axis that the active movie specialist did not authorize", async () => {
    const { store, submitDirection, plannerCalls } = setup({
      ...BLACK_HAWK_DOWN_DIRECTION_PROPOSAL,
      researchAxisIds: ["invented-secret-axis"],
    });

    await expect(
      submitDirection(
        BLACK_HAWK_DOWN_SPINE_IDS.owner,
        BLACK_HAWK_DOWN_DIRECTION_COMMAND,
      ),
    ).rejects.toMatchObject({ code: "PLANNER_POLICY_MISMATCH" });

    expect(plannerCalls()).toBe(1);
    expect(store.directionCount).toBe(0);
    expect(store.provenanceCount).toBe(0);
    expect(store.outboxCount).toBe(0);
  });

  it("rejects incoherent auto routing before it can create a branch", async () => {
    const { store, submitDirection, plannerCalls } = setup({
      ...BLACK_HAWK_DOWN_DIRECTION_PROPOSAL,
      directionType: "RETURN",
      branchKind: "THEORY",
      branchAction: "CREATE",
    });

    await expect(
      submitDirection(BLACK_HAWK_DOWN_SPINE_IDS.owner, {
        ...BLACK_HAWK_DOWN_DIRECTION_COMMAND,
        requestedAction: "auto",
      }),
    ).rejects.toThrow();

    expect(plannerCalls()).toBe(1);
    expect(store.directionCount).toBe(0);
    expect(store.outboxCount).toBe(0);
  });

  it("does not let planner output self-declare trusted derivation", async () => {
    const { store, submitDirection } = setup({
      ...BLACK_HAWK_DOWN_DIRECTION_PROPOSAL,
      derivation: {
        kind: "DETERMINISTIC_FIXTURE",
        fixtureId: "spoofed-live-planner",
        fixtureVersion: "999",
      },
    });

    await expect(
      submitDirection(
        BLACK_HAWK_DOWN_SPINE_IDS.owner,
        BLACK_HAWK_DOWN_DIRECTION_COMMAND,
      ),
    ).rejects.toThrow();
    expect(store.directionCount).toBe(0);
    expect(store.provenanceCount).toBe(0);
  });
});
