import { z } from "zod";
import {
  ExecutionCostMetadataSchema,
  ExecutionKindSchema,
  ExecutionModelMetadataSchema,
  ExecutionPromptMetadataSchema,
  ExecutionSchemaMetadataSchema,
  ExecutionTelemetryStateSchema,
  ExecutionToolMetadataSchema,
  ExecutionUsageMetadataSchema,
  NoPublicationAuthoritySchema,
  ResearchAttemptRecordSchema,
  ResearchJobRecordSchema,
  ResearchRunRecordSchema,
  ResearchScopePlanRecordSchema,
  ResearchStageExecutionResultSchema,
  ResearchStageSchema,
} from "@/core/research-runs/schemas";
import { ResearchAttemptInputManifestEnvelopeSchema } from "@/core/research-runs/input-manifests";
import {
  EntityIdSchema,
  IsoDateTimeSchema,
  OpaqueReferenceSchema,
  Sha256Schema,
  SlugSchema,
  VersionTagSchema,
} from "@/core/shared/schemas";

const terminalExecutionKinds = new Set(["POLICY", "RIGHTS", "AUTH_CONFIGURATION"]);

export const ResearchWorkerExecutionPlanSchema = z
  .object({
    executorId: SlugSchema,
    executorVersion: VersionTagSchema,
    configurationFingerprint: Sha256Schema,
    executionKind: ExecutionKindSchema,
    model: ExecutionModelMetadataSchema.nullable(),
    prompt: ExecutionPromptMetadataSchema.nullable(),
    schema: ExecutionSchemaMetadataSchema,
    tool: ExecutionToolMetadataSchema.nullable(),
    privateContentIncluded: z.boolean(),
    automaticRetrySafety: z.enum([
      "IDEMPOTENT_PROVIDER_REQUEST",
      "RESUMABLE_PROVIDER_RUN",
      "NOT_GUARANTEED",
    ]),
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
          ? `${execution.executionKind} requires model and prompt metadata`
          : `${execution.executionKind} cannot claim model or prompt metadata`,
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
          ? `${execution.executionKind} requires tool metadata`
          : `${execution.executionKind} cannot claim tool metadata`,
      });
    }
  });

export const ResearchWorkerExecutorIdentitySchema = z
  .object({
    stage: ResearchStageSchema,
    execution: ResearchWorkerExecutionPlanSchema,
  })
  .strict();

export const ResearchWorkerTelemetryStateSchema =
  ExecutionTelemetryStateSchema;

/** No provider response body or arbitrary diagnostic map can cross this boundary. */
export const ResearchWorkerExecutionTelemetrySchema = z
  .object({
    telemetryState: ResearchWorkerTelemetryStateSchema,
    providerRunId: OpaqueReferenceSchema.nullable(),
    usage: ExecutionUsageMetadataSchema.nullable(),
    cost: ExecutionCostMetadataSchema.nullable(),
  })
  .strict()
  .superRefine((telemetry, context) => {
    if (
      telemetry.telemetryState === "COMPLETE" &&
      (telemetry.usage === null || telemetry.cost === null)
    ) {
      context.addIssue({
        code: "custom",
        message: "COMPLETE telemetry requires usage and cost metadata",
      });
    }
    if (
      telemetry.telemetryState === "UNAVAILABLE" &&
      (telemetry.usage !== null || telemetry.cost !== null)
    ) {
      context.addIssue({
        code: "custom",
        message: "UNAVAILABLE telemetry cannot invent usage or cost metadata",
      });
    }
    if (
      telemetry.telemetryState === "PARTIAL" &&
      telemetry.providerRunId === null &&
      telemetry.usage === null &&
      telemetry.cost === null
    ) {
      context.addIssue({
        code: "custom",
        message: "PARTIAL telemetry requires one known provider field",
      });
    }
  });

