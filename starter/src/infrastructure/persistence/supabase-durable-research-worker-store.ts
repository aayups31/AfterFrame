import { z } from "zod";
import {
  CheckpointResearchJobLeaseCommandSchema,
  ClaimResearchJobLeaseCommandSchema,
  CompleteResearchJobLeaseCommandSchema,
  FailResearchJobLeaseCommandSchema,
  HeartbeatResearchJobLeaseCommandSchema,
  ReleaseResearchJobLeaseCommandSchema,
} from "@/contracts/research-worker";
import type {
  CheckpointResearchJobInput,
  AcceptResearchProviderRunInput,
  AcceptSourceResolutionInput,
  AcceptSourceRetrievalInput,
  AcceptSourceNormalizationInput,
  ClaimResearchJobInput,
  CompleteDurableResearchJobInput,
  DurableResearchWorkerStore,
  FailDurableResearchJobInput,
  HeartbeatResearchJobInput,
  ReleaseResearchJobInput,
} from "@/core/research-runs/ports";
import { ResearchProviderAcceptanceResultSchema } from "@/core/research-runs/provider-runs";
import {
  DurableSourceResolutionRecordSchema,
  SourceResolutionAcceptanceResultSchema,
} from "@/core/research/source-resolution";
import {
  DurableSourceRetrievalRecordSchema,
  SourceRetrievalAcceptanceResultSchema,
} from "@/core/research/source-retrieval";
import {
  DurableSourceNormalizationRecordSchema,
  SourceNormalizationAcceptanceResultSchema,
} from "@/core/research/source-normalization";
import {
  ResearchJobCheckpointResultSchema,
  ResearchJobClaimResultSchema,
  ResearchJobCompletionResultSchema,
  ResearchJobFailureResultSchema,
  ResearchJobHeartbeatResultSchema,
  ResearchJobReleaseResultSchema,
} from "@/core/research-runs/worker-schemas";
import { EntityIdSchema } from "@/core/shared/schemas";
import type { SupabaseRpcInvoker } from "@/infrastructure/persistence/supabase-investigation-store";

export type SupabaseDurableResearchWorkerErrorCode =
  | "VERSION_CONFLICT"
  | "IDEMPOTENCY_KEY_REUSED"
  | "IDENTIFIER_COLLISION"
  | "INVALID_ATOMIC_MUTATION"
  | "ACTOR_SCOPE_MISMATCH_OR_NOT_FOUND"
  | "LEASE_MISMATCH"
  | "RESEARCH_NOT_EXECUTABLE"
  | "ACTIVE_RESEARCH_RUN_EXISTS"
  | "PERSISTENCE_UNAVAILABLE"
  | "RPC_CONTRACT_INVALID";

/** Error text is deliberately bounded and never includes Postgres detail. */
export class SupabaseDurableResearchWorkerError extends Error {
  constructor(
    readonly code: SupabaseDurableResearchWorkerErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "SupabaseDurableResearchWorkerError";
  }
}

type RpcError = Readonly<{ code?: string; message?: string }>;

function throwMappedRpcError(error: RpcError): never {
  const mapped = {
    AFR01: "VERSION_CONFLICT",
    AFR02: "IDEMPOTENCY_KEY_REUSED",
    AFR03: "IDENTIFIER_COLLISION",
    AFR04: "INVALID_ATOMIC_MUTATION",
    AFR05: "ACTOR_SCOPE_MISMATCH_OR_NOT_FOUND",
    AFR06: "LEASE_MISMATCH",
    AFR07: "RESEARCH_NOT_EXECUTABLE",
    AFR08: "ACTIVE_RESEARCH_RUN_EXISTS",
    "40001": "VERSION_CONFLICT",
    "23505": "IDENTIFIER_COLLISION",
  } as const;
  const code =
    error.code === undefined
      ? undefined
      : mapped[error.code as keyof typeof mapped];
  if (code !== undefined) {
    throw new SupabaseDurableResearchWorkerError(
      code,
      `Postgres rejected the durable worker operation (${code})`,
    );
  }
  throw new SupabaseDurableResearchWorkerError(
    "PERSISTENCE_UNAVAILABLE",
    "The durable research worker store is unavailable",
  );
}

function parseCommand<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new SupabaseDurableResearchWorkerError(
      "INVALID_ATOMIC_MUTATION",
      "The durable worker operation is invalid",
    );
  }
  return parsed.data;
}

