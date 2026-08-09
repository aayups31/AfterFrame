import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createStartResearchRunService } from "@/application/research/start-research-run";
import type { ResearchRunOutboxEvent } from "@/contracts/research-runs";
import type { InvestigationSpecialistRegistry } from "@/core/ports/investigation-specialist";
import type {
  CommitResearchRunStartInput,
  ResearchContextReader,
  ResearchRunFingerprintPort,
  ResearchRunStartStore,
  StoredResearchRunStart,
} from "@/core/research-runs/ports";
import {
  BLACK_HAWK_DOWN_CASE,
  BLACK_HAWK_DOWN_ROOT_BRANCH,
} from "@/fixtures/black-hawk-down/deterministic-spine.fixture";
import {
  BLACK_HAWK_DOWN_RESEARCH_COMMAND,
  BLACK_HAWK_DOWN_RESEARCH_OBJECTIVE,
} from "@/fixtures/black-hawk-down/research-run.fixture";
import { afterFrameV1SpecialistRegistry } from "@/specialists/registry";

const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");

const fingerprints: ResearchRunFingerprintPort = {
  fingerprintStartRequest: (actorId, input) =>
    hash(`${actorId}:${JSON.stringify(input)}`),
  fingerprintObjective: hash,
  fingerprintPlan: (plan) => hash(JSON.stringify(plan)),
  fingerprintStageInput: (input) => hash(JSON.stringify(input)),
  fingerprintAttemptRequest: (runId, jobId, key) =>
    hash(`${runId}:${jobId}:${key}`),
  fingerprintExecutionOutput: (output) => hash(JSON.stringify(output)),
};

class StartStore implements ResearchRunStartStore<ResearchRunOutboxEvent> {
  result: StoredResearchRunStart<ResearchRunOutboxEvent> | null = null;
  requestFingerprint: string | null = null;
  commitCount = 0;

  async reserveResearchRunStart() {
    if (this.result !== null && this.requestFingerprint !== null) {
      return {
        status: "REPLAY" as const,
        requestFingerprint: this.requestFingerprint,
        result: this.result,
      };
    }
    return { status: "ACQUIRED" as const, reservationToken: "lease-1" };
  }

  async releaseResearchRunStart() {}

  async commitResearchRunStart(
    input: CommitResearchRunStartInput<ResearchRunOutboxEvent>,
  ) {
    this.result = input.result;
    this.requestFingerprint = input.requestFingerprint;
    this.commitCount += 1;
    return { replayed: false, result: input.result };
  }
}

function identifiers() {
  let next = 100;
  return () =>
    `33000000-0000-4000-8000-${String(next++).padStart(12, "0")}`;
}

describe("start research run", () => {
  it("uses the injected specialist and atomically stages a replayable private-safe run", async () => {
    const context: ResearchContextReader = {
      async getCase() {
        return BLACK_HAWK_DOWN_CASE;
      },
      async getBranch() {
        return BLACK_HAWK_DOWN_ROOT_BRANCH;
      },
    };
    const resolved = afterFrameV1SpecialistRegistry.resolve(
      BLACK_HAWK_DOWN_CASE.specialistId,
      BLACK_HAWK_DOWN_CASE.specialistVersion,
    );
    if (resolved === null) throw new Error("Movie specialist is required");
    const questions: string[] = [];
    const specialists: InvestigationSpecialistRegistry = {
      resolve() {
        return {
          manifest: resolved.manifest,
          prepareResearch(reference, question) {
            questions.push(question);
            return resolved.prepareResearch(reference, question);
          },
        };
      },
    };
    const store = new StartStore();
    const start = createStartResearchRunService({
      context,
      store,
      specialists,
      fingerprints,
      createId: identifiers(),
      now: () => "2026-08-08T17:00:00.000Z",
    });

    const first = await start(
      BLACK_HAWK_DOWN_CASE.ownerId,
      BLACK_HAWK_DOWN_RESEARCH_COMMAND,
    );
    const replay = await start(
      BLACK_HAWK_DOWN_CASE.ownerId,
      BLACK_HAWK_DOWN_RESEARCH_COMMAND,
    );

    expect(questions).toEqual([BLACK_HAWK_DOWN_RESEARCH_OBJECTIVE]);
    expect(first.bundle.jobs).toHaveLength(7);
    expect(first.bundle.jobs.every(({ status }) => status === "QUEUED")).toBe(
      true,
    );
    expect(first.bundle.plan.specialistId).toBe("movie-investigator");
    expect(first.bundle.run.publicationAuthority).toBe("NONE");
    expect(first.outboxEvents).toHaveLength(2);
    expect(JSON.stringify(first.outboxEvents)).not.toContain(
      BLACK_HAWK_DOWN_CASE.exactCuriosity,
    );
    expect(JSON.stringify(first.outboxEvents)).not.toContain(
      BLACK_HAWK_DOWN_ROOT_BRANCH.normalizedObjective,
    );
    expect(replay.replayed).toBe(true);
    expect(replay.bundle).toEqual(first.bundle);
    expect(store.commitCount).toBe(1);
  });
});
