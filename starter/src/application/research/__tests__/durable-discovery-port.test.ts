import { describe, expect, it } from "vitest";
import {
  DurableResearchDiscoveryInputSchema,
  DurableResearchDiscoveryOutputSchema,
  parseDurableResearchDiscoveryOutputForInput,
  providerRunRecordFromAcceptedHandle,
} from "@/application/research/durable-discovery-port";
import { BLACK_HAWK_DOWN_CASE } from "@/fixtures/black-hawk-down/deterministic-spine.fixture";
import {
  BLACK_HAWK_DOWN_PUBLIC_SUBJECT_IDENTITY,
  BLACK_HAWK_DOWN_RESEARCH_BUNDLE,
  BLACK_HAWK_DOWN_RESEARCH_IDS,
  BLACK_HAWK_DOWN_RESEARCH_OBJECTIVE,
} from "@/fixtures/black-hawk-down/research-run.fixture";

const ATTEMPT_ID = "76000000-0000-4000-8000-000000000001";
const MANIFEST_FINGERPRINT = "a".repeat(64);

const input = DurableResearchDiscoveryInputSchema.parse({
  schemaVersion: 1,
  runId: BLACK_HAWK_DOWN_RESEARCH_IDS.run,
  jobId: BLACK_HAWK_DOWN_RESEARCH_IDS.jobs.DISCOVERY,
  attemptId: ATTEMPT_ID,
  caseId: BLACK_HAWK_DOWN_CASE.id,
  manifestFingerprint: MANIFEST_FINGERPRINT,
  externalIdempotencyKey: "b".repeat(64),
  subjectRef: BLACK_HAWK_DOWN_CASE.subjectRef,
  publicSubjectIdentity: BLACK_HAWK_DOWN_PUBLIC_SUBJECT_IDENTITY,
  exactQuestion: BLACK_HAWK_DOWN_RESEARCH_OBJECTIVE,
  axes: BLACK_HAWK_DOWN_RESEARCH_BUNDLE.plan.plan.axes,
  sourceClassIds: BLACK_HAWK_DOWN_RESEARCH_BUNDLE.plan.plan.sourceClassIds,
});

const firstAxis = input.axes[0];
if (firstAxis === undefined) throw new Error("Fixture requires one research axis");
const firstSourceClass = firstAxis.sourceClassIds[0];
if (firstSourceClass === undefined) {
  throw new Error("Fixture axis requires one source class");
}

function output(candidateOverrides: Record<string, unknown> = {}) {
  return {
    candidates: [
      {
        candidateKey: "sha256:candidate-1",
        title: "Unverified source candidate",
        canonicalUrl: "https://example.org/original-source",
        medium: "ARTICLE",
        sourceClass: firstSourceClass,
        axisIds: [firstAxis.axisId],
        accessState: "UNKNOWN",
        rightsState: "UNKNOWN",
        discoveryInputFingerprint: MANIFEST_FINGERPRINT,
        contentTrust: "UNTRUSTED",
        evidenceStatus: "NOT_EVIDENCE",
        reviewState: "PROPOSED",
        publicationAuthority: "NONE",
        ...candidateOverrides,
      },
    ],
    execution: {
      executionKind: "MODEL_TOOL",
      traceId: "trace-durable-discovery-1",
      providerRunId: "resp_durable_discovery_1",
      model: {
        provider: "openai",
        model: "gpt-test",
        snapshot: "gpt-test-2026-08-01",
      },
      prompt: {
        id: "durable-source-discovery",
        version: "1",
        templateFingerprint: "c".repeat(64),
      },
      schema: {
        id: "axis-tagged-source-candidates",
        version: "1",
        schemaFingerprint: "d".repeat(64),
      },
      tool: { id: "openai-web-search", version: "responses-v1" },
      telemetryState: "COMPLETE",
      usage: {
        inputTokens: 100,
        outputTokens: 20,
        toolCalls: 2,
        inputBytes: 1_000,
        outputBytes: 500,
      },
      cost: { currency: "USD", pricingState: "UNPRICED", amountMicros: null },
      latencyMs: 2_000,
      provenanceInputs: [
        { recordType: "JOB", recordId: input.jobId },
        { recordType: "ATTEMPT", recordId: input.attemptId },
      ],
      privateContentIncluded: true,
    },
  } as const;
}

