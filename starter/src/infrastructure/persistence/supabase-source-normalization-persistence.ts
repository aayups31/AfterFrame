import { z } from "zod";
import type { DurableSourceNormalizationRecordReader } from "@/application/research/source-normalization-port";
import { StoredSourceNormalizationRecordSchema } from "@/core/research/source-normalization";
import { EntityIdSchema } from "@/core/shared/schemas";
import type { SupabaseRpcInvoker } from "@/infrastructure/persistence/supabase-investigation-store";

export type SupabaseSourceNormalizationPersistenceErrorCode =
  | "PERSISTENCE_UNAVAILABLE"
  | "RPC_CONTRACT_INVALID";

export class SupabaseSourceNormalizationPersistenceError extends Error {
  constructor(
    readonly code: SupabaseSourceNormalizationPersistenceErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "SupabaseSourceNormalizationPersistenceError";
  }
}

export class SupabaseSourceNormalizationPersistence
  implements DurableSourceNormalizationRecordReader
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

  async listAcceptedNormalizations(input: Readonly<{
    actorId: string;
    runId: string;
    jobId: string;
    attemptId: string;
  }>) {
    if (input.actorId !== this.#actorId) return [];
    let response: Awaited<ReturnType<SupabaseRpcInvoker>>;
    try {
      response = await this.#invokeRpc(
        "af_get_source_normalization_records_v1",
        {
          p_actor_id: this.#actorId,
          p_run_id: EntityIdSchema.parse(input.runId),
          p_job_id: EntityIdSchema.parse(input.jobId),
          p_attempt_id: EntityIdSchema.parse(input.attemptId),
        },
      );
    } catch {
      throw new SupabaseSourceNormalizationPersistenceError(
        "PERSISTENCE_UNAVAILABLE",
        "The source-normalization persistence boundary is unavailable",
      );
    }
    if (response.error !== null) {
      throw new SupabaseSourceNormalizationPersistenceError(
        "PERSISTENCE_UNAVAILABLE",
        "The source-normalization persistence boundary is unavailable",
      );
    }
    if (response.data === null) return [];
    const parsed = z.array(StoredSourceNormalizationRecordSchema).safeParse(
      response.data,
    );
    if (!parsed.success) {
      throw new SupabaseSourceNormalizationPersistenceError(
        "RPC_CONTRACT_INVALID",
        "Postgres returned invalid accepted source normalizations",
      );
    }
    return parsed.data;
  }
}