function parseRpcContract<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new SupabaseDurableResearchWorkerError(
      "RPC_CONTRACT_INVALID",
      "Postgres returned an invalid durable worker contract",
    );
  }
  return parsed.data;
}

export type SupabaseDurableResearchWorkerStoreOptions = Readonly<{
  /** Fixed from the authenticated server request; never selected by a command. */
  actorId: string;
  invokeRpc: SupabaseRpcInvoker;
}>;

/**
 * Server-only worker persistence. Every transition delegates to exactly one
 * actor-scoped, token-fenced Postgres RPC. There is intentionally no
 * table-by-table read/write fallback.
 */
export class SupabaseDurableResearchWorkerStore
  implements DurableResearchWorkerStore
{
  readonly #actorId: string;
  readonly #invokeRpc: SupabaseRpcInvoker;

  constructor(options: SupabaseDurableResearchWorkerStoreOptions) {
    this.#actorId = EntityIdSchema.parse(options.actorId);
    this.#invokeRpc = options.invokeRpc;
  }

  #assertActor(actorId: string) {
    if (actorId !== this.#actorId) {
      throw new SupabaseDurableResearchWorkerError(
        "ACTOR_SCOPE_MISMATCH_OR_NOT_FOUND",
        "The durable worker operation does not match the authenticated actor",
      );
    }
  }

  async #rpc(functionName: string, parameters: Record<string, unknown>) {
    let response: Awaited<ReturnType<SupabaseRpcInvoker>>;
    try {
      response = await this.#invokeRpc(functionName, parameters);
    } catch {
      throw new SupabaseDurableResearchWorkerError(
        "PERSISTENCE_UNAVAILABLE",
        "The durable research worker store is unavailable",
      );
    }
    if (response.error !== null) throwMappedRpcError(response.error);
    return response.data;
  }

  async claimResearchJob(input: ClaimResearchJobInput) {
    this.#assertActor(input.actorId);
    const command = parseCommand(ClaimResearchJobLeaseCommandSchema, input);
    const data = await this.#rpc("af_claim_research_job_v2", {
      p_actor_id: this.#actorId,
      p_run_id: command.runId,
      p_job_id: command.jobId,
      p_stage: command.stage,
      p_expected_run_version: command.expectedRunVersion,
      p_expected_job_version: command.expectedJobVersion,
      p_idempotency_key: command.idempotencyKey,
      p_attempt_id: command.attemptId,
      p_worker_id: command.workerId,
      p_execution: command.execution,
      p_lease_seconds: command.leaseDurationSeconds,
    });
    return parseRpcContract(ResearchJobClaimResultSchema, data);
  }

  async heartbeatResearchJob(input: HeartbeatResearchJobInput) {
    this.#assertActor(input.actorId);
    const command = parseCommand(
      HeartbeatResearchJobLeaseCommandSchema,
      input,
    );
    const data = await this.#rpc("af_heartbeat_research_job_v1", {
      p_actor_id: this.#actorId,
      p_lease: command.lease,
      p_lease_seconds: command.leaseDurationSeconds,
      p_occurred_at: command.occurredAt,
    });
    return parseRpcContract(ResearchJobHeartbeatResultSchema, data);
  }

  async checkpointResearchJob(input: CheckpointResearchJobInput) {
    this.#assertActor(input.actorId);
    const command = parseCommand(
      CheckpointResearchJobLeaseCommandSchema,
      input,
    );
    const data = await this.#rpc("af_checkpoint_research_job_v1", {
      p_actor_id: this.#actorId,
      p_lease: command.lease,
      p_checkpoint: command.checkpoint,
      p_lease_seconds: command.leaseDurationSeconds,
    });
    return parseRpcContract(ResearchJobCheckpointResultSchema, data);
  }

  async acceptResearchProviderRun(input: AcceptResearchProviderRunInput) {
    this.#assertActor(input.actorId);
    const data = await this.#rpc("af_accept_research_provider_run_v1", {
      p_actor_id: this.#actorId,
      p_lease: input.lease,
      p_checkpoint: input.checkpoint,
      p_provider_run: input.providerRun,
      p_lease_seconds: input.leaseDurationSeconds,
    });
    return parseRpcContract(ResearchProviderAcceptanceResultSchema, data);
  }

  async acceptSourceResolution(input: AcceptSourceResolutionInput) {
    this.#assertActor(input.actorId);
    if (
      !Number.isInteger(input.leaseDurationSeconds) ||
      input.leaseDurationSeconds < 5 ||
      input.leaseDurationSeconds > 900
    ) {
      throw new SupabaseDurableResearchWorkerError(
        "INVALID_ATOMIC_MUTATION",
        "The source-resolution lease duration is invalid",
      );
    }
    const record = parseCommand(
      DurableSourceResolutionRecordSchema,
      input.record,
    );
    const data = await this.#rpc("af_accept_source_resolution_v1", {
      p_actor_id: this.#actorId,
      p_lease: input.lease,
      p_record: record,
      p_lease_seconds: input.leaseDurationSeconds,
    });
    return parseRpcContract(SourceResolutionAcceptanceResultSchema, data);
  }

  async acceptSourceRetrieval(input: AcceptSourceRetrievalInput) {
    this.#assertActor(input.actorId);
    if (
      !Number.isInteger(input.leaseDurationSeconds) ||
      input.leaseDurationSeconds < 5 ||
      input.leaseDurationSeconds > 900
    ) {
      throw new SupabaseDurableResearchWorkerError(
        "INVALID_ATOMIC_MUTATION",
        "The source-retrieval lease duration is invalid",
      );
    }
    const record = parseCommand(
      DurableSourceRetrievalRecordSchema,
      input.record,
    );
    const data = await this.#rpc("af_accept_source_retrieval_v1", {
      p_actor_id: this.#actorId,
      p_lease: input.lease,
      p_record: record,
      p_lease_seconds: input.leaseDurationSeconds,
    });
    return parseRpcContract(SourceRetrievalAcceptanceResultSchema, data);
  }

  async acceptSourceNormalization(input: AcceptSourceNormalizationInput) {
    this.#assertActor(input.actorId);
    if (
      !Number.isInteger(input.leaseDurationSeconds) ||
      input.leaseDurationSeconds < 5 ||
      input.leaseDurationSeconds > 900
    ) {
      throw new SupabaseDurableResearchWorkerError(
        "INVALID_ATOMIC_MUTATION",
        "The source-normalization lease duration is invalid",
      );
    }
    const record = parseCommand(
      DurableSourceNormalizationRecordSchema,
      input.record,
    );
    const data = await this.#rpc("af_accept_source_normalization_v1", {
      p_actor_id: this.#actorId,
      p_lease: input.lease,
      p_record: record,
      p_lease_seconds: input.leaseDurationSeconds,
    });
    return parseRpcContract(SourceNormalizationAcceptanceResultSchema, data);
  }

  async completeResearchJob(input: CompleteDurableResearchJobInput) {
    this.#assertActor(input.actorId);
    const command = parseCommand(CompleteResearchJobLeaseCommandSchema, input);
    const data = await this.#rpc("af_complete_research_job_v2", {
      p_actor_id: this.#actorId,
      p_lease: command.lease,
      p_idempotency_key: command.idempotencyKey,
      p_result: command.result,
      p_output_fingerprint: command.outputFingerprint,
      p_execution: command.execution,
    });
    return parseRpcContract(ResearchJobCompletionResultSchema, data);
  }

  async failResearchJob(input: FailDurableResearchJobInput) {
    this.#assertActor(input.actorId);
    const command = parseCommand(FailResearchJobLeaseCommandSchema, input);
    const data = await this.#rpc("af_fail_research_job_v1", {
      p_actor_id: this.#actorId,
      p_lease: command.lease,
      p_idempotency_key: command.idempotencyKey,
      p_failure: command.failure,
      p_execution: command.execution,
    });
    return parseRpcContract(ResearchJobFailureResultSchema, data);
  }

  async releaseResearchJob(input: ReleaseResearchJobInput) {
    this.#assertActor(input.actorId);
    const command = parseCommand(ReleaseResearchJobLeaseCommandSchema, input);
    const data = await this.#rpc("af_release_research_job_v1", {
      p_actor_id: this.#actorId,
      p_lease: command.lease,
      p_idempotency_key: command.idempotencyKey,
      p_failure: command.failure,
      p_execution: command.execution,
    });
    return parseRpcContract(ResearchJobReleaseResultSchema, data);
  }
}
