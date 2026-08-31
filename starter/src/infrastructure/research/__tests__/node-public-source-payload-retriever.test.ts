import { EventEmitter } from "node:events";
import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { SourceRetrievalGrant } from "@/application/research/source-retrieval-port";
import type {
  SourceDnsAnswer,
  SourceDnsResolver,
} from "@/infrastructure/research/node-public-source-metadata-probe";
import {
  NodePinnedSourceGetRequester,
  NodePublicSourcePayloadRetriever,
  type PinnedSourceGetRequester,
  type SourcePayloadGetResult,
} from "@/infrastructure/research/node-public-source-payload-retriever";

const PUBLIC_V4 = { address: "93.184.216.34", family: 4 as const };
const PUBLIC_V6 = {
  address: "2606:2800:220:1:248:1893:25c8:1946",
  family: 6 as const,
};
const CAPTURED_AT = "2026-08-30T18:30:00.000Z";

function grant(overrides: Partial<SourceRetrievalGrant> = {}): SourceRetrievalGrant {
  return {
    status: "GRANTED",
    retention: "TRANSIENT_ONLY",
    requestedUrl: "https://example.com/report",
    allowedMediaTypes: ["text/html", "text/plain"],
    maxWireBytes: 1_000,
    maxDecodedBytes: 2_000,
    contentEncodingPolicy: "IDENTITY_ONLY",
    accessControlPolicy: "NO_CIRCUMVENTION",
    instructionAuthority: "NONE",
    publicationAuthority: "NONE",
    ...overrides,
  };
}

function dnsReturning(...sets: readonly (readonly SourceDnsAnswer[])[]) {
  let index = 0;
  return {
    resolve: vi.fn().mockImplementation(async () => sets[index++] ?? sets.at(-1) ?? []),
  } satisfies SourceDnsResolver;
}

function getResult(
  overrides: Partial<SourcePayloadGetResult> = {},
): SourcePayloadGetResult {
  return {
    statusCode: 200,
    location: null,
    declaredMediaType: "text/html",
    contentEncoding: null,
    body: new TextEncoder().encode("<!doctype html><p>Research</p>"),
    capturedAt: CAPTURED_AT,
    ...overrides,
  };
}

function requesterReturning(...responses: readonly SourcePayloadGetResult[]) {
  let index = 0;
  return {
    get: vi.fn().mockImplementation(async () => responses[index++] ?? responses.at(-1)),
  } satisfies PinnedSourceGetRequester;
}

