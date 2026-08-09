import { z } from "zod";
import { SpecialistResearchPlanSchema } from "@/core/ports/investigation-specialist";
import {
  AccessStateSchema,
  RightsStateSchema,
  SourceMediumSchema,
} from "@/core/research/schemas";
import {
  EntityIdSchema,
  HttpUrlSchema,
  IsoDateTimeSchema,
  OpaqueReferenceSchema,
  Sha256Schema,
  SlugSchema,
  VersionTagSchema,
} from "@/core/shared/schemas";

export const RESEARCH_STAGES = [
  "IDENTITY",
  "SCOPING",
  "DISCOVERY",
  "RESOLUTION",
  "NORMALIZATION",
  "CORROBORATION",
  "SEQUENCING",
] as const;

export const ResearchStageSchema = z.enum(RESEARCH_STAGES);
export const ResearchRunStatusSchema = z.enum([
  "QUEUED",
  "PLANNING",
  "RUNNING",
  "SYNTHESIZING",
  "SUCCEEDED",
  "DEGRADED",
  "FAILED",
  "CANCELLED",
]);
export const ResearchRunHealthSchema = z.enum([
  "HEALTHY",
  "DEGRADED",
  "FAILED",
]);
export const ResearchJobStatusSchema = z.enum([
  "QUEUED",
  "RUNNING",
  "SUCCEEDED",
  "FAILED_RETRYABLE",
  "DEGRADED",
  "FAILED_TERMINAL",
  "CANCELLED",
]);
export const ResearchAttemptStatusSchema = z.enum([
  "RUNNING",
  "SUCCEEDED",
  "DEGRADED",
  "FAILED_RETRYABLE",
  "FAILED_TERMINAL",
  "CANCELLED",
]);

export const NoPublicationAuthoritySchema = z.literal("NONE");

const terminalRunStatuses = new Set([
  "SUCCEEDED",
  "DEGRADED",
  "FAILED",
  "CANCELLED",
]);
const terminalJobStatuses = new Set([
  "SUCCEEDED",
  "DEGRADED",
  "FAILED_TERMINAL",
  "CANCELLED",
]);

export function researchStageIndex(stage: z.infer<typeof ResearchStageSchema>) {
  return RESEARCH_STAGES.indexOf(stage);
}

export const ResearchScopePlanRecordSchema = z
  .object({
    id: EntityIdSchema,
    runId: EntityIdSchema,
    specialistId: SlugSchema,
    specialistVersion: VersionTagSchema,
    inputFingerprint: Sha256Schema,
    planFingerprint: Sha256Schema,
    plan: SpecialistResearchPlanSchema,
    publicationAuthority: NoPublicationAuthoritySchema,
    createdAt: IsoDateTimeSchema,
  })
  .strict();

