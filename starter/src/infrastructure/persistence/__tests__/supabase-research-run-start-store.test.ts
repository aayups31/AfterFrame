import { describe, expect, it, vi } from "vitest";
import { ResearchRunOutboxEventSchema } from "@/contracts/research-runs";
import { START_RESEARCH_RUN_COMMAND } from "@/core/research-runs/ports";
import {
  BLACK_HAWK_DOWN_CASE,
  BLACK_HAWK_DOWN_ROOT_BRANCH,
} from "@/fixtures/black-hawk-down/deterministic-spine.fixture";
import {
  BLACK_HAWK_DOWN_RESEARCH_BUNDLE,
  BLACK_HAWK_DOWN_RESEARCH_IDS,
  BLACK_HAWK_DOWN_RESEARCH_TIME,
} from "@/fixtures/black-hawk-down/research-run.fixture";
import {
  SupabaseResearchRunStartError,
  SupabaseResearchRunStartStore,
} from "@/infrastructure/persistence/supabase-research-run-start-store";

const REQUEST_FINGERPRINT = "1".repeat(64);
const IDEMPOTENCY_KEY = "research-run-start:test:v1";
const RESERVATION_TOKEN = "40000000-0000-4000-8000-000000000001";

const outboxEvents = [
  ResearchRunOutboxEventSchema.parse({
    id: "40000000-0000-4000-8000-000000000010",
    event: {
      id: "40000000-0000-4000-8000-000000000011",
      type: "research.run_created",
      schemaVersion: 1,
      aggregateType: "research_run",
      aggregateId: BLACK_HAWK_DOWN_RESEARCH_IDS.run,
      sequence: 1,
      aggregateVersion: 0,
      occurredAt: BLACK_HAWK_DOWN_RESEARCH_TIME,
      publicationAuthority: "NONE",
      payload: {
        caseId: BLACK_HAWK_DOWN_CASE.id,
        branchId: BLACK_HAWK_DOWN_ROOT_BRANCH.id,
        planId: BLACK_HAWK_DOWN_RESEARCH_IDS.plan,
        specialistId: BLACK_HAWK_DOWN_CASE.specialistId,
        specialistVersion: BLACK_HAWK_DOWN_CASE.specialistVersion,
      },
    },
    recordedAt: BLACK_HAWK_DOWN_RESEARCH_TIME,
    deliveryAttempts: 0,
    deliveredAt: null,
  }),
  ResearchRunOutboxEventSchema.parse({
    id: "40000000-0000-4000-8000-000000000012",
    event: {
      id: "40000000-0000-4000-8000-000000000013",
      type: "research.jobs_staged",
      schemaVersion: 1,
      aggregateType: "research_run",
      aggregateId: BLACK_HAWK_DOWN_RESEARCH_IDS.run,
      sequence: 2,
      aggregateVersion: 0,
      occurredAt: BLACK_HAWK_DOWN_RESEARCH_TIME,
      publicationAuthority: "NONE",
      payload: {
        jobs: BLACK_HAWK_DOWN_RESEARCH_BUNDLE.jobs.map((job) => ({
          jobId: job.id,
          stage: job.stage,
          dependsOnJobId: job.dependsOnJobId,
        })),
      },
    },
    recordedAt: BLACK_HAWK_DOWN_RESEARCH_TIME,
    deliveryAttempts: 0,
    deliveredAt: null,
  }),
] as const;

const storedResult = {
  bundle: BLACK_HAWK_DOWN_RESEARCH_BUNDLE,
  outboxEvents,
};

const scope = {
  actorId: BLACK_HAWK_DOWN_CASE.ownerId,
  commandName: START_RESEARCH_RUN_COMMAND,
  idempotencyKey: IDEMPOTENCY_KEY,
} as const;