describe("NodePublicSourcePayloadRetriever", () => {
  it("fails closed without DNS or HTTP when its kill switch is off", async () => {
    const dns = dnsReturning([PUBLIC_V4]);
    const requester = requesterReturning(getResult());
    const retriever = new NodePublicSourcePayloadRetriever({
      enabled: false,
      dns,
      requester,
    });

    await expect(
      retriever.retrieve({ grant: grant() }, new AbortController().signal),
    ).rejects.toMatchObject({ code: "retrieval-disabled" });
    expect(dns.resolve).not.toHaveBeenCalled();
    expect(requester.get).not.toHaveBeenCalled();
  });

  it("revalidates and pins each redirect, then returns hostile bytes with body-free metadata", async () => {
    const body = new TextEncoder().encode("<!doctype html><p>Research</p>");
    const dns = dnsReturning([PUBLIC_V4], [PUBLIC_V6]);
    const requester = requesterReturning(
      getResult({
        statusCode: 302,
        location: "https://archive.example/final?utm_source=x",
        body: new Uint8Array(),
      }),
      getResult({ body }),
    );
    const retriever = new NodePublicSourcePayloadRetriever({
      enabled: true,
      dns,
      requester,
    });

    const result = await retriever.retrieve(
      { grant: grant() },
      new AbortController().signal,
    );
    expect(result.body).toEqual(body);
    expect(result.metadata).toEqual({
      requestedUrl: "https://example.com/report",
      finalUrl: "https://archive.example/final",
      redirectChainFingerprint: createHash("sha256")
        .update(
          JSON.stringify([
            "https://example.com/report",
            "https://archive.example/final",
          ]),
          "utf8",
        )
        .digest("hex"),
      declaredMediaType: "text/html",
      contentEncoding: null,
      wireContentLength: body.byteLength,
      capturedAt: CAPTURED_AT,
    });
    expect(dns.resolve).toHaveBeenNthCalledWith(1, "example.com", expect.any(AbortSignal));
    expect(dns.resolve).toHaveBeenNthCalledWith(2, "archive.example", expect.any(AbortSignal));
    expect(requester.get).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ address: PUBLIC_V4.address, family: 4 }),
    );
    expect(requester.get).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ address: PUBLIC_V6.address, family: 6 }),
    );
  });

  it("rejects private DNS on a later redirect before a second request", async () => {
    const requester = requesterReturning(
      getResult({
        statusCode: 301,
        location: "https://rebound.example/secrets",
        body: new Uint8Array(),
      }),
    );
    const retriever = new NodePublicSourcePayloadRetriever({
      enabled: true,
      dns: dnsReturning(
        [PUBLIC_V4],
        [{ address: "169.254.169.254", family: 4 }],
      ),
      requester,
    });

    await expect(
      retriever.retrieve({ grant: grant() }, new AbortController().signal),
    ).rejects.toMatchObject({ code: "retrieval-network-rejected" });
    expect(requester.get).toHaveBeenCalledTimes(1);
  });

  it.each([
    { location: null },
    { location: "http://127.0.0.1/secrets" },
    { location: "http://example.com/downgrade" },
    { location: "https://example.com:8443/custom-port" },
  ])("rejects missing, unsafe, downgraded, or custom-port redirects", async ({ location }) => {
    const retriever = new NodePublicSourcePayloadRetriever({
      enabled: true,
      dns: dnsReturning([PUBLIC_V4]),
      requester: requesterReturning(
        getResult({ statusCode: 302, location, body: new Uint8Array() }),
      ),
    });

    await expect(
      retriever.retrieve({ grant: grant() }, new AbortController().signal),
    ).rejects.toMatchObject({ code: "retrieval-redirect-invalid" });
  });

  it.each([
    { statusCode: 401, code: "retrieval-access-changed" },
    { statusCode: 403, code: "retrieval-access-changed" },
    { statusCode: 206, code: "retrieval-upstream-unavailable" },
    { statusCode: 500, code: "retrieval-upstream-unavailable" },
  ])("maps terminal HTTP states to bounded failures", async ({ statusCode, code }) => {
    const retriever = new NodePublicSourcePayloadRetriever({
      enabled: true,
      dns: dnsReturning([PUBLIC_V4]),
      requester: requesterReturning(getResult({ statusCode })),
    });

    await expect(
      retriever.retrieve({ grant: grant() }, new AbortController().signal),
    ).rejects.toMatchObject({ code });
  });

  it("propagates cancellation while DNS is pending", async () => {
    const controller = new AbortController();
    const dns = {
      resolve: vi.fn().mockImplementation(() => new Promise(() => undefined)),
    } satisfies SourceDnsResolver;
    const retriever = new NodePublicSourcePayloadRetriever({
      enabled: true,
      dns,
      requester: requesterReturning(getResult()),
    });
    const pending = retriever.retrieve({ grant: grant() }, controller.signal);
    controller.abort();

    await expect(pending).rejects.toMatchObject({ code: "retrieval-aborted" });
  });
});

