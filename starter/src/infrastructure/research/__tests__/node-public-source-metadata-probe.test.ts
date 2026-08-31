import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import {
  NodePinnedSourceHeadRequester,
  NodePublicSourceMetadataProbe,
  SourceMetadataProbeError,
  type PinnedSourceHeadRequester,
  type SourceDnsAnswer,
  type SourceDnsResolver,
} from "@/infrastructure/research/node-public-source-metadata-probe";

const PUBLIC_V4 = { address: "93.184.216.34", family: 4 as const };
const PUBLIC_V6 = {
  address: "2606:2800:220:1:248:1893:25c8:1946",
  family: 6 as const,
};
const OBSERVED_AT = "2026-08-30T12:00:00.000Z";

function dnsReturning(...answers: readonly (readonly SourceDnsAnswer[])[]) {
  let index = 0;
  return {
    resolve: vi.fn().mockImplementation(async () => answers[index++] ?? answers.at(-1) ?? []),
  } satisfies SourceDnsResolver;
}

function requesterReturning(
  ...responses: readonly Readonly<{
    statusCode: number;
    location?: string | null;
    contentType?: string | null;
    contentLength?: number | null;
  }>[]
) {
  let index = 0;
  return {
    head: vi.fn().mockImplementation(async () => {
      const response = responses[index++] ?? responses.at(-1);
      if (response === undefined) throw new Error("missing deterministic response");
      return {
        statusCode: response.statusCode,
        location: response.location ?? null,
        contentType: response.contentType ?? null,
        contentLength: response.contentLength ?? null,
        observedAt: OBSERVED_AT,
      };
    }),
  } satisfies PinnedSourceHeadRequester;
}

