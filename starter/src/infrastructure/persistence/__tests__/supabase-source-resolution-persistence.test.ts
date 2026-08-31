import { describe, expect, it, vi } from "vitest";
import type { DurableSourceResolutionRecord } from "@/application/research/source-resolution-port";
import {
  SupabaseSourceResolutionPersistence,
  SupabaseSourceResolutionPersistenceError,
} from "@/infrastructure/persistence/supabase-source-resolution-persistence";

const ACTOR_ID = "72000000-0000-4000-8000-000000000001";
const RUN_ID = "72000000-0000-4000-8000-000000000002";
const JOB_ID = "72000000-0000-4000-8000-000000000003";
const ATTEMPT_ID = "72000000-0000-4000-8000-000000000004";
const CASE_ID = "72000000-0000-4000-8000-000000000005";
const CANDIDATE_ID = "72000000-0000-4000-8000-000000000006";
const HASH = "c".repeat(64);
const T1 = "2026-08-25T16:00:00.000Z";
const T2 = "2026-08-25T16:01:00.000Z";

const record: DurableSourceResolutionRecord = {
  schemaVersion: 1,
  id: "72000000-0000-4000-8000-000000000007",
  runId: RUN_ID,
  jobId: JOB_ID,
  attemptId: ATTEMPT_ID,
  caseId: CASE_ID,
  manifestFingerprint: HASH,
  idempotencyKey: "resolution:candidate:unavailable",
  resolver: { id: "http-source-metadata", version: "1.0.0" },
  result: {
    status: "UNRESOLVED",
    candidateId: CANDIDATE_ID,
    code: "source-unavailable",
    publicationAuthority: "NONE",
  },
  createdAt: T1,
};

const stored = {
  ...record,
  resolutionFingerprint: "e".repeat(64),
  acceptedAt: T2,
};

describe("SupabaseSourceResolutionPersistence", () => {
  it("reads exact actor-scoped resolution context", async () => {
    const context = {
      schemaVersion: 1,
      runId: RUN_ID,
      jobId: JOB_ID,
      attemptId: ATTEMPT_ID,
      caseId: CASE_ID,
      manifestFingerprint: HASH,
      candidates: [],
    };
    const invokeRpc = vi.fn().mockResolvedValue({ data: context, error: null });
    const persistence = new SupabaseSourceResolutionPersistence({
      actorId: ACTOR_ID,
      invokeRpc,
    });
    await expect(
      persistence.getResolutionContext({
        actorId: ACTOR_ID,
        runId: RUN_ID,
        jobId: JOB_ID,
        attemptId: ATTEMPT_ID,
      }),
    ).resolves.toEqual(context);
    expect(invokeRpc).toHaveBeenCalledWith(
      "af_get_research_resolution_context_v1",
      {
        p_actor_id: ACTOR_ID,
        p_run_id: RUN_ID,
        p_job_id: JOB_ID,
        p_attempt_id: ATTEMPT_ID,
      },
    );
  });

  it("recovers the exact accepted resolution ledger", async () => {
    const invokeRpc = vi.fn().mockResolvedValue({ data: [stored], error: null });
    const persistence = new SupabaseSourceResolutionPersistence({
      actorId: ACTOR_ID,
      invokeRpc,
    });
    await expect(
      persistence.listAcceptedResolutions({
        actorId: ACTOR_ID,
        runId: RUN_ID,
        jobId: JOB_ID,
        attemptId: ATTEMPT_ID,
      }),
    ).resolves.toEqual([stored]);
  });

  it("rejects expanded persistence responses without leaking their body", async () => {
    const secret = "private source body";
    const invokeRpc = vi.fn().mockResolvedValue({
      data: [{ ...stored, sourceBody: secret }],
      error: null,
    });
    const persistence = new SupabaseSourceResolutionPersistence({
      actorId: ACTOR_ID,
      invokeRpc,
    });
    const result = persistence.listAcceptedResolutions({
      actorId: ACTOR_ID,
      runId: RUN_ID,
      jobId: JOB_ID,
      attemptId: ATTEMPT_ID,
    });
    await expect(result).rejects.toBeInstanceOf(
      SupabaseSourceResolutionPersistenceError,
    );
    await expect(result).rejects.not.toThrow(secret);
  });
});
