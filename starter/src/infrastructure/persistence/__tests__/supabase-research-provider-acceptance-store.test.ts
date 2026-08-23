import { describe, expect, it, vi } from "vitest";
import {
  SupabaseResearchProviderAcceptanceStore,
  SupabaseResearchProviderAcceptanceStoreError,
} from "@/infrastructure/persistence/supabase-research-provider-acceptance-store";

const ACTOR_ID = "78000000-0000-4000-8000-000000000001";
const RUN_ID = "78000000-0000-4000-8000-000000000002";
const JOB_ID = "78000000-0000-4000-8000-000000000003";
const ATTEMPT_ID = "78000000-0000-4000-8000-000000000004";
const CASE_ID = "78000000-0000-4000-8000-000000000005";
const CHECKPOINT_ID = "78000000-0000-4000-8000-000000000006";
const T0 = "2026-08-22T20:00:00.000Z";
const T1 = "2026-08-22T20:00:01.000Z";
const T2 = "2026-08-22T20:02:00.000Z";

const lease = {
  schemaVersion: 1 as const,
  runId: RUN_ID,
  jobId: JOB_ID,
  attemptId: ATTEMPT_ID,
  workerId: "worker-discovery-1",
  leaseToken: "78000000-0000-4000-8000-000000000007",
  leaseEpoch: 1,
  runVersion: 2,
  jobVersion: 2,
  attemptVersion: 0,
  claimedAt: T0,
  heartbeatAt: T0,
  expiresAt: T2,
  externalIdempotencyKey: "a".repeat(64),
};
const checkpoint = {
  schemaVersion: 1 as const,
  id: CHECKPOINT_ID,
  runId: RUN_ID,
  jobId: JOB_ID,
  attemptId: ATTEMPT_ID,
  idempotencyKey: "provider-accepted-discovery-1",
  sequence: 1,
  kind: "PROVIDER_ACCEPTED" as const,
  completedUnits: 0,
  totalUnits: 1,
  providerRunId: "resp_discovery_1",
  resumeTokenFingerprint: "b".repeat(64),
  outputFingerprint: null,
  publicationAuthority: "NONE" as const,
  createdAt: T1,
};
const providerRun = {
  schemaVersion: 1 as const,
  runId: RUN_ID,
  jobId: JOB_ID,
  attemptId: ATTEMPT_ID,
  caseId: CASE_ID,
  provider: "openai" as const,
  providerResponseId: "resp_discovery_1",
  state: "IN_PROGRESS" as const,
  requestedModel: "gpt-test",
  providerModel: "gpt-test-2026-08-01",
  traceId: "trace-discovery-1",
  manifestFingerprint: "c".repeat(64),
  externalIdempotencyKey: "a".repeat(64),
  startedAt: T0,
  acceptedAt: T1,
  lastObservedAt: T1,
  inputBytes: 2_000,
  dataControlMode: "MODIFIED_ABUSE_MONITORING" as const,
  projectIdFingerprint: "d".repeat(64),
  privateContentIncluded: true as const,
  publicationAuthority: "NONE" as const,
};

describe("SupabaseResearchProviderAcceptanceStore", () => {
  it("delegates acceptance to exactly one atomic RPC and parses its replay", async () => {
    const response = {
      status: "COMMITTED",
      lease: { ...lease, jobVersion: 3, heartbeatAt: T1, expiresAt: T2 },
      checkpoint,
      providerRun,
    };
    const invokeRpc = vi.fn().mockResolvedValue({ data: response, error: null });
    const store = new SupabaseResearchProviderAcceptanceStore({
      actorId: ACTOR_ID,
      invokeRpc,
    });
    await expect(
      store.acceptProviderRun({
        actorId: ACTOR_ID,
        lease,
        checkpoint,
        providerRun,
        leaseDurationSeconds: 120,
      }),
    ).resolves.toEqual(response);
    expect(invokeRpc).toHaveBeenCalledTimes(1);
    expect(invokeRpc).toHaveBeenCalledWith(
      "af_accept_research_provider_run_v1",
      {
        p_actor_id: ACTOR_ID,
        p_lease: lease,
        p_checkpoint: checkpoint,
        p_provider_run: providerRun,
        p_lease_seconds: 120,
      },
    );
  });

  it("rejects cross-actor and malformed input before calling Postgres", async () => {
    const invokeRpc = vi.fn();
    const store = new SupabaseResearchProviderAcceptanceStore({
      actorId: ACTOR_ID,
      invokeRpc,
    });
    await expect(
      store.acceptProviderRun({
        actorId: CASE_ID,
        lease,
        checkpoint,
        providerRun,
        leaseDurationSeconds: 120,
      }),
    ).rejects.toMatchObject({ code: "ACTOR_SCOPE_MISMATCH" });
    await expect(
      store.acceptProviderRun({
        actorId: ACTOR_ID,
        lease,
        checkpoint: { ...checkpoint, providerRunId: null },
        providerRun,
        leaseDurationSeconds: 120,
      }),
    ).rejects.toMatchObject({ code: "INVALID_ATOMIC_MUTATION" });
    expect(invokeRpc).not.toHaveBeenCalled();
  });

  it("never exposes database or private provider diagnostics", async () => {
    const secret = "private question and provider response body";
    const invokeRpc = vi.fn().mockResolvedValue({
      data: null,
      error: { code: "AFR04", message: secret },
    });
    const store = new SupabaseResearchProviderAcceptanceStore({
      actorId: ACTOR_ID,
      invokeRpc,
    });
    const rejection = store.acceptProviderRun({
      actorId: ACTOR_ID,
      lease,
      checkpoint,
      providerRun,
      leaseDurationSeconds: 120,
    });
    await expect(rejection).rejects.toBeInstanceOf(
      SupabaseResearchProviderAcceptanceStoreError,
    );
    await expect(rejection).rejects.not.toThrow(secret);
  });
});
