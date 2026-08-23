import { createHash } from "node:crypto";
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
  type ResearchWorkerExecutionPlan,
} from "@/core/research-runs/worker-schemas";
import { EntityIdSchema } from "@/core/shared/schemas";

const COVERAGE_GAP_CODE = "specialist-plan-coverage-gaps" as const;

export type ScopingResearchStageExecutorDependencies = Readonly<{
  execution: ResearchWorkerExecutionPlan;
}>;

function deterministicOutputId(attemptId: string) {
  const digest = createHash("sha256")
    .update(`afterframe:scoping-output:v1:${attemptId}`, "utf8")
    .digest("hex");
  const variantNibble = ((Number.parseInt(digest[16] ?? "0", 16) & 0x3) | 0x8)
    .toString(16);
  return EntityIdSchema.parse(
    `${digest.slice(0, 8)}-${digest.slice(8, 12)}-5${digest.slice(13, 16)}-${variantNibble}${digest.slice(17, 20)}-${digest.slice(20, 32)}`,
  );
}

function unavailableTelemetry() {
  return {
    telemetryState: "UNAVAILABLE" as const,
    providerRunId: null,
    usage: null,
    cost: null,
  };
}

function policyFailure(code: string) {
  return ResearchWorkerExecutionOutcomeSchema.parse({
    status: "FAILED",
    failure: ResearchWorkerFailureEnvelopeSchema.parse({
      schemaVersion: 1,
      code,
      category: "POLICY",
      phase: "PREPARATION",
      retryDirective: "DO_NOT_RETRY",
      retryAfterMs: null,
      providerStatusCode: null,
      diagnosticFingerprint: null,
      redactionState: "BODY_FREE",
    }),
    telemetry: unavailableTelemetry(),
  });
}

function hasUniqueValues(values: readonly string[]) {
  return new Set(values).size === values.length;
}

/**
 * Deterministically projects the immutable specialist plan into the exact
 * research axes and source classes later discovery is allowed to search.
 * It performs no provider call and cannot create candidates, evidence, claims,
 * prose, or publication authority.
 */
export class ScopingResearchStageExecutor
  implements DurableResearchStageExecutor
{
  readonly identity;

  constructor(dependencies: ScopingResearchStageExecutorDependencies) {
    const execution = ResearchWorkerExecutionPlanSchema.parse(
      dependencies.execution,
    );
    if (
      execution.executionKind !== "DETERMINISTIC" ||
      execution.model !== null ||
      execution.prompt !== null ||
      execution.tool !== null ||
      execution.privateContentIncluded ||
      execution.automaticRetrySafety !== "IDEMPOTENT_PROVIDER_REQUEST"
    ) {
      throw new Error(
        "Scoping executor requires a body-free deterministic replay-safe execution plan",
      );
    }
    this.identity = ResearchWorkerExecutorIdentitySchema.parse({
      stage: "SCOPING",
      execution,
    });
  }

  async execute(input: DurableResearchStageExecutionInput) {
    const parsedClaim = ClaimedResearchJobSchema.safeParse(input.claim);
    if (!parsedClaim.success) return policyFailure("scoping-claim-invalid");
    const claim = parsedClaim.data;
    const manifest = claim.inputManifest.manifest;
    if (
      claim.job.stage !== "SCOPING" ||
      manifest.stage !== "SCOPING" ||
      manifest.dependency.state !== "BOUND" ||
      manifest.subjectIdentity.state !== "BOUND" ||
      claim.providerCheckpoint !== null
    ) {
      return policyFailure("scoping-causal-input-invalid");
    }

    const axisIds = claim.plan.plan.axes.map(({ axisId }) => axisId);
    const sourceClassIds = [...claim.plan.plan.sourceClassIds];
    if (
      axisIds.length === 0 ||
      sourceClassIds.length === 0 ||
      !hasUniqueValues(axisIds) ||
      !hasUniqueValues(sourceClassIds) ||
      claim.plan.plan.axes.some(
        (axis) =>
          !hasUniqueValues(axis.sourceClassIds) ||
          axis.sourceClassIds.some(
            (sourceClassId) => !sourceClassIds.includes(sourceClassId),
          ),
      )
    ) {
      return policyFailure("scoping-specialist-plan-invalid");
    }

    const coverageGapCodes =
      claim.plan.plan.coverageGaps.length === 0 ? [] : [COVERAGE_GAP_CODE];
    const telemetry = {
      telemetryState: "COMPLETE" as const,
      providerRunId: null,
      usage: {
        inputTokens: 0,
        outputTokens: 0,
        toolCalls: 0,
        inputBytes: 0,
        outputBytes: 0,
      },
      cost: {
        currency: "USD" as const,
        pricingState: "PRICED" as const,
        amountMicros: 0,
      },
    };
    const result = ResearchStageExecutionResultSchema.parse({
      outcome: coverageGapCodes.length === 0 ? "SUCCEEDED" : "DEGRADED",
      boundedReasonCodes: coverageGapCodes,
      output: {
        schemaVersion: 1,
        id: deterministicOutputId(claim.attempt.id),
        runId: claim.run.id,
        jobId: claim.job.id,
        attemptId: claim.attempt.id,
        kind: "SCOPE_RESULT",
        stage: "SCOPING",
        reviewState: "PROPOSED",
        publicationAuthority: "NONE",
        provenanceInputs: [
          { recordType: "PLAN", recordId: claim.plan.id },
          { recordType: "JOB", recordId: claim.job.id },
          { recordType: "ATTEMPT", recordId: claim.attempt.id },
        ],
        createdAt: claim.attempt.startedAt,
        axisIds,
        sourceClassIds,
        coverageGapCodes,
      },
      subjectIdentities: [],
      sourceCandidates: [],
      untrustedContent: [],
    });
    return ResearchWorkerExecutionOutcomeSchema.parse({
      status: "COMPLETED",
      result,
      telemetry,
    });
  }
}

export function createScopingResearchStageExecutor(
  dependencies: ScopingResearchStageExecutorDependencies,
) {
  return new ScopingResearchStageExecutor(dependencies);
}
