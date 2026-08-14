import { z } from "zod";
import {
  ResearchIdempotencyKeySchema,
  ResearchRunOutboxEventSchema,
  type ResearchRunOutboxEvent,
} from "@/contracts/research-runs";
import {
  START_RESEARCH_RUN_COMMAND,
  type CommitResearchRunStartInput,
  type ReleaseResearchRunStartInput,
  type ResearchRunStartReservation,
  type ResearchRunStartStore,
  type ReserveResearchRunStartInput,
} from "@/core/research-runs/ports";
import { ResearchRunBundleSchema } from "@/core/research-runs/schemas";
import {
  EntityIdSchema,
  Sha256Schema,
} from "@/core/shared/schemas";
import type { SupabaseRpcInvoker } from "@/infrastructure/persistence/supabase-investigation-store";

const StoredResearchRunStartSchema = z
  .object({
    bundle: ResearchRunBundleSchema,
    outboxEvents: z.array(ResearchRunOutboxEventSchema).length(2),
  })
  .strict()
  .superRefine((stored, context) => {
    const { bundle, outboxEvents } = stored;
    const initialBundle =
      bundle.run.status === "QUEUED" &&
      bundle.run.aggregateVersion === 0 &&
      bundle.attempts.length === 0 &&
      bundle.outputs.length === 0 &&
      bundle.sourceCandidates.length === 0 &&
      bundle.untrustedContent.length === 0 &&
      bundle.jobs.every(
        (job) =>
          job.status === "QUEUED" &&
          job.aggregateVersion === 0 &&
          job.attemptCount === 0 &&
          job.checkpointCount === 0,
      );
    if (!initialBundle) {
      context.addIssue({
        code: "custom",
        path: ["bundle"],
        message: "A run-start commit must contain only initial queued state",
      });
    }

    const expectedTypes = [
      "research.run_created",
      "research.jobs_staged",
    ] as const;
    outboxEvents.forEach((outboxEvent, index) => {
      if (
        outboxEvent.event.type !== expectedTypes[index] ||
        outboxEvent.event.aggregateId !== bundle.run.id ||
        outboxEvent.event.sequence !== index + 1 ||
        outboxEvent.event.aggregateVersion !== bundle.run.aggregateVersion
      ) {
        context.addIssue({
          code: "custom",
          path: ["outboxEvents", index],
          message: "Run-start events must be the canonical ordered initial events",
        });
      }
    });

    const runCreated = outboxEvents[0]?.event;
    if (
      runCreated?.type !== "research.run_created" ||
      runCreated.payload.caseId !== bundle.run.caseId ||
      runCreated.payload.branchId !== bundle.run.branchId ||
      runCreated.payload.planId !== bundle.run.planId ||
      runCreated.payload.specialistId !== bundle.run.specialistId ||
      runCreated.payload.specialistVersion !== bundle.run.specialistVersion
    ) {
      context.addIssue({
        code: "custom",
        path: ["outboxEvents", 0, "event", "payload"],
        message: "Run-created event references must match the staged run",
      });
    }

    const jobsStaged = outboxEvents[1]?.event;
    const expectedJobs = bundle.jobs.map((job) => ({
      jobId: job.id,
      stage: job.stage,
      dependsOnJobId: job.dependsOnJobId,
    }));
    if (
      jobsStaged?.type !== "research.jobs_staged" ||
      JSON.stringify(jobsStaged.payload.jobs) !== JSON.stringify(expectedJobs)
    ) {
      context.addIssue({
        code: "custom",
        path: ["outboxEvents", 1, "event", "payload", "jobs"],
        message: "Jobs-staged event must enumerate the canonical staged jobs",
      });
    }

    if (
      new Set(outboxEvents.map(({ id }) => id)).size !== outboxEvents.length ||
      new Set(outboxEvents.map(({ event }) => event.id)).size !==
        outboxEvents.length
    ) {
      context.addIssue({
        code: "custom",
        path: ["outboxEvents"],
        message: "Run-start event and outbox identifiers must be unique",
      });
    }
  });

