import { z } from "zod";
import { EntityIdSchema } from "@/core/shared/schemas";

const ExactSelectedTextSchema = z
  .string()
  .min(1)
  .max(4_000)
  .refine((text) => text.trim().length > 0, {
    message: "Direction text must contain a non-whitespace character",
  });

const ExactDirectionTextSchema = ExactSelectedTextSchema.refine(
  (text) => text.trim().length >= 3,
  {
    message:
      "Direction text must contain at least three non-whitespace characters",
  },
);

export const DirectionIdempotencyKeySchema = z
  .string()
  .min(8)
  .max(200)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/, {
    message: "Idempotency keys must be stable, opaque tokens",
  });

export const DirectionRequestedActionSchema = z.enum([
  "auto",
  "theory",
  "challenge",
  "compare",
  "connect",
  "return",
]);

export const DirectionAnchorSchema = z
  .object({
    beatId: EntityIdSchema.optional(),
    evidenceId: EntityIdSchema.optional(),
    selectedText: ExactSelectedTextSchema.optional(),
  })
  .strict()
  .superRefine((anchor, context) => {
    if (anchor.beatId === undefined && anchor.evidenceId === undefined) {
      context.addIssue({
        code: "custom",
        message: "A direction anchor requires a beatId or evidenceId",
      });
    }
  });

/**
 * A direction is a state-changing command, not a chat message. `userText` and
 * `selectedText` are deliberately never trimmed or normalized: persistence
 * must retain exactly what the user supplied.
 */
export const SubmitDirectionCommandSchema = z
  .object({
    caseId: EntityIdSchema,
    idempotencyKey: DirectionIdempotencyKeySchema,
    expectedCaseVersion: z.number().int().nonnegative(),
    sourceBranchId: EntityIdSchema,
    userText: ExactDirectionTextSchema,
    anchor: DirectionAnchorSchema.nullable(),
    requestedAction: DirectionRequestedActionSchema,
  })
  .strict();

export type DirectionAnchor = z.infer<typeof DirectionAnchorSchema>;
export type DirectionRequestedAction = z.infer<
  typeof DirectionRequestedActionSchema
>;
export type SubmitDirectionCommand = z.infer<
  typeof SubmitDirectionCommandSchema
>;
