import { describe, expect, it } from "vitest";
import { readOpenAIBackgroundDataControlAttestation } from "@/infrastructure/config/openai-background-data-control";

const environment = {
  AFTERFRAME_OPENAI_BACKGROUND_DATA_CONTROL_MODE:
    "MODIFIED_ABUSE_MONITORING",
  AFTERFRAME_OPENAI_PROJECT_ID: "proj_afterframe_private",
  AFTERFRAME_OPENAI_DATA_CONTROL_ATTESTED_AT: "2026-08-22T18:00:00.000Z",
  AFTERFRAME_OPENAI_DATA_CONTROL_ATTESTED_BY: "deployment-owner",
} as const;

describe("OpenAI Background data-control attestation", () => {
  it("derives a body-free project fingerprint from an explicit MAM assertion", () => {
    const attestation = readOpenAIBackgroundDataControlAttestation(environment);

    expect(attestation).toMatchObject({
      mode: "MODIFIED_ABUSE_MONITORING",
      attestedAt: "2026-08-22T18:00:00.000Z",
      attestedBy: "deployment-owner",
    });
    expect(attestation.projectIdFingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(attestation)).not.toContain(
      "proj_afterframe_private",
    );
  });

  it("fails closed when the deployment has no explicit attestation", () => {
    expect(() => readOpenAIBackgroundDataControlAttestation({})).toThrow();
  });

  it("rejects an unapproved or misspelled retention claim", () => {
    expect(() =>
      readOpenAIBackgroundDataControlAttestation({
        ...environment,
        AFTERFRAME_OPENAI_BACKGROUND_DATA_CONTROL_MODE: "DEFAULT",
      }),
    ).toThrow();
  });
});

