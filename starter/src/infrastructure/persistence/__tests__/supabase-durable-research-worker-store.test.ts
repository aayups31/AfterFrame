import { describe, expect, it } from "vitest";
import type {
  AcceptResearchProviderRunInput,
  AcceptSourceResolutionInput,
  AcceptSourceRetrievalInput,
  AcceptSourceNormalizationInput,
  CheckpointResearchJobInput,
  ClaimResearchJobInput,
  CompleteDurableResearchJobInput,
  FailDurableResearchJobInput,
  HeartbeatResearchJobInput,
  ReleaseResearchJobInput,
} from "@/core/research-runs/ports";
import {
  BLACK_HAWK_DOWN_RESEARCH_BUNDLE,
  blackHawkDownStageResult,
} from "@/fixtures/black-hawk-down/research-run.fixture";
import {
  SupabaseDurableResearchWorkerError,
  SupabaseDurableResearchWorkerStore,
} from "@/infrastructure/persistence/supabase-durable-research-worker-store";
import type { SupabaseRpcInvoker } from "@/infrastructure/persistence/supabase-investigation-store";

const ACTOR_ID = "41000000-0000-4000-8000-000000000001";
const OTHER_ACTOR_ID = "41000000-0000-4000-8000-000000000002";
const ATTEMPT_ID = "41000000-0000-4000-8000-000000000003";
const CHECKPOINT_ID = "41000000-0000-4000-8000-000000000004";
const T1 = "2026-08-08T17:01:00.000Z";
const T2 = "2026-08-08T17:02:00.000Z";
const T3 = "2026-08-08T17:03:00.000Z";
const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const HASH_C = "c".repeat(64);
const runId = BLACK_HAWK_DOWN_RESEARCH_BUNDLE.run.id;
const jobId = BLACK_HAWK_DOWN_RESEARCH_BUNDLE.jobs[0]!.id;

const executionPlan = {
  executorId: "identity-resolver",
  executorVersion: "1",
  configurationFingerprint: HASH_A,
  executionKind: "RESOLVER",
  model: null,
  prompt: null,
  schema: {
    id: "identity-result",
    version: "1",
    schemaFingerprint: HASH_B,
  },
  tool: { id: "movie-identity", version: "1" },
  privateContentIncluded: false,
  automaticRetrySafety: "IDEMPOTENT_PROVIDER_REQUEST",
} as const;

const lease = {
  schemaVersion: 1,
  runId,
  jobId,
  attemptId: ATTEMPT_ID,
  workerId: "worker-checkpoint-03",
  leaseToken: "lease-token-1",
  leaseEpoch: 1,
  runVersion: 1,
  jobVersion: 1,
  attemptVersion: 0,
  claimedAt: T1,
  heartbeatAt: T1,
  expiresAt: T3,
  externalIdempotencyKey: HASH_C,
} as const;

const completion = {
  telemetryState: "COMPLETE",
  providerRunId: "provider-run-1",
  usage: {
    inputTokens: 10,
    outputTokens: 20,
    toolCalls: 1,
    inputBytes: 100,
    outputBytes: 200,
  },
  cost: {
    currency: "USD",
    pricingState: "UNPRICED",
    amountMicros: null,
  },
  latencyMs: 1_000,
  completedAt: T2,
} as const;

const failure = {
  schemaVersion: 1,
  code: "provider-timeout",
  category: "TIMEOUT",
  phase: "EXTERNAL_CALL",
  retryDirective: "RETRY_WITH_BACKOFF",
  retryAfterMs: 1_000,
  providerStatusCode: null,
  diagnosticFingerprint: HASH_A,
  redactionState: "BODY_FREE",
} as const;

const claimInput: ClaimResearchJobInput = {
  actorId: ACTOR_ID,
  runId,
  jobId,
  stage: "IDENTITY",
  expectedRunVersion: 0,
  expectedJobVersion: 0,
  idempotencyKey: "identity-once",
  attemptId: ATTEMPT_ID,
  workerId: "worker-checkpoint-03",
  execution: executionPlan,
  leaseDurationSeconds: 60,
};

const heartbeatInput: HeartbeatResearchJobInput = {
  actorId: ACTOR_ID,
  lease,
  leaseDurationSeconds: 60,
  occurredAt: T2,
};

const checkpointInput: CheckpointResearchJobInput = {
  actorId: ACTOR_ID,
  lease,
  checkpoint: {
    schemaVersion: 1,
    id: CHECKPOINT_ID,
    runId,
    jobId,
    attemptId: ATTEMPT_ID,
    idempotencyKey: "provider-accepted-once",
    sequence: 1,
    kind: "PROVIDER_ACCEPTED",
    completedUnits: 0,
    totalUnits: 1,
    providerRunId: "provider-run-1",
    resumeTokenFingerprint: null,
    outputFingerprint: null,
    publicationAuthority: "NONE",
    createdAt: T2,
  },
  leaseDurationSeconds: 60,
};

