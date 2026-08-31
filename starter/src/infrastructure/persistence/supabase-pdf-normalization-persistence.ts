import { z } from "zod";
import type { DurablePdfNormalizationRecordReader } from "@/application/research/pdf-normalization-port";
import { StoredPdfNormalizationRecordSchema } from "@/core/research/pdf-normalization";
import { EntityIdSchema } from "@/core/shared/schemas";
import type { SupabaseRpcInvoker } from "@/infrastructure/persistence/supabase-investigation-store";

export class SupabasePdfNormalizationPersistenceError extends Error {
  constructor(readonly code: "PERSISTENCE_UNAVAILABLE" | "RPC_CONTRACT_INVALID", message: string) {
    super(message);
    this.name = "SupabasePdfNormalizationPersistenceError";
  }
}

export class SupabasePdfNormalizationPersistence implements DurablePdfNormalizationRecordReader {
  readonly #actorId: string;
  readonly #invokeRpc: SupabaseRpcInvoker;

  constructor(options: Readonly<{ actorId: string; invokeRpc: SupabaseRpcInvoker }>) {
    this.#actorId = EntityIdSchema.parse(options.actorId);
    this.#invokeRpc = options.invokeRpc;
  }

  async listAcceptedPdfNormalizations(input: Readonly<{
    actorId: string; runId: string; jobId: string; attemptId: string;
  }>) {
    if (input.actorId !== this.#actorId) return [];
    let response: Awaited<ReturnType<SupabaseRpcInvoker>>;
    try {
      response = await this.#invokeRpc("af_get_pdf_normalization_records_v1", {
        p_actor_id: this.#actorId,
        p_run_id: EntityIdSchema.parse(input.runId),
        p_job_id: EntityIdSchema.parse(input.jobId),
        p_attempt_id: EntityIdSchema.parse(input.attemptId),
      });
    } catch {
      throw new SupabasePdfNormalizationPersistenceError("PERSISTENCE_UNAVAILABLE", "The PDF-normalization persistence boundary is unavailable");
    }
    if (response.error !== null) {
      throw new SupabasePdfNormalizationPersistenceError("PERSISTENCE_UNAVAILABLE", "The PDF-normalization persistence boundary is unavailable");
    }
    if (response.data === null) return [];
    const parsed = z.array(StoredPdfNormalizationRecordSchema).safeParse(response.data);
    if (!parsed.success) {
      throw new SupabasePdfNormalizationPersistenceError("RPC_CONTRACT_INVALID", "Postgres returned invalid accepted PDF normalizations");
    }
    return parsed.data;
  }
}