export const ResearchRunRecordSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: EntityIdSchema,
    caseId: EntityIdSchema,
    branchId: EntityIdSchema.nullable(),
    planId: EntityIdSchema,
    specialistId: SlugSchema,
    specialistVersion: VersionTagSchema,
    objectiveFingerprint: Sha256Schema,
    requestFingerprint: Sha256Schema,
    traceId: OpaqueReferenceSchema,
    status: ResearchRunStatusSchema,
    health: ResearchRunHealthSchema,
    currentStage: ResearchStageSchema.nullable(),
    publicationAuthority: NoPublicationAuthoritySchema,
    aggregateVersion: z.number().int().nonnegative(),
    createdAt: IsoDateTimeSchema,
    updatedAt: IsoDateTimeSchema,
    startedAt: IsoDateTimeSchema.nullable(),
    completedAt: IsoDateTimeSchema.nullable(),
  })
  .strict()
  .superRefine((run, context) => {
    const created = new Date(run.createdAt).getTime();
    const updated = new Date(run.updatedAt).getTime();
    const started =
      run.startedAt === null ? null : new Date(run.startedAt).getTime();
    const completed =
      run.completedAt === null ? null : new Date(run.completedAt).getTime();

    if (updated < created) {
      context.addIssue({
        code: "custom",
        path: ["updatedAt"],
        message: "updatedAt cannot precede createdAt",
      });
    }
    if (started !== null && started < created) {
      context.addIssue({
        code: "custom",
        path: ["startedAt"],
        message: "startedAt cannot precede createdAt",
      });
    }
    if (
      completed !== null &&
      (started === null || completed < started || completed > updated)
    ) {
      context.addIssue({
        code: "custom",
        path: ["completedAt"],
        message:
          "completedAt requires startedAt and must fall between startedAt and updatedAt",
      });
    }

    if (run.status === "QUEUED") {
      if (run.currentStage !== null || run.startedAt !== null) {
        context.addIssue({
          code: "custom",
          message: "QUEUED runs cannot have a current stage or start time",
        });
      }
    } else if (run.startedAt === null) {
      context.addIssue({
        code: "custom",
        path: ["startedAt"],
        message: `${run.status} runs require startedAt`,
      });
    }

    if (terminalRunStatuses.has(run.status)) {
      if (run.completedAt === null) {
        context.addIssue({
          code: "custom",
          path: ["completedAt"],
          message: `${run.status} runs require completedAt`,
        });
      }
    } else if (run.completedAt !== null) {
      context.addIssue({
        code: "custom",
        path: ["completedAt"],
        message: `${run.status} runs cannot have completedAt`,
      });
    }

    const requiredHealth = {
      SUCCEEDED: "HEALTHY",
      DEGRADED: "DEGRADED",
      FAILED: "FAILED",
    } as const;
    if (
      run.status in requiredHealth &&
      run.health !==
        requiredHealth[run.status as keyof typeof requiredHealth]
    ) {
      context.addIssue({
        code: "custom",
        path: ["health"],
        message: `${run.status} runs require ${requiredHealth[run.status as keyof typeof requiredHealth]} health`,
      });
    }
  });

export const ResearchJobRecordSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: EntityIdSchema,
    runId: EntityIdSchema,
    caseId: EntityIdSchema,
    stage: ResearchStageSchema,
    stageOrdinal: z.number().int().min(0).max(RESEARCH_STAGES.length - 1),
    dependsOnJobId: EntityIdSchema.nullable(),
    logicalJobKey: OpaqueReferenceSchema,
    stageInputFingerprint: Sha256Schema,
    status: ResearchJobStatusSchema,
    attemptCount: z.number().int().nonnegative(),
    maxAttempts: z.number().int().min(1).max(10),
    checkpointCount: z.number().int().nonnegative(),
    activeAttemptId: EntityIdSchema.nullable(),
    firstStartedAt: IsoDateTimeSchema.nullable(),
    terminalAt: IsoDateTimeSchema.nullable(),
    publicationAuthority: NoPublicationAuthoritySchema,
    aggregateVersion: z.number().int().nonnegative(),
    createdAt: IsoDateTimeSchema,
    updatedAt: IsoDateTimeSchema,
  })
  .strict()
  .superRefine((job, context) => {
    if (job.stageOrdinal !== researchStageIndex(job.stage)) {
      context.addIssue({
        code: "custom",
        path: ["stageOrdinal"],
        message: "stageOrdinal must match the canonical research stage order",
      });
    }
    if (job.attemptCount > job.maxAttempts) {
      context.addIssue({
        code: "custom",
        path: ["attemptCount"],
        message: "attemptCount cannot exceed maxAttempts",
      });
    }
    if (
      new Date(job.updatedAt).getTime() < new Date(job.createdAt).getTime()
    ) {
      context.addIssue({
        code: "custom",
        path: ["updatedAt"],
        message: "updatedAt cannot precede createdAt",
      });
    }
    if (
      job.firstStartedAt !== null &&
      new Date(job.firstStartedAt).getTime() <
        new Date(job.createdAt).getTime()
    ) {
      context.addIssue({
        code: "custom",
        path: ["firstStartedAt"],
        message: "firstStartedAt cannot precede createdAt",
      });
    }
    if (
      job.terminalAt !== null &&
      (job.firstStartedAt === null ||
        new Date(job.terminalAt).getTime() <
          new Date(job.firstStartedAt).getTime() ||
        new Date(job.terminalAt).getTime() >
          new Date(job.updatedAt).getTime())
    ) {
      context.addIssue({
        code: "custom",
        path: ["terminalAt"],
        message:
          "terminalAt requires firstStartedAt and must fall between firstStartedAt and updatedAt",
      });
    }

    if (job.status === "RUNNING") {
      if (job.activeAttemptId === null || job.firstStartedAt === null) {
        context.addIssue({
          code: "custom",
          message: "RUNNING jobs require an active attempt and firstStartedAt",
        });
      }
    } else if (job.activeAttemptId !== null) {
      context.addIssue({
        code: "custom",
        path: ["activeAttemptId"],
        message: `${job.status} jobs cannot retain an active attempt`,
      });
    }

    if (terminalJobStatuses.has(job.status)) {
      if (job.terminalAt === null) {
        context.addIssue({
          code: "custom",
          path: ["terminalAt"],
          message: `${job.status} jobs require terminalAt`,
        });
      }
    } else if (job.terminalAt !== null) {
      context.addIssue({
        code: "custom",
        path: ["terminalAt"],
        message: `${job.status} jobs cannot have terminalAt`,
      });
    }

    if (
      job.attemptCount === 0 &&
      (job.firstStartedAt !== null || job.status !== "QUEUED")
    ) {
      context.addIssue({
        code: "custom",
        path: ["attemptCount"],
        message: "An unattempted job must remain QUEUED and unstarted",
      });
    }
  });

