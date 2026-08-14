import { describe, expect, it } from "vitest";
import { ResearchAttemptRecordSchema } from "@/core/research-runs/schemas";
import {
  ResearchTransitionError,
  assertResearchJobRunnable,
  completeResearchAttempt,
  completeResearchJob,
  requeueResearchJob,
  startResearchJob,
  transitionResearchRun,
} from "@/core/research-runs/transitions";
import {
  BLACK_HAWK_DOWN_RESEARCH_BUNDLE,
  BLACK_HAWK_DOWN_RESEARCH_IDS,
} from "@/fixtures/black-hawk-down/research-run.fixture";

const ATTEMPT_1 = "31000000-0000-4000-8000-000000000001";
const ATTEMPT_2 = "31000000-0000-4000-8000-000000000002";
const T1 = "2026-08-08T17:01:00.000Z";
const T2 = "2026-08-08T17:02:00.000Z";
const T3 = "2026-08-08T17:03:00.000Z";
const T4 = "2026-08-08T17:04:00.000Z";

function expectCode(action: () => unknown, code: string) {
  try {
    action();
  } catch (error) {
    expect(error).toBeInstanceOf(ResearchTransitionError);
    expect((error as ResearchTransitionError).code).toBe(code);
    return;
  }
  throw new Error(`Expected ${code}`);
}

describe("research run transitions", () => {
  it("moves through canonical run phases without stage skipping", () => {
    const planning = transitionResearchRun(
      BLACK_HAWK_DOWN_RESEARCH_BUNDLE.run,
      {
        targetStatus: "PLANNING",
        currentStage: "IDENTITY",
        expectedVersion: 0,
        occurredAt: T1,
      },
    );
    const scoped = transitionResearchRun(planning, {
      targetStatus: "PLANNING",
      currentStage: "SCOPING",
      expectedVersion: 1,
      occurredAt: T2,
    });
    const running = transitionResearchRun(scoped, {
      targetStatus: "RUNNING",
      currentStage: "DISCOVERY",
      expectedVersion: 2,
      occurredAt: T3,
    });

    expect(running.status).toBe("RUNNING");
    expect(running.currentStage).toBe("DISCOVERY");
    expect(running.aggregateVersion).toBe(3);
    expectCode(
      () =>
        transitionResearchRun(planning, {
          targetStatus: "RUNNING",
          currentStage: "RESOLUTION",
          expectedVersion: 1,
          occurredAt: T2,
        }),
      "STAGE_ORDER_VIOLATION",
    );
  });

  it("checks version and time before a same-state idempotent return", () => {
    expectCode(
      () =>
        transitionResearchRun(BLACK_HAWK_DOWN_RESEARCH_BUNDLE.run, {
          targetStatus: "QUEUED",
          currentStage: null,
          expectedVersion: 9,
          occurredAt: T1,
        }),
      "VERSION_CONFLICT",
    );
    expectCode(
      () =>
        transitionResearchRun(BLACK_HAWK_DOWN_RESEARCH_BUNDLE.run, {
          targetStatus: "QUEUED",
          currentStage: null,
          expectedVersion: 0,
          occurredAt: "2026-08-08T16:59:00.000Z",
        }),
      "TIME_REGRESSION",
    );
  });

  it("does not allow successful termination before sequencing", () => {
    const planning = transitionResearchRun(
      BLACK_HAWK_DOWN_RESEARCH_BUNDLE.run,
      {
        targetStatus: "PLANNING",
        currentStage: "IDENTITY",
        expectedVersion: 0,
        occurredAt: T1,
      },
    );
    expectCode(
      () =>
        transitionResearchRun(planning, {
          targetStatus: "SUCCEEDED",
          currentStage: "IDENTITY",
          expectedVersion: 1,
          occurredAt: T2,
        }),
      "INVALID_TRANSITION",
    );
  });
});

