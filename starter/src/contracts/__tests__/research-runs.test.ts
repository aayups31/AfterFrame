import { describe, expect, it } from "vitest";
import {
  ResearchIdempotencyKeySchema,
  StartResearchRunCommandSchema,
} from "@/contracts/research-runs";

describe("research-run contracts", () => {
  it("keeps command idempotency keys aligned with the durable SQL boundary", () => {
    expect(
      ResearchIdempotencyKeySchema.parse("research-run:start:0001"),
    ).toBe("research-run:start:0001");
    expect(() => ResearchIdempotencyKeySchema.parse(" short ")).toThrow();
    expect(() =>
      StartResearchRunCommandSchema.parse({
        caseId: "40000000-0000-4000-8000-000000000001",
        branchId: null,
        expectedCaseVersion: 0,
        idempotencyKey: "research run has spaces",
      }),
    ).toThrow();
  });
});