export const ExecutionModelMetadataSchema = z
  .object({
    provider: SlugSchema,
    model: z.string().trim().min(1).max(200),
    snapshot: VersionTagSchema,
  })
  .strict();

export const ExecutionPromptMetadataSchema = z
  .object({
    id: SlugSchema,
    version: VersionTagSchema,
    templateFingerprint: Sha256Schema,
  })
  .strict();

export const ExecutionSchemaMetadataSchema = z
  .object({
    id: SlugSchema,
    version: VersionTagSchema,
    schemaFingerprint: Sha256Schema,
  })
  .strict();

export const ExecutionToolMetadataSchema = z
  .object({
    id: SlugSchema,
    version: VersionTagSchema,
  })
  .strict();

export const ExecutionUsageMetadataSchema = z
  .object({
    inputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
    toolCalls: z.number().int().nonnegative(),
    inputBytes: z.number().int().nonnegative(),
    outputBytes: z.number().int().nonnegative(),
  })
  .strict();

export const ExecutionCostMetadataSchema = z
  .object({
    currency: z.literal("USD"),
    pricingState: z.enum(["PRICED", "UNPRICED"]),
    amountMicros: z.number().int().nonnegative().nullable(),
  })
  .strict()
  .superRefine((cost, context) => {
    if ((cost.pricingState === "PRICED") !== (cost.amountMicros !== null)) {
      context.addIssue({
        code: "custom",
        path: ["amountMicros"],
        message:
          "PRICED cost requires an amount; UNPRICED cost must preserve an unknown amount as null",
      });
    }
  });

export const ExecutionProvenanceReferenceSchema = z
  .object({
    recordType: z.enum([
      "CASE",
      "BRANCH",
      "RUN",
      "PLAN",
      "JOB",
      "ATTEMPT",
      "SOURCE_CANDIDATE",
      "SOURCE",
      "LOCATOR",
      "EVIDENCE",
      "CLAIM",
      "OUTPUT",
    ]),
    recordId: EntityIdSchema,
  })
  .strict();

export const ExecutionKindSchema = z.enum([
  "DETERMINISTIC",
  "MODEL",
  "MODEL_TOOL",
  "TOOL",
  "RESOLVER",
  "IMPORTER",
]);