describe("NodePinnedSourceGetRequester", () => {
  function fakeExchange(headers: Record<string, string>, chunks: readonly Uint8Array[]) {
    const response = Object.assign(new EventEmitter(), {
      statusCode: 200,
      headers,
      destroy: vi.fn(),
    });
    const request = Object.assign(new EventEmitter(), {
      end: vi.fn(() => {
        queueMicrotask(() => {
          for (const chunk of chunks) response.emit("data", chunk);
          response.emit("end");
        });
      }),
      destroy: vi.fn(),
    });
    let options: Record<string, unknown> | undefined;
    const httpsRequest = vi.fn().mockImplementation(
      (_url: URL, value: Record<string, unknown>, callback: (response: unknown) => void) => {
        options = value;
        callback(response);
        return request;
      },
    );
    return { response, request, httpsRequest, getOptions: () => options };
  }

  it("uses an identity-encoded, DNS-pinned, bounded TLS GET and streams bytes", async () => {
    const first = new TextEncoder().encode("<!doctype html>");
    const second = new TextEncoder().encode("<p>Research</p>");
    const exchange = fakeExchange(
      { "content-type": "text/html", "content-length": String(first.length + second.length) },
      [first, second],
    );
    const requester = new NodePinnedSourceGetRequester({
      httpsRequest: exchange.httpsRequest as never,
      now: () => new Date(CAPTURED_AT),
    });

    const result = await requester.get({
      url: "https://example.com/report",
      address: PUBLIC_V4.address,
      family: 4,
      allowedMediaTypes: ["text/html", "text/plain"],
      maxWireBytes: 1_000,
      maxHeaderBytes: 16_384,
      timeoutMs: 15_000,
      signal: new AbortController().signal,
    });

    expect(new TextDecoder().decode(result.body)).toBe(
      "<!doctype html><p>Research</p>",
    );
    expect(exchange.getOptions()).toMatchObject({
      method: "GET",
      agent: false,
      family: 4,
      maxHeaderSize: 16_384,
      insecureHTTPParser: false,
      servername: "example.com",
      rejectUnauthorized: true,
      minVersion: "TLSv1.2",
      headers: {
        accept: "text/html, text/plain",
        "accept-encoding": "identity",
        "user-agent": "AfterFrame-Source-Retriever/1.0",
      },
    });
    const lookup = exchange.getOptions()?.lookup as (
      hostname: string,
      options: object,
      callback: (error: null, address: string, family: number) => void,
    ) => void;
    const callback = vi.fn();
    lookup("rebind.example", {}, callback);
    expect(callback).toHaveBeenCalledWith(null, PUBLIC_V4.address, 4);
  });

  it("rejects declared oversize before consuming any body", async () => {
    const exchange = fakeExchange(
      { "content-type": "text/html", "content-length": "1001" },
      [new Uint8Array(1_001)],
    );
    const requester = new NodePinnedSourceGetRequester({
      httpsRequest: exchange.httpsRequest as never,
    });

    await expect(
      requester.get({
        url: "https://example.com/report",
        address: PUBLIC_V4.address,
        family: 4,
        allowedMediaTypes: ["text/html"],
        maxWireBytes: 1_000,
        maxHeaderBytes: 16_384,
        timeoutMs: 15_000,
        signal: new AbortController().signal,
      }),
    ).rejects.toMatchObject({ code: "retrieval-size-exceeded" });
    expect(exchange.response.destroy).toHaveBeenCalledOnce();
  });

  it("terminates a chunked response immediately when its byte budget is crossed", async () => {
    const exchange = fakeExchange(
      { "content-type": "text/plain" },
      [new Uint8Array(600), new Uint8Array(500)],
    );
    const requester = new NodePinnedSourceGetRequester({
      httpsRequest: exchange.httpsRequest as never,
    });

    await expect(
      requester.get({
        url: "https://example.com/report",
        address: PUBLIC_V4.address,
        family: 4,
        allowedMediaTypes: ["text/plain"],
        maxWireBytes: 1_000,
        maxHeaderBytes: 16_384,
        timeoutMs: 15_000,
        signal: new AbortController().signal,
      }),
    ).rejects.toMatchObject({ code: "retrieval-size-exceeded" });
    expect(exchange.response.destroy).toHaveBeenCalledOnce();
  });

  it.each(["gzip", "br"])("rejects encoded bodies before data collection: %s", async (encoding) => {
    const exchange = fakeExchange(
      { "content-type": "text/html", "content-encoding": encoding },
      [new Uint8Array(100)],
    );
    const requester = new NodePinnedSourceGetRequester({
      httpsRequest: exchange.httpsRequest as never,
    });

    await expect(
      requester.get({
        url: "https://example.com/report",
        address: PUBLIC_V4.address,
        family: 4,
        allowedMediaTypes: ["text/html"],
        maxWireBytes: 1_000,
        maxHeaderBytes: 16_384,
        timeoutMs: 15_000,
        signal: new AbortController().signal,
      }),
    ).rejects.toMatchObject({ code: "retrieval-content-encoding-rejected" });
  });
});
