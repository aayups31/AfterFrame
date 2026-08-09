import { describe, expect, it, vi } from "vitest";
import {
  OpenAIResearchDiscoveryError,
  OpenAIShadowResearchDiscoveryAdapter,
} from "@/infrastructure/research/openai-shadow-discovery";
import {
  ResearchDiscoveryInputSchema,
  ResearchDiscoveryOutputSchema,
} from "@/application/research/discovery-port";

const input = ResearchDiscoveryInputSchema.parse({
  runId: "30000000-0000-4000-8000-000000000001",
  jobId: "30000000-0000-4000-8000-000000000002",
  caseId: "30000000-0000-4000-8000-000000000003",
  stageInputFingerprint: "c".repeat(64),
  subjectRef: { type: "film", id: "tmdb:movie:278", versionId: null },
  publicSubjectIdentity: {
    displayName: "The Shawshank Redemption",
    alternateNames: [],
    disambiguators: [
      { label: "release-date", value: "1994-09-23" },
      { label: "original-language", value: "en" },
    ],
    identityFingerprint: "b".repeat(64),
    dataClass: "PUBLIC",
    verificationState: "RESOLVER_VERIFIED",
    resolver: { id: "tmdb-movie-details", version: "v3" },
    resolvedAt: "2026-08-09T12:00:00.000Z",
  },
  exactQuestion: "How did the adaptation reshape the ending?",
  axis: {
    axisId: "adaptation-source",
    objective: "Compare the finished film with its source and screenplay history.",
    sourceClassIds: ["books", "articles-trades", "video-podcasts"],
  },
});

function completedResponse() {
  return {
    id: "resp_afterframe_1",
    model: "gpt-5.6-sol-2026-07-01",
    status: "completed",
    error: null,
    output_text:
      "This generated report is deliberately discarded and must never become the investigation.",
    output_parsed: {
      candidates: [
        {
          url: "https://example.com/interview?utm_source=search#answer",
          title: "Model-proposed title",
          sourceClass: "articles-trades",
        },
        {
          url: "https://hallucinated.example/not-in-search",
          title: "Hallucinated URL",
          sourceClass: "books",
        },
        {
          url: "https://example.com/wrong-policy",
          title: "Wrong policy class",
          sourceClass: "community",
        },
      ],
    },
    output: [
      {
        type: "web_search_call",
        id: "search_1",
        status: "completed",
        action: {
          type: "search",
          sources: [
            {
              type: "url",
              url: "https://example.com/interview?utm_source=search",
            },
            { type: "url", url: "https://example.com/wrong-policy" },
          ],
        },
      },
      {
        type: "message",
        content: [
          {
            type: "output_text",
            text: "discarded",
            annotations: [
              {
                type: "url_citation",
                url: "https://example.com/interview?utm_source=search",
                title: "Resolved citation title",
                start_index: 0,
                end_index: 9,
              },
            ],
          },
        ],
      },
    ],
    usage: { input_tokens: 1_200, output_tokens: 250, total_tokens: 1_450 },
  };
}

describe("OpenAI shadow research discovery", () => {
  it("returns only search-backed candidates and discards generated prose", async () => {
    const parseResponse = vi.fn(async () => completedResponse());
    const adapter = new OpenAIShadowResearchDiscoveryAdapter({
      model: "gpt-5.6-sol",
      parseResponse,
      now: () => new Date("2026-08-09T12:00:01.000Z"),
      createTraceId: () => "30000000-0000-4000-8000-000000000004",
    });

    const raw = await adapter.discover(input);
    const output = ResearchDiscoveryOutputSchema.parse(raw);

    expect(output.candidates).toHaveLength(1);
    expect(output.candidates[0]).toMatchObject({
      title: "Resolved citation title",
      canonicalUrl: "https://example.com/interview",
      sourceClass: "articles-trades",
      accessState: "UNKNOWN",
      rightsState: "UNKNOWN",
      contentTrust: "UNTRUSTED",
      evidenceStatus: "NOT_EVIDENCE",
      reviewState: "PROPOSED",
      publicationAuthority: "NONE",
      discoveryInputFingerprint: input.stageInputFingerprint,
    });
    expect(JSON.stringify(output)).not.toContain("generated report");
    expect(JSON.stringify(output)).not.toContain(input.exactQuestion);
    expect(output.execution).toMatchObject({
      executionKind: "MODEL_TOOL",
      providerRunId: "resp_afterframe_1",
      model: {
        provider: "openai",
        model: "gpt-5.6-sol",
        snapshot: "gpt-5.6-sol-2026-07-01",
      },
      usage: { inputTokens: 1_200, outputTokens: 250, toolCalls: 1 },
      cost: { pricingState: "UNPRICED", amountMicros: null },
      privateContentIncluded: true,
    });

    expect(parseResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "gpt-5.6-sol",
        background: false,
        store: false,
        tools: [{ type: "web_search", search_context_size: "high" }],
        include: ["web_search_call.action.sources"],
        metadata: { run_id: input.runId, job_id: input.jobId },
      }),
    );
  });

  it("rejects a completed response whose structured output is malformed", async () => {
    const response = completedResponse();
    response.output_parsed = {
      candidates: [
        { url: "javascript:alert(1)", title: "Unsafe", sourceClass: "books" },
      ],
    };
    const adapter = new OpenAIShadowResearchDiscoveryAdapter({
      model: "gpt-5.6-sol",
      parseResponse: vi.fn(async () => response),
    });

    await expect(adapter.discover(input)).rejects.toMatchObject({
      code: "INVALID_PROVIDER_RESPONSE",
    });
  });

  it("sanitizes provider failure content", async () => {
    const adapter = new OpenAIShadowResearchDiscoveryAdapter({
      model: "gpt-5.6-sol",
      parseResponse: vi.fn(async () => {
        throw new Error(`failed while processing: ${input.exactQuestion}`);
      }),
    });

    const rejection = adapter.discover(input);
    await expect(rejection).rejects.toBeInstanceOf(
      OpenAIResearchDiscoveryError,
    );
    await expect(rejection).rejects.not.toThrow(input.exactQuestion);
  });

  it("does not treat queued or incomplete provider work as discovered sources", async () => {
    const response = completedResponse();
    response.status = "incomplete";
    const adapter = new OpenAIShadowResearchDiscoveryAdapter({
      model: "gpt-5.6-sol",
      parseResponse: vi.fn(async () => response),
    });

    await expect(adapter.discover(input)).rejects.toMatchObject({
      code: "PROVIDER_INCOMPLETE",
    });
  });
});