describe("NodePublicSourceMetadataProbe", () => {
  it("fails closed behind its adapter kill switch", async () => {
    const dns = dnsReturning([PUBLIC_V4]);
    const requester = requesterReturning({ statusCode: 200 });
    const probe = new NodePublicSourceMetadataProbe({ enabled: false, dns, requester });

    await expect(
      probe.probe("https://example.com/article", {
        maxRedirects: 5,
        signal: new AbortController().signal,
      }),
    ).rejects.toMatchObject({ code: "disabled" });
    expect(dns.resolve).not.toHaveBeenCalled();
    expect(requester.head).not.toHaveBeenCalled();
  });

  it("re-resolves, revalidates and pins every redirect hop without returning a body", async () => {
    const dns = dnsReturning([PUBLIC_V4, PUBLIC_V6], [PUBLIC_V6]);
    const requester = requesterReturning(
      { statusCode: 302, location: "https://archive.example/final?utm_source=x" },
      { statusCode: 200, contentType: "text/html", contentLength: 42 },
    );
    const probe = new NodePublicSourceMetadataProbe({ enabled: true, dns, requester });

    await expect(
      probe.probe("https://example.com/start#fragment", {
        maxRedirects: 5,
        signal: new AbortController().signal,
      }),
    ).resolves.toEqual({
      requestedUrl: "https://example.com/start",
      hops: [
        {
          url: "https://example.com/start",
          statusCode: 302,
          resolvedAddresses: [PUBLIC_V4.address, PUBLIC_V6.address],
          contentType: null,
          contentLength: null,
          title: null,
          observedAt: OBSERVED_AT,
        },
        {
          url: "https://archive.example/final",
          statusCode: 200,
          resolvedAddresses: [PUBLIC_V6.address],
          contentType: "text/html",
          contentLength: 42,
          title: null,
          observedAt: OBSERVED_AT,
        },
      ],
      bodyIncluded: false,
    });
    expect(dns.resolve).toHaveBeenNthCalledWith(1, "example.com", expect.any(AbortSignal));
    expect(dns.resolve).toHaveBeenNthCalledWith(2, "archive.example", expect.any(AbortSignal));
    expect(requester.head).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ address: PUBLIC_V4.address, family: 4 }),
    );
    expect(requester.head).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ address: PUBLIC_V6.address, family: 6 }),
    );
  });

  it("rejects mixed public/private DNS before opening a socket", async () => {
    const dns = dnsReturning([
      PUBLIC_V4,
      { address: "169.254.169.254", family: 4 },
    ]);
    const requester = requesterReturning({ statusCode: 200 });
    const probe = new NodePublicSourceMetadataProbe({ enabled: true, dns, requester });

    await expect(
      probe.probe("https://example.com", {
        maxRedirects: 5,
        signal: new AbortController().signal,
      }),
    ).rejects.toMatchObject({ code: "network-target-rejected" });
    expect(requester.head).not.toHaveBeenCalled();
  });

  it.each([
    {
      answers: Array.from({ length: 17 }, (_, index) => ({
        address: `93.184.216.${index + 1}`,
        family: 4 as const,
      })),
    },
    { answers: [{ address: PUBLIC_V4.address, family: 6 as const }] },
  ])("rejects malformed or unbounded DNS answer sets", async ({ answers }) => {
    const requester = requesterReturning({ statusCode: 200 });
    const probe = new NodePublicSourceMetadataProbe({
      enabled: true,
      dns: dnsReturning(answers),
      requester,
    });

    await expect(
      probe.probe("https://example.com", {
        maxRedirects: 5,
        signal: new AbortController().signal,
      }),
    ).rejects.toMatchObject({ code: "dns-answer-invalid" });
    expect(requester.head).not.toHaveBeenCalled();
  });

  it("blocks a redirect that resolves into a private network", async () => {
    const dns = dnsReturning(
      [PUBLIC_V4],
      [{ address: "10.0.0.7", family: 4 }],
    );
    const requester = requesterReturning({
      statusCode: 301,
      location: "https://internal.example/secrets",
    });
    const probe = new NodePublicSourceMetadataProbe({ enabled: true, dns, requester });

    await expect(
      probe.probe("https://example.com", {
        maxRedirects: 5,
        signal: new AbortController().signal,
      }),
    ).rejects.toMatchObject({ code: "network-target-rejected" });
    expect(requester.head).toHaveBeenCalledTimes(1);
  });

  it.each([
    { statusCode: 302, location: null, code: "redirect-location-invalid" },
    { statusCode: 302, location: "http://127.0.0.1/admin", code: "redirect-location-invalid" },
    { statusCode: 302, location: "https://example.com:8443/admin", code: "redirect-location-invalid" },
  ])("rejects an unsafe redirect location", async ({ statusCode, location, code }) => {
    const probe = new NodePublicSourceMetadataProbe({
      enabled: true,
      dns: dnsReturning([PUBLIC_V4]),
      requester: requesterReturning({ statusCode, location }),
    });

    await expect(
      probe.probe("https://example.com", {
        maxRedirects: 5,
        signal: new AbortController().signal,
      }),
    ).rejects.toMatchObject({ code });
  });

  it("enforces the redirect budget before another DNS lookup", async () => {
    const dns = dnsReturning([PUBLIC_V4]);
    const probe = new NodePublicSourceMetadataProbe({
      enabled: true,
      dns,
      requester: requesterReturning({ statusCode: 302, location: "/again" }),
    });

    await expect(
      probe.probe("https://example.com", {
        maxRedirects: 0,
        signal: new AbortController().signal,
      }),
    ).rejects.toMatchObject({ code: "redirect-limit-exceeded" });
    expect(dns.resolve).toHaveBeenCalledTimes(1);
  });

  it("treats non-navigation 3xx statuses as terminal metadata", async () => {
    const probe = new NodePublicSourceMetadataProbe({
      enabled: true,
      dns: dnsReturning([PUBLIC_V4]),
      requester: requesterReturning({ statusCode: 304 }),
    });

    const result = await probe.probe("https://example.com", {
      maxRedirects: 5,
      signal: new AbortController().signal,
    });
    expect(result.hops).toHaveLength(1);
    expect(result.hops[0]?.statusCode).toBe(304);
  });

  it("propagates caller cancellation while DNS is pending", async () => {
    const controller = new AbortController();
    const dns = {
      resolve: vi.fn().mockImplementation(
        (_hostname: string, signal: AbortSignal) =>
          new Promise((_, reject) => {
            signal.addEventListener("abort", () => reject(signal.reason), { once: true });
          }),
      ),
    } satisfies SourceDnsResolver;
    const probe = new NodePublicSourceMetadataProbe({
      enabled: true,
      dns,
      requester: requesterReturning({ statusCode: 200 }),
    });
    const pending = probe.probe("https://example.com", {
      maxRedirects: 5,
      signal: controller.signal,
    });
    controller.abort();

    await expect(pending).rejects.toMatchObject({ code: "aborted" });
  });

  it("enforces one bounded deadline across DNS and redirect work", async () => {
    vi.useFakeTimers();
    try {
      const dns = {
        resolve: vi.fn().mockImplementation(() => new Promise(() => undefined)),
      } satisfies SourceDnsResolver;
      const probe = new NodePublicSourceMetadataProbe({
        enabled: true,
        dns,
        requester: requesterReturning({ statusCode: 200 }),
        timeoutMs: 100,
      });
      const pending = probe.probe("https://example.com", {
        maxRedirects: 5,
        signal: new AbortController().signal,
      });
      const assertion = expect(pending).rejects.toMatchObject({ code: "timeout" });
      await vi.advanceTimersByTimeAsync(100);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects unsafe resource-limit configuration at composition time", () => {
    expect(
      () => new NodePublicSourceMetadataProbe({ enabled: true, timeoutMs: 99 }),
    ).toThrow(RangeError);
    expect(
      () =>
        new NodePublicSourceMetadataProbe({
          enabled: true,
          maxHeaderBytes: 65_537,
        }),
    ).toThrow(RangeError);
  });
});

