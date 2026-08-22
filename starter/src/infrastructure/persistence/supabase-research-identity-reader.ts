import {
  ResearchSubjectIdentityContextSchema,
  type ResearchSubjectIdentityContextReader,
} from "@/application/research/subject-identity-port";
import { ResolvedSubjectIdentityRecordSchema } from "@/core/research/subject-identity";
import { EntityIdSchema } from "@/core/shared/schemas";
import type { SupabaseRpcInvoker } from "@/infrastructure/persistence/supabase-investigation-store";

export type SupabaseResearchIdentityReaderErrorCode =
  | "PERSISTENCE_UNAVAILABLE"
  | "RPC_CONTRACT_INVALID";

export class SupabaseResearchIdentityReaderError extends Error {
  constructor(
    readonly code: SupabaseResearchIdentityReaderErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "SupabaseResearchIdentityReaderError";
  }
}

export type SupabaseResearchIdentityReaderOptions = Readonly<{
  actorId: string;
  invokeRpc: SupabaseRpcInvoker;
}>;

/** Actor-scoped reads for resolver input and the durable identity it creates. */
export class SupabaseResearchIdentityReader
  implements ResearchSubjectIdentityContextReader
{
  readonly #actorId: string;
  readonly #invokeRpc: SupabaseRpcInvoker;

  constructor(options: SupabaseResearchIdentityReaderOptions) {
    this.#actorId = EntityIdSchema.parse(options.actorId);
    this.#invokeRpc = options.invokeRpc;
  }

  async #rpc(functionName: string, parameters: Record<string, unknown>) {
    let response: Awaited<ReturnType<SupabaseRpcInvoker>>;
    try {
      response = await this.#invokeRpc(functionName, parameters);
    } catch {
      throw new SupabaseResearchIdentityReaderError(
        "PERSISTENCE_UNAVAILABLE",
        "The research identity reader is unavailable",
      );
    }
    if (response.error !== null) {
      throw new SupabaseResearchIdentityReaderError(
        "PERSISTENCE_UNAVAILABLE",
        "The research identity reader is unavailable",
      );
    }
    return response.data;
  }

  async getSubjectIdentityContext(input: Readonly<{
    actorId: string;
    runId: string;
    jobId: string;
  }>) {
    if (input.actorId !== this.#actorId) return null;
    const data = await this.#rpc("af_get_research_identity_context_v1", {
      p_actor_id: this.#actorId,
      p_run_id: EntityIdSchema.parse(input.runId),
      p_job_id: EntityIdSchema.parse(input.jobId),
    });
    if (data === null) return null;
    const parsed = ResearchSubjectIdentityContextSchema.safeParse(data);
    if (!parsed.success) {
      throw new SupabaseResearchIdentityReaderError(
        "RPC_CONTRACT_INVALID",
        "Postgres returned an invalid research identity context",
      );
    }
    return parsed.data;
  }

  async getResolvedSubjectIdentity(input: Readonly<{
    actorId: string;
    runId: string;
  }>) {
    if (input.actorId !== this.#actorId) return null;
    const data = await this.#rpc("af_get_resolved_subject_identity_v1", {
      p_actor_id: this.#actorId,
      p_run_id: EntityIdSchema.parse(input.runId),
    });
    if (data === null) return null;
    const parsed = ResolvedSubjectIdentityRecordSchema.safeParse(data);
    if (!parsed.success) {
      throw new SupabaseResearchIdentityReaderError(
        "RPC_CONTRACT_INVALID",
        "Postgres returned an invalid resolved subject identity",
      );
    }
    return parsed.data;
  }
}