describe("research job and attempt transitions", () => {
  it("enforces sequential dependencies", () => {
    expect(
      assertResearchJobRunnable(
        BLACK_HAWK_DOWN_RESEARCH_BUNDLE,
        BLACK_HAWK_DOWN_RESEARCH_IDS.jobs.IDENTITY,
      ).stage,
    ).toBe("IDENTITY");
    expectCode(
      () =>
        assertResearchJobRunnable(
          BLACK_HAWK_DOWN_RESEARCH_BUNDLE,
          BLACK_HAWK_DOWN_RESEARCH_IDS.jobs.SCOPING,
        ),
      "DEPENDENCY_INCOMPLETE",
    );
  });

  it("retains one logical job across bounded attempts", () => {
    const initial = {
      ...BLACK_HAWK_DOWN_RESEARCH_BUNDLE.jobs[0]!,
      maxAttempts: 2,
    };
    const first = startResearchJob(initial, {
      attemptId: ATTEMPT_1,
      expectedVersion: 0,
      occurredAt: T1,
    });
    const failed = completeResearchJob(first, {
      attemptId: ATTEMPT_1,
      targetStatus: "FAILED_RETRYABLE",
      expectedVersion: 1,
      occurredAt: T2,
    });
    const requeued = requeueResearchJob(failed, {
      expectedVersion: 2,
      occurredAt: T3,
    });
    const second = startResearchJob(requeued, {
      attemptId: ATTEMPT_2,
      expectedVersion: 3,
      occurredAt: T4,
    });

    expect(second.logicalJobKey).toBe(initial.logicalJobKey);
    expect(second.attemptCount).toBe(2);
    expectCode(
      () =>
        completeResearchJob(second, {
          attemptId: ATTEMPT_2,
          targetStatus: "FAILED_RETRYABLE",
          expectedVersion: 4,
          occurredAt: T4,
        }),
      "RETRY_EXHAUSTED",
    );
  });

  it("rejects stale or regressed idempotent job starts", () => {
    const running = startResearchJob(
      BLACK_HAWK_DOWN_RESEARCH_BUNDLE.jobs[0]!,
      {
        attemptId: ATTEMPT_1,
        expectedVersion: 0,
        occurredAt: T1,
      },
    );
    expectCode(
      () =>
        startResearchJob(running, {
          attemptId: ATTEMPT_1,
          expectedVersion: 0,
          occurredAt: T2,
        }),
      "VERSION_CONFLICT",
    );
    expectCode(
      () =>
        startResearchJob(running, {
          attemptId: ATTEMPT_1,
          expectedVersion: 1,
          occurredAt: "2026-08-08T17:00:30.000Z",
        }),
      "TIME_REGRESSION",
    );
  });

  it("completes attempt metadata monotonically and refuses stale replay", () => {
    const running = ResearchAttemptRecordSchema.parse({
      schemaVersion: 1,
      id: ATTEMPT_1,
      runId: BLACK_HAWK_DOWN_RESEARCH_IDS.run,
      jobId: BLACK_HAWK_DOWN_RESEARCH_IDS.jobs.IDENTITY,
      attemptNumber: 1,
      requestFingerprint: "c".repeat(64),
      status: "RUNNING",
      execution: {
        executionKind: "DETERMINISTIC",
        traceId: BLACK_HAWK_DOWN_RESEARCH_IDS.trace,
        providerRunId: null,
        model: null,
        prompt: null,
        schema: {
          id: "research-stage-output",
          version: "1",
          schemaFingerprint: "d".repeat(64),
        },
        tool: null,
        telemetryState: "UNAVAILABLE",
        usage: null,
        cost: null,
        latencyMs: null,
        provenanceInputs: [
          { recordType: "RUN", recordId: BLACK_HAWK_DOWN_RESEARCH_IDS.run },
          {
            recordType: "JOB",
            recordId: BLACK_HAWK_DOWN_RESEARCH_IDS.jobs.IDENTITY,
          },
        ],
        privateContentIncluded: false,
      },
      outputFingerprint: null,
      errorCode: null,
      publicationAuthority: "NONE",
      aggregateVersion: 0,
      startedAt: T1,
      completedAt: null,
    });
    const completed = completeResearchAttempt(running, {
      targetStatus: "SUCCEEDED",
      outputFingerprint: "e".repeat(64),
      errorCode: null,
      telemetryState: "COMPLETE",
      providerRunId: null,
      usage: {
        inputTokens: 0,
        outputTokens: 0,
        toolCalls: 0,
        inputBytes: 0,
        outputBytes: 0,
      },
      cost: {
        currency: "USD",
        pricingState: "PRICED",
        amountMicros: 0,
      },
      latencyMs: 60_000,
      expectedVersion: 0,
      occurredAt: T2,
    });
    expect(completed.aggregateVersion).toBe(1);
    expect(completed.execution.latencyMs).toBe(60_000);
    expectCode(
      () =>
        completeResearchAttempt(completed, {
          targetStatus: "SUCCEEDED",
          outputFingerprint: "e".repeat(64),
          errorCode: null,
          telemetryState: "COMPLETE",
          providerRunId: null,
          usage: {
            inputTokens: 0,
            outputTokens: 0,
            toolCalls: 0,
            inputBytes: 0,
            outputBytes: 0,
          },
          cost: {
            currency: "USD",
            pricingState: "PRICED",
            amountMicros: 0,
          },
          latencyMs: 60_000,
          expectedVersion: 0,
          occurredAt: T3,
        }),
      "VERSION_CONFLICT",
    );
  });
});
