import { z } from "zod";
import { SpecialistSubjectRefSchema } from "@/core/cases/schemas";
import { SpecialistResearchAxisPlanSchema } from "@/core/ports/investigation-specialist";
import {
  AccessStateSchema,
  RightsStateSchema,
  SourceMediumSchema,
} from "@/core/research/schemas";
import { ResolvedPublicSubjectIdentitySchema } from "@/core/research/subject-identity";
import {
  ExecutionMetadataSchema,
  NoPublicationAuthoritySchema,
} from "@/core/research-runs/schemas";
import { ResearchProviderRunRecordSchema } from "@/core/research-runs/provider-runs";
import {
  EntityIdSchema,
  HttpUrlSchema,
  IsoDateTimeSchema,
  OpaqueReferenceSchema,
  Sha256Schema,
  SlugSchema,
} from "@/core/shared/schemas";

const ExactPrivateQuestionSchema = z
  .string()
  .min(3)
  .max(4_000)
  .refine((value) => value.trim().length >= 3, {
    message: "The exact question must contain at least three non-whitespace characters",
  });

export const DurableResearchDiscoveryContextSchema = z
  .object({
    schemaVersion: z.literal(1),
    runId: EntityIdSchema,
    jobId: EntityIdSchema,
    caseId: EntityIdSchema,
    subjectRef: SpecialistSubjectRefSchema,
    publicSubjectIdentity: ResolvedPublicSubjectIdentitySchema,
    exactQuestion: ExactPrivateQuestionSchema,
    axes: z.array(SpecialistResearchAxisPlanSchema).min(1).max(30),
    sourceClassIds: z.array(SlugSchema).min(1).max(30),
  })
  .strict()
  .superRefine((input, context) => {
    const axisIds = new Set(input.axes.map(({ axisId }) => axisId));
    const sourceClassIds = new Set(input.sourceClassIds);
    const selectedSourceClasses = new Set(
      input.axes.flatMap(({ sourceClassIds: selected }) => selected),
    );
    if (
      axisIds.size !== input.axes.length ||
      sourceClassIds.size !== input.sourceClassIds.length ||
      input.axes.some(
        (axis) =>
          new Set(axis.sourceClassIds).size !== axis.sourceClassIds.length ||
          axis.sourceClassIds.some(
            (sourceClassId) => !sourceClassIds.has(sourceClassId),
          ),
      ) ||
      selectedSourceClasses.size !== sourceClassIds.size ||
      [...selectedSourceClasses].some(
        (sourceClassId) => !sourceClassIds.has(sourceClassId),
      )
    ) {
      context.addIssue({
        code: "custom",
        path: ["axes"],
        message:
          "Discovery context must uniquely and exactly cover its pinned axes and source classes",
      });
    }
  });

export const DurableResearchDiscoveryInputSchema = z
  .object({
    schemaVersion: z.literal(1),
    runId: EntityIdSchema,
    jobId: EntityIdSchema,
    attemptId: EntityIdSchema,
    caseId: EntityIdSchema,
    manifestFingerprint: Sha256Schema,
    externalIdempotencyKey: Sha256Schema,
    subjectRef: SpecialistSubjectRefSchema,
    publicSubjectIdentity: ResolvedPublicSubjectIdentitySchema,
    exactQuestion: ExactPrivateQuestionSchema,
    axes: z.array(SpecialistResearchAxisPlanSchema).min(1).max(30),
    sourceClassIds: z.array(SlugSchema).min(1).max(30),
  })
  .strict()
  .superRefine((input, context) => {
    const axisIds = new Set<string>();
    const permittedSourceClasses = new Set(input.sourceClassIds);
    if (permittedSourceClasses.size !== input.sourceClassIds.length) {
      context.addIssue({
        code: "custom",
        path: ["sourceClassIds"],
        message: "Discovery source-class IDs must be unique",
      });
    }
    input.axes.forEach((axis, axisIndex) => {
      if (axisIds.has(axis.axisId)) {
        context.addIssue({
          code: "custom",
          path: ["axes", axisIndex, "axisId"],
          message: "Discovery axis IDs must be unique",
        });
      }
      axisIds.add(axis.axisId);
      if (new Set(axis.sourceClassIds).size !== axis.sourceClassIds.length) {
        context.addIssue({
          code: "custom",
          path: ["axes", axisIndex, "sourceClassIds"],
          message: "Axis source-class IDs must be unique",
        });
      }
      axis.sourceClassIds.forEach((sourceClassId, sourceClassIndex) => {
        if (!permittedSourceClasses.has(sourceClassId)) {
          context.addIssue({
            code: "custom",
            path: ["axes", axisIndex, "sourceClassIds", sourceClassIndex],
            message: "Axis source classes must come from the pinned scope",
          });
        }
      });
    });
    const selectedSourceClasses = new Set(
      input.axes.flatMap(({ sourceClassIds }) => sourceClassIds),
    );
    if (
      selectedSourceClasses.size !== permittedSourceClasses.size ||
      [...selectedSourceClasses].some(
        (sourceClassId) => !permittedSourceClasses.has(sourceClassId),
      )
    ) {
      context.addIssue({
        code: "custom",
        path: ["sourceClassIds"],
        message:
          "The multi-axis discovery request must cover exactly the pinned source-class scope",
      });
    }
  });

