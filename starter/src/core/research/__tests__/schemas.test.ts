import { describe, expect, it } from "vitest";
import {
  SourceLocatorSchema,
  SourceRecordSchema,
  SourceSnapshotSchema,
} from "@/core/research/schemas";
import {
  TEST_FINGERPRINT,
  TEST_IDS,
  TEST_LATER_TIME,
  TEST_TIME,
  makeValidGraph,
} from "@/core/__tests__/test-fixtures";

describe("research schemas", () => {
  it("accepts an edition-aware exact book locator", () => {
    const locator = makeValidGraph().locators[0];
    expect(SourceLocatorSchema.parse(locator)).toMatchObject({
      kind: "BOOK",
      editionId: "edition:test-hardcover",
      pageStart: 42,
    });
  });

  it("rejects unknown source fields", () => {
    const source = { ...makeValidGraph().sources[0], credibilityScore: 99 };
    expect(SourceRecordSchema.safeParse(source).success).toBe(false);
  });

  it("rejects an exact book locator without edition and page identity", () => {
    const locator = {
      ...makeValidGraph().locators[0],
      editionId: null,
      pageStart: null,
      pageEnd: null,
    };
    expect(SourceLocatorSchema.safeParse(locator).success).toBe(false);
  });

  it("rejects a backwards video time range", () => {
    const locator = {
      id: TEST_IDS.locator,
      sourceId: TEST_IDS.source,
      kind: "VIDEO",
      status: "VERIFIED_EXACT",
      resolver: { id: "video-resolver", version: "1.0.0" },
      revision: 1,
      supersedesLocatorId: null,
      openUrl: "https://example.com/watch?v=1&t=20",
      resolvedAt: TEST_TIME,
      lastVerifiedAt: TEST_LATER_TIME,
      createdAt: TEST_TIME,
      provider: "example-video",
      providerItemId: "video-1",
      timestampStartMs: 20_000,
      timestampEndMs: 10_000,
      transcriptCueIds: ["cue-1"],
      transcriptFingerprint: TEST_FINGERPRINT,
    };

    expect(SourceLocatorSchema.safeParse(locator).success).toBe(false);
  });

  it("rejects an exact webpage locator without a text fingerprint", () => {
    const locator = {
      id: TEST_IDS.locator,
      sourceId: TEST_IDS.source,
      kind: "WEBPAGE",
      status: "VERIFIED_EXACT",
      resolver: { id: "web-resolver", version: "1.0.0" },
      revision: 1,
      supersedesLocatorId: null,
      openUrl: "https://example.com/report",
      resolvedAt: TEST_TIME,
      lastVerifiedAt: TEST_LATER_TIME,
      createdAt: TEST_TIME,
      headingPath: ["Findings"],
      paragraphIndex: 2,
      textFingerprint: null,
      textFragmentUrl: null,
    };

    expect(SourceLocatorSchema.safeParse(locator).success).toBe(false);
  });

  it("keeps user-owned and link-only snapshot content out of shared storage", () => {
    const snapshot = makeValidGraph().snapshots[0];

    expect(
      SourceSnapshotSchema.safeParse({
        ...snapshot,
        caseId: null,
        rightsState: "USER_OWNED",
      }).success,
    ).toBe(false);
    expect(
      SourceSnapshotSchema.safeParse({
        ...snapshot,
        rightsState: "LINK_ONLY",
        storageRef: "must-not-be-stored",
      }).success,
    ).toBe(false);
    expect(
      SourceSnapshotSchema.safeParse({
        ...snapshot,
        rightsState: "UNKNOWN",
        storageRef: "must-not-be-stored",
      }).success,
    ).toBe(false);
    expect(
      SourceSnapshotSchema.safeParse({
        ...snapshot,
        accessState: "UNAVAILABLE",
        storageRef: "must-not-be-stored",
      }).success,
    ).toBe(false);
  });
});