export const ExecutionMetadataSchema = z
  .object({
    executionKind: ExecutionKindSchema,
    traceId: OpaqueReferenceSchema,
    providerRunId: OpaqueReferenceSchema.nullable(),
    model: ExecutionModelMetadataSchema.nullable(),
    prompt: ExecutionPromptMetadataSchema.nullable(),
    schema: ExecutionSchemaMetadataSchema,
    tool: ExecutionToolMetadataSchema.nullable(),
    usage: ExecutionUsageMetadataSchema,
    cost: ExecutionCostMetadataSchema,
    latencyMs: z.number().int().nonnegative().nullable(),
    provenanceInputs: z
      .array(ExecutionProvenanceReferenceSchema)
      .min(2)
      .max(100),
    /** Body-free disclosure flag; private bodies are still rejected by strictness. */
    privateContentIncluded: z.boolean(),
  })
  .strict()
  .superRefine((execution, context) => {
    const modelRequired =
      execution.executionKind === "MODEL" ||
      execution.executionKind === "MODEL_TOOL";
    if (
      modelRequired !==
      (execution.model !== null && execution.prompt !== null)
    ) {
      context.addIssue({
        code: "custom",
        message: modelRequired
          ? `${execution.executionKind} execution requires model and prompt metadata`
          : `${execution.executionKind} execution cannot claim model or prompt metadata`,
      });
    }

    const toolRequired = [
      "MODEL_TOOL",
      "TOOL",
      "RESOLVER",
      "IMPORTER",
    ].includes(execution.executionKind);
    if (toolRequired !== (execution.tool !== null)) {
      context.addIssue({
        code: "custom",
        path: ["tool"],
        message: toolRequired
          ? `${execution.executionKind} execution requires tool metadata`
          : `${execution.executionKind} execution cannot claim tool metadata`,
      });
    }
  });

/**
 * Every attempt carries this complete, body-free execution envelope. Null is
 * explicit when a field is inapplicable; live adapters may not omit metadata.
 */
export const ResearchAttemptRecordSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: EntityIdSchema,
    runId: EntityIdSchema,
    jobId: EntityIdSchema,
    attemptNumber: z.number().int().positive(),
    requestFingerprint: Sha256Schema,
    status: ResearchAttemptStatusSchema,
    execution: ExecutionMetadataSchema,
    outputFingerprint: Sha256Schema.nullable(),
    errorCode: SlugSchema.nullable(),
    publicationAuthority: NoPublicationAuthoritySchema,
    aggregateVersion: z.number().int().nonnegative(),
    startedAt: IsoDateTimeSchema,
    completedAt: IsoDateTimeSchema.nullable(),
  })
  .strict()
  .superRefine((attempt, context) => {
    if (attempt.status === "RUNNING") {
      if (
        attempt.completedAt !== null ||
        attempt.execution.latencyMs !== null ||
        attempt.outputFingerprint !== null ||
        attempt.errorCode !== null
      ) {
        context.addIssue({
          code: "custom",
          message: "RUNNING attempts cannot carry completion metadata",
        });
      }
      return;
    }

    if (
      attempt.completedAt === null ||
      attempt.execution.latencyMs === null
    ) {
      context.addIssue({
        code: "custom",
        message: `${attempt.status} attempts require completion time and latency`,
      });
    } else if (
      new Date(attempt.completedAt).getTime() <
      new Date(attempt.startedAt).getTime()
    ) {
      context.addIssue({
        code: "custom",
        path: ["completedAt"],
        message: "completedAt cannot precede startedAt",
      });
    }

    const successful = ["SUCCEEDED", "DEGRADED"].includes(attempt.status);
    if (successful && attempt.outputFingerprint === null) {
      context.addIssue({
        code: "custom",
        path: ["outputFingerprint"],
        message: `${attempt.status} attempts require an output fingerprint`,
      });
    }
    if (successful && attempt.errorCode !== null) {
      context.addIssue({
        code: "custom",
        path: ["errorCode"],
        message: `${attempt.status} attempts cannot carry an error code`,
      });
    }
    if (!successful && attempt.errorCode === null) {
      context.addIssue({
        code: "custom",
        path: ["errorCode"],
        message: `${attempt.status} attempts require a bounded error code`,
      });
    }
  });

