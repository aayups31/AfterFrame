import {
  ResearchSubjectIdentityContextSchema,
  SubjectIdentityResolverDescriptorSchema,
  SubjectIdentityResolverResultSchema,
  type ResearchSubjectIdentityContext,
  type ResearchSubjectIdentityContextReader,
  type SubjectIdentityResolver,
  type SubjectIdentityResolverResult,
} from "@/application/research/subject-identity-port";
import type {
  DurableResearchStageExecutionInput,
  DurableResearchStageExecutor,
} from "@/core/research-runs/ports";
import { ResearchStageExecutionResultSchema } from "@/core/research-runs/schemas";
import {
  ClaimedResearchJobSchema,
  ResearchWorkerExecutionOutcomeSchema,
  ResearchWorkerExecutionPlanSchema,
  ResearchWorkerExecutorIdentitySchema,
  ResearchWorkerFailureEnvelopeSchema,
  type ClaimedResearchJob,
  type ResearchWorkerExecutionOutcome,
  type ResearchWorkerExecutionPlan,
  type ResearchWorkerExecutionTelemetry,
} from "@/core/research-runs/worker-schemas";
import { EntityIdSchema, IsoDateTimeSchema } from "@/core/shared/schemas";

export type IdentityResearchStageIdentifierKind =
  | "research_stage_output"
  | "subject_identity";

export type IdentityResearchStageExecutorDependencies = Readonly<{
  context: ResearchSubjectIdentityContextReader;
  resolver: SubjectIdentityResolver;
  execution: ResearchWorkerExecutionPlan;
  createId: (kind: IdentityResearchStageIdentifierKind) => string;
  now: () => string;
}>;

function unavailableTelemetry(): ResearchWorkerExecutionTelemetry {
  return {
    telemetryState: "UNAVAILABLE",
    providerRunId: null,
    usage: null,
    cost: null,
  };
}

function failureOutcome(input: Readonly<{
  code: string;
  category:
    | "TRANSIENT_UPSTREAM"
    | "RATE_LIMITED"
    | "TIMEOUT"
    | "INVALID_OUTPUT"
    | "POLICY"
    | "NOT_FOUND"
    | "AUTH_CONFIGURATION"
    | "WORKER_INTERNAL";
  phase: "PREPARATION" | "EXTERNAL_CALL" | "VALIDATION";
  retryAfterMs: number | null;
  providerStatusCode: number | null;
  telemetry: ResearchWorkerExecutionTelemetry;
}>): ResearchWorkerExecutionOutcome {
  return ResearchWorkerExecutionOutcomeSchema.parse({
    status: "FAILED",
    failure: ResearchWorkerFailureEnvelopeSchema.parse({
      schemaVersion: 1,
      code: input.code,
      category: input.category,
      phase: input.phase,
      retryDirective:
        input.retryAfterMs === null ? "DO_NOT_RETRY" : "RETRY_WITH_BACKOFF",
      retryAfterMs: input.retryAfterMs,
      providerStatusCode: input.providerStatusCode,
      diagnosticFingerprint: null,
      redactionState: "BODY_FREE",
    }),
    telemetry: input.telemetry,
  });
}

function contextMatchesClaim(
  context: ResearchSubjectIdentityContext,
  claim: ClaimedResearchJob,
  resolver: ReturnType<typeof SubjectIdentityResolverDescriptorSchema.parse>,
) {
  const manifest = claim.inputManifest.manifest;
  return (
    claim.job.stage === "IDENTITY" &&
    context.runId === claim.run.id &&
    context.jobId === claim.job.id &&
    context.caseId === claim.run.caseId &&
    context.specialistId === claim.run.specialistId &&
    context.specialistVersion === claim.run.specialistVersion &&
    context.specialistId === claim.plan.specialistId &&
    context.specialistVersion === claim.plan.specialistVersion &&
    context.subjectRef.type === resolver.subjectType &&
    context.specialistId === resolver.specialistId &&
    context.specialistVersion === resolver.specialistVersion &&
    context.subjectRefFingerprint === manifest.subjectRefFingerprint &&
    JSON.stringify(context.identityRequirements) ===
      JSON.stringify(claim.plan.plan.identityRequirements) &&
    resolver.resolvedRequirementIds.every((requirementId) =>
      context.identityRequirements.some(
        (requirement) => requirement.id === requirementId,
      ),
    )
  );
}

