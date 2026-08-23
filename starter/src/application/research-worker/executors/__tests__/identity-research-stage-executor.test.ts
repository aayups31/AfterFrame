import { describe, expect, it, vi } from "vitest";
import {
  IdentityResearchStageExecutor,
  type IdentityResearchStageExecutorDependencies,
} from "@/application/research-worker/executors/identity-research-stage-executor";
import type {
  ResearchSubjectIdentityContextReader,
  SubjectIdentityResolver,
} from "@/application/research/subject-identity-port";
import type { DurableResearchStageExecutionInput } from "@/core/research-runs/ports";
import { ResearchAttemptRecordSchema } from "@/core/research-runs/schemas";
import {
  ClaimedResearchJobSchema,
  type ClaimedResearchJob,
  type ResearchWorkerExecutionPlan,
} from "@/core/research-runs/worker-schemas";
import {
  startResearchJob,
  transitionResearchRun,
} from "@/core/research-runs/transitions";
import {
  BLACK_HAWK_DOWN_RESEARCH_BUNDLE,
} from "@/fixtures/black-hawk-down/research-run.fixture";
import {
  BLACK_HAWK_DOWN_CASE,
  BLACK_HAWK_DOWN_SPINE_IDS,
} from "@/fixtures/black-hawk-down/deterministic-spine.fixture";

const T1 = "2026-08-14T10:00:00.000Z";
const T2 = "2026-08-14T10:00:01.000Z";
const T3 = "2026-08-14T10:02:00.000Z";
const ATTEMPT_ID = "73000000-0000-4000-8000-000000000001";
const OUTPUT_ID = "73000000-0000-4000-8000-000000000002";
const IDENTITY_ID = "73000000-0000-4000-8000-000000000003";
const SUBJECT_FINGERPRINT = "4".repeat(64);
const ATTEMPT_FINGERPRINT = "5".repeat(64);
const MANIFEST_FINGERPRINT = "6".repeat(64);
const SECRET = "provider body must never cross the resolver boundary";

const execution: ResearchWorkerExecutionPlan = {
  executorId: "identity-stage-executor",
  executorVersion: "1",
  configurationFingerprint: "7".repeat(64),
  executionKind: "RESOLVER",
  model: null,
  prompt: null,
  schema: {
    id: "research-stage-output",
    version: "1",
    schemaFingerprint: "8".repeat(64),
  },
  tool: { id: "test-subject-resolver", version: "1" },
  privateContentIncluded: false,
  automaticRetrySafety: "IDEMPOTENT_PROVIDER_REQUEST",
};

const resolverIdentity: SubjectIdentityResolver["identity"] = {
  specialistId: BLACK_HAWK_DOWN_CASE.specialistId,
  specialistVersion: BLACK_HAWK_DOWN_CASE.specialistVersion,
  subjectType: "film",
  resolver: { id: "test-subject-resolver", version: "1" },
  resolvedRequirementIds: ["tmdb-film"],
};

const telemetry = {
  telemetryState: "COMPLETE",
  providerRunId: "test-provider-run-1",
  usage: {
    inputTokens: 0,
    outputTokens: 0,
    toolCalls: 1,
    inputBytes: 32,
    outputBytes: 128,
  },
  cost: {
    currency: "USD",
    pricingState: "UNPRICED",
    amountMicros: null,
  },
} as const;

const publicIdentity = {
  displayName: "Black Hawk Down",
  alternateNames: [],
  disambiguators: [
    { label: "release-year", value: "2001" },
    { label: "provider-id", value: "tmdb:movie:855" },
  ],
  identityFingerprint: "9".repeat(64),
  dataClass: "PUBLIC",
  verificationState: "RESOLVER_VERIFIED",
  resolver: resolverIdentity.resolver,
  resolvedAt: T1,
} as const;

