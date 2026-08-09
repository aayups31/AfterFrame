import { z } from "zod";
import { SpecialistSubjectRefSchema } from "@/core/cases/schemas";
import {
  AccessStateSchema,
  RightsStateSchema,
  SourceMediumSchema,
} from "@/core/research/schemas";
import {
  ExecutionMetadataSchema,
  NoPublicationAuthoritySchema,
} from "@/core/research-runs/schemas";
import {
  EntityIdSchema,
  HttpUrlSchema,
  IsoDateTimeSchema,
  OpaqueReferenceSchema,
  Sha256Schema,
  SlugSchema,
  VersionTagSchema,
} from "@/core/shared/schemas";

const ExactBoundedTextSchema = z
  .string()
  .min(3)
  .max(4_000)
  .refine((text) => text.trim().length >= 3, {
    message: "Text must contain at least three non-whitespace characters",
  });

const PublicIdentityNameSchema = z
  .string()
  .min(1)
  .max(500)
  .refine((text) => text.trim().length > 0, {
    message: "Public identity names cannot be whitespace-only",
  });

/**
 * Resolver-supplied public context for any subject domain. The discovery
 * worker must not infer this identity from a model answer or user assertion.
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

export const ResearchDiscoveryAxisInputSchema = z
  .object({
    axisId: SlugSchema,
    objective: ExactBoundedTextSchema,
    sourceClassIds: z.array(SlugSchema).min(1).max(30),
  })
  .strict();

/**
 * exactQuestion is intentionally available only at the authorized worker
 * boundary. It must never be copied into telemetry, errors, or domain events.
 */
export const ResearchDiscoveryInputSchema = z
  .object({
    runId: EntityIdSchema,
    jobId: EntityIdSchema,
    caseId: EntityIdSchema,
    /** Trusted logical-job input fingerprint; adapters must echo this on candidates. */
    stageInputFingerprint: Sha256Schema,
    subjectRef: SpecialistSubjectRefSchema,
    publicSubjectIdentity: ResolvedPublicSubjectIdentitySchema,
    exactQuestion: ExactBoundedTextSchema,
    axis: ResearchDiscoveryAxisInputSchema,
  })
  .strict();

/** A proposed URL/title remains an unverified lead, never source evidence. */
export const UnverifiedSourceCandidateProposalSchema = z
  .object({
    candidateKey: OpaqueReferenceSchema,
    title: z.string().trim().min(1).max(1_000),
    canonicalUrl: HttpUrlSchema.nullable(),
    medium: SourceMediumSchema,
    sourceClass: SlugSchema,
    accessState: AccessStateSchema,
    rightsState: RightsStateSchema,
    discoveryInputFingerprint: Sha256Schema,
    contentTrust: z.literal("UNTRUSTED"),
    evidenceStatus: z.literal("NOT_EVIDENCE"),
    reviewState: z.literal("PROPOSED"),
    publicationAuthority: NoPublicationAuthoritySchema,
  })
  .strict();

export const ResearchDiscoveryOutputSchema = z
  .object({
    candidates: z.array(UnverifiedSourceCandidateProposalSchema).max(500),
    execution: ExecutionMetadataSchema,
  })
  .strict()
  .superRefine((output, context) => {
    if (output.execution.executionKind !== "MODEL_TOOL") {
      context.addIssue({
        code: "custom",
        path: ["execution", "executionKind"],
        message:
          "Live discovery must record both model and search-tool execution metadata",
      });
    }
    if (output.execution.latencyMs === null) {
      context.addIssue({
        code: "custom",
        path: ["execution", "latencyMs"],
        message: "Completed discovery output requires latency metadata",
      });
    }
  });

/**
 * Validates both sides of the adapter handshake. The stage fingerprint is
 * supplied by orchestration and must be echoed, never recomputed from private
 * question text or the provider request body.
 */
export function parseResearchDiscoveryOutputForInput(
  inputValue: unknown,
  outputValue: unknown,
): ResearchDiscoveryOutput {
  const input = ResearchDiscoveryInputSchema.parse(inputValue);
  const output = ResearchDiscoveryOutputSchema.parse(outputValue);
  const mismatchedCandidate = output.candidates.find(
    (candidate) =>
      candidate.discoveryInputFingerprint !== input.stageInputFingerprint,
  );
  if (mismatchedCandidate !== undefined) {
    throw new z.ZodError([
      {
        code: "custom",
        path: ["candidates", "discoveryInputFingerprint"],
        message:
          "Discovery candidates must echo the trusted stageInputFingerprint",
      },
    ]);
  }
  return output;
}

export type ResolvedPublicSubjectIdentity = z.infer<
  typeof ResolvedPublicSubjectIdentitySchema
>;
export type ResearchDiscoveryInput = z.infer<
  typeof ResearchDiscoveryInputSchema
>;
export type UnverifiedSourceCandidateProposal = z.infer<
  typeof UnverifiedSourceCandidateProposalSchema
>;
export type ResearchDiscoveryOutput = z.infer<
  typeof ResearchDiscoveryOutputSchema
>;

/**
 * Provider boundary. `unknown` is deliberate: application orchestration must
 * validate every adapter response before it can enter durable research state.
 */
export interface ResearchDiscoveryPort {
  discover(input: ResearchDiscoveryInput): Promise<unknown>;
}
