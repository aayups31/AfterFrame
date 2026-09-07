import { z } from "zod";
import type { ExactLocatorVerificationRecordReader } from "@/application/research/exact-locator-verification-port";
import { StoredExactLocatorVerificationRecordSchema } from "@/core/research/exact-locator-verification";
import { EntityIdSchema } from "@/core/shared/schemas";
import type { SupabaseRpcInvoker } from "@/infrastructure/persistence/supabase-investigation-store";

export class SupabaseExactLocatorVerificationPersistenceError extends Error {
  constructor(readonly code: "PERSISTENCE_UNAVAILABLE" | "RPC_CONTRACT_INVALID", message: string) {
    super(message);
    this.name = "SupabaseExactLocatorVerificationPersistenceError";
  }
}

export class SupabaseExactLocatorVerificationPersistence implements ExactLocatorVerificationRecordReader {
  readonly #actorId: string;
  readonly #invokeRpc: SupabaseRpcInvoker;

  constructor(options: Readonly<{ actorId: string; invokeRpc: SupabaseRpcInvoker }>) {
    this.#actorId = EntityIdSchema.parse(options.actorId);
    this.#invokeRpc = options.invokeRpc;
  }

  async listAcceptedExactLocatorVerifications(input: Readonly<{
    actorId: string; runId: string; jobId: string; attemptId: string;
  }>) {
    if (input.actorId !== this.#actorId) return [];
    let response: Awaited<ReturnType<SupabaseRpcInvoker>>;
    try {
      response = await this.#invokeRpc("af_get_exact_locator_verifications_v1", {
        p_actor_id: this.#actorId,
        p_run_id: EntityIdSchema.parse(input.runId),
        p_job_id: EntityIdSchema.parse(input.jobId),
        p_attempt_id: EntityIdSchema.parse(input.attemptId),
      });
    } catch {
      throw new SupabaseExactLocatorVerificationPersistenceError(
        "PERSISTENCE_UNAVAILABLE",
        "The exact-locator persistence boundary is unavailable",
      );
    }
    if (response.error !== null) {
      throw new SupabaseExactLocatorVerificationPersistenceError(
        "PERSISTENCE_UNAVAILABLE",
        "The exact-locator persistence boundary is unavailable",
      );
    }
    if (response.data === null) return [];
    const parsed = z.array(StoredExactLocatorVerificationRecordSchema).safeParse(response.data);
    if (!parsed.success) {
      throw new SupabaseExactLocatorVerificationPersistenceError(
        "RPC_CONTRACT_INVALID",
        "Postgres returned invalid exact-locator verifications",
      );
    }
    return parsed.data;
  }
}
