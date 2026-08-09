import { z } from "zod";
import { EntityIdSchema, IsoDateTimeSchema } from "@/core/shared/schemas";
import { DirectionRequestedActionSchema } from "@/contracts/directions";

const EventAnchorReferenceSchema = z
  .object({
    beatId: EntityIdSchema.optional(),
    evidenceId: EntityIdSchema.optional(),
  })
  .strict()
  .superRefine((anchor, context) => {
    if (anchor.beatId === undefined && anchor.evidenceId === undefined) {
      context.addIssue({
        code: "custom",
        message: "An event anchor requires a beatId or evidenceId",
      });
    }
  });

/**
 * Domain-event payloads intentionally contain references and classifications
 * only. Exact direction text, selected text, source excerpts, note bodies, and
 * open-ended analytics properties belong in neither this event nor the outbox.
 */
export const DirectionSubmittedEventPayloadSchema = z
  .object({
    directionId: EntityIdSchema,
    sourceBranchId: EntityIdSchema,
    requestedAction: DirectionRequestedActionSchema,
    anchor: EventAnchorReferenceSchema.nullable(),
  })
  .strict();

export const DirectionSubmittedDomainEventSchema = z
  .object({
    id: EntityIdSchema,
    type: z.literal("direction.submitted"),
    schemaVersion: z.literal(1),
    aggregateType: z.literal("case"),
    aggregateId: EntityIdSchema,
    sequence: z.number().int().positive(),
    aggregateVersion: z.number().int().positive(),
    occurredAt: IsoDateTimeSchema,
    payload: DirectionSubmittedEventPayloadSchema,
  })
  .strict();

export const BranchProposedEventPayloadSchema = z
  .object({
    branchId: EntityIdSchema,
    parentBranchId: EntityIdSchema,
    originDirectionId: EntityIdSchema,
  })
  .strict();

export const BranchProposedDomainEventSchema = z
  .object({
    id: EntityIdSchema,
    type: z.literal("branch.proposed"),
    schemaVersion: z.literal(1),
    aggregateType: z.literal("case"),
    aggregateId: EntityIdSchema,
    sequence: z.number().int().positive(),
    aggregateVersion: z.number().int().positive(),
    occurredAt: IsoDateTimeSchema,
    payload: BranchProposedEventPayloadSchema,
  })
  .strict();

// This is a deliberately small V1 union. Add variants only when their state
// transition exists; never accept an unvalidated payload bag.
export const DomainEventSchema = z.discriminatedUnion("type", [
  DirectionSubmittedDomainEventSchema,
  BranchProposedDomainEventSchema,
]);

export const OutboxEventSchema = z
  .object({
    id: EntityIdSchema,
    event: DomainEventSchema,
    recordedAt: IsoDateTimeSchema,
    publicationAttempts: z.number().int().nonnegative(),
    publishedAt: IsoDateTimeSchema.nullable(),
  })
  .strict()
  .superRefine((outboxEvent, context) => {
    if (
      outboxEvent.publishedAt !== null &&
      new Date(outboxEvent.publishedAt).getTime() <
        new Date(outboxEvent.recordedAt).getTime()
    ) {
      context.addIssue({
        code: "custom",
        path: ["publishedAt"],
        message: "publishedAt cannot precede recordedAt",
      });
    }
  });

export type DirectionSubmittedEventPayload = z.infer<
  typeof DirectionSubmittedEventPayloadSchema
>;
export type DirectionSubmittedDomainEvent = z.infer<
  typeof DirectionSubmittedDomainEventSchema
>;
export type BranchProposedDomainEvent = z.infer<
  typeof BranchProposedDomainEventSchema
>;
export type DomainEvent = z.infer<typeof DomainEventSchema>;
export type OutboxEvent = z.infer<typeof OutboxEventSchema>;