function makeClaim(startedAt = T1): ClaimedResearchJob {
  const run = transitionResearchRun(BLACK_HAWK_DOWN_RESEARCH_BUNDLE.run, {
    targetStatus: "PLANNING",
    currentStage: "IDENTITY",
    expectedVersion: 0,
    occurredAt: startedAt,
  });
  const initialJob = BLACK_HAWK_DOWN_RESEARCH_BUNDLE.jobs[0];
  if (initialJob === undefined) throw new Error("Fixture has no IDENTITY job");
  const job = startResearchJob(initialJob, {
    attemptId: ATTEMPT_ID,
    expectedVersion: 0,
    occurredAt: startedAt,
  });
  const attempt = ResearchAttemptRecordSchema.parse({
    schemaVersion: 1,
    id: ATTEMPT_ID,
    runId: run.id,
    jobId: job.id,
    attemptNumber: 1,
    requestFingerprint: ATTEMPT_FINGERPRINT,
    status: "RUNNING",
    execution: {
      executionKind: execution.executionKind,
      traceId: run.traceId,
      providerRunId: null,
      model: execution.model,
      prompt: execution.prompt,
      schema: execution.schema,
      tool: execution.tool,
      telemetryState: "UNAVAILABLE",
      usage: null,
      cost: null,
      latencyMs: null,
      provenanceInputs: [
        { recordType: "RUN", recordId: run.id },
        { recordType: "PLAN", recordId: run.planId },
        { recordType: "JOB", recordId: job.id },
      ],
      privateContentIncluded: false,
    },
    outputFingerprint: null,
    errorCode: null,
    publicationAuthority: "NONE",
    aggregateVersion: 0,
    startedAt,
    completedAt: null,
  });
  return ClaimedResearchJobSchema.parse({
    run,
    job,
    plan: BLACK_HAWK_DOWN_RESEARCH_BUNDLE.plan,
    attempt,
    lease: {
      schemaVersion: 1,
      runId: run.id,
      jobId: job.id,
      attemptId: attempt.id,
      workerId: "identity-worker-1",
      leaseToken: "identity-lease-1",
      leaseEpoch: 1,
      runVersion: run.aggregateVersion,
      jobVersion: job.aggregateVersion,
      attemptVersion: attempt.aggregateVersion,
      claimedAt: startedAt,
      heartbeatAt: startedAt,
      expiresAt: T3,
      externalIdempotencyKey: ATTEMPT_FINGERPRINT,
    },
    execution,
    inputManifest: {
      schemaVersion: 1,
      authority: "POSTGRES",
      manifest: {
        schemaVersion: 1,
        runId: run.id,
        caseId: run.caseId,
        branchId: run.branchId,
        planId: run.planId,
        jobId: job.id,
        stage: "IDENTITY",
        subjectRefFingerprint: SUBJECT_FINGERPRINT,
        objectiveFingerprint: run.objectiveFingerprint,
        runRequestFingerprint: run.requestFingerprint,
        planFingerprint: BLACK_HAWK_DOWN_RESEARCH_BUNDLE.plan.planFingerprint,
        stageSeedFingerprint: job.stageInputFingerprint,
        dependency: { state: "ROOT" },
        subjectIdentity: { state: "UNBOUND" },
      },
      manifestFingerprint: MANIFEST_FINGERPRINT,
      authoredAt: T1,
    },
    latestCheckpoint: null,
    providerCheckpoint: null,
    resumed: false,
    replayed: false,
  });
}

function identityContext(claim: ClaimedResearchJob) {
  return {
    schemaVersion: 1 as const,
    runId: claim.run.id,
    jobId: claim.job.id,
    caseId: claim.run.caseId,
    specialistId: claim.run.specialistId,
    specialistVersion: claim.run.specialistVersion,
    subjectRef: BLACK_HAWK_DOWN_CASE.subjectRef,
    subjectRefFingerprint: SUBJECT_FINGERPRINT,
    identityRequirements: claim.plan.plan.identityRequirements,
  };
}

function executionInput(
  claim: ClaimedResearchJob,
  signal = new AbortController().signal,
): DurableResearchStageExecutionInput {
  return {
    actorId: BLACK_HAWK_DOWN_SPINE_IDS.owner,
    claim,
    externalIdempotencyKey: ATTEMPT_FINGERPRINT,
    signal,
    async checkpoint() {
      throw new Error("IDENTITY does not checkpoint provider bodies");
    },
    async acceptProviderRun() {
      throw new Error("IDENTITY does not accept provider runs");
    },
  };
}

