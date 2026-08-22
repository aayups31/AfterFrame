import { z } from "zod";
import {
  EntityIdSchema,
  IsoDateTimeSchema,
  Sha256Schema,
  SlugSchema,
  VersionTagSchema,
} from "@/core/shared/schemas";

const PublicIdentityNameSchema = z
  .string()
  .min(1)
  .max(500)
  .refine((text) => text.trim().length > 0, {
    message: "Public identity names cannot be whitespace-only",
  });

/**
 * Resolver-supplied public subject context. This is identity metadata only: it
 * is never a source, evidence fragment, claim, or publication-authorized text.
 */
export const ResolvedPublicSubjectIdentitySchema = z
  .object({
    displayName: PublicIdentityNameSchema,
    alternateNames: z.array(PublicIdentityNameSchema).max(30),
    disambiguators: z
      .array(
        z
          .object({
            label: SlugSchema,
            value: z.string().trim().min(1).max(500),
          })
          .strict(),
      )
      .max(30),
    identityFingerprint: Sha256Schema,
    dataClass: z.literal("PUBLIC"),
    verificationState: z.literal("RESOLVER_VERIFIED"),
    resolver: z
      .object({
        id: SlugSchema,
        version: VersionTagSchema,
      })
      .strict(),
    resolvedAt: IsoDateTimeSchema,
  })
  .strict();

const SubjectIdentityProvenanceReferenceSchema = z.discriminatedUnion(
  "recordType",
  [
    z
      .object({
        recordType: z.literal("JOB"),
        recordId: EntityIdSchema,
      })
      .strict(),
    z
      .object({
        recordType: z.literal("ATTEMPT"),
        recordId: EntityIdSchema,
      })
      .strict(),
  ],
);

/** Durable, body-free identity produced by the IDENTITY research stage. */
export const ResolvedSubjectIdentityRecordSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: EntityIdSchema,
    caseId: EntityIdSchema,
    runId: EntityIdSchema,
    jobId: EntityIdSchema,
    attemptId: EntityIdSchema,
    subjectRefFingerprint: Sha256Schema,
    publicIdentity: ResolvedPublicSubjectIdentitySchema,
    evidenceStatus: z.literal("NOT_EVIDENCE"),
    reviewState: z.literal("PROPOSED"),
    publicationAuthority: z.literal("NONE"),
    provenanceInputs: z
      .array(SubjectIdentityProvenanceReferenceSchema)
      .length(2),
    createdAt: IsoDateTimeSchema,
  })
  .strict()
  .superRefine((identity, context) => {
    const jobReferences = identity.provenanceInputs.filter(
      (reference) =>
        reference.recordType === "JOB" &&
        reference.recordId === identity.jobId,
    );
    const attemptReferences = identity.provenanceInputs.filter(
      (reference) =>
        reference.recordType === "ATTEMPT" &&
        reference.recordId === identity.attemptId,
    );
    if (jobReferences.length !== 1 || attemptReferences.length !== 1) {
      context.addIssue({
        code: "custom",
        path: ["provenanceInputs"],
        message:
          "Resolved subject identity requires exactly its producing job and attempt provenance",
      });
    }
    if (
      new Date(identity.createdAt).getTime() <
      new Date(identity.publicIdentity.resolvedAt).getTime()
    ) {
      context.addIssue({
        code: "custom",
        path: ["createdAt"],
        message: "Identity record creation cannot precede resolver verification",
      });
    }
  });

export type ResolvedPublicSubjectIdentity = z.infer<
  typeof ResolvedPublicSubjectIdentitySchema
>;
export type ResolvedSubjectIdentityRecord = z.infer<
  typeof ResolvedSubjectIdentityRecordSchema
>;