export const AxisTaggedSourceCandidateProposalSchema = z
  .object({
    candidateKey: OpaqueReferenceSchema,
    title: z.string().trim().min(1).max(1_000),
    canonicalUrl: HttpUrlSchema,
    medium: SourceMediumSchema,
    sourceClass: SlugSchema,
    axisIds: z.array(SlugSchema).min(1).max(30),
    accessState: AccessStateSchema,
    rightsState: RightsStateSchema,
    discoveryInputFingerprint: Sha256Schema,
    contentTrust: z.literal("UNTRUSTED"),
    evidenceStatus: z.literal("NOT_EVIDENCE"),
    reviewState: z.literal("PROPOSED"),
    publicationAuthority: NoPublicationAuthoritySchema,
  })
  .strict()
  .superRefine((candidate, context) => {
    if (new Set(candidate.axisIds).size !== candidate.axisIds.length) {
      context.addIssue({
        code: "custom",
        path: ["axisIds"],
        message: "Candidate axis IDs must be unique",
      });
    }
  });

export const DurableResearchDiscoveryOutputSchema = z
  .object({
    candidates: z.array(AxisTaggedSourceCandidateProposalSchema).max(500),
    execution: ExecutionMetadataSchema,
  })
  .strict()
  .superRefine((output, context) => {
    if (
      output.execution.executionKind !== "MODEL_TOOL" ||
      output.execution.telemetryState !== "COMPLETE" ||
      output.execution.latencyMs === null
    ) {
      context.addIssue({
        code: "custom",
        path: ["execution"],
        message:
          "Completed durable discovery requires complete model-and-tool execution metadata",
      });
    }
    const keys = new Set<string>();
    output.candidates.forEach((candidate, candidateIndex) => {
      if (keys.has(candidate.candidateKey)) {
        context.addIssue({
          code: "custom",
          path: ["candidates", candidateIndex, "candidateKey"],
          message: "Candidate keys must be unique",
        });
      }
      keys.add(candidate.candidateKey);
    });
  });

/** Validates the provider result against the exact Postgres-authored attempt. */
export function parseDurableResearchDiscoveryOutputForInput(
  inputValue: unknown,
  outputValue: unknown,
) {
  const input = DurableResearchDiscoveryInputSchema.parse(inputValue);
  const output = DurableResearchDiscoveryOutputSchema.parse(outputValue);
  const axes = new Map(input.axes.map((axis) => [axis.axisId, axis]));
  const policyMismatch = output.candidates.some((candidate) => {
    if (candidate.discoveryInputFingerprint !== input.manifestFingerprint) {
      return true;
    }
    return candidate.axisIds.some((axisId) => {
      const axis = axes.get(axisId);
      return axis === undefined || !axis.sourceClassIds.includes(candidate.sourceClass);
    });
  });
  if (policyMismatch) {
    throw new z.ZodError([
      {
        code: "custom",
        path: ["candidates"],
        message:
          "Every candidate must bind the exact manifest and an axis that permits its source class",
      },
    ]);
  }
  return output;
}

export type DurableResearchDiscoveryInput = z.infer<
  typeof DurableResearchDiscoveryInputSchema
>;
export type DurableResearchDiscoveryContext = z.infer<
  typeof DurableResearchDiscoveryContextSchema
>;
export type AxisTaggedSourceCandidateProposal = z.infer<
  typeof AxisTaggedSourceCandidateProposalSchema
>;
export type DurableResearchDiscoveryOutput = z.infer<
  typeof DurableResearchDiscoveryOutputSchema
>;

export const DurableResearchDiscoveryHandleSchema = z
  .object({
    providerResponseId: OpaqueReferenceSchema,
    state: z.enum(["QUEUED", "IN_PROGRESS", "COMPLETED", "FAILED", "INCOMPLETE", "CANCELLED"]),
    requestedModel: z.string().trim().min(1).max(200),
    providerModel: z.string().trim().min(1).max(200),
    traceId: OpaqueReferenceSchema,
    binding: z
      .object({
        runId: EntityIdSchema,
        jobId: EntityIdSchema,
        attemptId: EntityIdSchema,
        caseId: EntityIdSchema,
        manifestFingerprint: Sha256Schema,
        externalIdempotencyKey: Sha256Schema,
      })
      .strict(),
    startedAt: IsoDateTimeSchema,
    lastObservedAt: IsoDateTimeSchema,
    inputBytes: z.number().int().nonnegative(),
    dataControlMode: z.literal("MODIFIED_ABUSE_MONITORING"),
    projectIdFingerprint: Sha256Schema,
    privateContentIncluded: z.literal(true),
  })
  .strict();