const acceptanceInput: AcceptResearchProviderRunInput = {
  ...checkpointInput,
  providerRun: {
    schemaVersion: 1,
    runId,
    jobId,
    attemptId: ATTEMPT_ID,
    caseId: BLACK_HAWK_DOWN_RESEARCH_BUNDLE.run.caseId,
    provider: "openai",
    providerResponseId: "provider-run-1",
    state: "IN_PROGRESS",
    requestedModel: "gpt-test",
    providerModel: "gpt-test-2026-08-01",
    traceId: "trace-provider-run-1",
    manifestFingerprint: HASH_A,
    externalIdempotencyKey: HASH_C,
    startedAt: T1,
    acceptedAt: T2,
    lastObservedAt: T2,
    inputBytes: 100,
    dataControlMode: "MODIFIED_ABUSE_MONITORING",
    projectIdFingerprint: HASH_B,
    privateContentIncluded: true,
    publicationAuthority: "NONE",
  },
};

const completeInput: CompleteDurableResearchJobInput = {
  actorId: ACTOR_ID,
  lease,
  idempotencyKey: "complete-once",
  result: blackHawkDownStageResult("IDENTITY", ATTEMPT_ID, T2),
  outputFingerprint: HASH_B,
  execution: completion,
};

const failInput: FailDurableResearchJobInput = {
  actorId: ACTOR_ID,
  lease,
  idempotencyKey: "failure-once",
  failure,
  execution: completion,
};

const releaseInput: ReleaseResearchJobInput = {
  ...failInput,
  idempotencyKey: "release-once",
};

const sourceResolutionInput: AcceptSourceResolutionInput = {
  actorId: ACTOR_ID,
  lease,
  leaseDurationSeconds: 60,
  record: {
    schemaVersion: 1,
    id: "41000000-0000-4000-8000-000000000009",
    runId,
    jobId,
    attemptId: ATTEMPT_ID,
    caseId: BLACK_HAWK_DOWN_RESEARCH_BUNDLE.run.caseId,
    manifestFingerprint: HASH_A,
    idempotencyKey: "resolve-candidate-once",
    resolver: { id: "http-source-metadata", version: "1.0.0" },
    result: {
      status: "UNRESOLVED",
      candidateId: "41000000-0000-4000-8000-000000000010",
      code: "source-unavailable",
      publicationAuthority: "NONE",
    },
    createdAt: T2,
  },
};

const sourceRetrievalInput: AcceptSourceRetrievalInput = {
  actorId: ACTOR_ID,
  lease,
  leaseDurationSeconds: 60,
  record: {
    schemaVersion: 1,
    id: "41000000-0000-4000-8000-000000000011",
    runId,
    jobId,
    attemptId: ATTEMPT_ID,
    caseId: BLACK_HAWK_DOWN_RESEARCH_BUNDLE.run.caseId,
    manifestFingerprint: HASH_A,
    resolutionRecordId: "41000000-0000-4000-8000-000000000012",
    idempotencyKey: "retrieve-candidate-once",
    policy: { id: "lawful-source-retrieval", version: "1.0.0" },
    retriever: { id: "public-source-retriever", version: "1.0.0" },
    result: {
      status: "UNAVAILABLE",
      candidateId: "41000000-0000-4000-8000-000000000010",
      sourceId: "41000000-0000-4000-8000-000000000013",
      sourceLocatorId: "41000000-0000-4000-8000-000000000014",
      code: "retrieval-upstream-unavailable",
      instructionAuthority: "NONE",
      publicationAuthority: "NONE",
    },
    createdAt: T2,
  },
};

const sourceNormalizationInput: AcceptSourceNormalizationInput = {
  actorId: ACTOR_ID,
  lease,
  leaseDurationSeconds: 60,
  record: {
    schemaVersion: 1,
    id: "41000000-0000-4000-8000-000000000015",
    runId,
    jobId,
    attemptId: ATTEMPT_ID,
    caseId: BLACK_HAWK_DOWN_RESEARCH_BUNDLE.run.caseId,
    manifestFingerprint: HASH_A,
    retrievalRecordId: "41000000-0000-4000-8000-000000000011",
    idempotencyKey: "normalize-candidate-once",
    normalizer: {
      id: "deterministic-hostile-document-normalizer",
      version: "1.0.0",
    },
    result: {
      status: "UNAVAILABLE",
      candidateId: "41000000-0000-4000-8000-000000000010",
      retrievalRecordId: "41000000-0000-4000-8000-000000000011",
      sourceId: "41000000-0000-4000-8000-000000000013",
      sourceLocatorId: "41000000-0000-4000-8000-000000000014",
      code: "normalization-unsupported-media",
      instructionAuthority: "NONE",
      publicationAuthority: "NONE",
    },
    createdAt: T2,
  },
};

