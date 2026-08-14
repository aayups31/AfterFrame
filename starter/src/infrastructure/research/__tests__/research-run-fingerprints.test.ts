import { describe, expect, it } from "vitest";
import { Sha256ResearchRunFingerprintAdapter } from "@/infrastructure/research/research-run-fingerprints";

const fingerprints = new Sha256ResearchRunFingerprintAdapter();

describe("research-run fingerprints", () => {
  it("is stable across object insertion order but preserves array order", () => {
    const first = fingerprints.fingerprintPlan({
      axes: ["history", "adaptation"],
      policy: { counterevidence: true, sourceLimit: 30 },
    });
    const reorderedKeys = fingerprints.fingerprintPlan({
      policy: { sourceLimit: 30, counterevidence: true },
      axes: ["history", "adaptation"],
    });
    const reorderedArray = fingerprints.fingerprintPlan({
      policy: { counterevidence: true, sourceLimit: 30 },
      axes: ["adaptation", "history"],
    });

    expect(first).toBe(reorderedKeys);
    expect(first).not.toBe(reorderedArray);
    expect(first).toMatch(/^[a-f0-9]{64}$/);
  });

  it("preserves exact private objective bytes without returning the body", () => {
    const exact = "  Why does the ending refuse closure?  ";
    const exactFingerprint = fingerprints.fingerprintObjective(exact);
    const trimmedFingerprint = fingerprints.fingerprintObjective(exact.trim());

    expect(exactFingerprint).not.toBe(trimmedFingerprint);
    expect(exactFingerprint).not.toContain("ending");
  });

  it("domain-separates identical values used for different purposes", () => {
    const value = "30000000-0000-4000-8000-000000000001";
    expect(fingerprints.fingerprintObjective(value)).not.toBe(
      fingerprints.fingerprintPlan(value),
    );
  });

  it("rejects cyclic, non-finite, and non-plain input", () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;

    expect(() => fingerprints.fingerprintPlan(cyclic)).toThrow(/cycles/);
    expect(() => fingerprints.fingerprintPlan(Number.NaN)).toThrow(/finite/);
    expect(() => fingerprints.fingerprintPlan(new Date())).toThrow(
      /plain records/,
    );
  });
});
