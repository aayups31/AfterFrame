import { z } from "zod";
import { ResearchStageSchema } from "@/core/research-runs/schemas";
import {
  EntityIdSchema,
  IsoDateTimeSchema,
  Sha256Schema,
} from "@/core/shared/schemas";

export const ResearchAttemptInputDependencySchema = z.discriminatedUnion(
  "state",
  [
    z.object({ state: z.literal("ROOT") }).strict(),
    z
      .object({
        state: z.literal("BOUND"),
        predecessorJobId: EntityIdSchema,
        predecessorAttemptId: EntityIdSchema,
        predecessorOutputId: EntityIdSchema,
        predecessorOutputFingerprint: Sha256Schema,
      })
      .strict(),
  ],
);

export const ResearchAttemptInputSubjectIdentitySchema =
  z.discriminatedUnion("state", [
    z.object({ state: z.literal("UNBOUND") }).strict(),
    z
      .object({
        state: z.literal("BOUND"),
        subjectIdentityId: EntityIdSchema,
        identityFingerprint: Sha256Schema,
      })
      .strict(),
  ]);

/**
 * Immutable causal input selected from authoritative rows when an attempt is
 * claimed. It contains fingerprints and record references, never private text
 * or provider/source bodies.
 */
export const ResearchAttemptInputManifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    runId: EntityIdSchema,
    caseId: EntityIdSchema,
    branchId: EntityIdSchema.nullable(),
    planId: EntityIdSchema,
    jobId: EntityIdSchema,
    stage: ResearchStageSchema,
    subjectRefFingerprint: Sha256Schema,
    objectiveFingerprint: Sha256Schema,
    runRequestFingerprint: Sha256Schema,
    planFingerprint: Sha256Schema,
    stageSeedFingerprint: Sha256Schema,
    dependency: ResearchAttemptInputDependencySchema,
    subjectIdentity: ResearchAttemptInputSubjectIdentitySchema,
  })
  .strict()
  .superRefine((manifest, context) => {
    const isIdentity = manifest.stage === "IDENTITY";
    if (isIdentity !== (manifest.dependency.state === "ROOT")) {
      context.addIssue({
        code: "custom",
        path: ["dependency"],
        message:
          "Only IDENTITY may be a root input; every later stage requires its immediate predecessor",
      });
    }
    if (isIdentity !== (manifest.subjectIdentity.state === "UNBOUND")) {
      context.addIssue({
        code: "custom",
        path: ["subjectIdentity"],
        message:
          "IDENTITY must begin unbound; every later stage requires the resolver-verified subject identity",
      });
    }
  });

/** The database is the sole authority for both the manifest and its hash. */
export const ResearchAttemptInputManifestEnvelopeSchema = z
  .object({
    schemaVersion: z.literal(1),
    authority: z.literal("POSTGRES"),
    manifest: ResearchAttemptInputManifestSchema,
    manifestFingerprint: Sha256Schema,
    authoredAt: IsoDateTimeSchema,
  })
  .strict();

export type ResearchAttemptInputDependency = z.infer<
  typeof ResearchAttemptInputDependencySchema
>;
export type ResearchAttemptInputSubjectIdentity = z.infer<
  typeof ResearchAttemptInputSubjectIdentitySchema
>;
export type ResearchAttemptInputManifest = z.infer<
  typeof ResearchAttemptInputManifestSchema
>;
export type ResearchAttemptInputManifestEnvelope = z.infer<
  typeof ResearchAttemptInputManifestEnvelopeSchema
>;