describe("Supabase durable research worker store", () => {
  it("delegates every state transition to one versioned RPC with a JSON lease cursor", async () => {
    const calls: Array<{
      name: string;
      parameters: Record<string, unknown>;
    }> = [];
    const responses: Record<string, unknown> = {
      af_claim_research_job_v2: {
        status: "IN_PROGRESS",
        retryAfterMs: 500,
      },
      af_heartbeat_research_job_v1: { status: "CANCELLED" },
      af_checkpoint_research_job_v1: { status: "LEASE_LOST" },
      af_accept_research_provider_run_v1: { status: "LEASE_LOST" },
      af_accept_source_resolution_v1: { status: "LEASE_LOST" },
      af_accept_source_retrieval_v1: { status: "LEASE_LOST" },
      af_accept_source_normalization_v1: { status: "LEASE_LOST" },
      af_complete_research_job_v2: { status: "CANCELLED" },
      af_fail_research_job_v1: { status: "LEASE_LOST" },
      af_release_research_job_v1: { status: "CANCELLED" },
    };
    const invokeRpc: SupabaseRpcInvoker = async (name, parameters) => {
      calls.push({ name, parameters });
      return { data: responses[name], error: null };
    };
    const store = new SupabaseDurableResearchWorkerStore({
      actorId: ACTOR_ID,
      invokeRpc,
    });

    await store.claimResearchJob(claimInput);
    await store.heartbeatResearchJob(heartbeatInput);
    await store.checkpointResearchJob(checkpointInput);
    await store.acceptResearchProviderRun(acceptanceInput);
    await store.acceptSourceResolution(sourceResolutionInput);
    await store.acceptSourceRetrieval(sourceRetrievalInput);
    await store.acceptSourceNormalization(sourceNormalizationInput);
    await store.completeResearchJob(completeInput);
    await store.failResearchJob(failInput);
    await store.releaseResearchJob(releaseInput);

    expect(calls.map(({ name }) => name)).toEqual([
      "af_claim_research_job_v2",
      "af_heartbeat_research_job_v1",
      "af_checkpoint_research_job_v1",
      "af_accept_research_provider_run_v1",
      "af_accept_source_resolution_v1",
      "af_accept_source_retrieval_v1",
      "af_accept_source_normalization_v1",
      "af_complete_research_job_v2",
      "af_fail_research_job_v1",
      "af_release_research_job_v1",
    ]);
    expect(calls[0]?.parameters).toEqual({
      p_actor_id: ACTOR_ID,
      p_run_id: runId,
      p_job_id: jobId,
      p_stage: "IDENTITY",
      p_expected_run_version: 0,
      p_expected_job_version: 0,
      p_idempotency_key: "identity-once",
      p_attempt_id: ATTEMPT_ID,
      p_worker_id: "worker-checkpoint-03",
      p_execution: executionPlan,
      p_lease_seconds: 60,
    });
    expect(calls[1]?.parameters).toEqual({
      p_actor_id: ACTOR_ID,
      p_lease: lease,
      p_lease_seconds: 60,
      p_occurred_at: T2,
    });
    expect(calls[2]?.parameters).toEqual({
      p_actor_id: ACTOR_ID,
      p_lease: lease,
      p_checkpoint: checkpointInput.checkpoint,
      p_lease_seconds: 60,
    });
    expect(calls[3]?.parameters).toEqual({
      p_actor_id: ACTOR_ID,
      p_lease: lease,
      p_checkpoint: checkpointInput.checkpoint,
      p_provider_run: acceptanceInput.providerRun,
      p_lease_seconds: 60,
    });
    expect(calls[4]?.parameters).toEqual({
      p_actor_id: ACTOR_ID,
      p_lease: lease,
      p_record: sourceResolutionInput.record,
      p_lease_seconds: 60,
    });
    expect(calls[5]?.parameters).toEqual({
      p_actor_id: ACTOR_ID,
      p_lease: lease,
      p_record: sourceRetrievalInput.record,
      p_lease_seconds: 60,
    });
    expect(calls[6]?.parameters).toEqual({
      p_actor_id: ACTOR_ID,
      p_lease: lease,
      p_record: sourceNormalizationInput.record,
      p_lease_seconds: 60,
    });
    expect(calls[7]?.parameters).toEqual({
      p_actor_id: ACTOR_ID,
      p_lease: lease,
      p_idempotency_key: "complete-once",
      p_result: completeInput.result,
      p_output_fingerprint: HASH_B,
      p_execution: completion,
    });
    expect(calls[8]?.parameters).toEqual({
      p_actor_id: ACTOR_ID,
      p_lease: lease,
      p_idempotency_key: "failure-once",
      p_failure: failure,
      p_execution: completion,
    });
    expect(calls[9]?.parameters).toEqual({
      p_actor_id: ACTOR_ID,
      p_lease: lease,
      p_idempotency_key: "release-once",
      p_failure: failure,
      p_execution: completion,
    });
    for (const call of calls.slice(1)) {
      expect(Object.keys(call.parameters)).not.toContain("p_run_id");
      expect(call.parameters.p_lease).toEqual(lease);
    }
  });

  it("rejects actor substitution before invoking Postgres", async () => {
    let calls = 0;
    const store = new SupabaseDurableResearchWorkerStore({
      actorId: ACTOR_ID,
      invokeRpc: async () => {
        calls += 1;
        return { data: null, error: null };
      },
    });

    await expect(
      store.claimResearchJob({ ...claimInput, actorId: OTHER_ACTOR_ID }),
    ).rejects.toMatchObject({
      code: "ACTOR_SCOPE_MISMATCH_OR_NOT_FOUND",
    });
    expect(calls).toBe(0);
  });

  it("strictly rejects malformed RPC data and does not persist unknown fields", async () => {
    const store = new SupabaseDurableResearchWorkerStore({
      actorId: ACTOR_ID,
      invokeRpc: async () => ({
        data: {
          status: "IN_PROGRESS",
          retryAfterMs: 500,
          sourceBody: "must-not-cross-the-boundary",
        },
        error: null,
      }),
    });

    await expect(store.claimResearchJob(claimInput)).rejects.toMatchObject({
      code: "RPC_CONTRACT_INVALID",
      message: "Postgres returned an invalid durable worker contract",
    });
  });

  it("accepts a bounded terminal release when Postgres exhausts the handoff budget", async () => {
    const store = new SupabaseDurableResearchWorkerStore({
      actorId: ACTOR_ID,
      invokeRpc: async () => ({
        data: {
          status: "FAILED_TERMINAL",
          terminal: {
            runId,
            jobId,
            attemptId: ATTEMPT_ID,
            jobStatus: "FAILED_TERMINAL",
          },
          replayed: false,
        },
        error: null,
      }),
    });

    await expect(store.releaseResearchJob(releaseInput)).resolves.toEqual({
      status: "FAILED_TERMINAL",
      terminal: {
        runId,
        jobId,
        attemptId: ATTEMPT_ID,
        jobStatus: "FAILED_TERMINAL",
      },
      replayed: false,
    });
  });

  it.each([
    ["AFR01", "VERSION_CONFLICT"],
    ["AFR02", "IDEMPOTENCY_KEY_REUSED"],
    ["AFR03", "IDENTIFIER_COLLISION"],
    ["AFR04", "INVALID_ATOMIC_MUTATION"],
    ["AFR05", "ACTOR_SCOPE_MISMATCH_OR_NOT_FOUND"],
    ["AFR06", "LEASE_MISMATCH"],
    ["AFR07", "RESEARCH_NOT_EXECUTABLE"],
    ["AFR08", "ACTIVE_RESEARCH_RUN_EXISTS"],
  ] as const)("maps %s without exposing database detail", async (rpcCode, code) => {
    const store = new SupabaseDurableResearchWorkerStore({
      actorId: ACTOR_ID,
      invokeRpc: async () => ({
        data: null,
        error: { code: rpcCode, message: "private source body" },
      }),
    });

    let caught: unknown;
    try {
      await store.claimResearchJob(claimInput);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(SupabaseDurableResearchWorkerError);
    expect(caught).toMatchObject({ code });
    expect((caught as Error).message).not.toContain("private source body");
  });

  it("reduces thrown transport failures to one bounded error", async () => {
    const store = new SupabaseDurableResearchWorkerStore({
      actorId: ACTOR_ID,
      invokeRpc: async () => {
        throw new Error("database host and private diagnostic");
      },
    });

    await expect(store.claimResearchJob(claimInput)).rejects.toMatchObject({
      code: "PERSISTENCE_UNAVAILABLE",
      message: "The durable research worker store is unavailable",
    });
  });
});