function boundedUnavailableFailure(
  result: Extract<SubjectIdentityResolverResult, { status: "UNAVAILABLE" }>,
) {
  const mapping = {
    AUTHENTICATION_FAILED: {
      code: "subject-identity-authentication-failed",
      category: "AUTH_CONFIGURATION",
      phase: "EXTERNAL_CALL",
    },
    NETWORK_ERROR: {
      code: "subject-identity-network-error",
      category: "TRANSIENT_UPSTREAM",
      phase: "EXTERNAL_CALL",
    },
    REQUEST_TIMEOUT: {
      code: "subject-identity-request-timeout",
      category: "TIMEOUT",
      phase: "EXTERNAL_CALL",
    },
    UPSTREAM_UNAVAILABLE: {
      code: "subject-identity-upstream-unavailable",
      category: "TRANSIENT_UPSTREAM",
      phase: "EXTERNAL_CALL",
    },
    INVALID_PROVIDER_RESPONSE: {
      code: "subject-identity-provider-response-invalid",
      category: "INVALID_OUTPUT",
      phase: "VALIDATION",
    },
    UNEXPECTED_PROVIDER_RESPONSE: {
      code: "subject-identity-provider-response-unexpected",
      category: "INVALID_OUTPUT",
      phase: "VALIDATION",
    },
  } as const;
  return failureOutcome({
    ...mapping[result.reason],
    retryAfterMs: result.retryAfterMs,
    providerStatusCode: result.providerStatusCode,
    telemetry: result.telemetry,
  });
}

function createdAtAtOrAfter(now: () => string, floors: readonly string[]) {
  return [IsoDateTimeSchema.parse(now()), ...floors.map((value) =>
    IsoDateTimeSchema.parse(value),
  )].reduce((latest, candidate) =>
    new Date(candidate).getTime() > new Date(latest).getTime()
      ? candidate
      : latest,
  );
}

function isAbortError(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    error.name === "AbortError"
  );
}

/**
 * Domain-neutral first-stage executor. The injected resolver may establish
 * public subject identity, but it has no authority to create evidence, claims,
 * source candidates, prose, or publication-ready output.
 */