describe("NodePinnedSourceHeadRequester", () => {
  it("uses a body-free, DNS-pinned, bounded TLS HEAD request", async () => {
    const response = Object.assign(new EventEmitter(), {
      statusCode: 200,
      headers: {
        location: "/next",
        "content-type": "text/html; charset=utf-8",
        "content-length": "1234",
      },
      destroy: vi.fn(),
    });
    const request = Object.assign(new EventEmitter(), {
      end: vi.fn(),
      destroy: vi.fn(),
    });
    let capturedOptions: Record<string, unknown> | undefined;
    const httpsRequest = vi.fn().mockImplementation(
      (_url: URL, options: Record<string, unknown>, callback: (value: unknown) => void) => {
        capturedOptions = options;
        queueMicrotask(() => callback(response));
        return request;
      },
    );
    const requester = new NodePinnedSourceHeadRequester({
      httpsRequest: httpsRequest as never,
      now: () => new Date(OBSERVED_AT),
    });

    await expect(
      requester.head({
        url: "https://example.com/source",
        address: PUBLIC_V4.address,
        family: 4,
        signal: new AbortController().signal,
        timeoutMs: 8_000,
        maxHeaderBytes: 16_384,
      }),
    ).resolves.toEqual({
      statusCode: 200,
      location: "/next",
      contentType: "text/html; charset=utf-8",
      contentLength: 1_234,
      observedAt: OBSERVED_AT,
    });

    expect(capturedOptions).toMatchObject({
      method: "HEAD",
      agent: false,
      family: 4,
      maxHeaderSize: 16_384,
      insecureHTTPParser: false,
      timeout: 8_000,
      servername: "example.com",
      rejectUnauthorized: true,
      minVersion: "TLSv1.2",
      headers: {
        accept: "*/*",
        "accept-encoding": "identity",
        "user-agent": "AfterFrame-Source-Metadata-Probe/1.0",
      },
    });
    const lookup = capturedOptions?.lookup as (
      hostname: string,
      options: object,
      callback: (error: null, address: string, family: number) => void,
    ) => void;
    const callback = vi.fn();
    lookup("malicious-rebinding.example", {}, callback);
    expect(callback).toHaveBeenCalledWith(null, PUBLIC_V4.address, 4);
    expect(response.destroy).toHaveBeenCalledOnce();
    expect(request.end).toHaveBeenCalledOnce();
  });

  it("never promotes oversized or malformed content lengths", async () => {
    const response = Object.assign(new EventEmitter(), {
      statusCode: 200,
      headers: { "content-length": "100000001" },
      destroy: vi.fn(),
    });
    const request = Object.assign(new EventEmitter(), {
      end: vi.fn(),
      destroy: vi.fn(),
    });
    const httpRequest = vi.fn().mockImplementation(
      (_url: URL, _options: object, callback: (value: unknown) => void) => {
        queueMicrotask(() => callback(response));
        return request;
      },
    );
    const requester = new NodePinnedSourceHeadRequester({ httpRequest: httpRequest as never });

    await expect(
      requester.head({
        url: "http://example.com/source",
        address: PUBLIC_V4.address,
        family: 4,
        signal: new AbortController().signal,
        timeoutMs: 8_000,
        maxHeaderBytes: 16_384,
      }),
    ).resolves.toMatchObject({ contentLength: null });
  });

  it("exposes only a stable failure code when the socket fails", async () => {
    const request = Object.assign(new EventEmitter(), {
      end: vi.fn(function (this: EventEmitter) {
        queueMicrotask(() => this.emit("error", new Error("secret upstream detail")));
      }),
      destroy: vi.fn(),
    });
    const httpRequest = vi.fn().mockReturnValue(request);
    const requester = new NodePinnedSourceHeadRequester({ httpRequest: httpRequest as never });

    const pending = requester.head({
      url: "http://example.com/source",
      address: PUBLIC_V4.address,
      family: 4,
      signal: new AbortController().signal,
      timeoutMs: 8_000,
      maxHeaderBytes: 16_384,
    });
    await expect(pending).rejects.toEqual(new SourceMetadataProbeError("request-failed"));
  });

  it("preserves the bounded timeout failure from the request layer", async () => {
    const request = Object.assign(new EventEmitter(), {
      end: vi.fn(function (this: EventEmitter) {
        queueMicrotask(() => this.emit("timeout"));
      }),
      destroy: vi.fn(function (this: EventEmitter, error: Error) {
        queueMicrotask(() => this.emit("error", error));
      }),
    });
    const httpRequest = vi.fn().mockReturnValue(request);
    const requester = new NodePinnedSourceHeadRequester({
      httpRequest: httpRequest as never,
    });

    await expect(
      requester.head({
        url: "http://example.com/source",
        address: PUBLIC_V4.address,
        family: 4,
        signal: new AbortController().signal,
        timeoutMs: 8_000,
        maxHeaderBytes: 16_384,
      }),
    ).rejects.toMatchObject({ code: "timeout" });
  });
});
