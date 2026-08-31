import { z } from "zod";
import type {
  DurableNormalizationRetrievalContextReader,
  DurableSourceRetrievalRecordReader,
} from "@/application/research/source-retrieval-port";
import {
  DurableNormalizationRetrievalContextSchema,
  StoredSourceRetrievalRecordSchema,
} from "@/application/research/source-retrieval-port";
import { EntityIdSchema } from "@/core/shared/schemas";
import type { SupabaseRpcInvoker } from "@/infrastructure/persistence/supabase-investigation-store";

export type SupabaseSourceRetrievalPersistenceErrorCode =
  | "PERSISTENCE_UNAVAILABLE"
  | "RPC_CONTRACT_INVALID";

export class SupabaseSourceRetrievalPersistenceError extends Error {
  constructor(
    readonly code: SupabaseSourceRetrievalPersistenceErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "SupabaseSourceRetrievalPersistenceError";
  }
}

export class SupabaseSourceRetrievalPersistence
  implements
    DurableNormalizationRetrievalContextReader,
    DurableSourceRetrievalRecordReader
{
  readonly #actorId: string;
  readonly #invokeRpc: SupabaseRpcInvoker;

  constructor(options: Readonly<{
    actorId: string;
    invokeRpc: SupabaseRpcInvoker;
  }>) {
    this.#actorId = EntityIdSchema.parse(options.actorId);
    this.#invokeRpc = options.invokeRpc;
  }

  async #rpc(functionName: string, parameters: Record<string, unknown>) {
    try {
      const response = await this.#invokeRpc(functionName, parameters);
      if (response.error !== null) {
        throw new SupabaseSourceRetrievalPersistenceError(
          "PERSISTENCE_UNAVAILABLE",
          "The source-retrieval persistence boundary is unavailable",
        );
      }
      return response.data;
    } catch (error) {
      if (error instanceof SupabaseSourceRetrievalPersistenceError) throw error;
      throw new SupabaseSourceRetrievalPersistenceError(
        "PERSISTENCE_UNAVAILABLE",
        "The source-retrieval persistence boundary is unavailable",
      );
    }
  }

  async getNormalizationRetrievalContext(input: Readonly<{
    actorId: string;
    runId: string;
    jobId: string;
    attemptId: string;
  }>) {
    if (input.actorId !== this.#actorId) return null;
    const data = await this.#rpc("af_get_normalization_retrieval_context_v1", {
      p_actor_id: this.#actorId,
      p_run_id: EntityIdSchema.parse(input.runId),
      p_job_id: EntityIdSchema.parse(input.jobId),
      p_attempt_id: EntityIdSchema.parse(input.attemptId),
    });
    if (data === null) return null;
    const parsed = DurableNormalizationRetrievalContextSchema.safeParse(data);
    if (!parsed.success) {
      throw new SupabaseSourceRetrievalPersistenceError(
        "RPC_CONTRACT_INVALID",
        "Postgres returned an invalid normalization retrieval context",
      );
    }
    return parsed.data;
  }

  async listAcceptedRetrievals(input: Readonly<{
    actorId: string;
    runId: string;
    jobId: string;
    attemptId: string;
  }>) {
    if (input.actorId !== this.#actorId) return [];
    const data = await this.#rpc("af_get_source_retrieval_records_v1", {
      p_actor_id: this.#actorId,
      p_run_id: EntityIdSchema.parse(input.runId),
      p_job_id: EntityIdSchema.parse(input.jobId),
      p_attempt_id: EntityIdSchema.parse(input.attemptId),
    });
    if (data === null) return [];
    const parsed = z.array(StoredSourceRetrievalRecordSchema).safeParse(data);
    if (!parsed.success) {
      throw new SupabaseSourceRetrievalPersistenceError(
        "RPC_CONTRACT_INVALID",
        "Postgres returned invalid accepted source retrievals",
      );
    }
    return parsed.data;
  }
}
