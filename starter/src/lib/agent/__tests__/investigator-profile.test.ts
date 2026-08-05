import { describe, expect, it } from "vitest";
import { mergeCalibration } from "@/lib/agent/investigator-profile";

describe("mergeCalibration", () => {
  it("applies temporary case overrides after persistent preferences", () => {
    const result = mergeCalibration(
      "documentary_researcher",
      { challengeLevel: 1 },
      { challengeLevel: 3, spoilerPolicy: "full" },
    );

    expect(result.mode).toBe("documentary_researcher");
    expect(result.challengeLevel).toBe(1);
    expect(result.spoilerPolicy).toBe("full");
  });

  it("rejects out-of-range values", () => {
    expect(() =>
      mergeCalibration("open_rabbit_hole", { depth: 8 as 0 }),
    ).toThrow();
  });
});