const ResearchRunStartReservationSchema = z.discriminatedUnion("status", [
  z
    .object({
      status: z.literal("ACQUIRED"),
      reservationToken: EntityIdSchema,
    })
    .strict(),
  z.object({ status: z.literal("IN_PROGRESS") }).strict(),
  z
    .object({
      status: z.literal("REPLAY"),
      requestFingerprint: Sha256Schema,
      result: StoredResearchRunStartSchema,
    })
    .strict(),
]);

const CommitResearchRunStartOutcomeSchema = z
  .object({
    replayed: z.boolean(),
    result: StoredResearchRunStartSchema,
  })
  .strict();

export type SupabaseResearchRunStartErrorCode =
  | "VERSION_CONFLICT"
  | "IDEMPOTENCY_KEY_REUSED"
  | "IDENTIFIER_COLLISION"
  | "INVALID_ATOMIC_MUTATION"
  | "ACTOR_SCOPE_MISMATCH_OR_NOT_FOUND"
  | "ACTIVE_RESEARCH_RUN_EXISTS"
  | "PERSISTENCE_UNAVAILABLE"
  | "RPC_CONTRACT_INVALID";

export class SupabaseResearchRunStartError extends Error {
  constructor(
    readonly code: SupabaseResearchRunStartErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "SupabaseResearchRunStartError";
  }
}

type RpcError = Readonly<{ code?: string; message?: string }>;

function throwMappedRpcError(error: RpcError): never {
  const mapped = {
    AFR01: "VERSION_CONFLICT",
    AFR02: "IDEMPOTENCY_KEY_REUSED",
    AFR03: "IDENTIFIER_COLLISION",
    AFR04: "INVALID_ATOMIC_MUTATION",
    AFR05: "ACTOR_SCOPE_MISMATCH_OR_NOT_FOUND",
    AFR08: "ACTIVE_RESEARCH_RUN_EXISTS",
    "40001": "VERSION_CONFLICT",
    "23505": "IDENTIFIER_COLLISION",
  } as const;
  const code =
    error.code === undefined
      ? undefined
      : mapped[error.code as keyof typeof mapped];
  if (code !== undefined) {
    throw new SupabaseResearchRunStartError(
      code,
      `Postgres rejected the research-run operation (${code})`,
    );
  }
  throw new SupabaseResearchRunStartError(
    "PERSISTENCE_UNAVAILABLE",
    "The durable research-run store is unavailable",
  );
}

function parseRpcContract<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new SupabaseResearchRunStartError(
      "RPC_CONTRACT_INVALID",
      "Postgres returned an invalid research-run contract",
    );
  }
  return parsed.data;
}

export type SupabaseResearchRunStartStoreOptions = Readonly<{
  actorId: string;
  invokeRpc: SupabaseRpcInvoker;
  reservationLeaseSeconds?: number;
}>;

/**
 * Server-only adapter. Run, plan, seven jobs, replay snapshot, and outbox are
 * committed by one actor-scoped Postgres RPC; no table-by-table fallback is
 * permitted.
 */