export const ResearchWorkerExecutionCompletionSchema =
  ResearchWorkerExecutionTelemetrySchema.safeExtend({
    latencyMs: z.number().int().nonnegative(),
    completedAt: IsoDateTimeSchema,
  }).strict();

export const ResearchWorkerFailureCategorySchema = z.enum([
  "TRANSIENT_UPSTREAM",
  "RATE_LIMITED",
  "TIMEOUT",
  "INVALID_OUTPUT",
  "POLICY",
  "RIGHTS",
  "NOT_FOUND",
  "AUTH_CONFIGURATION",
  "WORKER_INTERNAL",
]);

/**
 * Failure persistence is deliberately body-free. Messages, stacks, source
 * excerpts, prompts, questions, and provider bodies are rejected by strictness.
 */
export const ResearchWorkerFailureEnvelopeSchema = z
  .object({
    schemaVersion: z.literal(1),
    code: SlugSchema,
    category: ResearchWorkerFailureCategorySchema,
    phase: z.enum([
      "PREPARATION",
      "EXTERNAL_CALL",
      "VALIDATION",
      "CHECKPOINT",
      "COMMIT",
    ]),
    retryDirective: z.enum(["RETRY_WITH_BACKOFF", "DO_NOT_RETRY"]),
    retryAfterMs: z.number().int().min(100).max(86_400_000).nullable(),
    providerStatusCode: z.number().int().min(100).max(599).nullable(),
    diagnosticFingerprint: Sha256Schema.nullable(),
    redactionState: z.literal("BODY_FREE"),
  })
  .strict()
  .superRefine((failure, context) => {
    const requestsRetry = failure.retryDirective === "RETRY_WITH_BACKOFF";
    if (requestsRetry !== (failure.retryAfterMs !== null)) {
      context.addIssue({
        code: "custom",
        path: ["retryAfterMs"],
        message: "Retry directives require a bounded delay; terminal failures require null",
      });
    }
    if (requestsRetry && terminalExecutionKinds.has(failure.category)) {
      context.addIssue({
        code: "custom",
        path: ["retryDirective"],
        message: `${failure.category} failures cannot be retried blindly`,
      });
    }
    if (
      failure.category === "RATE_LIMITED" &&
      failure.providerStatusCode !== null &&
      failure.providerStatusCode !== 429
    ) {
      context.addIssue({
        code: "custom",
        path: ["providerStatusCode"],
        message: "RATE_LIMITED provider status must be 429 when known",
      });
    }
  });

export const ResearchWorkerCheckpointKindSchema = z.enum([
  "PROGRESS",
  "PROVIDER_ACCEPTED",
  "OUTPUT_VALIDATED",
]);

export const ResearchWorkerCheckpointProposalSchema = z
  .object({
    idempotencyKey: OpaqueReferenceSchema,
    sequence: z.number().int().positive(),
    kind: ResearchWorkerCheckpointKindSchema,
    completedUnits: z.number().int().nonnegative(),
    totalUnits: z.number().int().positive().nullable(),
    providerRunId: OpaqueReferenceSchema.nullable(),
    resumeTokenFingerprint: Sha256Schema.nullable(),
    outputFingerprint: Sha256Schema.nullable(),
  })
  .strict()
  .superRefine((checkpoint, context) => {
    if (
      checkpoint.totalUnits !== null &&
      checkpoint.completedUnits > checkpoint.totalUnits
    ) {
      context.addIssue({
        code: "custom",
        path: ["completedUnits"],
        message: "Checkpoint progress cannot exceed its declared total",
      });
    }
    if (
      checkpoint.kind === "PROVIDER_ACCEPTED" &&
      checkpoint.providerRunId === null
    ) {
      context.addIssue({
        code: "custom",
        path: ["providerRunId"],
        message: "PROVIDER_ACCEPTED checkpoints require a provider run reference",
      });
    }
    if (
      checkpoint.kind === "OUTPUT_VALIDATED" &&
      checkpoint.outputFingerprint === null
    ) {
      context.addIssue({
        code: "custom",
        path: ["outputFingerprint"],
        message: "OUTPUT_VALIDATED checkpoints require an output fingerprint",
      });
    }
  });

export const ResearchWorkerCheckpointRecordSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: EntityIdSchema,
    runId: EntityIdSchema,
    jobId: EntityIdSchema,
    attemptId: EntityIdSchema,
    idempotencyKey: OpaqueReferenceSchema,
    sequence: z.number().int().positive(),
    kind: ResearchWorkerCheckpointKindSchema,
    completedUnits: z.number().int().nonnegative(),
    totalUnits: z.number().int().positive().nullable(),
    providerRunId: OpaqueReferenceSchema.nullable(),
    resumeTokenFingerprint: Sha256Schema.nullable(),
    outputFingerprint: Sha256Schema.nullable(),
    publicationAuthority: NoPublicationAuthoritySchema,
    createdAt: IsoDateTimeSchema,
  })
  .strict()
  .superRefine((checkpoint, context) => {
    if (
      checkpoint.totalUnits !== null &&
      checkpoint.completedUnits > checkpoint.totalUnits
    ) {
      context.addIssue({
        code: "custom",
        path: ["completedUnits"],
        message: "Checkpoint progress cannot exceed its declared total",
      });
    }
    if (
      checkpoint.kind === "PROVIDER_ACCEPTED" &&
      checkpoint.providerRunId === null
    ) {
      context.addIssue({
        code: "custom",
        path: ["providerRunId"],
        message: "PROVIDER_ACCEPTED checkpoints require a provider run reference",
      });
    }
    if (
      checkpoint.kind === "OUTPUT_VALIDATED" &&
      checkpoint.outputFingerprint === null
    ) {
      context.addIssue({
        code: "custom",
        path: ["outputFingerprint"],
        message: "OUTPUT_VALIDATED checkpoints require an output fingerprint",
      });
    }
  });

export const ResearchJobLeaseCursorSchema = z
  .object({
    schemaVersion: z.literal(1),
    runId: EntityIdSchema,
    jobId: EntityIdSchema,
    attemptId: EntityIdSchema,
    workerId: OpaqueReferenceSchema,
    leaseToken: OpaqueReferenceSchema,
    leaseEpoch: z.number().int().positive(),
    runVersion: z.number().int().nonnegative(),
    jobVersion: z.number().int().nonnegative(),
    attemptVersion: z.number().int().nonnegative(),
    claimedAt: IsoDateTimeSchema,
    heartbeatAt: IsoDateTimeSchema,
    expiresAt: IsoDateTimeSchema,
    externalIdempotencyKey: Sha256Schema,
  })
  .strict()
  .superRefine((lease, context) => {
    const claimed = new Date(lease.claimedAt).getTime();
    const heartbeat = new Date(lease.heartbeatAt).getTime();
    const expires = new Date(lease.expiresAt).getTime();
    if (heartbeat < claimed) {
      context.addIssue({
        code: "custom",
        path: ["heartbeatAt"],
        message: "Lease heartbeat cannot precede its claim",
      });
    }
    if (expires <= heartbeat) {
      context.addIssue({
        code: "custom",
        path: ["expiresAt"],
        message: "Lease expiry must follow the latest heartbeat",
      });
    }
  });

function sameJson(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right);
}