describe("Supabase research-run start store", () => {
  it("reserves before work with the authenticated actor and bounded lease", async () => {
    const invokeRpc = vi.fn(async () => ({
      data: { status: "ACQUIRED", reservationToken: RESERVATION_TOKEN },
      error: null,
    }));
    const store = new SupabaseResearchRunStartStore({
      actorId: BLACK_HAWK_DOWN_CASE.ownerId,
      invokeRpc,
      reservationLeaseSeconds: 75,
    });

    await expect(
      store.reserveResearchRunStart({ scope, requestFingerprint: REQUEST_FINGERPRINT }),
    ).resolves.toEqual({
      status: "ACQUIRED",
      reservationToken: RESERVATION_TOKEN,
    });
    expect(invokeRpc).toHaveBeenCalledWith(
      "af_reserve_research_run_start_v1",
      {
        p_actor_id: BLACK_HAWK_DOWN_CASE.ownerId,
        p_idempotency_key: IDEMPOTENCY_KEY,
        p_request_fingerprint: REQUEST_FINGERPRINT,
        p_lease_seconds: 75,
      },
    );
  });

  it("commits only canonical initial state through one RPC", async () => {
    const invokeRpc = vi.fn(async () => ({
      data: { replayed: false, result: storedResult },
      error: null,
    }));
    const store = new SupabaseResearchRunStartStore({
      actorId: BLACK_HAWK_DOWN_CASE.ownerId,
      invokeRpc,
    });

    const committed = await store.commitResearchRunStart({
      scope,
      requestFingerprint: REQUEST_FINGERPRINT,
      reservationToken: RESERVATION_TOKEN,
      expectedCaseVersion: BLACK_HAWK_DOWN_CASE.aggregateVersion,
      result: storedResult,
    });

    expect(committed).toEqual({ replayed: false, result: storedResult });
    expect(invokeRpc).toHaveBeenCalledTimes(1);
    expect(invokeRpc).toHaveBeenCalledWith(
      "af_commit_research_run_start_v1",
      expect.objectContaining({
        p_actor_id: BLACK_HAWK_DOWN_CASE.ownerId,
        p_expected_case_version: BLACK_HAWK_DOWN_CASE.aggregateVersion,
        p_result: storedResult,
      }),
    );
  });

  it("fails locally on actor substitution without touching Postgres", async () => {
    const invokeRpc = vi.fn();
    const store = new SupabaseResearchRunStartStore({
      actorId: BLACK_HAWK_DOWN_CASE.ownerId,
      invokeRpc,
    });

    await expect(
      store.reserveResearchRunStart({
        scope: {
          ...scope,
          actorId: "40000000-0000-4000-8000-000000000099",
        },
        requestFingerprint: REQUEST_FINGERPRINT,
      }),
    ).rejects.toMatchObject({ code: "INVALID_ATOMIC_MUTATION" });
    expect(invokeRpc).not.toHaveBeenCalled();
  });

  it("maps SQLSTATE without leaking provider diagnostics", async () => {
    const invokeRpc = vi.fn(async () => ({
      data: null,
      error: {
        code: "AFR02",
        message: `private diagnostic: ${BLACK_HAWK_DOWN_CASE.exactCuriosity}`,
      },
    }));
    const store = new SupabaseResearchRunStartStore({
      actorId: BLACK_HAWK_DOWN_CASE.ownerId,
      invokeRpc,
    });

    let rejection: unknown;
    try {
      await store.reserveResearchRunStart({
        scope,
        requestFingerprint: REQUEST_FINGERPRINT,
      });
    } catch (error) {
      rejection = error;
    }
    expect(rejection).toBeInstanceOf(SupabaseResearchRunStartError);
    expect(rejection).toMatchObject({ code: "IDEMPOTENCY_KEY_REUSED" });
    expect(String(rejection)).not.toContain(BLACK_HAWK_DOWN_CASE.exactCuriosity);
  });

  it("reduces thrown transport failures to one body-free error", async () => {
    const invokeRpc = vi.fn(async () => {
      throw new Error(
        `database host and private diagnostic: ${BLACK_HAWK_DOWN_CASE.exactCuriosity}`,
      );
    });
    const store = new SupabaseResearchRunStartStore({
      actorId: BLACK_HAWK_DOWN_CASE.ownerId,
      invokeRpc,
    });

    await expect(
      store.reserveResearchRunStart({
        scope,
        requestFingerprint: REQUEST_FINGERPRINT,
      }),
    ).rejects.toMatchObject({
      code: "PERSISTENCE_UNAVAILABLE",
      message: "The durable research-run store is unavailable",
    });
  });

  it("rejects malformed replay contracts instead of trusting RPC JSON", async () => {
    const invokeRpc = vi.fn(async () => ({
      data: {
        status: "REPLAY",
        requestFingerprint: REQUEST_FINGERPRINT,
        result: { ...storedResult, privateBody: "must not cross" },
      },
      error: null,
    }));
    const store = new SupabaseResearchRunStartStore({
      actorId: BLACK_HAWK_DOWN_CASE.ownerId,
      invokeRpc,
    });

    await expect(
      store.reserveResearchRunStart({ scope, requestFingerprint: REQUEST_FINGERPRINT }),
    ).rejects.toMatchObject({ code: "RPC_CONTRACT_INVALID" });
  });
});
