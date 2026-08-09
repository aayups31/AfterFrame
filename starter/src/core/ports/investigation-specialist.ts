import { z } from "zod";
import {
  SpecialistSubjectRefSchema,
  type SpecialistSubjectRef,
} from "@/core/cases/schemas";
import { SlugSchema, VersionTagSchema } from "@/core/shared/schemas";

export const SpecialistManifestSchema = z
  .object({
    id: SlugSchema,
    version: VersionTagSchema,
    supportedSubjectTypes: z.array(SlugSchema).min(1),
  })
  .strict();

export const SourceEvidenceUseSchema = z.enum([
  "EVIDENCE_CAPABLE",
  "INTERPRETIVE_EVIDENCE",
  "LEAD_ONLY",
]);

export const SpecialistSourceClassPolicySchema = z
  .object({
    id: SlugSchema,
    label: z.string().trim().min(1).max(120),
    evidenceUse: SourceEvidenceUseSchema,
    useWhen: z.array(z.string().trim().min(1).max(400)).min(1),
    credibilityCriteria: z.array(z.string().trim().min(1).max(400)).min(1),
    locatorRequirements: z.array(z.string().trim().min(1).max(400)).min(1),
    limitations: z.array(z.string().trim().min(1).max(500)),
  })
  .strict();

export const SpecialistResearchAxisPlanSchema = z
  .object({
    axisId: SlugSchema,
    objective: z.string().trim().min(1).max(2_000),
    sourceClassIds: z.array(SlugSchema).min(1),
    adversarialQuestion: z.string().trim().min(1).max(1_000).nullable(),
  })
  .strict();

export const IdentityRequirementStateSchema = z.enum([
  "UNRESOLVED",
  "IDENTIFIED",
  "RESOLVER_VERIFIED",
  "NOT_REQUIRED",
]);

export const IdentityRequirementBasisSchema = z.enum([
  "STRUCTURAL_REFERENCE",
  "MISSING_REFERENCE",
  "EXPLICIT_REFERENCE",
  "RESOLVER",
  "POLICY",
]);

export const SpecialistIdentityRequirementSchema = z
  .object({
    id: SlugSchema,
    state: IdentityRequirementStateSchema,
    basis: IdentityRequirementBasisSchema,
    reason: z.string().trim().min(1).max(1_000),
  })
  .strict()
  .superRefine((requirement, context) => {
    const validBases = {
      UNRESOLVED: ["STRUCTURAL_REFERENCE", "MISSING_REFERENCE"],
      IDENTIFIED: ["EXPLICIT_REFERENCE"],
      RESOLVER_VERIFIED: ["RESOLVER"],
      NOT_REQUIRED: ["POLICY"],
    } as const;

    if (
      !(validBases[requirement.state] as readonly string[]).includes(
        requirement.basis,
      )
    ) {
      context.addIssue({
        code: "custom",
        path: ["basis"],
        message: `${requirement.state} identity cannot use ${requirement.basis} as its basis`,
      });
    }
  });

export const SpecialistResearchPlanSchema = z
  .object({
    axes: z.array(SpecialistResearchAxisPlanSchema).min(1),
    sourceClassIds: z.array(SlugSchema).min(1),
    identityRequirements: z.array(SpecialistIdentityRequirementSchema),
    coverageGaps: z.array(z.string().trim().min(1).max(1_000)),
  })
  .strict()
  .superRefine((plan, context) => {
    const policyIds = new Set(plan.sourceClassIds);
    plan.axes.forEach((axis, axisIndex) => {
      axis.sourceClassIds.forEach((sourceClassId, sourceIndex) => {
        if (!policyIds.has(sourceClassId)) {
          context.addIssue({
            code: "custom",
            path: ["axes", axisIndex, "sourceClassIds", sourceIndex],
            message:
              "Axis source classes must be included in the plan sourceClassIds",
          });
        }
      });
    });
  });

export type SpecialistManifest = z.infer<typeof SpecialistManifestSchema>;
export type SpecialistSourceClassPolicy = z.infer<
  typeof SpecialistSourceClassPolicySchema
>;
export type SpecialistResearchAxisPlan = z.infer<
  typeof SpecialistResearchAxisPlanSchema
>;
export type SpecialistResearchPlan = z.infer<
  typeof SpecialistResearchPlanSchema
>;

export type SpecialistSubjectValidation<TSubject> =
  | Readonly<{ valid: true; subject: TSubject }>
  | Readonly<{
      valid: false;
      code: "UNSUPPORTED_SUBJECT_TYPE" | "INVALID_SUBJECT_REFERENCE";
      reason: string;
    }>;

export type SpecialistResearchInput<TSubject> = Readonly<{
  subject: TSubject;
  question: string;
}>;

/**
 * Domain-neutral seam used by application orchestration. A specialist may
 * interpret an opaque subject reference and contribute research judgment, but
 * it does not own persistence, source fetching, model calls, or publication.
 */
export interface InvestigationSpecialist<TSubject> {
  readonly manifest: SpecialistManifest;
  validateSubject(
    reference: SpecialistSubjectRef,
  ): SpecialistSubjectValidation<TSubject>;
  sourcePolicy(): readonly SpecialistSourceClassPolicy[];
  planResearch(
    input: SpecialistResearchInput<TSubject>,
  ): SpecialistResearchPlan;
}

export type PreparedSpecialistResearch =
  | Readonly<{
      valid: true;
      plan: SpecialistResearchPlan;
    }>
  | Readonly<{
      valid: false;
      code: "UNSUPPORTED_SUBJECT_TYPE" | "INVALID_SUBJECT_REFERENCE";
      reason: string;
    }>;

/** Type-erased application seam; concrete subject types never leak into core. */
export interface ResolvedInvestigationSpecialist {
  readonly manifest: SpecialistManifest;
  prepareResearch(
    reference: SpecialistSubjectRef,
    question: string,
  ): PreparedSpecialistResearch;
}

export interface InvestigationSpecialistRegistry {
  resolve(
    specialistId: string,
    specialistVersion: string,
  ): ResolvedInvestigationSpecialist | null;
}

export function bindInvestigationSpecialist<TSubject>(
  specialist: InvestigationSpecialist<TSubject>,
): ResolvedInvestigationSpecialist {
  return {
    manifest: specialist.manifest,
    prepareResearch(reference, question) {
      const validation = specialist.validateSubject(reference);
      if (!validation.valid) return validation;
      return {
        valid: true,
        plan: specialist.planResearch({
          subject: validation.subject,
          question,
        }),
      };
    },
  };
}

export function parseSpecialistSubjectRef(
  value: unknown,
): SpecialistSubjectRef {
  return SpecialistSubjectRefSchema.parse(value);
}
