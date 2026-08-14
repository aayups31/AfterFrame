import { z } from "zod";
import { ResearchIdempotencyKeySchema } from "@/contracts/research-runs";
import {
  ResearchJobLeaseCursorSchema,
  ResearchWorkerCheckpointRecordSchema,
  ResearchWorkerExecutionCompletionSchema,
  ResearchWorkerExecutionPlanSchema,
  ResearchWorkerFailureEnvelopeSchema,
} from "@/core/research-runs/worker-schemas";
import {
  ResearchStageExecutionResultSchema,
  ResearchStageSchema,
} from "@/core/research-runs/schemas";
import {
  EntityIdSchema,
  IsoDateTimeSchema,
  OpaqueReferenceSchema,
  Sha256Schema,
} from "@/core/shared/schemas";

export const ExecuteDurableResearchJobCommandSchema = z
  .object({
    runId: EntityIdSchema,
    jobId: EntityIdSchema,
    stage: ResearchStageSchema,
    expectedRunVersion: z.number().int().nonnegative(),
    expectedJobVersion: z.number().int().nonnegative(),
    idempotencyKey: ResearchIdempotencyKeySchema,
  })
  .strict();

export const ClaimResearchJobLeaseCommandSchema = z
  .object({
    actorId: EntityIdSchema,
    runId: EntityIdSchema,
    jobId: EntityIdSchema,
    stage: ResearchStageSchema,
    expectedRunVersion: z.number().int().nonnegative(),
    expectedJobVersion: z.number().int().nonnegative(),
    idempotencyKey: ResearchIdempotencyKeySchema,
    requestFingerprint: Sha256Schema,
    attemptId: EntityIdSchema,
    workerId: OpaqueReferenceSchema,
    execution: ResearchWorkerExecutionPlanSchema,
    leaseDurationSeconds: z.number().int().min(5).max(900),
  })
  .strict();

export const HeartbeatResearchJobLeaseCommandSchema = z
  .object({
    actorId: EntityIdSchema,
    lease: ResearchJobLeaseCursorSchema,
    leaseDurationSeconds: z.number().int().min(5).max(900),
    occurredAt: IsoDateTimeSchema,
  })
  .strict();

export const CheckpointResearchJobLeaseCommandSchema = z
  .object({
    actorId: EntityIdSchema,
    lease: ResearchJobLeaseCursorSchema,
    checkpoint: ResearchWorkerCheckpointRecordSchema,
    leaseDurationSeconds: z.number().int().min(5).max(900),
  })
  .strict()
  .superRefine((command, context) => {
    if (
      command.checkpoint.runId !== command.lease.runId ||
      command.checkpoint.jobId !== command.lease.jobId ||
      command.checkpoint.attemptId !== command.lease.attemptId
    ) {
      context.addIssue({
        code: "custom",
        path: ["checkpoint"],
        message: "Checkpoint must belong to the fenced lease",
      });
    }
  });

export const CompleteResearchJobLeaseCommandSchema = z
  .object({
    actorId: EntityIdSchema,
    lease: ResearchJobLeaseCursorSchema,
    idempotencyKey: ResearchIdempotencyKeySchema,
    result: ResearchStageExecutionResultSchema,
    outputFingerprint: Sha256Schema,
    execution: ResearchWorkerExecutionCompletionSchema,
  })
  .strict()
  .superRefine((command, context) => {
    if (
      command.result.output.runId !== command.lease.runId ||
      command.result.output.jobId !== command.lease.jobId ||
      command.result.output.attemptId !== command.lease.attemptId
    ) {
      context.addIssue({
        code: "custom",
        path: ["result", "output"],
        message: "Completed output must belong to the fenced lease",
      });
    }
  });

export const FailResearchJobLeaseCommandSchema = z
  .object({
    actorId: EntityIdSchema,
    lease: ResearchJobLeaseCursorSchema,
    idempotencyKey: ResearchIdempotencyKeySchema,
    failure: ResearchWorkerFailureEnvelopeSchema,
    execution: ResearchWorkerExecutionCompletionSchema,
  })
  .strict();

export const ReleaseResearchJobLeaseCommandSchema = z
  .object({
    actorId: EntityIdSchema,
    lease: ResearchJobLeaseCursorSchema,
    idempotencyKey: ResearchIdempotencyKeySchema,
    failure: ResearchWorkerFailureEnvelopeSchema,
    execution: ResearchWorkerExecutionCompletionSchema,
  })
  .strict();

const resultIdentity = {
  runId: EntityIdSchema,
  jobId: EntityIdSchema,
  attemptId: EntityIdSchema.nullable(),
};

export const DurableResearchWorkerResultSchema = z.discriminatedUnion(
  "disposition",
  [
    z
      .object({
        disposition: z.literal("IN_PROGRESS"),
        ...resultIdentity,
        retryAfterMs: z.number().int().min(100).max(900_000),
      })
      .strict(),
    z
      .object({
        disposition: z.literal("ALREADY_TERMINAL"),
        ...resultIdentity,
        jobStatus: z.enum([
          "SUCCEEDED",
          "DEGRADED",
          "FAILED_TERMINAL",
          "CANCELLED",
        ]),
        replayed: z.boolean(),
      })
      .strict(),
    z
      .object({
        disposition: z.enum(["SUCCEEDED", "DEGRADED"]),
        ...resultIdentity,
        attemptId: EntityIdSchema,
        replayed: z.boolean(),
      })
      .strict(),
    z
      .object({
        disposition: z.literal("FAILED_RETRYABLE"),
        ...resultIdentity,
        attemptId: EntityIdSchema,
        retryAt: IsoDateTimeSchema,
        replayed: z.boolean(),
      })
      .strict(),
    z
      .object({
        disposition: z.literal("FAILED_TERMINAL"),
        ...resultIdentity,
        attemptId: EntityIdSchema,
        replayed: z.boolean(),
      })
      .strict(),
    z
      .object({
        disposition: z.enum(["CANCELLED", "LEASE_LOST"]),
        ...resultIdentity,
      })
      .strict(),
    z
      .object({
        disposition: z.literal("RELEASED"),
        ...resultIdentity,
        attemptId: EntityIdSchema,
        retryAt: IsoDateTimeSchema,
        replayed: z.boolean(),
      })
      .strict(),
  ],
);

export type ExecuteDurableResearchJobCommand = z.infer<
  typeof ExecuteDurableResearchJobCommandSchema
>;
export type ClaimResearchJobLeaseCommand = z.infer<
  typeof ClaimResearchJobLeaseCommandSchema
>;
export type HeartbeatResearchJobLeaseCommand = z.infer<
  typeof HeartbeatResearchJobLeaseCommandSchema
>;
export type CheckpointResearchJobLeaseCommand = z.infer<
  typeof CheckpointResearchJobLeaseCommandSchema
>;
export type CompleteResearchJobLeaseCommand = z.infer<
  typeof CompleteResearchJobLeaseCommandSchema
>;
export type FailResearchJobLeaseCommand = z.infer<
  typeof FailResearchJobLeaseCommandSchema
>;
export type ReleaseResearchJobLeaseCommand = z.infer<
  typeof ReleaseResearchJobLeaseCommandSchema
>;
export type DurableResearchWorkerResult = z.infer<
  typeof DurableResearchWorkerResultSchema
>;