/** Discovery output is explicitly a lead, not normalized source evidence. */
export const SourceCandidateRecordSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: EntityIdSchema,
    runId: EntityIdSchema,
    jobId: EntityIdSchema,
    attemptId: EntityIdSchema,
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
    createdAt: IsoDateTimeSchema,
  })
  .strict();

/**
 * Hostile source material is represented only by a fingerprint and a
 * rights-aware storage reference. It has no instruction authority and cannot
 * enter telemetry as a raw body.
 */
export const UntrustedResearchContentRecordSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: EntityIdSchema,
    runId: EntityIdSchema,
    jobId: EntityIdSchema,
    attemptId: EntityIdSchema,
    candidateId: EntityIdSchema,
    contentKind: z.enum(["METADATA", "DOCUMENT", "TRANSCRIPT", "EXCERPT"]),
    contentFingerprint: Sha256Schema,
    contentLength: z.number().int().nonnegative(),
    storageRef: OpaqueReferenceSchema.nullable(),
    accessState: AccessStateSchema,
    rightsState: RightsStateSchema,
    trustBoundary: z.literal("UNTRUSTED_SOURCE_DATA"),
    instructionAuthority: z.literal("NONE"),
    screeningState: z.enum(["UNSCREENED", "PASSED", "QUARANTINED"]),
    publicationAuthority: NoPublicationAuthoritySchema,
    createdAt: IsoDateTimeSchema,
  })
  .strict()
  .superRefine((content, context) => {
    const storageEligible = new Set([
      "PERMITTED",
      "USER_OWNED",
      "PUBLIC_DOMAIN",
      "LICENSED",
    ]);
    if (content.storageRef !== null && !storageEligible.has(content.rightsState)) {
      context.addIssue({
        code: "custom",
        path: ["storageRef"],
        message: `${content.rightsState} content cannot retain a storage reference`,
      });
    }
  });

const researchOutputBase = {
  schemaVersion: z.literal(1),
  id: EntityIdSchema,
  runId: EntityIdSchema,
  jobId: EntityIdSchema,
  attemptId: EntityIdSchema,
  reviewState: z.literal("PROPOSED"),
  publicationAuthority: NoPublicationAuthoritySchema,
  provenanceInputs: z
    .array(ExecutionProvenanceReferenceSchema)
    .min(1)
    .max(100),
  createdAt: IsoDateTimeSchema,
};

export const IdentityStageOutputSchema = z
  .object({
    ...researchOutputBase,
    kind: z.literal("IDENTITY_RESULT"),
    stage: z.literal("IDENTITY"),
    resolvedRequirementIds: z.array(SlugSchema).max(50),
    unresolvedRequirementIds: z.array(SlugSchema).max(50),
  })
  .strict();

export const ScopingStageOutputSchema = z
  .object({
    ...researchOutputBase,
    kind: z.literal("SCOPE_RESULT"),
    stage: z.literal("SCOPING"),
    axisIds: z.array(SlugSchema).min(1).max(30),
    sourceClassIds: z.array(SlugSchema).min(1).max(30),
    coverageGapCodes: z.array(SlugSchema).max(50),
  })
  .strict();

export const DiscoveryStageOutputSchema = z
  .object({
    ...researchOutputBase,
    kind: z.literal("DISCOVERY_RESULT"),
    stage: z.literal("DISCOVERY"),
    candidateIds: z.array(EntityIdSchema).max(500),
  })
  .strict();

export const ResolutionStageOutputSchema = z
  .object({
    ...researchOutputBase,
    kind: z.literal("RESOLUTION_RESULT"),
    stage: z.literal("RESOLUTION"),
    sourceIds: z.array(EntityIdSchema).max(500),
    locatorIds: z.array(EntityIdSchema).max(1_000),
    unresolvedCandidateIds: z.array(EntityIdSchema).max(500),
  })
  .strict();

export const NormalizationStageOutputSchema = z
  .object({
    ...researchOutputBase,
    kind: z.literal("NORMALIZATION_RESULT"),
    stage: z.literal("NORMALIZATION"),
    proposedEvidenceIds: z.array(EntityIdSchema).max(2_000),
    proposedClaimIds: z.array(EntityIdSchema).max(2_000),
  })
  .strict();