function makeExecutor(input: Readonly<{
  claim?: ClaimedResearchJob;
  context?: ResearchSubjectIdentityContextReader;
  resolver?: SubjectIdentityResolver;
  execution?: ResearchWorkerExecutionPlan;
  now?: () => string;
}> = {}) {
  const claim = input.claim ?? makeClaim();
  const context =
    input.context ??
    ({
      getSubjectIdentityContext: vi.fn(async () => identityContext(claim)),
    } satisfies ResearchSubjectIdentityContextReader);
  const resolver =
    input.resolver ??
    ({
      identity: resolverIdentity,
      resolve: vi.fn(async () => ({
        status: "VERIFIED",
        publicIdentity,
        telemetry,
      })),
    } satisfies SubjectIdentityResolver);
  const dependencies: IdentityResearchStageExecutorDependencies = {
    context,
    resolver,
    execution: input.execution ?? execution,
    createId: (kind) =>
      kind === "subject_identity" ? IDENTITY_ID : OUTPUT_ID,
    now: input.now ?? (() => T2),
  };
  return {
    claim,
    context,
    resolver,
    executor: new IdentityResearchStageExecutor(dependencies),
  };
}

describe("IdentityResearchStageExecutor", () => {
  it("persists only resolver-verified identity metadata and forwards actor scope", async () => {
    const setup = makeExecutor();
    const signal = new AbortController().signal;
    const outcome = await setup.executor.execute(
      executionInput(setup.claim, signal),
    );

    expect(outcome.status).toBe("COMPLETED");
    if (outcome.status !== "COMPLETED") throw new Error("Expected completion");
    expect(outcome.result.outcome).toBe("DEGRADED");
    expect(outcome.result.boundedReasonCodes).toEqual([
      "identity-requirements-unresolved",
    ]);
    expect(outcome.result.output).toMatchObject({
      kind: "IDENTITY_RESULT",
      stage: "IDENTITY",
      subjectIdentityId: IDENTITY_ID,
      resolvedRequirementIds: ["tmdb-film"],
      unresolvedRequirementIds: ["film-version"],
    });
    expect(outcome.result.subjectIdentities).toHaveLength(1);
    expect(outcome.result.subjectIdentities[0]).toMatchObject({
      id: IDENTITY_ID,
      caseId: BLACK_HAWK_DOWN_CASE.id,
      subjectRefFingerprint: SUBJECT_FINGERPRINT,
      evidenceStatus: "NOT_EVIDENCE",
      reviewState: "PROPOSED",
      publicationAuthority: "NONE",
      publicIdentity,
    });
    expect(outcome.result.sourceCandidates).toEqual([]);
    expect(outcome.result.untrustedContent).toEqual([]);
    expect(Object.keys(outcome.result).sort()).toEqual([
      "boundedReasonCodes",
      "outcome",
      "output",
      "sourceCandidates",
      "subjectIdentities",
      "untrustedContent",
    ]);
    expect(setup.context.getSubjectIdentityContext).toHaveBeenCalledWith({
      actorId: BLACK_HAWK_DOWN_SPINE_IDS.owner,
      runId: setup.claim.run.id,
      jobId: setup.claim.job.id,
    });
    expect(setup.resolver.resolve).toHaveBeenCalledWith({
      subjectRef: BLACK_HAWK_DOWN_CASE.subjectRef,
      signal,
    });
  });

  it("floors produced timestamps at the database-authored attempt start", async () => {
    const claim = makeClaim(T2);
    const setup = makeExecutor({ claim, now: () => T1 });
    const outcome = await setup.executor.execute(executionInput(claim));

    expect(outcome.status).toBe("COMPLETED");
    if (outcome.status !== "COMPLETED") throw new Error("Expected completion");
    expect(outcome.result.output.createdAt).toBe(T2);
    expect(outcome.result.subjectIdentities[0]?.createdAt).toBe(T2);
  });

  it("fails closed before resolver work when claim or context binding drifts", async () => {
    const context = {
      getSubjectIdentityContext: vi.fn(async () => ({
        ...identityContext(makeClaim()),
        subjectRefFingerprint: "a".repeat(64),
      })),
    } satisfies ResearchSubjectIdentityContextReader;
    const resolver = {
      identity: resolverIdentity,
      resolve: vi.fn(async () => ({
        status: "VERIFIED",
        publicIdentity,
        telemetry,
      })),
    } satisfies SubjectIdentityResolver;
    const contextMismatch = makeExecutor({ context, resolver });
    const contextOutcome = await contextMismatch.executor.execute(
      executionInput(contextMismatch.claim),
    );
    expect(contextOutcome).toMatchObject({
      status: "FAILED",
      failure: {
        code: "subject-identity-context-mismatch",
        category: "POLICY",
        retryDirective: "DO_NOT_RETRY",
      },
    });
    expect(resolver.resolve).not.toHaveBeenCalled();

    const valid = makeExecutor();
    const invalidClaim = {
      ...valid.claim,
      inputManifest: {
        ...valid.claim.inputManifest,
        manifest: {
          ...valid.claim.inputManifest.manifest,
          stageSeedFingerprint: "b".repeat(64),
        },
      },
    } as ClaimedResearchJob;
    const claimOutcome = await valid.executor.execute(
      executionInput(invalidClaim),
    );
    expect(claimOutcome).toMatchObject({
      status: "FAILED",
      failure: {
        code: "subject-identity-claim-invalid",
        category: "POLICY",
      },
    });
  });

  it.each([
    [
      { status: "NOT_FOUND", providerStatusCode: 404, telemetry },
      "subject-identity-not-found",
      "NOT_FOUND",
      "DO_NOT_RETRY",
    ],
    [
      {
        status: "RATE_LIMITED",
        retryAfterMs: 750,
        providerStatusCode: 429,
        telemetry,
      },
      "subject-identity-rate-limited",
      "RATE_LIMITED",
      "RETRY_WITH_BACKOFF",
    ],
    [
      {
        status: "UNAVAILABLE",
        reason: "REQUEST_TIMEOUT",
        retryable: true,
        retryAfterMs: 750,
        providerStatusCode: null,
        telemetry,
      },
      "subject-identity-request-timeout",
      "TIMEOUT",
      "RETRY_WITH_BACKOFF",
    ],
    [
      {
        status: "UNAVAILABLE",
        reason: "AUTHENTICATION_FAILED",
        retryable: false,
        retryAfterMs: null,
        providerStatusCode: 401,
        telemetry,
      },
      "subject-identity-authentication-failed",
      "AUTH_CONFIGURATION",
      "DO_NOT_RETRY",
    ],
  ] as const)(
    "maps %s to a bounded body-free worker failure",
    async (resolverResult, code, category, retryDirective) => {
      const setup = makeExecutor({
        resolver: {
          identity: resolverIdentity,
          resolve: vi.fn(async () => resolverResult),
        },
      });
      const outcome = await setup.executor.execute(executionInput(setup.claim));
      expect(outcome).toMatchObject({
        status: "FAILED",
        failure: { code, category, retryDirective, redactionState: "BODY_FREE" },
      });
    },
  );

  it("reduces malformed resolver output to terminal body-free invalid output", async () => {
    const setup = makeExecutor({
      resolver: {
        identity: resolverIdentity,
        resolve: vi.fn(async () => ({
          status: "VERIFIED",
          publicIdentity,
          telemetry,
          providerBody: SECRET,
        })),
      },
    });
    const outcome = await setup.executor.execute(executionInput(setup.claim));
    expect(outcome).toMatchObject({
      status: "FAILED",
      failure: {
        code: "subject-identity-resolver-output-invalid",
        category: "INVALID_OUTPUT",
        retryDirective: "DO_NOT_RETRY",
        redactionState: "BODY_FREE",
      },
    });
    expect(JSON.stringify(outcome)).not.toContain(SECRET);
  });

  it("propagates resolver AbortError so durable worker authority owns cancellation", async () => {
    const abortError = Object.assign(new Error("cancelled by worker"), {
      name: "AbortError",
    });
    const setup = makeExecutor({
      resolver: {
        identity: resolverIdentity,
        resolve: vi.fn(async () => {
          throw abortError;
        }),
      },
    });
    await expect(
      setup.executor.execute(executionInput(setup.claim)),
    ).rejects.toBe(abortError);
  });

  it("rejects model, private, mismatched, and non-idempotent execution plans", () => {
    const base = makeExecutor();
    const invalidPlans = [
      {
        ...execution,
        executionKind: "MODEL_TOOL" as const,
        model: { provider: "test", model: "test", snapshot: "test" },
        prompt: {
          id: "identity",
          version: "1",
          templateFingerprint: "c".repeat(64),
        },
      },
      { ...execution, privateContentIncluded: true },
      { ...execution, tool: { id: "wrong-resolver", version: "1" } },
      { ...execution, automaticRetrySafety: "NOT_GUARANTEED" as const },
    ];
    for (const invalidExecution of invalidPlans) {
      expect(
        () =>
          new IdentityResearchStageExecutor({
            context: base.context,
            resolver: base.resolver,
            execution: invalidExecution,
            createId: () => IDENTITY_ID,
            now: () => T2,
          }),
      ).toThrow();
    }
  });
});
