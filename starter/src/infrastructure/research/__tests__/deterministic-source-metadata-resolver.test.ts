import { describe, expect, it, vi } from "vitest";
import type {
  SourceMetadataProbeTransport,
  SourceResolutionInput,
} from "@/application/research/source-resolution-port";
import { DeterministicSourceMetadataResolver } from "@/infrastructure/research/deterministic-source-metadata-resolver";
import { createNodePublicSourceMetadataResolver } from "@/infrastructure/research/node-public-source-metadata-probe";

const ZERO_HASH = "0".repeat(64);

function resolutionInput(
  overrides: Partial<SourceResolutionInput["candidate"]> = {},
): SourceResolutionInput {
  return {
    schemaVersion: 1,
    runId: "00000000-0000-4000-8000-000000000001",
    jobId: "00000000-0000-4000-8000-000000000002",
    attemptId: "00000000-0000-4000-8000-000000000003",
    caseId: "00000000-0000-4000-8000-000000000004",
    manifestFingerprint: ZERO_HASH,
    candidate: {
      schemaVersion: 1,
      id: "00000000-0000-4000-8000-000000000005",
      runId: "00000000-0000-4000-8000-000000000001",
      jobId: "00000000-0000-4000-8000-000000000002",
      attemptId: "00000000-0000-4000-8000-000000000003",
      candidateKey: "candidate:example",
      title: "Candidate title",
      canonicalUrl: "https://example.com/article?utm_source=discovery",
      medium: "ARTICLE",
      sourceClass: "editorial-analysis",
      axisIds: ["production-history"],
      accessState: "UNKNOWN",
      rightsState: "UNKNOWN",
      discoveryInputFingerprint: ZERO_HASH,
      contentTrust: "UNTRUSTED",
      evidenceStatus: "NOT_EVIDENCE",
      reviewState: "PROPOSED",
      publicationAuthority: "NONE",
      createdAt: "2026-08-22T10:00:00.000Z",
      ...overrides,
    },
  };
}

function publicProbe(overrides: Record<string, unknown> = {}) {
  return {
    requestedUrl: "https://example.com/article",
    hops: [
      {
        url: "https://example.com/article",
        statusCode: 200,
        resolvedAddresses: ["93.184.216.34"],
        contentType: "text/html; charset=utf-8",
        contentLength: 3_210,
        title: "  An\u0000 elite   analysis  ",
        observedAt: "2026-08-22T10:01:00.000Z",
      },
    ],
    bodyIncluded: false,
    ...overrides,
  };
}

function transportReturning(value: unknown) {
  return {
    probe: vi.fn().mockResolvedValue(value),
  } satisfies SourceMetadataProbeTransport;
}

