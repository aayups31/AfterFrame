import { describe, expect, it } from "vitest";
import { SubmitDirectionCommandSchema } from "@/contracts/directions";
import {
  BranchProposedDomainEventSchema,
  DirectionSubmittedDomainEventSchema,
  OutboxEventSchema,
} from "@/contracts/domain-events";

const CASE_ID = "00000000-0000-4000-8000-000000000001";
const BRANCH_ID = "00000000-0000-4000-8000-000000000002";
const BEAT_ID = "00000000-0000-4000-8000-000000000003";
const DIRECTION_ID = "00000000-0000-4000-8000-000000000004";
const EVENT_ID = "00000000-0000-4000-8000-000000000005";
const OUTBOX_ID = "00000000-0000-4000-8000-000000000006";

function directionCommand() {
  return {
    caseId: CASE_ID,
    idempotencyKey: "direction:client-session:0001",
    expectedCaseVersion: 7,
    sourceBranchId: BRANCH_ID,
    userText: "  I think this failed before contact.\n",
    anchor: {
      beatId: BEAT_ID,
      selectedText: "  the plan depended on speed  ",
    },
    requestedAction: "theory" as const,
  };
}

function domainEvent() {
  return {
    id: EVENT_ID,
    type: "direction.submitted" as const,
    schemaVersion: 1 as const,
    aggregateType: "case" as const,
    aggregateId: CASE_ID,
    sequence: 8,
    aggregateVersion: 8,
    occurredAt: "2026-08-08T21:00:00.000Z",
    payload: {
      directionId: DIRECTION_ID,
      sourceBranchId: BRANCH_ID,
      requestedAction: "theory" as const,
      anchor: { beatId: BEAT_ID },
    },
  };
}

describe("SubmitDirectionCommandSchema", () => {
  it("preserves exact user and selected text", () => {
    const input = directionCommand();
    const parsed = SubmitDirectionCommandSchema.parse(input);

    expect(parsed.userText).toBe(input.userText);
    expect(parsed.anchor?.selectedText).toBe(input.anchor.selectedText);
    expect(parsed.idempotencyKey).toBe(input.idempotencyKey);
  });

  it("rejects blank text, unstable keys, stale-shaped versions, and empty anchors", () => {
    expect(
      SubmitDirectionCommandSchema.safeParse({
        ...directionCommand(),
        userText: " \n\t ",
      }).success,
    ).toBe(false);
    expect(
      SubmitDirectionCommandSchema.safeParse({
        ...directionCommand(),
        idempotencyKey: " has spaces ",
      }).success,
    ).toBe(false);
    expect(
      SubmitDirectionCommandSchema.safeParse({
        ...directionCommand(),
        expectedCaseVersion: -1,
      }).success,
    ).toBe(false);
    expect(
      SubmitDirectionCommandSchema.safeParse({
        ...directionCommand(),
        anchor: { selectedText: "orphaned selection" },
      }).success,
    ).toBe(false);
  });
});

describe("domain and outbox event contracts", () => {
  it("accepts a versioned, ordered direction event with reference-only payload", () => {
    expect(DirectionSubmittedDomainEventSchema.parse(domainEvent())).toEqual(
      domainEvent(),
    );
  });

  it("represents the proposed branch without copying private direction text", () => {
    expect(
      BranchProposedDomainEventSchema.safeParse({
        ...domainEvent(),
        id: OUTBOX_ID,
        type: "branch.proposed",
        sequence: 9,
        payload: {
          branchId: BRANCH_ID,
          parentBranchId: "00000000-0000-4000-8000-000000000007",
          originDirectionId: DIRECTION_ID,
        },
      }).success,
    ).toBe(true);

    expect(
      BranchProposedDomainEventSchema.safeParse({
        ...domainEvent(),
        id: OUTBOX_ID,
        type: "branch.proposed",
        sequence: 9,
        payload: {
          branchId: BRANCH_ID,
          parentBranchId: "00000000-0000-4000-8000-000000000007",
          originDirectionId: DIRECTION_ID,
          userText: "private theory",
        },
      }).success,
    ).toBe(false);
  });

  it("rejects private text and open-ended analytics properties", () => {
    const event = domainEvent();

    expect(
      DirectionSubmittedDomainEventSchema.safeParse({
        ...event,
        payload: { ...event.payload, userText: "private theory" },
      }).success,
    ).toBe(false);
    expect(
      DirectionSubmittedDomainEventSchema.safeParse({
        ...event,
        payload: { ...event.payload, properties: { filmTitle: "private" } },
      }).success,
    ).toBe(false);
    expect(
      DirectionSubmittedDomainEventSchema.safeParse({
        ...event,
        payload: {
          ...event.payload,
          anchor: { beatId: BEAT_ID, selectedText: "private selection" },
        },
      }).success,
    ).toBe(false);
  });

  it("validates outbox identity and publication order", () => {
    const valid = {
      id: OUTBOX_ID,
      event: domainEvent(),
      recordedAt: "2026-08-08T21:00:00.000Z",
      publicationAttempts: 0,
      publishedAt: null,
    };

    expect(OutboxEventSchema.safeParse(valid).success).toBe(true);
    expect(
      OutboxEventSchema.safeParse({
        ...valid,
        publishedAt: "2026-08-08T20:59:59.000Z",
      }).success,
    ).toBe(false);
  });
});