describe("durable multi-axis discovery boundary", () => {
  it("binds one complete multi-axis request to the exact attempt manifest", () => {
    expect(input.axes).toEqual(BLACK_HAWK_DOWN_RESEARCH_BUNDLE.plan.plan.axes);
    expect(input.exactQuestion).toBe(BLACK_HAWK_DOWN_RESEARCH_OBJECTIVE);
    expect(input.manifestFingerprint).toBe(MANIFEST_FINGERPRINT);
    expect(
      DurableResearchDiscoveryInputSchema.safeParse({
        ...input,
        axes: [...input.axes, input.axes[0]],
      }).success,
    ).toBe(false);
    expect(
      DurableResearchDiscoveryInputSchema.safeParse({
        ...input,
        sourceClassIds: input.sourceClassIds.slice(1),
      }).success,
    ).toBe(false);
  });

  it("accepts only manifest-bound axis-tagged untrusted candidates", () => {
    const value = output();
    expect(DurableResearchDiscoveryOutputSchema.safeParse(value).success).toBe(
      true,
    );
    expect(parseDurableResearchDiscoveryOutputForInput(input, value)).toEqual(
      value,
    );
    expect(value.candidates[0]).toMatchObject({
      contentTrust: "UNTRUSTED",
      evidenceStatus: "NOT_EVIDENCE",
      reviewState: "PROPOSED",
      publicationAuthority: "NONE",
    });
  });

  it("rejects a candidate bound only to a stage seed or a wrong axis", () => {
    expect(() =>
      parseDurableResearchDiscoveryOutputForInput(
        input,
        output({ discoveryInputFingerprint: "e".repeat(64) }),
      ),
    ).toThrow(/exact manifest/);
    expect(() =>
      parseDurableResearchDiscoveryOutputForInput(
        input,
        output({ axisIds: ["not-a-pinned-axis"] }),
      ),
    ).toThrow(/exact manifest/);
  });

  it("rejects duplicate candidate identities and answer-shaped additions", () => {
    const candidate = output().candidates[0];
    expect(
      DurableResearchDiscoveryOutputSchema.safeParse({
        ...output(),
        candidates: [candidate, candidate],
      }).success,
    ).toBe(false);
    expect(
      DurableResearchDiscoveryOutputSchema.safeParse({
        ...output(),
        claims: [{ text: "This candidate proves the theory" }],
      }).success,
    ).toBe(false);
    expect(
      DurableResearchDiscoveryOutputSchema.safeParse({
        ...output(),
        sourceBody: "Hostile source instructions",
      }).success,
    ).toBe(false);
  });

  it("normalizes the full accepted provider handle into body-free recovery state", () => {
    const record = providerRunRecordFromAcceptedHandle(
      input,
      {
        providerResponseId: "resp_durable_discovery_1",
        state: "IN_PROGRESS",
        requestedModel: "gpt-test",
        providerModel: "gpt-test-2026-08-01",
        traceId: "trace-durable-discovery-1",
        binding: {
          runId: input.runId,
          jobId: input.jobId,
          attemptId: input.attemptId,
          caseId: input.caseId,
          manifestFingerprint: input.manifestFingerprint,
          externalIdempotencyKey: input.externalIdempotencyKey,
        },
        startedAt: "2026-08-22T20:00:00.000Z",
        lastObservedAt: "2026-08-22T20:00:01.000Z",
        inputBytes: 2_000,
        dataControlMode: "MODIFIED_ABUSE_MONITORING",
        projectIdFingerprint: "f".repeat(64),
        privateContentIncluded: true,
      },
      "2026-08-22T20:00:02.000Z",
    );

    expect(record).toMatchObject({
      providerResponseId: "resp_durable_discovery_1",
      traceId: "trace-durable-discovery-1",
      manifestFingerprint: input.manifestFingerprint,
      externalIdempotencyKey: input.externalIdempotencyKey,
      dataControlMode: "MODIFIED_ABUSE_MONITORING",
      publicationAuthority: "NONE",
    });
    expect(JSON.stringify(record)).not.toContain(input.exactQuestion);
  });

  it("rejects a provider handle from another attempt", () => {
    const baseHandle = {
      providerResponseId: "resp_durable_discovery_1",
      state: "QUEUED",
      requestedModel: "gpt-test",
      providerModel: "gpt-test",
      traceId: "trace-durable-discovery-1",
      binding: {
        runId: input.runId,
        jobId: input.jobId,
        attemptId: input.attemptId,
        caseId: input.caseId,
        manifestFingerprint: input.manifestFingerprint,
        externalIdempotencyKey: input.externalIdempotencyKey,
      },
      startedAt: "2026-08-22T20:00:00.000Z",
      lastObservedAt: "2026-08-22T20:00:01.000Z",
      inputBytes: 2_000,
      dataControlMode: "MODIFIED_ABUSE_MONITORING",
      projectIdFingerprint: "f".repeat(64),
      privateContentIncluded: true,
    } as const;
    expect(() =>
      providerRunRecordFromAcceptedHandle(
        input,
        {
          ...baseHandle,
          binding: {
            ...baseHandle.binding,
            attemptId: "76000000-0000-4000-8000-000000000099",
          },
        },
        "2026-08-22T20:00:02.000Z",
      ),
    ).toThrow(/exact discovery attempt/);
  });

  it.each(["COMPLETED", "FAILED", "INCOMPLETE", "CANCELLED"] as const)(
    "retains a synchronously terminal %s response for exact recovery",
    (state) => {
      const record = providerRunRecordFromAcceptedHandle(
        input,
        {
          providerResponseId: `resp_terminal_${state.toLowerCase()}`,
          state,
          requestedModel: "gpt-test",
          providerModel: "gpt-test",
          traceId: "trace-terminal-discovery-1",
          binding: {
            runId: input.runId,
            jobId: input.jobId,
            attemptId: input.attemptId,
            caseId: input.caseId,
            manifestFingerprint: input.manifestFingerprint,
            externalIdempotencyKey: input.externalIdempotencyKey,
          },
          startedAt: "2026-08-22T20:00:00.000Z",
          lastObservedAt: "2026-08-22T20:00:01.000Z",
          inputBytes: 2_000,
          dataControlMode: "MODIFIED_ABUSE_MONITORING",
          projectIdFingerprint: "f".repeat(64),
          privateContentIncluded: true,
        },
        "2026-08-22T20:00:02.000Z",
      );

      expect(record.state).toBe(state);
      expect(record.providerResponseId).toBe(
        `resp_terminal_${state.toLowerCase()}`,
      );
      expect(JSON.stringify(record)).not.toContain(input.exactQuestion);
    },
  );
});
