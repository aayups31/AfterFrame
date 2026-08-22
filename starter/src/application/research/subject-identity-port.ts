import { z } from "zod";
import { SpecialistSubjectRefSchema } from "@/core/cases/schemas";
import { SpecialistIdentityRequirementSchema } from "@/core/ports/investigation-specialist";
import { ResolvedPublicSubjectIdentitySchema } from "@/core/research/subject-identity";
import { ResearchWorkerExecutionTelemetrySchema } from "@/core/research-runs/worker-schemas";
import {
  EntityIdSchema,
  Sha256Schema,
  SlugSchema,
  VersionTagSchema,
} from "@/core/shared/schemas";

export const ResearchSubjectIdentityContextSchema = z
  .object({
    schemaVersion: z.literal(1),
    runId: EntityIdSchema,
    jobId: EntityIdSchema,
    caseId: EntityIdSchema,
    specialistId: SlugSchema,
    specialistVersion: VersionTagSchema,
    subjectRef: SpecialistSubjectRefSchema,
    subjectRefFingerprint: Sha256Schema,
    identityRequirements: z
      .array(SpecialistIdentityRequirementSchema)
      .max(50),
  })
  .strict();

export const SubjectIdentityResolverDescriptorSchema = z
  .object({
    specialistId: SlugSchema,
    specialistVersion: VersionTagSchema,
    subjectType: SlugSchema,
    resolver: z
      .object({ id: SlugSchema, version: VersionTagSchema })
      .strict(),
    resolvedRequirementIds: z.array(SlugSchema).min(1).max(50),
  })
  .strict();

export const SubjectIdentityUnavailableReasonSchema = z.enum([
  "AUTHENTICATION_FAILED",
  "NETWORK_ERROR",
  "REQUEST_TIMEOUT",
  "UPSTREAM_UNAVAILABLE",
  "INVALID_PROVIDER_RESPONSE",
  "UNEXPECTED_PROVIDER_RESPONSE",
]);

export const SubjectIdentityResolverResultSchema = z
  .discriminatedUnion("status", [
    z
      .object({
        status: z.literal("VERIFIED"),
        publicIdentity: ResolvedPublicSubjectIdentitySchema,
        telemetry: ResearchWorkerExecutionTelemetrySchema,
      })
      .strict(),
    z
      .object({
        status: z.literal("NOT_FOUND"),
        providerStatusCode: z.literal(404).nullable(),
        telemetry: ResearchWorkerExecutionTelemetrySchema,
      })
      .strict(),
    z
      .object({
        status: z.literal("RATE_LIMITED"),
        retryAfterMs: z.number().int().min(100).max(86_400_000),
        providerStatusCode: z.literal(429).nullable(),
        telemetry: ResearchWorkerExecutionTelemetrySchema,
      })
      .strict(),
    z
      .object({
        status: z.literal("UNAVAILABLE"),
        reason: SubjectIdentityUnavailableReasonSchema,
        retryable: z.boolean(),
        retryAfterMs: z
          .number()
          .int()
          .min(100)
          .max(86_400_000)
          .nullable(),
        providerStatusCode: z.number().int().min(100).max(599).nullable(),
        telemetry: ResearchWorkerExecutionTelemetrySchema,
      })
      .strict(),
  ])
  .superRefine((result, context) => {
    if (
      result.status === "VERIFIED" &&
      result.telemetry.telemetryState !== "COMPLETE"
    ) {
      context.addIssue({
        code: "custom",
        path: ["telemetry", "telemetryState"],
        message: "Verified identity requires complete resolver telemetry",
      });
    }
    if (result.status === "UNAVAILABLE") {
      if (result.retryable !== (result.retryAfterMs !== null)) {
        context.addIssue({
          code: "custom",
          path: ["retryAfterMs"],
          message:
            "Retryable identity failures require a bounded delay; terminal failures require null",
        });
      }
      const retryableReasons = new Set([
        "NETWORK_ERROR",
        "REQUEST_TIMEOUT",
        "UPSTREAM_UNAVAILABLE",
      ]);
      if (result.retryable !== retryableReasons.has(result.reason)) {
        context.addIssue({
          code: "custom",
          path: ["retryable"],
          message:
            "Identity availability retry policy must match the bounded failure reason",
        });
      }
    }
  });

export type ResearchSubjectIdentityContext = z.infer<
  typeof ResearchSubjectIdentityContextSchema
>;
export type SubjectIdentityResolverDescriptor = z.infer<
  typeof SubjectIdentityResolverDescriptorSchema
>;
export type SubjectIdentityResolverResult = z.infer<
  typeof SubjectIdentityResolverResultSchema
>;

export interface ResearchSubjectIdentityContextReader {
  getSubjectIdentityContext(input: Readonly<{
    actorId: string;
    runId: string;
    jobId: string;
  }>): Promise<unknown>;
}

export interface SubjectIdentityResolver {
  readonly identity: SubjectIdentityResolverDescriptor;
  resolve(input: Readonly<{
    subjectRef: z.infer<typeof SpecialistSubjectRefSchema>;
    signal: AbortSignal;
  }>): Promise<unknown>;
}