export const ClaimedResearchJobSchema = z
  .object({
    run: ResearchRunRecordSchema,
    job: ResearchJobRecordSchema,
    plan: ResearchScopePlanRecordSchema,
    attempt: ResearchAttemptRecordSchema,
    lease: ResearchJobLeaseCursorSchema,
    execution: ResearchWorkerExecutionPlanSchema,
    inputManifest: ResearchAttemptInputManifestEnvelopeSchema,
    latestCheckpoint: ResearchWorkerCheckpointRecordSchema.nullable(),
    providerCheckpoint: ResearchWorkerCheckpointRecordSchema.nullable(),
    resumed: z.boolean(),
    replayed: z.boolean(),
  })
  .strict()
  .superRefine((claim, context) => {
    const manifest = claim.inputManifest.manifest;
    if (
      claim.job.runId !== claim.run.id ||
      claim.plan.runId !== claim.run.id ||
      claim.attempt.runId !== claim.run.id ||
      claim.attempt.jobId !== claim.job.id ||
      claim.lease.runId !== claim.run.id ||
      claim.lease.jobId !== claim.job.id ||
      claim.lease.attemptId !== claim.attempt.id
    ) {
      context.addIssue({
        code: "custom",
        message: "Claim records must belong to one run, job, and attempt",
      });
    }
    if (
      manifest.runId !== claim.run.id ||
      manifest.caseId !== claim.run.caseId ||
      manifest.branchId !== claim.run.branchId ||
      manifest.planId !== claim.plan.id ||
      manifest.jobId !== claim.job.id ||
      manifest.stage !== claim.job.stage ||
      manifest.objectiveFingerprint !== claim.run.objectiveFingerprint ||
      manifest.runRequestFingerprint !== claim.run.requestFingerprint ||
      manifest.planFingerprint !== claim.plan.planFingerprint ||
      manifest.stageSeedFingerprint !== claim.job.stageInputFingerprint
    ) {
      context.addIssue({
        code: "custom",
        path: ["inputManifest", "manifest"],
        message:
          "The database-authored input manifest must bind the claimed run, plan, job, and immutable fingerprints",
      });
    }
    if (
      (claim.job.dependsOnJobId === null) !==
      (manifest.dependency.state === "ROOT")
    ) {
      context.addIssue({
        code: "custom",
        path: ["inputManifest", "manifest", "dependency"],
        message: "Manifest dependency state must match the logical job",
      });
    } else if (
      manifest.dependency.state === "BOUND" &&
      manifest.dependency.predecessorJobId !== claim.job.dependsOnJobId
    ) {
      context.addIssue({
        code: "custom",
        path: [
          "inputManifest",
          "manifest",
          "dependency",
          "predecessorJobId",
        ],
        message: "Manifest must bind the immediate predecessor job",
      });
    }
    if (
      claim.job.status !== "RUNNING" ||
      claim.job.activeAttemptId !== claim.attempt.id ||
      claim.attempt.status !== "RUNNING"
    ) {
      context.addIssue({
        code: "custom",
        message: "External work requires a durably RUNNING job and attempt",
      });
    }
    if (
      claim.run.aggregateVersion !== claim.lease.runVersion ||
      claim.job.aggregateVersion !== claim.lease.jobVersion ||
      claim.attempt.aggregateVersion !== claim.lease.attemptVersion
    ) {
      context.addIssue({
        code: "custom",
        path: ["lease"],
        message: "Lease fencing versions must match the claimed aggregates",
      });
    }
    if (
      claim.attempt.requestFingerprint !==
      claim.lease.externalIdempotencyKey
    ) {
      context.addIssue({
        code: "custom",
        path: ["lease", "externalIdempotencyKey"],
        message: "External idempotency must reuse the durable attempt fingerprint",
      });
    }
    if (
      claim.latestCheckpoint !== null &&
      (claim.latestCheckpoint.runId !== claim.run.id ||
        claim.latestCheckpoint.jobId !== claim.job.id ||
        claim.latestCheckpoint.attemptId !== claim.attempt.id ||
        claim.latestCheckpoint.sequence !== claim.job.checkpointCount ||
        new Date(claim.latestCheckpoint.createdAt).getTime() <
          new Date(claim.attempt.startedAt).getTime())
    ) {
      context.addIssue({
        code: "custom",
        path: ["latestCheckpoint"],
        message: "The resume checkpoint must belong to the active attempt",
      });
    }
    if (
      (claim.job.checkpointCount === 0) !==
      (claim.latestCheckpoint === null)
    ) {
      context.addIssue({
        code: "custom",
        path: ["latestCheckpoint"],
        message: "Claim must include exactly the latest durable checkpoint",
      });
    }
    if (
      claim.providerCheckpoint !== null &&
      (claim.providerCheckpoint.runId !== claim.run.id ||
        claim.providerCheckpoint.jobId !== claim.job.id ||
        claim.providerCheckpoint.attemptId !== claim.attempt.id ||
        claim.providerCheckpoint.kind !== "PROVIDER_ACCEPTED" ||
        claim.providerCheckpoint.providerRunId === null ||
        claim.latestCheckpoint === null ||
        claim.providerCheckpoint.sequence > claim.latestCheckpoint.sequence ||
        new Date(claim.providerCheckpoint.createdAt).getTime() <
          new Date(claim.attempt.startedAt).getTime())
    ) {
      context.addIssue({
        code: "custom",
        path: ["providerCheckpoint"],
        message:
          "The provider resume checkpoint must be a durable checkpoint from the active attempt",
      });
    }
    const persisted = claim.attempt.execution;
    const expected = claim.execution;
    if (
      persisted.executionKind !== expected.executionKind ||
      !sameJson(persisted.model, expected.model) ||
      !sameJson(persisted.prompt, expected.prompt) ||
      !sameJson(persisted.schema, expected.schema) ||
      !sameJson(persisted.tool, expected.tool) ||
      persisted.privateContentIncluded !== expected.privateContentIncluded
    ) {
      context.addIssue({
        code: "custom",
        path: ["attempt", "execution"],
        message: "Persisted attempt execution must match the claimed executor plan",
      });
    }
  });

