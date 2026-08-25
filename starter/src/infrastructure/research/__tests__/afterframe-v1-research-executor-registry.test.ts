import { describe, expect, it, vi } from "vitest";
import { RESEARCH_STAGES } from "@/core/research-runs/schemas";
import {
  afterFrameV1IdentityExecutionPlan,
  afterFrameV1ScopingExecutionPlan,
  afterFrameV1DiscoveryExecutionPlan,
  afterFrameV1SourceResolutionExecutionPlan,
  createAfterFrameV1ResearchExecutorRegistry,
  createAfterFrameV1ShadowResearchExecutorRegistry,
} from "@/infrastructure/research/afterframe-v1-research-executor-registry";

const ACTOR_ID = "74000000-0000-4000-8000-000000000001";

describe("AfterFrame V1 durable executor composition", () => {
  it("defines a snapshot-explicit resumable DISCOVERY execution identity", () => {
    const plan = afterFrameV1DiscoveryExecutionPlan(
      "gpt-5.6-sol",
      "gpt-5.6-sol-2026-07-01",
    );
    expect(plan).toMatchObject({
      executorId: "discovery-stage-executor",
      executionKind: "MODEL_TOOL",
      model: {
        provider: "openai",
        model: "gpt-5.6-sol",
        snapshot: "gpt-5.6-sol-2026-07-01",
      },
      tool: { id: "openai-web-search", version: "responses-v1" },
      privateContentIncluded: true,
      automaticRetrySafety: "RESUMABLE_PROVIDER_RUN",
    });
  });

  it("defines body-free, idempotent source resolution as a resolver execution", () => {
    expect(afterFrameV1SourceResolutionExecutionPlan()).toMatchObject({
      executorId: "source-resolution-stage-executor",
      executionKind: "RESOLVER",
      model: null,
      prompt: null,
      tool: { id: "http-source-metadata", version: "1.0.0" },
      privateContentIncluded: false,
      automaticRetrySafety: "IDEMPOTENT_PROVIDER_REQUEST",
    });
  });

  it("registers Movie IDENTITY and deterministic SCOPING while later stages fail closed", () => {
    const invokeRpc = vi.fn(async () => ({ data: null, error: null }));
    const registry = createAfterFrameV1ResearchExecutorRegistry({
      actorId: ACTOR_ID,
      invokeRpc,
      tmdbApiKey: "private-tmdb-key",
      fetchImpl: vi.fn(),
      createId: () => "74000000-0000-4000-8000-000000000002",
      now: () => new Date("2026-08-14T12:00:00.000Z"),
    });

    const identity = registry.resolve("IDENTITY");
    expect(identity?.identity).toEqual({
      stage: "IDENTITY",
      execution: afterFrameV1IdentityExecutionPlan(),
    });
    const scoping = registry.resolve("SCOPING");
    expect(scoping?.identity).toEqual({
      stage: "SCOPING",
      execution: afterFrameV1ScopingExecutionPlan(),
    });
    for (const stage of RESEARCH_STAGES.filter(
      (candidate) => candidate !== "IDENTITY" && candidate !== "SCOPING",
    )) {
      expect(registry.resolve(stage)).toBeNull();
    }
    expect(JSON.stringify(identity)).not.toContain("private-tmdb-key");
    expect(JSON.stringify(scoping)).not.toContain("private-tmdb-key");
    expect(invokeRpc).not.toHaveBeenCalled();
  });

  it("registers DISCOVERY only through the attested shadow composition", () => {
    const invokeRpc = vi.fn(async () => ({ data: null, error: null }));
    const registry = createAfterFrameV1ShadowResearchExecutorRegistry({
      actorId: ACTOR_ID,
      invokeRpc,
      tmdbApiKey: "private-tmdb-key",
      openAiApiKey: "private-openai-key",
      requestedModel: "gpt-5.6-sol",
      expectedProviderSnapshot: "gpt-5.6-sol",
      dataControlAttestation: {
        mode: "MODIFIED_ABUSE_MONITORING",
        projectIdFingerprint:
          "a".repeat(64),
        attestedAt: "2026-08-22T18:00:00.000Z",
        attestedBy: "deployment-owner",
      },
    });

    expect(registry.resolve("DISCOVERY")?.identity).toEqual({
      stage: "DISCOVERY",
      execution: afterFrameV1DiscoveryExecutionPlan(
        "gpt-5.6-sol",
        "gpt-5.6-sol",
      ),
    });
    expect(invokeRpc).not.toHaveBeenCalled();
  });

  it("rejects shadow composition without a valid MAM attestation", () => {
    expect(() =>
      createAfterFrameV1ShadowResearchExecutorRegistry({
        actorId: ACTOR_ID,
        invokeRpc: vi.fn(async () => ({ data: null, error: null })),
        tmdbApiKey: "private-tmdb-key",
        openAiApiKey: "private-openai-key",
        requestedModel: "gpt-5.6-sol",
        expectedProviderSnapshot: "gpt-5.6-sol",
        dataControlAttestation: {
          mode: "DEFAULT",
          projectIdFingerprint: "a".repeat(64),
          attestedAt: "2026-08-22T18:00:00.000Z",
          attestedBy: "deployment-owner",
        } as never,
      }),
    ).toThrow();
  });
});
