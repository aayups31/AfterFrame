import {
  DurableResearchDiscoveryContextSchema,
  type DurableResearchDiscoveryContextReader,
} from "@/application/research/durable-discovery-port";
import { EntityIdSchema } from "@/core/shared/schemas";
import type { SupabaseRpcInvoker } from "@/infrastructure/persistence/supabase-investigation-store";

export type SupabaseResearchDiscoveryContextReaderErrorCode =
  | "PERSISTENCE_UNAVAILABLE"
  | "RPC_CONTRACT_INVALID";

export class SupabaseResearchDiscoveryContextReaderError extends Error {
  constructor(
    readonly code: SupabaseResearchDiscoveryContextReaderErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "SupabaseResearchDiscoveryContextReaderError";
  }
}

export type SupabaseResearchDiscoveryContextReaderOptions = Readonly<{
  actorId: string;
  invokeRpc: SupabaseRpcInvoker;
}>;

/** Server-only, actor-scoped private input boundary for durable DISCOVERY. */
export class SupabaseResearchDiscoveryContextReader
  implements DurableResearchDiscoveryContextReader
{
  readonly #actorId: string;
  readonly #invokeRpc: SupabaseRpcInvoker;

  constructor(options: SupabaseResearchDiscoveryContextReaderOptions) {
    this.#actorId = EntityIdSchema.parse(options.actorId);
    this.#invokeRpc = options.invokeRpc;
  }

  async getDiscoveryContext(input: Readonly<{
    actorId: string;
    runId: string;
    jobId: string;
  }>) {
    if (input.actorId !== this.#actorId) return null;
    let response: Awaited<ReturnType<SupabaseRpcInvoker>>;
    try {
      response = await this.#invokeRpc("af_get_research_discovery_context_v1", {
        p_actor_id: this.#actorId,
        p_run_id: EntityIdSchema.parse(input.runId),
        p_job_id: EntityIdSchema.parse(input.jobId),
      });
    } catch {
      throw new SupabaseResearchDiscoveryContextReaderError(
        "PERSISTENCE_UNAVAILABLE",
        "The research discovery context reader is unavailable",
      );
    }
    if (response.error !== null) {
      throw new SupabaseResearchDiscoveryContextReaderError(
        "PERSISTENCE_UNAVAILABLE",
        "The research discovery context reader is unavailable",
      );
    }
    if (response.data === null) return null;
    const parsed = DurableResearchDiscoveryContextSchema.safeParse(
      response.data,
    );
    if (!parsed.success) {
      throw new SupabaseResearchDiscoveryContextReaderError(
        "RPC_CONTRACT_INVALID",
        "Postgres returned an invalid research discovery context",
      );
    }
    return parsed.data;
  }
}