export const ResearchWorkerTerminalSummarySchema = z
  .object({
    runId: EntityIdSchema,
    jobId: EntityIdSchema,
    attemptId: EntityIdSchema.nullable(),
    jobStatus: z.enum([
      "SUCCEEDED",
      "DEGRADED",
      "FAILED_TERMINAL",
      "CANCELLED",
    ]),
  })
  .strict();

export const ResearchJobClaimResultSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("CLAIMED"), claim: ClaimedResearchJobSchema }).strict(),
  z
    .object({
      status: z.literal("IN_PROGRESS"),
      retryAfterMs: z.number().int().min(100).max(900_000),
    })
    .strict(),
  z
    .object({
      status: z.literal("TERMINAL"),
      terminal: ResearchWorkerTerminalSummarySchema,
      replayed: z.boolean(),
    })
    .strict(),
  z.object({ status: z.literal("CANCELLED") }).strict(),
]);

const leaseRenewed = z
  .object({ status: z.literal("RENEWED"), lease: ResearchJobLeaseCursorSchema })
  .strict();
const leaseLost = z.object({ status: z.literal("LEASE_LOST") }).strict();
const cancelled = z.object({ status: z.literal("CANCELLED") }).strict();

export const ResearchJobHeartbeatResultSchema = z.discriminatedUnion("status", [
  leaseRenewed,
  leaseLost,
  cancelled,
]);

export const ResearchJobCheckpointResultSchema = z.discriminatedUnion("status", [
  z
    .object({
      status: z.enum(["COMMITTED", "REPLAY"]),
      lease: ResearchJobLeaseCursorSchema,
      checkpoint: ResearchWorkerCheckpointRecordSchema,
    })
    .strict(),
  leaseLost,
  cancelled,
]);

export const ResearchJobCompletionResultSchema = z.discriminatedUnion("status", [
  z
    .object({
      status: z.enum(["COMMITTED", "REPLAY"]),
      outcome: z.enum(["SUCCEEDED", "DEGRADED"]),
      terminal: ResearchWorkerTerminalSummarySchema,
    })
    .strict(),
  leaseLost,
  cancelled,
]);

