import { z } from "zod";
import {
  EntityIdSchema,
  IsoDateTimeSchema,
  OpaqueReferenceSchema,
  SlugSchema,
  VersionTagSchema,
} from "@/core/shared/schemas";

export const CaseStatusSchema = z.enum([
  "DRAFT",
  "INTENT_PROPOSED",
  "READY",
  "ACTIVE",
  "PAUSED",
  "CLOSURE_REVIEW",
  "CLOSED",
]);

export const CaseHealthSchema = z.enum(["HEALTHY", "DEGRADED", "FAILED"]);

/**
 * Core treats this reference as opaque. A specialist is responsible for
 * validating the referenced subject and optional version.
 */
export const SpecialistSubjectRefSchema = z
  .object({
    type: SlugSchema,
    id: OpaqueReferenceSchema,
    versionId: OpaqueReferenceSchema.nullable(),
  })
  .strict();

export const InvestigationCaseSchema = z
  .object({
    id: EntityIdSchema,
    ownerId: EntityIdSchema,
    specialistId: SlugSchema,
    specialistVersion: VersionTagSchema,
    subjectRef: SpecialistSubjectRefSchema,
    exactCuriosity: z
      .string()
      .min(3)
      .max(4_000)
      .refine((text) => text.trim().length >= 3, {
        message:
          "Curiosity must contain at least three non-whitespace characters",
      }),
    status: CaseStatusSchema,
    health: CaseHealthSchema,
    activeBranchId: EntityIdSchema.nullable(),
    aggregateVersion: z.number().int().nonnegative(),
    eventSequence: z.number().int().nonnegative(),
    createdAt: IsoDateTimeSchema,
    updatedAt: IsoDateTimeSchema,
  })
  .strict()
  .superRefine((investigationCase, context) => {
    if (
      ["ACTIVE", "PAUSED", "CLOSURE_REVIEW", "CLOSED"].includes(
        investigationCase.status,
      ) &&
      investigationCase.activeBranchId === null
    ) {
      context.addIssue({
        code: "custom",
        path: ["activeBranchId"],
        message: `${investigationCase.status} cases require an activeBranchId`,
      });
    }

    if (
      new Date(investigationCase.updatedAt).getTime() <
      new Date(investigationCase.createdAt).getTime()
    ) {
      context.addIssue({
        code: "custom",
        path: ["updatedAt"],
        message: "updatedAt cannot precede createdAt",
      });
    }
  });

export type CaseStatus = z.infer<typeof CaseStatusSchema>;
export type SpecialistSubjectRef = z.infer<typeof SpecialistSubjectRefSchema>;
export type InvestigationCase = z.infer<typeof InvestigationCaseSchema>;