export const CorroborationStageOutputSchema = z
  .object({
    ...researchOutputBase,
    kind: z.literal("CORROBORATION_RESULT"),
    stage: z.literal("CORROBORATION"),
    assessedClaimIds: z.array(EntityIdSchema).max(2_000),
    independenceGroupIds: z.array(OpaqueReferenceSchema).max(1_000),
    contradictionIds: z.array(EntityIdSchema).max(2_000),
    unresolvedClaimIds: z.array(EntityIdSchema).max(2_000),
  })
  .strict();

export const SequencingStageOutputSchema = z
  .object({
    ...researchOutputBase,
    kind: z.literal("SEQUENCING_RESULT"),
    stage: z.literal("SEQUENCING"),
    sequenceProposalId: EntityIdSchema,
    eligibleClaimIds: z.array(EntityIdSchema).max(2_000),
    omittedClaimIds: z.array(EntityIdSchema).max(2_000),
  })
  .strict();

export const ResearchStageOutputSchema = z.discriminatedUnion("kind", [
  IdentityStageOutputSchema,
  ScopingStageOutputSchema,
  DiscoveryStageOutputSchema,
  ResolutionStageOutputSchema,
  NormalizationStageOutputSchema,
  CorroborationStageOutputSchema,
  SequencingStageOutputSchema,
]);

export const ResearchStageExecutionResultSchema = z
  .object({
    outcome: z.enum(["SUCCEEDED", "DEGRADED"]),
    boundedReasonCodes: z.array(SlugSchema).max(20),
    output: ResearchStageOutputSchema,
    sourceCandidates: z.array(SourceCandidateRecordSchema).max(500),
    untrustedContent: z
      .array(UntrustedResearchContentRecordSchema)
      .max(1_000),
  })
  .strict()
  .superRefine((result, context) => {
    if (
      (result.outcome === "DEGRADED") !==
      (result.boundedReasonCodes.length > 0)
    ) {
      context.addIssue({
        code: "custom",
        path: ["boundedReasonCodes"],
        message:
          "DEGRADED results require bounded reason codes; SUCCEEDED results require none",
      });
    }
    const { output } = result;
    const hasJobProvenance = output.provenanceInputs.some(
      (reference) =>
        reference.recordType === "JOB" && reference.recordId === output.jobId,
    );
    const hasAttemptProvenance = output.provenanceInputs.some(
      (reference) =>
        reference.recordType === "ATTEMPT" &&
        reference.recordId === output.attemptId,
    );
    if (!hasJobProvenance || !hasAttemptProvenance) {
      context.addIssue({
        code: "custom",
        path: ["output", "provenanceInputs"],
        message: "Stage outputs require job and attempt provenance",
      });
    }
    for (const [collectionName, records] of [
      ["sourceCandidates", result.sourceCandidates],
      ["untrustedContent", result.untrustedContent],
    ] as const) {
      records.forEach((record, index) => {
        if (
          record.runId !== output.runId ||
          record.jobId !== output.jobId ||
          record.attemptId !== output.attemptId
        ) {
          context.addIssue({
            code: "custom",
            path: [collectionName, index],
            message: "Produced records must belong to the output run, job, and attempt",
          });
        }
      });
    }

    if (output.stage !== "DISCOVERY" && result.sourceCandidates.length > 0) {
      context.addIssue({
        code: "custom",
        path: ["sourceCandidates"],
        message: "Only the DISCOVERY stage may create source candidates",
      });
    }
    if (
      output.stage !== "RESOLUTION" &&
      output.stage !== "NORMALIZATION" &&
      result.untrustedContent.length > 0
    ) {
      context.addIssue({
        code: "custom",
        path: ["untrustedContent"],
        message:
          "Only RESOLUTION or NORMALIZATION may observe untrusted source content",
      });
    }
    if (output.stage === "DISCOVERY") {
      const recordIds = new Set(result.sourceCandidates.map(({ id }) => id));
      if (output.candidateIds.some((id) => !recordIds.has(id))) {
        context.addIssue({
          code: "custom",
          path: ["output", "candidateIds"],
          message: "Every discovered candidate ID requires a candidate record",
        });
      }
    }
  });

