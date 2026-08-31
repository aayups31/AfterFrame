import { z } from "zod";
import {
  DurableSourceResolutionContextSchema,
  StoredSourceResolutionRecordSchema,
  type DurableSourceResolutionContextReader,
  type DurableSourceResolutionRecordReader,
} from "@/application/research/source-resolution-port";
import { EntityIdSchema } from "@/core/shared/schemas";
import type { SupabaseRpcInvoker } from "@/infrastructure/persistence/supabase-investigation-store";

export type SupabaseSourceResolutionPersistenceErrorCode =
  | "PERSISTENCE_UNAVAILABLE"
  | "RPC_CONTRACT_INVALID";

export class SupabaseSourceResolutionPersistenceError extends Error {
  constructor(
    readonly code: SupabaseSourceResolutionPersistenceErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "SupabaseSourceResolutionPersistenceError";
  }
}

export type SupabaseSourceResolutionPersistenceOptions = Readonly<{
  actorId: string;
  invokeRpc: SupabaseRpcInvoker;
}>;

/** Server-only adapter for body-free, lease-fenced source resolution state. */
export class SupabaseSourceResolutionPersistence
  implements
    DurableSourceResolutionContextReader,
    DurableSourceResolutionRecordReader
{
  readonly #actorId: string;
  readonly #invokeRpc: SupabaseRpcInvoker;

  constructor(options: SupabaseSourceResolutionPersistenceOptions) {
    this.#actorId = EntityIdSchema.parse(options.actorId);
    this.#invokeRpc = options.invokeRpc;
  }

  async #rpc(functionName: string, parameters: Record<string, unknown>) {
    try {
      const response = await this.#invokeRpc(functionName, parameters);
      if (response.error !== null) {
        throw new SupabaseSourceResolutionPersistenceError(
          "PERSISTENCE_UNAVAILABLE",
          "The source-resolution persistence boundary is unavailable",
        );
      }
      return response.data;
    } catch (error) {
      if (error instanceof SupabaseSourceResolutionPersistenceError) throw error;
      throw new SupabaseSourceResolutionPersistenceError(
        "PERSISTENCE_UNAVAILABLE",
        "The source-resolution persistence boundary is unavailable",
      );
    }
  }

  async getResolutionContext(input: Readonly<{
    actorId: string;
    runId: string;
    jobId: string;
    attemptId: string;
  }>) {
    if (input.actorId !== this.#actorId) return null;
    const data = await this.#rpc("af_get_research_resolution_context_v1", {
      p_actor_id: this.#actorId,
      p_run_id: EntityIdSchema.parse(input.runId),
      p_job_id: EntityIdSchema.parse(input.jobId),
      p_attempt_id: EntityIdSchema.parse(input.attemptId),
    });
    if (data === null) return null;
    const parsed = DurableSourceResolutionContextSchema.safeParse(data);
    if (!parsed.success) {
      throw new SupabaseSourceResolutionPersistenceError(
        "RPC_CONTRACT_INVALID",
        "Postgres returned an invalid source-resolution context",
      );
    }
    return parsed.data;
  }

  async listAcceptedResolutions(input: Readonly<{
    actorId: string;
    runId: string;
    jobId: string;
    attemptId: string;
  }>) {
    if (input.actorId !== this.#actorId) return [];
    const data = await this.#rpc("af_get_source_resolution_records_v1", {
      p_actor_id: this.#actorId,
      p_run_id: EntityIdSchema.parse(input.runId),
      p_job_id: EntityIdSchema.parse(input.jobId),
      p_attempt_id: EntityIdSchema.parse(input.attemptId),
    });
    if (data === null) return [];
    const parsed = z.array(StoredSourceResolutionRecordSchema).safeParse(data);
    if (!parsed.success) {
      throw new SupabaseSourceResolutionPersistenceError(
        "RPC_CONTRACT_INVALID",
        "Postgres returned invalid accepted source resolutions",
      );
    }
    return parsed.data;
  }
}
