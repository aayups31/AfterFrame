import type { ResearchProviderRunReader } from "@/core/research-runs/ports";
import { ResearchProviderRunRecordSchema } from "@/core/research-runs/provider-runs";
import { EntityIdSchema } from "@/core/shared/schemas";
import type { SupabaseRpcInvoker } from "@/infrastructure/persistence/supabase-investigation-store";

export class SupabaseResearchProviderRunReaderError extends Error {
  constructor(
    readonly code: "PERSISTENCE_UNAVAILABLE" | "RPC_CONTRACT_INVALID",
    message: string,
  ) {
    super(message);
    this.name = "SupabaseResearchProviderRunReaderError";
  }
}

export class SupabaseResearchProviderRunReader
  implements ResearchProviderRunReader
{
  readonly #actorId: string;
  readonly #invokeRpc: SupabaseRpcInvoker;

  constructor(options: Readonly<{ actorId: string; invokeRpc: SupabaseRpcInvoker }>) {
    this.#actorId = EntityIdSchema.parse(options.actorId);
    this.#invokeRpc = options.invokeRpc;
  }

  async getAcceptedProviderRun(input: Readonly<{
    actorId: string;
    runId: string;
    jobId: string;
    attemptId: string;
  }>) {
    if (input.actorId !== this.#actorId) return null;
    let response: Awaited<ReturnType<SupabaseRpcInvoker>>;
    try {
      response = await this.#invokeRpc("af_get_research_provider_run_v1", {
        p_actor_id: this.#actorId,
        p_run_id: EntityIdSchema.parse(input.runId),
        p_job_id: EntityIdSchema.parse(input.jobId),
        p_attempt_id: EntityIdSchema.parse(input.attemptId),
      });
    } catch {
      throw new SupabaseResearchProviderRunReaderError(
        "PERSISTENCE_UNAVAILABLE",
        "The provider recovery reader is unavailable",
      );
    }
    if (response.error !== null) {
      throw new SupabaseResearchProviderRunReaderError(
        "PERSISTENCE_UNAVAILABLE",
        "The provider recovery reader is unavailable",
      );
    }
    if (response.data === null) return null;
    const parsed = ResearchProviderRunRecordSchema.safeParse(response.data);
    if (!parsed.success) {
      throw new SupabaseResearchProviderRunReaderError(
        "RPC_CONTRACT_INVALID",
        "Postgres returned invalid provider recovery state",
      );
    }
    return parsed.data;
  }
}
