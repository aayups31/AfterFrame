import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import {
  InvestigationBranchSchema,
  DirectionEventSchema,
} from "@/core/branches/schemas";
import { InvestigationCaseSchema } from "@/core/cases/schemas";
import {
  InvestigationStoreError,
  SUBMIT_DIRECTION_COMMAND,
  type CommitDirectionInput,
  type CommitDirectionOutcome,
  type DirectionReservationInput,
  type DirectionReservationOutcome,
  type InvestigationStore,
  type ReleaseDirectionReservationInput,
} from "@/core/ports/investigation-store";
import { ProvenanceEdgeSchema } from "@/core/provenance/schemas";
import {
  EntityIdSchema,
  OpaqueReferenceSchema,
  Sha256Schema,
} from "@/core/shared/schemas";
import { OutboxEventSchema, type OutboxEvent } from "@/contracts/domain-events";

const StoredDirectionResultSchema = z
  .object({
    investigationCase: InvestigationCaseSchema,
    direction: DirectionEventSchema,
    proposedBranch: InvestigationBranchSchema,
    provenanceEdges: z.array(ProvenanceEdgeSchema),
    outboxEvents: z.array(OutboxEventSchema),
  })
  .strict();

const StoredDirectionReplaySchema = z
  .object({
    requestFingerprint: Sha256Schema,
    result: StoredDirectionResultSchema,
  })
  .strict();

const DirectionReservationOutcomeSchema = z.discriminatedUnion("status", [
  z
    .object({
      status: z.literal("ACQUIRED"),
      reservationToken: OpaqueReferenceSchema,
    })
    .strict(),
  z.object({ status: z.literal("IN_PROGRESS") }).strict(),
  z
    .object({
      status: z.literal("REPLAY"),
      replay: StoredDirectionReplaySchema,
    })
    .strict(),
]);

const CommitDirectionOutcomeSchema = z
  .object({
    replayed: z.boolean(),
    result: StoredDirectionResultSchema,
  })
  .strict();

type RpcError = Readonly<{ code?: string; message?: string }>;
type RpcResult = Readonly<{ data: unknown; error: RpcError | null }>;
export type SupabaseRpcInvoker = (
  functionName: string,
  parameters: Record<string, unknown>,
) => Promise<RpcResult>;

export class SupabasePersistenceError extends Error {
  constructor(
    readonly code: "PERSISTENCE_UNAVAILABLE" | "RPC_CONTRACT_INVALID",
    message: string,
  ) {
    super(message);
    this.name = "SupabasePersistenceError";
  }
}

function mappedRpcError(error: RpcError): never {
  const storeCode = {
    AFD01: "CASE_VERSION_CONFLICT",
    AFD02: "IDEMPOTENCY_KEY_REUSED",
    AFD03: "IDENTIFIER_COLLISION",
    AFD04: "INVALID_ATOMIC_MUTATION",
    AFD05: "INVALID_ATOMIC_MUTATION",
  } as const;
  const mapped = error.code === undefined ? undefined : storeCode[error.code as keyof typeof storeCode];
  if (mapped !== undefined) {
    throw new InvestigationStoreError(
      mapped,
      `Postgres rejected the atomic direction operation (${mapped})`,
    );
  }
  if (error.code === "40001") {
    throw new InvestigationStoreError(
      "CASE_VERSION_CONFLICT",
      "Postgres rejected a concurrent case update",
    );
  }
  if (error.code === "23505") {
    throw new InvestigationStoreError(
      "IDENTIFIER_COLLISION",
      "Postgres rejected a duplicate durable identifier",
    );
  }
  throw new SupabasePersistenceError(
    "PERSISTENCE_UNAVAILABLE",
    "The durable investigation store is unavailable",
  );
}

function parseRpcContract<T>(schema: z.ZodType<T>, data: unknown): T {
  const parsed = schema.safeParse(data);
  if (!parsed.success) {
    throw new SupabasePersistenceError(
      "RPC_CONTRACT_INVALID",
      "Postgres returned an invalid investigation-store contract",
    );
  }
  return parsed.data;
}

export type SupabaseInvestigationStoreOptions = Readonly<{
  actorId: string;
  invokeRpc: SupabaseRpcInvoker;
  directionLeaseSeconds?: number;
}>;

/**
 * Durable server adapter. All multi-record direction writes happen inside the
 * versioned Postgres RPC; the service-role client never performs table-by-table
 * mutations and never decides actor identity.
 */