export const ResearchJobFailureResultSchema = z.discriminatedUnion("status", [
  z
    .object({
      status: z.enum(["RETRY_SCHEDULED", "REPLAY"]),
      attemptId: EntityIdSchema,
      retryAt: IsoDateTimeSchema,
    })
    .strict(),
  z
    .object({
      status: z.literal("FAILED_TERMINAL"),
      terminal: ResearchWorkerTerminalSummarySchema,
      replayed: z.boolean(),
    })
    .strict(),
  leaseLost,
  cancelled,
]);

export const ResearchJobReleaseResultSchema = z.discriminatedUnion("status", [
  z
    .object({
      status: z.enum(["RELEASED", "REPLAY"]),
      attemptId: EntityIdSchema,
      retryAt: IsoDateTimeSchema,
    })
    .strict(),
  z
    .object({
      status: z.literal("FAILED_TERMINAL"),
      terminal: ResearchWorkerTerminalSummarySchema,
      replayed: z.boolean(),
    })
    .strict(),
  leaseLost,
  cancelled,
]);

export const ResearchWorkerExecutionOutcomeSchema = z.discriminatedUnion(
  "status",
  [
    z
      .object({
        status: z.literal("COMPLETED"),
        result: ResearchStageExecutionResultSchema,
        telemetry: ResearchWorkerExecutionTelemetrySchema,
      })
      .strict()
      .superRefine((outcome, context) => {
        if (outcome.telemetry.telemetryState !== "COMPLETE") {
          context.addIssue({
            code: "custom",
            path: ["telemetry", "telemetryState"],
            message: "Successful work requires complete usage and cost telemetry",
          });
        }
      }),
    z
      .object({
        status: z.literal("FAILED"),
        failure: ResearchWorkerFailureEnvelopeSchema,
        telemetry: ResearchWorkerExecutionTelemetrySchema,
      })
      .strict(),
  ],
);

export type ResearchWorkerExecutionPlan = z.infer<
  typeof ResearchWorkerExecutionPlanSchema
>;
export type ResearchWorkerExecutorIdentity = z.infer<
  typeof ResearchWorkerExecutorIdentitySchema
>;
export type ResearchWorkerExecutionTelemetry = z.infer<
  typeof ResearchWorkerExecutionTelemetrySchema
>;
export type ResearchWorkerExecutionCompletion = z.infer<
  typeof ResearchWorkerExecutionCompletionSchema
>;
export type ResearchWorkerFailureEnvelope = z.infer<
  typeof ResearchWorkerFailureEnvelopeSchema
>;
export type ResearchWorkerCheckpointProposal = z.infer<
  typeof ResearchWorkerCheckpointProposalSchema
>;
export type ResearchWorkerCheckpointRecord = z.infer<
  typeof ResearchWorkerCheckpointRecordSchema
>;
export type ResearchJobLeaseCursor = z.infer<
  typeof ResearchJobLeaseCursorSchema
>;
export type ClaimedResearchJob = z.infer<typeof ClaimedResearchJobSchema>;
export type ResearchJobClaimResult = z.infer<
  typeof ResearchJobClaimResultSchema
>;
export type ResearchJobHeartbeatResult = z.infer<
  typeof ResearchJobHeartbeatResultSchema
>;
export type ResearchJobCheckpointResult = z.infer<
  typeof ResearchJobCheckpointResultSchema
>;
export type ResearchJobCompletionResult = z.infer<
  typeof ResearchJobCompletionResultSchema
>;
export type ResearchJobFailureResult = z.infer<
  typeof ResearchJobFailureResultSchema
>;
export type ResearchJobReleaseResult = z.infer<
  typeof ResearchJobReleaseResultSchema
>;
export type ResearchWorkerExecutionOutcome = z.infer<
  typeof ResearchWorkerExecutionOutcomeSchema
>;