export const ResearchRunBundleSchema = z
  .object({
    run: ResearchRunRecordSchema,
    plan: ResearchScopePlanRecordSchema,
    jobs: z.array(ResearchJobRecordSchema).length(RESEARCH_STAGES.length),
    attempts: z.array(ResearchAttemptRecordSchema),
    outputs: z.array(ResearchStageOutputSchema),
    sourceCandidates: z.array(SourceCandidateRecordSchema),
    untrustedContent: z.array(UntrustedResearchContentRecordSchema),
  })
  .strict()
  .superRefine((bundle, context) => {
    if (
      bundle.plan.id !== bundle.run.planId ||
      bundle.plan.runId !== bundle.run.id ||
      bundle.plan.specialistId !== bundle.run.specialistId ||
      bundle.plan.specialistVersion !== bundle.run.specialistVersion
    ) {
      context.addIssue({
        code: "custom",
        path: ["plan"],
        message: "The plan must belong to the run and its pinned specialist",
      });
    }

    const ids = new Set<string>();
    const logicalKeys = new Set<string>();
    const jobById = new Map(bundle.jobs.map((job) => [job.id, job]));
    bundle.jobs.forEach((job, index) => {
      if (ids.has(job.id) || logicalKeys.has(job.logicalJobKey)) {
        context.addIssue({
          code: "custom",
          path: ["jobs", index],
          message: "Job IDs and logical keys must be unique within a run",
        });
      }
      ids.add(job.id);
      logicalKeys.add(job.logicalJobKey);
      if (job.runId !== bundle.run.id || job.caseId !== bundle.run.caseId) {
        context.addIssue({
          code: "custom",
          path: ["jobs", index],
          message: "Every job must belong to the run and case",
        });
      }
      if (job.stage !== RESEARCH_STAGES[index] || job.stageOrdinal !== index) {
        context.addIssue({
          code: "custom",
          path: ["jobs", index],
          message: "Jobs must appear exactly once in canonical stage order",
        });
      }
      const expectedDependency = index === 0 ? null : bundle.jobs[index - 1]?.id;
      if (job.dependsOnJobId !== expectedDependency) {
        context.addIssue({
          code: "custom",
          path: ["jobs", index, "dependsOnJobId"],
          message: "Each stage must depend on the immediately preceding stage",
        });
      }
    });

    const seenAttemptIds = new Set<string>();
    const seenRequestFingerprints = new Set<string>();
    const attemptCountByJob = new Map<string, number>();
    bundle.attempts.forEach((attempt, index) => {
      if (
        seenAttemptIds.has(attempt.id) ||
        seenRequestFingerprints.has(attempt.requestFingerprint)
      ) {
        context.addIssue({
          code: "custom",
          path: ["attempts", index],
          message: "Attempt IDs and request fingerprints must be unique",
        });
      }
      seenAttemptIds.add(attempt.id);
      seenRequestFingerprints.add(attempt.requestFingerprint);
      const job = jobById.get(attempt.jobId);
      if (job === undefined || attempt.runId !== bundle.run.id) {
        context.addIssue({
          code: "custom",
          path: ["attempts", index],
          message: "Every attempt must belong to a job in this run",
        });
        return;
      }
      attemptCountByJob.set(
        job.id,
        (attemptCountByJob.get(job.id) ?? 0) + 1,
      );
    });
    bundle.jobs.forEach((job, index) => {
      if ((attemptCountByJob.get(job.id) ?? 0) !== job.attemptCount) {
        context.addIssue({
          code: "custom",
          path: ["jobs", index, "attemptCount"],
          message: "Job attemptCount must equal its durable attempt records",
        });
      }
    });

    const validateProducedRecord = (
      record: { runId: string; jobId: string; attemptId: string },
      path: (string | number)[],
    ) => {
      const job = jobById.get(record.jobId);
      const attempt = bundle.attempts.find(({ id }) => id === record.attemptId);
      if (
        record.runId !== bundle.run.id ||
        job === undefined ||
        attempt === undefined ||
        attempt.jobId !== record.jobId
      ) {
        context.addIssue({
          code: "custom",
          path,
          message: "Produced records require a matching run, job, and attempt",
        });
      }
    };
    bundle.outputs.forEach((output, index) => {
      validateProducedRecord(output, ["outputs", index]);
      const job = jobById.get(output.jobId);
      if (job !== undefined && output.stage !== job.stage) {
        context.addIssue({
          code: "custom",
          path: ["outputs", index, "stage"],
          message: "Output stage must match its job stage",
        });
      }
    });
    bundle.sourceCandidates.forEach((candidate, index) => {
      validateProducedRecord(candidate, ["sourceCandidates", index]);
      const job = jobById.get(candidate.jobId);
      if (job !== undefined && job.stage !== "DISCOVERY") {
        context.addIssue({
          code: "custom",
          path: ["sourceCandidates", index, "jobId"],
          message: "Source candidates must originate in DISCOVERY",
        });
      }
    });
    bundle.untrustedContent.forEach((content, index) => {
      validateProducedRecord(content, ["untrustedContent", index]);
      if (!bundle.sourceCandidates.some(({ id }) => id === content.candidateId)) {
        context.addIssue({
          code: "custom",
          path: ["untrustedContent", index, "candidateId"],
          message: "Untrusted content must retain its source candidate reference",
        });
      }
    });

    const runningJobs = bundle.jobs.filter(({ status }) => status === "RUNNING");
    if (runningJobs.length > 1) {
      context.addIssue({
        code: "custom",
        path: ["jobs"],
        message: "The deterministic spine permits at most one running stage",
      });
    }
    bundle.jobs.forEach((job, index) => {
      if (index === 0 || job.status === "QUEUED") return;
      const predecessor = bundle.jobs[index - 1];
      if (
        predecessor !== undefined &&
        predecessor.status !== "SUCCEEDED" &&
        predecessor.status !== "DEGRADED"
      ) {
        context.addIssue({
          code: "custom",
          path: ["jobs", index, "status"],
          message: "A stage cannot advance before its predecessor completes",
        });
      }
    });
  });

