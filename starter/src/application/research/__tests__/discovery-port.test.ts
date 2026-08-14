import { describe, expect, it } from "vitest";
import {
  parseResearchDiscoveryOutputForInput,
  ResearchDiscoveryInputSchema,
  ResearchDiscoveryOutputSchema,
} from "@/application/research/discovery-port";
import {
  BLACK_HAWK_DOWN_DISCOVERY_INPUT,
  BLACK_HAWK_DOWN_RESEARCH_IDS,
} from "@/fixtures/black-hawk-down/research-run.fixture";

describe("research discovery boundary", () => {
  it("preserves the exact question while requiring resolver-verified public identity", () => {
    const exactQuestion = "  Why did this operation fail so completely?  ";
    const parsed = ResearchDiscoveryInputSchema.parse({
      ...BLACK_HAWK_DOWN_DISCOVERY_INPUT,
      exactQuestion,
    });
    expect(parsed.exactQuestion).toBe(exactQuestion);
    expect(
      ResearchDiscoveryInputSchema.safeParse({
        ...BLACK_HAWK_DOWN_DISCOVERY_INPUT,
        publicSubjectIdentity: {
          ...BLACK_HAWK_DOWN_DISCOVERY_INPUT.publicSubjectIdentity,
          verificationState: "MODEL_ASSERTED",
        },
      }).success,
    ).toBe(false);
    expect(
      ResearchDiscoveryInputSchema.safeParse({
        ...BLACK_HAWK_DOWN_DISCOVERY_INPUT,
        exactQuestion: "   ",
      }).success,
    ).toBe(false);
    expect(
      ResearchDiscoveryInputSchema.safeParse({
        ...BLACK_HAWK_DOWN_DISCOVERY_INPUT,
        stageInputFingerprint: "derived-from-full-private-input",
      }).success,
    ).toBe(false);
  });

  it("accepts only unverified candidates plus body-free model/tool metadata", () => {
    const output = {
      candidates: [
        {
          candidateKey: "provider:candidate:1",
          title: "Candidate title supplied as untrusted metadata",
          canonicalUrl: "https://example.org/source",
          medium: "ARTICLE",
          sourceClass:
            BLACK_HAWK_DOWN_DISCOVERY_INPUT.axis.sourceClassIds[0],
          accessState: "UNKNOWN",
          rightsState: "UNKNOWN",
          discoveryInputFingerprint: "6".repeat(64),
          contentTrust: "UNTRUSTED",
          evidenceStatus: "NOT_EVIDENCE",
          reviewState: "PROPOSED",
          publicationAuthority: "NONE",
        },
      ],
      execution: {
        executionKind: "MODEL_TOOL",
        traceId: BLACK_HAWK_DOWN_RESEARCH_IDS.trace,
        providerRunId: "response_fixture",
        model: {
          provider: "openai",
          model: "gpt-test",
          snapshot: "2026-08-01",
        },
        prompt: {
          id: "source-discovery",
          version: "1",
          templateFingerprint: "a".repeat(64),
        },
        schema: {
          id: "source-candidate-proposals",
          version: "1",
          schemaFingerprint: "b".repeat(64),
        },
        tool: { id: "web-search", version: "1" },
        telemetryState: "COMPLETE",
        usage: {
          inputTokens: 10,
          outputTokens: 20,
          toolCalls: 1,
          inputBytes: 100,
          outputBytes: 200,
        },
        cost: {
          currency: "USD",
          pricingState: "UNPRICED",
          amountMicros: null,
        },
        latencyMs: 250,
        provenanceInputs: [
          { recordType: "RUN", recordId: BLACK_HAWK_DOWN_RESEARCH_IDS.run },
          {
            recordType: "JOB",
            recordId: BLACK_HAWK_DOWN_RESEARCH_IDS.jobs.DISCOVERY,
          },
        ],
        privateContentIncluded: true,
      },
    } as const;
    expect(ResearchDiscoveryOutputSchema.safeParse(output).success).toBe(true);
    expect(
      parseResearchDiscoveryOutputForInput(
        BLACK_HAWK_DOWN_DISCOVERY_INPUT,
        output,
      ),
    ).toEqual(output);
    expect(
      () =>
        parseResearchDiscoveryOutputForInput(
          BLACK_HAWK_DOWN_DISCOVERY_INPUT,
          {
            ...output,
            candidates: output.candidates.map((candidate) => ({
              ...candidate,
              discoveryInputFingerprint: "d".repeat(64),
            })),
          },
        ),
    ).toThrow(/stageInputFingerprint/);
    expect(output.execution.privateContentIncluded).toBe(true);
    expect(JSON.stringify(output)).not.toContain(
      BLACK_HAWK_DOWN_DISCOVERY_INPUT.exactQuestion,
    );
    expect(
      ResearchDiscoveryOutputSchema.safeParse({
        ...output,
        claims: [{ text: "This candidate proves the theory" }],
      }).success,
    ).toBe(false);
    expect(
      ResearchDiscoveryOutputSchema.safeParse({
        ...output,
        sourceBody: "hostile private source text",
      }).success,
    ).toBe(false);
    expect(
      ResearchDiscoveryOutputSchema.safeParse({
        ...output,
        execution: {
          ...output.execution,
          telemetryState: "PARTIAL",
          usage: null,
          cost: null,
        },
      }).success,
    ).toBe(false);
  });
});