export class SupabaseInvestigationStore
  implements InvestigationStore<OutboxEvent>
{
  readonly #actorId: string;
  readonly #invokeRpc: SupabaseRpcInvoker;
  readonly #directionLeaseSeconds: number;

  constructor(options: SupabaseInvestigationStoreOptions) {
    this.#actorId = EntityIdSchema.parse(options.actorId);
    this.#invokeRpc = options.invokeRpc;
    this.#directionLeaseSeconds = options.directionLeaseSeconds ?? 60;
    if (
      !Number.isInteger(this.#directionLeaseSeconds) ||
      this.#directionLeaseSeconds < 5 ||
      this.#directionLeaseSeconds > 300
    ) {
      throw new Error("Direction lease must be between 5 and 300 seconds");
    }
  }

  async #rpc(functionName: string, parameters: Record<string, unknown>) {
    const result = await this.#invokeRpc(functionName, parameters);
    if (result.error !== null) mappedRpcError(result.error);
    return result.data;
  }

  #assertScopeActor(actorId: string) {
    if (actorId !== this.#actorId) {
      throw new InvestigationStoreError(
        "INVALID_ATOMIC_MUTATION",
        "The idempotency scope does not match the authenticated actor",
      );
    }
  }

  async getCase(caseIdInput: string) {
    const caseId = EntityIdSchema.parse(caseIdInput);
    const data = await this.#rpc("af_get_case_v1", {
      p_actor_id: this.#actorId,
      p_case_id: caseId,
    });
    return data === null
      ? null
      : parseRpcContract(InvestigationCaseSchema, data);
  }

  async getBranch(branchIdInput: string) {
    const branchId = EntityIdSchema.parse(branchIdInput);
    const data = await this.#rpc("af_get_branch_v1", {
      p_actor_id: this.#actorId,
      p_branch_id: branchId,
    });
    return data === null
      ? null
      : parseRpcContract(InvestigationBranchSchema, data);
  }

  async reserveDirection(
    input: DirectionReservationInput,
  ): Promise<DirectionReservationOutcome<OutboxEvent>> {
    this.#assertScopeActor(input.scope.actorId);
    if (input.scope.commandName !== SUBMIT_DIRECTION_COMMAND) {
      throw new InvestigationStoreError(
        "INVALID_ATOMIC_MUTATION",
        "Unsupported idempotency command scope",
      );
    }
    const requestFingerprint = Sha256Schema.parse(input.requestFingerprint);
    const data = await this.#rpc("af_reserve_direction_v1", {
      p_actor_id: this.#actorId,
      p_idempotency_key: OpaqueReferenceSchema.parse(
        input.scope.idempotencyKey,
      ),
      p_request_fingerprint: requestFingerprint,
      p_lease_seconds: this.#directionLeaseSeconds,
    });
    return parseRpcContract(DirectionReservationOutcomeSchema, data);
  }

  async releaseDirectionReservation(
    input: ReleaseDirectionReservationInput,
  ): Promise<void> {
    this.#assertScopeActor(input.scope.actorId);
    const data = await this.#rpc("af_release_direction_reservation_v1", {
      p_actor_id: this.#actorId,
      p_idempotency_key: OpaqueReferenceSchema.parse(
        input.scope.idempotencyKey,
      ),
      p_request_fingerprint: Sha256Schema.parse(input.requestFingerprint),
      p_reservation_token: OpaqueReferenceSchema.parse(input.reservationToken),
    });
    if (data !== true) {
      throw new InvestigationStoreError(
        "INVALID_ATOMIC_MUTATION",
        "The direction reservation could not be released",
      );
    }
  }

  async commitDirection(
    input: CommitDirectionInput<OutboxEvent>,
  ): Promise<CommitDirectionOutcome<OutboxEvent>> {
    this.#assertScopeActor(input.scope.actorId);
    const result = StoredDirectionResultSchema.parse(input.result);
    const data = await this.#rpc("af_commit_direction_v1", {
      p_actor_id: this.#actorId,
      p_idempotency_key: OpaqueReferenceSchema.parse(
        input.scope.idempotencyKey,
      ),
      p_request_fingerprint: Sha256Schema.parse(input.requestFingerprint),
      p_reservation_token: OpaqueReferenceSchema.parse(input.reservationToken),
      p_expected_case_version: z.number().int().nonnegative().parse(
        input.expectedCaseVersion,
      ),
      p_result: result,
    });
    return parseRpcContract(CommitDirectionOutcomeSchema, data);
  }
}

export function supabaseRpcInvoker(client: SupabaseClient): SupabaseRpcInvoker {
  return async (functionName, parameters) => {
    const { data, error } = await client.rpc(
      functionName as never,
      parameters as never,
    );
    return {
      data,
      error:
        error === null
          ? null
          : { code: error.code, message: error.message },
    };
  };
}
