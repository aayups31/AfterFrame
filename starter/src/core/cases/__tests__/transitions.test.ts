import { describe, expect, it } from "vitest";
import { InvestigationCaseSchema } from "@/core/cases/schemas";
import { CaseTransitionError, transitionCase } from "@/core/cases/transitions";
import {
  TEST_LATER_TIME,
  TEST_TIME,
  makeValidGraph,
} from "@/core/__tests__/test-fixtures";

describe("case schemas and transitions", () => {
  it("stores an opaque specialist subject without a film field in core", () => {
    const investigationCase = makeValidGraph().case;
    const parsed = InvestigationCaseSchema.parse(investigationCase);

    expect(parsed.subjectRef).toEqual({
      type: "film",
      id: "tmdb:123",
      versionId: null,
    });
    expect(parsed).not.toHaveProperty("filmId");
  });

  it("preserves exact curiosity text while validating its non-whitespace content", () => {
    const investigationCase = makeValidGraph().case;
    const exactCuriosity = "  Why did this fail?\n";
    const parsed = InvestigationCaseSchema.parse({
      ...investigationCase,
      exactCuriosity,
    });

    expect(parsed.exactCuriosity).toBe(exactCuriosity);
    expect(
      InvestigationCaseSchema.safeParse({
        ...investigationCase,
        exactCuriosity: "  x  ",
      }).success,
    ).toBe(false);
  });

  it("reopens a closed case deterministically", () => {
    const closed = { ...makeValidGraph().case, status: "CLOSED" as const };
    expect(
      transitionCase(closed, {
        targetStatus: "ACTIVE",
        expectedVersion: 4,
        occurredAt: TEST_LATER_TIME,
      }),
    ).toMatchObject({ status: "ACTIVE", aggregateVersion: 5 });
  });

  it("rejects an invalid jump and a stale expected version", () => {
    const draft = {
      ...makeValidGraph().case,
      status: "DRAFT" as const,
      activeBranchId: null,
    };
    expect(() =>
      transitionCase(draft, {
        targetStatus: "ACTIVE",
        expectedVersion: 4,
        occurredAt: TEST_LATER_TIME,
      }),
    ).toThrowError(CaseTransitionError);
    expect(() =>
      transitionCase(draft, {
        targetStatus: "INTENT_PROPOSED",
        expectedVersion: 3,
        occurredAt: TEST_LATER_TIME,
      }),
    ).toThrowError(/Expected case version/);
  });

  it("checks version and time before treating a same-state request as a no-op", () => {
    const active = makeValidGraph().case;
    expect(() =>
      transitionCase(active, {
        targetStatus: "ACTIVE",
        expectedVersion: 3,
        occurredAt: TEST_LATER_TIME,
      }),
    ).toThrowError(/Expected case version/);
    expect(() =>
      transitionCase(active, {
        targetStatus: "ACTIVE",
        expectedVersion: 4,
        occurredAt: TEST_TIME,
      }),
    ).toThrowError(/precedes current case time/);
    expect(
      transitionCase(active, {
        targetStatus: "ACTIVE",
        expectedVersion: 4,
        occurredAt: TEST_LATER_TIME,
      }),
    ).toEqual(active);
  });
});
