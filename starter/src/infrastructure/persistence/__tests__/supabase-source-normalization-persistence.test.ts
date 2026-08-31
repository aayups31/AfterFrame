import { describe, expect, it, vi } from "vitest";
import { SupabaseSourceNormalizationPersistence } from "@/infrastructure/persistence/supabase-source-normalization-persistence";

const ACTOR_ID = "9a000000-0000-4000-8000-000000000001";
const OTHER_ACTOR_ID = "9a000000-0000-4000-8000-000000000002";
const RUN_ID = "9a000000-0000-4000-8000-000000000003";
const JOB_ID = "9a000000-0000-4000-8000-000000000004";
const ATTEMPT_ID = "9a000000-0000-4000-8000-000000000005";
const HASH = "a".repeat(64);
const normalization = {
  schemaVersion: 1,
  id: "9a000000-0000-4000-8000-000000000006",
  runId: RUN_ID,
  jobId: JOB_ID,
  attemptId: ATTEMPT_ID,
  caseId: "9a000000-0000-4000-8000-000000000007",
  manifestFingerprint: HASH,
  retrievalRecordId: "9a000000-0000-4000-8000-000000000008",
  idempotencyKey: "normalize-once",
  normalizer: {
    id: "deterministic-hostile-document-normalizer",
    version: "1.0.0",
  },
  result: {
    status: "UNAVAILABLE",
    candidateId: "9a000000-0000-4000-8000-000000000009",
    retrievalRecordId: "9a000000-0000-4000-8000-000000000008",
    sourceId: "9a000000-0000-4000-8000-000000000010",
    sourceLocatorId: "9a000000-0000-4000-8000-000000000011",
    code: "normalization-unsupported-media",
    instructionAuthority: "NONE",
    publicationAuthority: "NONE",
  },
  createdAt: "2026-08-31T05:00:00.000Z",
  normalizationFingerprint: "b".repeat(64),
  acceptedAt: "2026-08-31T05:00:01.000Z",
} as const;

describe("SupabaseSourceNormalizationPersistence", () => {
  it("reads strict text-free normalization records through the actor RPC", async () => {
    const invokeRpc = vi.fn(async () => ({ data: [normalization], error: null }));
    const persistence = new SupabaseSourceNormalizationPersistence({
      actorId: ACTOR_ID,
      invokeRpc,
    });

    await expect(
      persistence.listAcceptedNormalizations({
        actorId: ACTOR_ID,
        runId: RUN_ID,
        jobId: JOB_ID,
        attemptId: ATTEMPT_ID,
      }),
    ).resolves.toEqual([normalization]);
    expect(invokeRpc).toHaveBeenCalledWith(
      "af_get_source_normalization_records_v1",
      {
        p_actor_id: ACTOR_ID,
        p_run_id: RUN_ID,
        p_job_id: JOB_ID,
        p_attempt_id: ATTEMPT_ID,
      },
    );
  });

  it("rejects actor substitution without invoking Postgres", async () => {
    const invokeRpc = vi.fn();
    const persistence = new SupabaseSourceNormalizationPersistence({
      actorId: ACTOR_ID,
      invokeRpc,
    });
    await expect(
      persistence.listAcceptedNormalizations({
        actorId: OTHER_ACTOR_ID,
        runId: RUN_ID,
        jobId: JOB_ID,
        attemptId: ATTEMPT_ID,
      }),
    ).resolves.toEqual([]);
    expect(invokeRpc).not.toHaveBeenCalled();
  });

  it("fails closed when a source body appears in the database contract", async () => {
    const persistence = new SupabaseSourceNormalizationPersistence({
      actorId: ACTOR_ID,
      invokeRpc: vi.fn(async () => ({
        data: [{ ...normalization, sourceBody: "must never cross" }],
        error: null,
      })),
    });
    await expect(
      persistence.listAcceptedNormalizations({
        actorId: ACTOR_ID,
        runId: RUN_ID,
        jobId: JOB_ID,
        attemptId: ATTEMPT_ID,
      }),
    ).rejects.toMatchObject({
      code: "RPC_CONTRACT_INVALID",
      message: "Postgres returned invalid accepted source normalizations",
    });
  });
});