export const DeterministicResearchExecutorIdentitySchema = z
  .object({
    kind: z.literal("DETERMINISTIC_FIXTURE"),
    id: SlugSchema,
    version: VersionTagSchema,
    schema: ExecutionSchemaMetadataSchema,
  })
  .strict();

export type ResearchStage = z.infer<typeof ResearchStageSchema>;
export type ResearchRunStatus = z.infer<typeof ResearchRunStatusSchema>;
export type ResearchRunHealth = z.infer<typeof ResearchRunHealthSchema>;
export type ResearchJobStatus = z.infer<typeof ResearchJobStatusSchema>;
export type ResearchAttemptStatus = z.infer<
  typeof ResearchAttemptStatusSchema
>;
export type ResearchScopePlanRecord = z.infer<
  typeof ResearchScopePlanRecordSchema
>;
export type ResearchRunRecord = z.infer<typeof ResearchRunRecordSchema>;
export type ResearchJobRecord = z.infer<typeof ResearchJobRecordSchema>;
export type ResearchAttemptRecord = z.infer<typeof ResearchAttemptRecordSchema>;
export type SourceCandidateRecord = z.infer<typeof SourceCandidateRecordSchema>;
export type UntrustedResearchContentRecord = z.infer<
  typeof UntrustedResearchContentRecordSchema
>;
export type ResearchStageOutput = z.infer<typeof ResearchStageOutputSchema>;
export type ResearchStageExecutionResult = z.infer<
  typeof ResearchStageExecutionResultSchema
>;
export type ResearchRunBundle = z.infer<typeof ResearchRunBundleSchema>;
export type DeterministicResearchExecutorIdentity = z.infer<
  typeof DeterministicResearchExecutorIdentitySchema
>;
