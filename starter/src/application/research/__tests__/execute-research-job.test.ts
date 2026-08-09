import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createExecuteResearchJobService } from "@/application/research/execute-research-job";
import type {
  DeterministicResearchStageExecutor,
  ResearchRunFingerprintPort,
} from "@/core/research-runs/ports";
import {
  BLACK_HAWK_DOWN_RESEARCH_BUNDLE,
  blackHawkDownStageResult,
} from "@/fixtures/black-hawk-down/research-run.fixture";

const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");

const fingerprints: ResearchRunFingerprintPort = {
  fingerprintStartRequest: (_actorId, input) => hash(JSON.stringify(input)),
  fingerprintObjective: hash,
  fingerprintPlan: (plan) => hash(JSON.stringify(plan)),
  fingerprintStageInput: (input) => hash(JSON.stringify(input)),
  fingerprintAttemptRequest: (runId, jobId, key) =>
    hash(`${runId}:${jobId}:${key}`),
  fingerprintExecutionOutput: (output) => hash(JSON.stringify(output)),
};

function clock() {
  let tick = 0;
  return () =>
    new Date(Date.parse("2026-08-08T17:01:00.000Z") + tick++ * 1_000)
      .toISOString();
}

function attemptIds() {
  let next = 1;
  return () =>
    `32000000-0000-4000-8000-${String(next++).padStart(12, "0")}`;
}

const identity = {
  kind: "DETERMINISTIC_FIXTURE",
  id: "black-hawk-down-research-spine",
  version: "1",
  schema: {
    id: "research-stage-output",
    version: "1",
    schemaFingerprint: "f".repeat(64),
  },
} as const;

describe("deterministic research job execution", () => {
  it("executes all seven dependent stages and ends degraded without publishing", async () => {
    let executionCount = 0;
    const executor: DeterministicResearchStageExecutor = {
      identity,
      async execute(input) {
        executionCount += 1;
        return blackHawkDownStageResult(
          input.job.stage,
          input.attemptId,
          input.run.updatedAt,
        );
      },
    };
    const execute = createExecuteResearchJobService({
      executor,
      fingerprints,
      createId: attemptIds(),
      now: clock(),
    });
    let bundle = BLACK_HAWK_DOWN_RESEARCH_BUNDLE;

    for (const [index, job] of bundle.jobs.entries()) {
      const currentJob = bundle.jobs[index];
      if (currentJob === undefined) throw new Error("Missing staged job");
      const result = await execute(bundle, {
        runId: bundle.run.id,
        jobId: currentJob.id,
        expectedRunVersion: bundle.run.aggregateVersion,
        expectedJobVersion: currentJob.aggregateVersion,
        idempotencyKey: `attempt:${job.stage}:1`,
      });
      bundle = result.bundle;
    }

    expect(executionCount).toBe(7);
    expect(bundle.jobs.map(({ status }) => status)).toEqual([
      "SUCCEEDED",
      "SUCCEEDED",
      "SUCCEEDED",
      "DEGRADED",
      "SUCCEEDED",
      "SUCCEEDED",
      "SUCCEEDED",
    ]);
    expect(bundle.run.status).toBe("DEGRADED");
    expect(bundle.run.currentStage).toBe("SEQUENCING");
    expect(bundle.sourceCandidates).toHaveLength(1);
    expect(bundle.sourceCandidates[0]?.evidenceStatus).toBe("NOT_EVIDENCE");
    expect(bundle.outputs.every((output) => output.reviewState === "PROPOSED"))
      .toBe(true);
    expect(
      bundle.outputs.every(
        (output) => output.publicationAuthority === "NONE",
      ),
    ).toBe(true);
  });

  it("replays a completed attempt before evaluating stale versions", async () => {
    let executionCount = 0;
    const executor: DeterministicResearchStageExecutor = {
      identity,
      async execute(input) {
        executionCount += 1;
        return blackHawkDownStageResult(
          input.job.stage,
          input.attemptId,
          input.run.updatedAt,
        );
      },
    };
    const execute = createExecuteResearchJobService({
      executor,
      fingerprints,
      createId: attemptIds(),
      now: clock(),
    });
    const job = BLACK_HAWK_DOWN_RESEARCH_BUNDLE.jobs[0]!;
    const command = {
      runId: BLACK_HAWK_DOWN_RESEARCH_BUNDLE.run.id,
      jobId: job.id,
      expectedRunVersion: 0,
      expectedJobVersion: 0,
      idempotencyKey: "identity-once",
    };
    const first = await execute(BLACK_HAWK_DOWN_RESEARCH_BUNDLE, command);
    const replay = await execute(first.bundle, command);

    expect(replay.disposition).toBe("REPLAY");
    expect(replay.replayed).toBe(true);
    expect(executionCount).toBe(1);
    expect(replay.bundle).toEqual(first.bundle);
  });

  it("uses one stable logical job across bounded retry attempts", async () => {
    const executor: DeterministicResearchStageExecutor = {
      identity,
      async execute() {
        return { untrusted: "malformed model-shaped output" };
      },
    };
    const execute = createExecuteResearchJobService({
      executor,
      fingerprints,
      createId: attemptIds(),
      now: clock(),
    });
    let bundle = BLACK_HAWK_DOWN_RESEARCH_BUNDLE;
    const logicalJobKey = bundle.jobs[0]!.logicalJobKey;

    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const job = bundle.jobs[0]!;
      const result = await execute(bundle, {
        runId: bundle.run.id,
        jobId: job.id,
        expectedRunVersion: bundle.run.aggregateVersion,
        expectedJobVersion: job.aggregateVersion,
        idempotencyKey: `malformed:${attempt}`,
      });
      bundle = result.bundle;
      expect(result.disposition).toBe(
        attempt < 3 ? "FAILED_RETRYABLE" : "FAILED_TERMINAL",
      );
    }

    expect(bundle.jobs[0]?.logicalJobKey).toBe(logicalJobKey);
    expect(bundle.jobs[0]?.attemptCount).toBe(3);
    expect(bundle.attempts).toHaveLength(3);
    expect(bundle.run.status).toBe("FAILED");
    expect(bundle.outputs).toHaveLength(0);
  });
});
