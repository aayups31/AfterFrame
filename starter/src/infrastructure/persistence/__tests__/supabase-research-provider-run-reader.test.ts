import { describe, expect, it, vi } from "vitest";
import {
  SupabaseResearchProviderRunReader,
  SupabaseResearchProviderRunReaderError,
} from "@/infrastructure/persistence/supabase-research-provider-run-reader";

const ACTOR_ID = "79000000-0000-4000-8000-000000000001";
const RUN_ID = "79000000-0000-4000-8000-000000000002";
const JOB_ID = "79000000-0000-4000-8000-000000000003";
const ATTEMPT_ID = "79000000-0000-4000-8000-000000000004";
const record = {
  schemaVersion: 1 as const,
  runId: RUN_ID,
  jobId: JOB_ID,
  attemptId: ATTEMPT_ID,
  caseId: "79000000-0000-4000-8000-000000000005",
  provider: "openai" as const,
  providerResponseId: "resp_takeover_1",
  state: "IN_PROGRESS" as const,
  requestedModel: "gpt-test",
  providerModel: "gpt-test-2026-08-01",
  traceId: "trace-takeover-1",
  manifestFingerprint: "a".repeat(64),
  externalIdempotencyKey: "b".repeat(64),
  startedAt: "2026-08-22T20:00:00.000Z",
  acceptedAt: "2026-08-22T20:00:01.000Z",
  lastObservedAt: "2026-08-22T20:00:01.000Z",
  inputBytes: 1_000,
  dataControlMode: "MODIFIED_ABUSE_MONITORING" as const,
  projectIdFingerprint: "c".repeat(64),
  privateContentIncluded: true as const,
  publicationAuthority: "NONE" as const,
};

describe("SupabaseResearchProviderRunReader", () => {
  it("reads one exact actor-scoped recovery record", async () => {
    const invokeRpc = vi.fn().mockResolvedValue({ data: record, error: null });
    const reader = new SupabaseResearchProviderRunReader({
      actorId: ACTOR_ID,
      invokeRpc,
    });
    await expect(
      reader.getAcceptedProviderRun({
        actorId: ACTOR_ID,
        runId: RUN_ID,
        jobId: JOB_ID,
        attemptId: ATTEMPT_ID,
      }),
    ).resolves.toEqual(record);
    expect(invokeRpc).toHaveBeenCalledWith(
      "af_get_research_provider_run_v1",
      {
        p_actor_id: ACTOR_ID,
        p_run_id: RUN_ID,
        p_job_id: JOB_ID,
        p_attempt_id: ATTEMPT_ID,
      },
    );
  });

  it("does not query another actor's recovery state", async () => {
    const invokeRpc = vi.fn();
    const reader = new SupabaseResearchProviderRunReader({
      actorId: ACTOR_ID,
      invokeRpc,
    });
    await expect(
      reader.getAcceptedProviderRun({
        actorId: record.caseId,
        runId: RUN_ID,
        jobId: JOB_ID,
        attemptId: ATTEMPT_ID,
      }),
    ).resolves.toBeNull();
    expect(invokeRpc).not.toHaveBeenCalled();
  });

  it("rejects expanded or malformed recovery contracts without leaking bodies", async () => {
    const secret = "private provider body";
    const invokeRpc = vi.fn().mockResolvedValue({
      data: { ...record, responseBody: secret },
      error: null,
    });
    const reader = new SupabaseResearchProviderRunReader({
      actorId: ACTOR_ID,
      invokeRpc,
    });
    const rejection = reader.getAcceptedProviderRun({
      actorId: ACTOR_ID,
      runId: RUN_ID,
      jobId: JOB_ID,
      attemptId: ATTEMPT_ID,
    });
    await expect(rejection).rejects.toBeInstanceOf(
      SupabaseResearchProviderRunReaderError,
    );
    await expect(rejection).rejects.not.toThrow(secret);
  });
});
