import { describe, expect, it, vi } from "vitest";
import {
  BLACK_HAWK_DOWN_DISCOVERY_INPUT,
  BLACK_HAWK_DOWN_RESEARCH_BUNDLE,
} from "@/fixtures/black-hawk-down/research-run.fixture";
import {
  SupabaseResearchDiscoveryContextReader,
  SupabaseResearchDiscoveryContextReaderError,
} from "@/infrastructure/persistence/supabase-research-discovery-context-reader";

const ACTOR_ID = "10000000-0000-4000-8000-000000000001";
const context = {
  schemaVersion: 1 as const,
  runId: BLACK_HAWK_DOWN_DISCOVERY_INPUT.runId,
  jobId: BLACK_HAWK_DOWN_DISCOVERY_INPUT.jobId,
  caseId: BLACK_HAWK_DOWN_DISCOVERY_INPUT.caseId,
  subjectRef: BLACK_HAWK_DOWN_DISCOVERY_INPUT.subjectRef,
  publicSubjectIdentity:
    BLACK_HAWK_DOWN_DISCOVERY_INPUT.publicSubjectIdentity,
  exactQuestion: BLACK_HAWK_DOWN_DISCOVERY_INPUT.exactQuestion,
  axes: BLACK_HAWK_DOWN_RESEARCH_BUNDLE.plan.plan.axes,
  sourceClassIds: BLACK_HAWK_DOWN_RESEARCH_BUNDLE.plan.plan.sourceClassIds,
};

describe("SupabaseResearchDiscoveryContextReader", () => {
  it("returns the strict actor-scoped context without reshaping private text", async () => {
    const invokeRpc = vi.fn().mockResolvedValue({ data: context, error: null });
    const reader = new SupabaseResearchDiscoveryContextReader({
      actorId: ACTOR_ID,
      invokeRpc,
    });

    await expect(
      reader.getDiscoveryContext({
        actorId: ACTOR_ID,
        runId: context.runId,
        jobId: context.jobId,
      }),
    ).resolves.toEqual(context);
    expect(invokeRpc).toHaveBeenCalledWith(
      "af_get_research_discovery_context_v1",
      {
        p_actor_id: ACTOR_ID,
        p_run_id: context.runId,
        p_job_id: context.jobId,
      },
    );
  });

  it("does not call Postgres for a different actor", async () => {
    const invokeRpc = vi.fn();
    const reader = new SupabaseResearchDiscoveryContextReader({
      actorId: ACTOR_ID,
      invokeRpc,
    });
    await expect(
      reader.getDiscoveryContext({
        actorId: "10000000-0000-4000-8000-000000000002",
        runId: context.runId,
        jobId: context.jobId,
      }),
    ).resolves.toBeNull();
    expect(invokeRpc).not.toHaveBeenCalled();
  });

  it("rejects lossy or private-expanded database contracts with bounded errors", async () => {
    const invokeRpc = vi.fn().mockResolvedValue({
      data: { ...context, sourceBody: context.exactQuestion },
      error: null,
    });
    const reader = new SupabaseResearchDiscoveryContextReader({
      actorId: ACTOR_ID,
      invokeRpc,
    });
    const rejection = reader.getDiscoveryContext({
      actorId: ACTOR_ID,
      runId: context.runId,
      jobId: context.jobId,
    });
    await expect(rejection).rejects.toBeInstanceOf(
      SupabaseResearchDiscoveryContextReaderError,
    );
    await expect(rejection).rejects.not.toThrow(context.exactQuestion);
  });
});
