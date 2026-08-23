import {
  DurableResearchProviderAcceptanceResultSchema,
  DurableResearchProviderRunRecordSchema,
  type DurableResearchProviderAcceptanceStore,
} from "@/application/research/durable-discovery-port";
import {
  ResearchJobLeaseCursorSchema,
  ResearchWorkerCheckpointRecordSchema,
} from "@/core/research-runs/worker-schemas";
import { EntityIdSchema } from "@/core/shared/schemas";
import type { SupabaseRpcInvoker } from "@/infrastructure/persistence/supabase-investigation-store";

export class SupabaseResearchProviderAcceptanceStoreError extends Error {
  constructor(
    readonly code:
      | "ACTOR_SCOPE_MISMATCH"
      | "INVALID_ATOMIC_MUTATION"
      | "PERSISTENCE_UNAVAILABLE"
      | "RPC_CONTRACT_INVALID",
    message: string,
  ) {
    super(message);
    this.name = "SupabaseResearchProviderAcceptanceStoreError";
  }
}

export class SupabaseResearchProviderAcceptanceStore
  implements DurableResearchProviderAcceptanceStore
{
  readonly #actorId: string;
  readonly #invokeRpc: SupabaseRpcInvoker;

  constructor(options: Readonly<{ actorId: string; invokeRpc: SupabaseRpcInvoker }>) {
    this.#actorId = EntityIdSchema.parse(options.actorId);
    this.#invokeRpc = options.invokeRpc;
  }

  async acceptProviderRun(
    input: Parameters<DurableResearchProviderAcceptanceStore["acceptProviderRun"]>[0],
  ) {
    if (input.actorId !== this.#actorId) {
      throw new SupabaseResearchProviderAcceptanceStoreError(
        "ACTOR_SCOPE_MISMATCH",
        "Provider acceptance does not match the authenticated actor",
      );
    }
    const lease = ResearchJobLeaseCursorSchema.safeParse(input.lease);
    const checkpoint = ResearchWorkerCheckpointRecordSchema.safeParse(
      input.checkpoint,
    );
    const providerRun = DurableResearchProviderRunRecordSchema.safeParse(
      input.providerRun,
    );
    if (
      !lease.success ||
      !checkpoint.success ||
      !providerRun.success ||
      !Number.isInteger(input.leaseDurationSeconds) ||
      input.leaseDurationSeconds < 5 ||
      input.leaseDurationSeconds > 900
    ) {
      throw new SupabaseResearchProviderAcceptanceStoreError(
        "INVALID_ATOMIC_MUTATION",
        "Provider acceptance input is invalid",
      );
    }
    let response: Awaited<ReturnType<SupabaseRpcInvoker>>;
    try {
      response = await this.#invokeRpc("af_accept_research_provider_run_v1", {
        p_actor_id: this.#actorId,
        p_lease: lease.data,
        p_checkpoint: checkpoint.data,
        p_provider_run: providerRun.data,
        p_lease_seconds: input.leaseDurationSeconds,
      });
    } catch {
      throw new SupabaseResearchProviderAcceptanceStoreError(
        "PERSISTENCE_UNAVAILABLE",
        "The provider acceptance store is unavailable",
      );
    }
    if (response.error !== null) {
      throw new SupabaseResearchProviderAcceptanceStoreError(
        "PERSISTENCE_UNAVAILABLE",
        "The provider acceptance store is unavailable",
      );
    }
    const parsed = DurableResearchProviderAcceptanceResultSchema.safeParse(
      response.data,
    );
    if (!parsed.success) {
      throw new SupabaseResearchProviderAcceptanceStoreError(
        "RPC_CONTRACT_INVALID",
        "Postgres returned an invalid provider acceptance contract",
      );
    }
    return parsed.data;
  }
}
