import { describe, expect, it } from "vitest";
import { DirectionEventSchema } from "@/core/branches/schemas";
import {
  BranchTransitionError,
  transitionBranch,
} from "@/core/branches/transitions";
import {
  TEST_LATER_TIME,
  TEST_TIME,
  makeValidGraph,
} from "@/core/__tests__/test-fixtures";

describe("branch transitions", () => {
  it("advances only through the declared lifecycle and increments versions", () => {
    const proposed = makeValidGraph().branches[1];
    const planned = transitionBranch(proposed, {
      targetStatus: "PLANNED",
      expectedVersion: 0,
      occurredAt: TEST_LATER_TIME,
    });
    const opened = transitionBranch(planned, {
      targetStatus: "OPEN",
      expectedVersion: 1,
      occurredAt: TEST_LATER_TIME,
    });

    expect(planned.aggregateVersion).toBe(1);
    expect(opened).toMatchObject({ status: "OPEN", aggregateVersion: 2 });
  });

  it("treats a repeated target state as an idempotent no-op", () => {
    const branch = makeValidGraph().branches[1];
    expect(
      transitionBranch(branch, {
        targetStatus: "PROPOSED",
        expectedVersion: 0,
        occurredAt: TEST_LATER_TIME,
      }),
    ).toEqual(branch);
  });

  it("rejects a stale version even when the requested state already matches", () => {
    const branch = makeValidGraph().branches[1];
    expect(() =>
      transitionBranch(branch, {
        targetStatus: "PROPOSED",
        expectedVersion: 999,
        occurredAt: TEST_LATER_TIME,
      }),
    ).toThrowError(/Expected branch version/);
  });

  it("rejects an out-of-order transition timestamp", () => {
    const branch = makeValidGraph().branches[1];
    expect(() =>
      transitionBranch(branch, {
        targetStatus: "PLANNED",
        expectedVersion: 0,
        occurredAt: TEST_TIME,
      }),
    ).toThrowError(/precedes current branch time/);
  });

  it("rejects skipped transitions and optimistic version conflicts", () => {
    const branch = makeValidGraph().branches[1];
    expect(() =>
      transitionBranch(branch, {
        targetStatus: "OPEN",
        expectedVersion: 0,
        occurredAt: TEST_LATER_TIME,
      }),
    ).toThrowError(BranchTransitionError);
    expect(() =>
      transitionBranch(branch, {
        targetStatus: "PLANNED",
        expectedVersion: 4,
        occurredAt: TEST_LATER_TIME,
      }),
    ).toThrowError(/Expected branch version/);
  });

  it("preserves exact direction text rather than trimming it", () => {
    const direction = makeValidGraph().directions[0];
    const parsed = DirectionEventSchema.parse(direction);
    expect(parsed.exactUserText).toBe(
      "  I think the plan was fragile before contact.  ",
    );
  });

  it("rejects direction records with fewer than three non-whitespace characters", () => {
    const direction = makeValidGraph().directions[0];
    expect(
      DirectionEventSchema.safeParse({
        ...direction,
        exactUserText: "  x  ",
      }).success,
    ).toBe(false);
    expect(
      DirectionEventSchema.safeParse({
        ...direction,
        exactUserText: "   ",
      }).success,
    ).toBe(false);
  });
});