export class SupabaseResearchRunStartStore
  implements ResearchRunStartStore<ResearchRunOutboxEvent>
{
  readonly #actorId: string;
  readonly #invokeRpc: SupabaseRpcInvoker;
  readonly #reservationLeaseSeconds: number;

  constructor(options: SupabaseResearchRunStartStoreOptions) {
    this.#actorId = EntityIdSchema.parse(options.actorId);
    this.#invokeRpc = options.invokeRpc;
    this.#reservationLeaseSeconds = options.reservationLeaseSeconds ?? 60;
    if (
      !Number.isInteger(this.#reservationLeaseSeconds) ||
      this.#reservationLeaseSeconds < 5 ||
      this.#reservationLeaseSeconds > 900
    ) {
      throw new Error("Research-run reservation lease must be between 5 and 900 seconds");
    }
  }

  #assertScope(input: { scope: { actorId: string; commandName: string } }) {
    if (
      input.scope.actorId !== this.#actorId ||
      input.scope.commandName !== START_RESEARCH_RUN_COMMAND
    ) {
      throw new SupabaseResearchRunStartError(
        "INVALID_ATOMIC_MUTATION",
        "The research-run command scope does not match the authenticated actor",
      );
    }
  }

  async #rpc(functionName: string, parameters: Record<string, unknown>) {
    let result: Awaited<ReturnType<SupabaseRpcInvoker>>;
    try {
      result = await this.#invokeRpc(functionName, parameters);
    } catch {
      throw new SupabaseResearchRunStartError(
        "PERSISTENCE_UNAVAILABLE",
        "The durable research-run store is unavailable",
      );
    }
    if (result.error !== null) throwMappedRpcError(result.error);
    return result.data;
  }

  async reserveResearchRunStart(
    input: ReserveResearchRunStartInput,
  ): Promise<ResearchRunStartReservation<ResearchRunOutboxEvent>> {
    this.#assertScope(input);
    const data = await this.#rpc("af_reserve_research_run_start_v1", {
      p_actor_id: this.#actorId,
      p_idempotency_key: ResearchIdempotencyKeySchema.parse(
        input.scope.idempotencyKey,
      ),
      p_request_fingerprint: Sha256Schema.parse(input.requestFingerprint),
      p_lease_seconds: this.#reservationLeaseSeconds,
    });
    const reservation = parseRpcContract(
      ResearchRunStartReservationSchema,
      data,
    );
    if (
      reservation.status === "REPLAY" &&
      reservation.result.bundle.run.requestFingerprint !==
        reservation.requestFingerprint
    ) {
      throw new SupabaseResearchRunStartError(
        "RPC_CONTRACT_INVALID",
        "Postgres returned a replay with inconsistent request identity",
      );
    }
    return reservation;
  }

  async releaseResearchRunStart(
    input: ReleaseResearchRunStartInput,
  ): Promise<void> {
    this.#assertScope(input);
    const data = await this.#rpc(
      "af_release_research_run_start_reservation_v1",
      {
        p_actor_id: this.#actorId,
        p_idempotency_key: ResearchIdempotencyKeySchema.parse(
          input.scope.idempotencyKey,
        ),
        p_request_fingerprint: Sha256Schema.parse(input.requestFingerprint),
        p_reservation_token: EntityIdSchema.parse(
          input.reservationToken,
        ),
      },
    );
    if (data !== true) {
      throw new SupabaseResearchRunStartError(
        "INVALID_ATOMIC_MUTATION",
        "The research-run reservation could not be released",
      );
    }
  }

  async commitResearchRunStart(
    input: CommitResearchRunStartInput<ResearchRunOutboxEvent>,
  ) {
    this.#assertScope(input);
    const result = StoredResearchRunStartSchema.parse(input.result);
    const data = await this.#rpc("af_commit_research_run_start_v1", {
      p_actor_id: this.#actorId,
      p_idempotency_key: ResearchIdempotencyKeySchema.parse(
        input.scope.idempotencyKey,
      ),
      p_request_fingerprint: Sha256Schema.parse(input.requestFingerprint),
      p_reservation_token: EntityIdSchema.parse(input.reservationToken),
      p_expected_case_version: z.number().int().nonnegative().parse(
        input.expectedCaseVersion,
      ),
      p_result: result,
    });
    const committed = parseRpcContract(
      CommitResearchRunStartOutcomeSchema,
      data,
    );
    if (
      committed.result.bundle.run.requestFingerprint !==
      input.requestFingerprint
    ) {
      throw new SupabaseResearchRunStartError(
        "RPC_CONTRACT_INVALID",
        "Postgres returned a commit with inconsistent request identity",
      );
    }
    return committed;
  }
}