export const DurableResearchDiscoveryFailureSchema = z
  .object({
    providerResponseId: OpaqueReferenceSchema,
    state: z.enum(["FAILED", "INCOMPLETE", "CANCELLED"]),
    reasonCode: z.enum(["provider-failed", "provider-incomplete", "provider-cancelled"]),
    providerReasonCode: SlugSchema.nullable(),
    requestedModel: z.string().trim().min(1).max(200),
    providerModel: z.string().trim().min(1).max(200),
    traceId: OpaqueReferenceSchema,
    startedAt: IsoDateTimeSchema,
    observedAt: IsoDateTimeSchema,
    latencyMs: z.number().int().nonnegative(),
    usage: z
      .object({
        inputTokens: z.number().int().nonnegative(),
        outputTokens: z.number().int().nonnegative(),
        totalTokens: z.number().int().nonnegative(),
      })
      .strict()
      .nullable(),
    privateContentIncluded: z.literal(true),
  })
  .strict();

/**
 * Body-free durable recovery state. Persisting only providerResponseId would
 * make trace, model, timing, and data-control metadata unknowable after a
 * worker crash, so the accepted handle is normalized into this exact record.
 */
export const DurableResearchProviderRunRecordSchema =
  ResearchProviderRunRecordSchema;

export function providerRunRecordFromAcceptedHandle(
  inputValue: unknown,
  handleValue: unknown,
  acceptedAt: string,
) {
  const input = DurableResearchDiscoveryInputSchema.parse(inputValue);
  const handle = DurableResearchDiscoveryHandleSchema.parse(handleValue);
  if (
    handle.binding.runId !== input.runId ||
    handle.binding.jobId !== input.jobId ||
    handle.binding.attemptId !== input.attemptId ||
    handle.binding.caseId !== input.caseId ||
    handle.binding.manifestFingerprint !== input.manifestFingerprint ||
    handle.binding.externalIdempotencyKey !== input.externalIdempotencyKey ||
    !["QUEUED", "IN_PROGRESS"].includes(handle.state)
  ) {
    throw new z.ZodError([
      {
        code: "custom",
        path: ["handle"],
        message: "Accepted provider handle must bind the exact discovery attempt",
      },
    ]);
  }
  return DurableResearchProviderRunRecordSchema.parse({
    schemaVersion: 1,
    runId: input.runId,
    jobId: input.jobId,
    attemptId: input.attemptId,
    caseId: input.caseId,
    provider: "openai",
    providerResponseId: handle.providerResponseId,
    state: handle.state,
    requestedModel: handle.requestedModel,
    providerModel: handle.providerModel,
    traceId: handle.traceId,
    manifestFingerprint: input.manifestFingerprint,
    externalIdempotencyKey: input.externalIdempotencyKey,
    startedAt: handle.startedAt,
    acceptedAt,
    lastObservedAt: handle.lastObservedAt,
    inputBytes: handle.inputBytes,
    dataControlMode: handle.dataControlMode,
    projectIdFingerprint: handle.projectIdFingerprint,
    privateContentIncluded: true,
    publicationAuthority: "NONE",
  });
}

export type DurableResearchDiscoveryHandle = z.infer<
  typeof DurableResearchDiscoveryHandleSchema
>;
export type DurableResearchDiscoveryStartResult = Readonly<{
  kind: "STARTED";
  state: DurableResearchDiscoveryHandle["state"];
  handle: DurableResearchDiscoveryHandle;
}>;
export type DurableResearchDiscoveryPollResult =
  | Readonly<{
      kind: "PENDING";
      state: "QUEUED" | "IN_PROGRESS";
      handle: DurableResearchDiscoveryHandle;
    }>
  | Readonly<{
      kind: "COMPLETED";
      state: "COMPLETED";
      handle: DurableResearchDiscoveryHandle;
      output: DurableResearchDiscoveryOutput;
    }>
  | Readonly<{
      kind: "TERMINAL";
      state: "FAILED" | "INCOMPLETE" | "CANCELLED";
      handle: DurableResearchDiscoveryHandle;
      failure: z.infer<typeof DurableResearchDiscoveryFailureSchema>;
    }>;

export interface DurableResearchDiscoveryProvider {
  start(input: DurableResearchDiscoveryInput): Promise<DurableResearchDiscoveryStartResult>;
  retrieve(
    input: DurableResearchDiscoveryInput,
    handle: DurableResearchDiscoveryHandle,
  ): Promise<DurableResearchDiscoveryPollResult>;
}

/**
 * The exact private question is released only through this actor-scoped,
 * server-side worker boundary. Implementations must never log or cache it.
 */
export interface DurableResearchDiscoveryContextReader {
  getDiscoveryContext(input: Readonly<{
    actorId: string;
    runId: string;
    jobId: string;
  }>): Promise<DurableResearchDiscoveryContext | null>;
}