describe("deterministic source metadata resolver", () => {
  it("creates only a conservative source identity and source-level locator", async () => {
    const transport = transportReturning(publicProbe());
    const resolver = new DeterministicSourceMetadataResolver(transport);

    const first = await resolver.resolve(resolutionInput(), new AbortController().signal);
    const second = await resolver.resolve(resolutionInput(), new AbortController().signal);

    expect(first).toEqual(second);
    expect(transport.probe).toHaveBeenCalledWith("https://example.com/article", {
      maxRedirects: 5,
      signal: expect.any(AbortSignal),
    });
    expect(first).toMatchObject({
      status: "RESOLVED",
      proposal: {
        candidateId: "00000000-0000-4000-8000-000000000005",
        source: {
          canonicalUrl: "https://example.com/article",
          title: "An elite analysis",
          contributors: [],
          publisher: null,
          publishedAt: null,
          accessState: "OPEN",
          rightsState: "LINK_ONLY",
        },
        locator: {
          kind: "ARTICLE",
          status: "SOURCE_ONLY",
          headingPath: [],
          paragraphIndex: null,
          lastVerifiedAt: null,
        },
        reviewState: "PROPOSED",
        metadataTrust: "UNTRUSTED_SOURCE_DATA",
        evidenceStatus: "NOT_EVIDENCE",
        publicationAuthority: "NONE",
        contentBodyIncluded: false,
      },
    });
  });

  it("gives the same canonical source identity to later attempts", async () => {
    const resolver = new DeterministicSourceMetadataResolver(
      transportReturning(publicProbe()),
    );
    const first = await resolver.resolve(
      resolutionInput(),
      new AbortController().signal,
    );
    const later = resolutionInput({
      id: "00000000-0000-4000-8000-000000000006",
      attemptId: "00000000-0000-4000-8000-000000000007",
    });
    later.attemptId = "00000000-0000-4000-8000-000000000007";
    const second = await resolver.resolve(later, new AbortController().signal);

    expect(first.status).toBe("RESOLVED");
    expect(second.status).toBe("RESOLVED");
    if (first.status === "RESOLVED" && second.status === "RESOLVED") {
      expect(first.proposal.source.id).toBe(second.proposal.source.id);
      expect(first.proposal.locator.id).toBe(second.proposal.locator.id);
    }
  });

  it("does not contact the transport for a blocked candidate target", async () => {
    const transport = transportReturning(publicProbe());
    const resolver = new DeterministicSourceMetadataResolver(transport);

    const result = await resolver.resolve(
      resolutionInput({ canonicalUrl: "http://127.0.0.1/admin" }),
      new AbortController().signal,
    );

    expect(result).toMatchObject({
      status: "UNRESOLVED",
      code: "network-target-rejected",
      publicationAuthority: "NONE",
    });
    expect(transport.probe).not.toHaveBeenCalled();
  });

  it("degrades deterministically without network work when production probing is disabled", async () => {
    const resolver = createNodePublicSourceMetadataResolver({ enabled: false });

    await expect(
      resolver.resolve(resolutionInput(), new AbortController().signal),
    ).resolves.toMatchObject({
      status: "UNRESOLVED",
      code: "probe-unavailable",
      publicationAuthority: "NONE",
    });
  });

  it("rejects a transport contract that contains source body data", async () => {
    const resolver = new DeterministicSourceMetadataResolver(
      transportReturning(publicProbe({ body: "hostile instructions" })),
    );

    await expect(
      resolver.resolve(resolutionInput(), new AbortController().signal),
    ).resolves.toMatchObject({
      status: "UNRESOLVED",
      code: "probe-contract-invalid",
    });
  });

  it("rejects redirect chains that do not begin at the admitted request", async () => {
    const probe = publicProbe();
    probe.hops[0] = {
      ...probe.hops[0],
      url: "https://other.example/article",
    };
    const resolver = new DeterministicSourceMetadataResolver(
      transportReturning(probe),
    );

    await expect(
      resolver.resolve(resolutionInput(), new AbortController().signal),
    ).resolves.toMatchObject({
      status: "UNRESOLVED",
      code: "redirect-chain-invalid",
    });
  });

  it("rejects a redirect whose DNS result crosses into a private network", async () => {
    const probe = publicProbe({
      hops: [
        {
          ...publicProbe().hops[0],
          statusCode: 302,
        },
        {
          ...publicProbe().hops[0],
          url: "https://redirect.example/article",
          resolvedAddresses: ["10.0.0.8"],
        },
      ],
    });
    const resolver = new DeterministicSourceMetadataResolver(
      transportReturning(probe),
    );

    await expect(
      resolver.resolve(resolutionInput(), new AbortController().signal),
    ).resolves.toMatchObject({
      status: "UNRESOLVED",
      code: "network-target-rejected",
    });
  });

  it("keeps unsupported media as unresolved candidates", async () => {
    const resolver = new DeterministicSourceMetadataResolver(
      transportReturning(publicProbe()),
    );

    await expect(
      resolver.resolve(
        resolutionInput({ medium: "OTHER" }),
        new AbortController().signal,
      ),
    ).resolves.toMatchObject({
      status: "UNRESOLVED",
      code: "source-medium-unsupported",
      publicationAuthority: "NONE",
    });
  });
});
