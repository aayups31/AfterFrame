import { z } from "zod";
import {
  NoPublicationAuthoritySchema,
  ResearchJobStatusSchema,
  ResearchRunStatusSchema,
  ResearchStageSchema,
} from "@/core/research-runs/schemas";
import {
  EntityIdSchema,
  IsoDateTimeSchema,
  SlugSchema,
  VersionTagSchema,
} from "@/core/shared/schemas";

export const ResearchIdempotencyKeySchema = z
  .string()
  .min(8)
  .max(200)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);

export const StartResearchRunCommandSchema = z
  .object({
    caseId: EntityIdSchema,
    branchId: EntityIdSchema.nullable(),
    expectedCaseVersion: z.number().int().nonnegative(),
    idempotencyKey: ResearchIdempotencyKeySchema,
  })
  .strict();

export const ExecuteResearchJobCommandSchema = z
  .object({
    runId: EntityIdSchema,
    jobId: EntityIdSchema,
    expectedRunVersion: z.number().int().nonnegative(),
    expectedJobVersion: z.number().int().nonnegative(),
    idempotencyKey: ResearchIdempotencyKeySchema,
  })
  .strict();

export const RetryResearchJobCommandSchema = z
  .object({
    runId: EntityIdSchema,
    jobId: EntityIdSchema,
    expectedRunVersion: z.number().int().nonnegative(),
    expectedJobVersion: z.number().int().nonnegative(),
    idempotencyKey: ResearchIdempotencyKeySchema,
  })
  .strict();

const ResearchRunEventBaseSchema = z
  .object({
    id: EntityIdSchema,
    schemaVersion: z.literal(1),
    aggregateType: z.literal("research_run"),
    aggregateId: EntityIdSchema,
    sequence: z.number().int().positive(),
    aggregateVersion: z.number().int().nonnegative(),
    occurredAt: IsoDateTimeSchema,
    publicationAuthority: NoPublicationAuthoritySchema,
  })
  .strict();

export const ResearchRunCreatedEventPayloadSchema = z
  .object({
    caseId: EntityIdSchema,
    branchId: EntityIdSchema.nullable(),
    planId: EntityIdSchema,
    specialistId: SlugSchema,
    specialistVersion: VersionTagSchema,
  })
  .strict();

export const ResearchRunCreatedDomainEventSchema =
  ResearchRunEventBaseSchema.extend({
    type: z.literal("research.run_created"),
    payload: ResearchRunCreatedEventPayloadSchema,
  }).strict();

export const ResearchJobsStagedEventPayloadSchema = z
  .object({
    jobs: z
      .array(
        z
          .object({
            jobId: EntityIdSchema,
            stage: ResearchStageSchema,
            dependsOnJobId: EntityIdSchema.nullable(),
          })
          .strict(),
      )
      .length(7),
  })
  .strict();

export const ResearchJobsStagedDomainEventSchema =
  ResearchRunEventBaseSchema.extend({
    type: z.literal("research.jobs_staged"),
    payload: ResearchJobsStagedEventPayloadSchema,
  }).strict();

export const ResearchJobStatusChangedEventPayloadSchema = z
  .object({
    jobId: EntityIdSchema,
    stage: ResearchStageSchema,
    previousStatus: ResearchJobStatusSchema,
    status: ResearchJobStatusSchema,
    attemptId: EntityIdSchema.nullable(),
    boundedReasonCode: SlugSchema.nullable(),
  })
  .strict();

export const ResearchJobStatusChangedDomainEventSchema =
  ResearchRunEventBaseSchema.extend({
    type: z.literal("research.job_status_changed"),
    payload: ResearchJobStatusChangedEventPayloadSchema,
  }).strict();

export const ResearchRunStatusChangedEventPayloadSchema = z
  .object({
    previousStatus: ResearchRunStatusSchema,
    status: ResearchRunStatusSchema,
    currentStage: ResearchStageSchema.nullable(),
    boundedReasonCode: SlugSchema.nullable(),
  })
  .strict();

export const ResearchRunStatusChangedDomainEventSchema =
  ResearchRunEventBaseSchema.extend({
    type: z.literal("research.run_status_changed"),
    payload: ResearchRunStatusChangedEventPayloadSchema,
  }).strict();

export const ResearchRunDomainEventSchema = z.discriminatedUnion("type", [
  ResearchRunCreatedDomainEventSchema,
  ResearchJobsStagedDomainEventSchema,
  ResearchJobStatusChangedDomainEventSchema,
  ResearchRunStatusChangedDomainEventSchema,
]);

/** Event delivery is separate from publication of research prose or beats. */
export const ResearchRunOutboxEventSchema = z
  .object({
    id: EntityIdSchema,
    event: ResearchRunDomainEventSchema,
    recordedAt: IsoDateTimeSchema,
    deliveryAttempts: z.number().int().nonnegative(),
    deliveredAt: IsoDateTimeSchema.nullable(),
  })
  .strict()
  .superRefine((outboxEvent, context) => {
    if (
      outboxEvent.deliveredAt !== null &&
      new Date(outboxEvent.deliveredAt).getTime() <
        new Date(outboxEvent.recordedAt).getTime()
    ) {
      context.addIssue({
        code: "custom",
        path: ["deliveredAt"],
        message: "deliveredAt cannot precede recordedAt",
      });
    }
  });

export type StartResearchRunCommand = z.infer<
  typeof StartResearchRunCommandSchema
>;
export type ExecuteResearchJobCommand = z.infer<
  typeof ExecuteResearchJobCommandSchema
>;
export type RetryResearchJobCommand = z.infer<
  typeof RetryResearchJobCommandSchema
>;
export type ResearchRunDomainEvent = z.infer<
  typeof ResearchRunDomainEventSchema
>;
export type ResearchRunOutboxEvent = z.infer<
  typeof ResearchRunOutboxEventSchema
>;