export class IdentityResearchStageExecutor
  implements DurableResearchStageExecutor
{
  readonly identity;
  readonly #context: ResearchSubjectIdentityContextReader;
  readonly #resolver: SubjectIdentityResolver;
  readonly #resolverIdentity: ReturnType<
    typeof SubjectIdentityResolverDescriptorSchema.parse
  >;
  readonly #createId: (kind: IdentityResearchStageIdentifierKind) => string;
  readonly #now: () => string;

  constructor(dependencies: IdentityResearchStageExecutorDependencies) {
    const resolverIdentity = SubjectIdentityResolverDescriptorSchema.parse(
      dependencies.resolver.identity,
    );
    const execution = ResearchWorkerExecutionPlanSchema.parse(
      dependencies.execution,
    );
    if (
      execution.executionKind !== "RESOLVER" ||
      execution.tool === null ||
      execution.tool.id !== resolverIdentity.resolver.id ||
      execution.tool.version !== resolverIdentity.resolver.version ||
      execution.privateContentIncluded ||
      execution.automaticRetrySafety !== "IDEMPOTENT_PROVIDER_REQUEST"
    ) {
      throw new Error(
        "Identity executor requires a body-free idempotent resolver execution plan",
      );
    }
    this.identity = ResearchWorkerExecutorIdentitySchema.parse({
      stage: "IDENTITY",
      execution,
    });
    this.#context = dependencies.context;
    this.#resolver = dependencies.resolver;
    this.#resolverIdentity = resolverIdentity;
    this.#createId = dependencies.createId;
    this.#now = dependencies.now;
  }

  async execute(
    input: DurableResearchStageExecutionInput,
  ): Promise<ResearchWorkerExecutionOutcome> {
    const claimResult = ClaimedResearchJobSchema.safeParse(input.claim);
    if (!claimResult.success) {
      return failureOutcome({
        code: "subject-identity-claim-invalid",
        category: "POLICY",
        phase: "PREPARATION",
        retryAfterMs: null,
        providerStatusCode: null,
        telemetry: unavailableTelemetry(),
      });
    }
    const claim = claimResult.data;

    let contextValue: unknown;
    try {
      contextValue = await this.#context.getSubjectIdentityContext({
        actorId: input.actorId,
        runId: claim.run.id,
        jobId: claim.job.id,
      });
    } catch {
      return failureOutcome({
        code: "subject-identity-context-unavailable",
        category: "TRANSIENT_UPSTREAM",
        phase: "PREPARATION",
        retryAfterMs: 1_000,
        providerStatusCode: null,
        telemetry: unavailableTelemetry(),
      });
    }
    const context = ResearchSubjectIdentityContextSchema.safeParse(contextValue);
    if (
      !context.success ||
      !contextMatchesClaim(context.data, claim, this.#resolverIdentity)
    ) {
      return failureOutcome({
        code: "subject-identity-context-mismatch",
        category: "POLICY",
        phase: "PREPARATION",
        retryAfterMs: null,
        providerStatusCode: null,
        telemetry: unavailableTelemetry(),
      });
    }

    let resolverValue: unknown;
    try {
      resolverValue = await this.#resolver.resolve({
        subjectRef: context.data.subjectRef,
        signal: input.signal,
      });
    } catch (error) {
      if (input.signal.aborted || isAbortError(error)) throw error;
      return failureOutcome({
        code: "subject-identity-resolver-threw",
        category: "TRANSIENT_UPSTREAM",
        phase: "EXTERNAL_CALL",
        retryAfterMs: 1_000,
        providerStatusCode: null,
        telemetry: unavailableTelemetry(),
      });
    }
    const resolverResult = SubjectIdentityResolverResultSchema.safeParse(
      resolverValue,
    );
    if (!resolverResult.success) {
      return failureOutcome({
        code: "subject-identity-resolver-output-invalid",
        category: "INVALID_OUTPUT",
        phase: "VALIDATION",
        retryAfterMs: null,
        providerStatusCode: null,
        telemetry: unavailableTelemetry(),
      });
    }
    const result = resolverResult.data;
    if (result.status === "NOT_FOUND") {
      return failureOutcome({
        code: "subject-identity-not-found",
        category: "NOT_FOUND",
        phase: "EXTERNAL_CALL",
        retryAfterMs: null,
        providerStatusCode: result.providerStatusCode,
        telemetry: result.telemetry,
      });
    }
    if (result.status === "RATE_LIMITED") {
      return failureOutcome({
        code: "subject-identity-rate-limited",
        category: "RATE_LIMITED",
        phase: "EXTERNAL_CALL",
        retryAfterMs: result.retryAfterMs,
        providerStatusCode: result.providerStatusCode,
        telemetry: result.telemetry,
      });
    }
    if (result.status === "UNAVAILABLE") {
      return boundedUnavailableFailure(result);
    }
    if (
      result.publicIdentity.resolver.id !==
        this.#resolverIdentity.resolver.id ||
      result.publicIdentity.resolver.version !==
        this.#resolverIdentity.resolver.version
    ) {
      return failureOutcome({
        code: "subject-identity-resolver-provenance-mismatch",
        category: "POLICY",
        phase: "VALIDATION",
        retryAfterMs: null,
        providerStatusCode: null,
        telemetry: result.telemetry,
      });
    }

    const resolvedByAdapter = new Set(
      this.#resolverIdentity.resolvedRequirementIds,
    );
    const resolvedRequirementIds = [
      ...new Set(
        context.data.identityRequirements
          .filter(
            (requirement) =>
              requirement.state !== "UNRESOLVED" ||
              resolvedByAdapter.has(requirement.id),
          )
          .map(({ id }) => id),
      ),
    ];
    const unresolvedRequirementIds = [
      ...new Set(
        context.data.identityRequirements
          .filter(
            (requirement) =>
              requirement.state === "UNRESOLVED" &&
              !resolvedByAdapter.has(requirement.id),
          )
          .map(({ id }) => id),
      ),
    ];
    const createdAt = createdAtAtOrAfter(
      this.#now,
      [result.publicIdentity.resolvedAt, claim.attempt.startedAt],
    );
    const subjectIdentityId = EntityIdSchema.parse(
      this.#createId("subject_identity"),
    );
    const outputId = EntityIdSchema.parse(
      this.#createId("research_stage_output"),
    );
    const provenanceInputs = [
      { recordType: "JOB" as const, recordId: claim.job.id },
      { recordType: "ATTEMPT" as const, recordId: claim.attempt.id },
    ];
    const stageResult = ResearchStageExecutionResultSchema.parse({
      outcome:
        unresolvedRequirementIds.length === 0 ? "SUCCEEDED" : "DEGRADED",
      boundedReasonCodes:
        unresolvedRequirementIds.length === 0
          ? []
          : ["identity-requirements-unresolved"],
      output: {
        schemaVersion: 1,
        id: outputId,
        runId: claim.run.id,
        jobId: claim.job.id,
        attemptId: claim.attempt.id,
        kind: "IDENTITY_RESULT",
        stage: "IDENTITY",
        reviewState: "PROPOSED",
        publicationAuthority: "NONE",
        provenanceInputs,
        createdAt,
        subjectIdentityId,
        resolvedRequirementIds,
        unresolvedRequirementIds,
      },
      subjectIdentities: [
        {
          schemaVersion: 1,
          id: subjectIdentityId,
          caseId: claim.run.caseId,
          runId: claim.run.id,
          jobId: claim.job.id,
          attemptId: claim.attempt.id,
          subjectRefFingerprint: context.data.subjectRefFingerprint,
          publicIdentity: result.publicIdentity,
          evidenceStatus: "NOT_EVIDENCE",
          reviewState: "PROPOSED",
          publicationAuthority: "NONE",
          provenanceInputs,
          createdAt,
        },
      ],
      sourceCandidates: [],
      untrustedContent: [],
    });
    return ResearchWorkerExecutionOutcomeSchema.parse({
      status: "COMPLETED",
      result: stageResult,
      telemetry: result.telemetry,
    });
  }
}

export function createIdentityResearchStageExecutor(
  dependencies: IdentityResearchStageExecutorDependencies,
) {
  return new IdentityResearchStageExecutor(dependencies);
}
