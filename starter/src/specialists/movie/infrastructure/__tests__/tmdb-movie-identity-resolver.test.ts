import { describe, expect, it, vi } from "vitest";
import { validateMovieSubjectRef } from "@/specialists/movie/subject";
import { SpecialistSubjectRefSchema } from "@/core/cases/schemas";
import {
  MAX_TMDB_RETRY_AFTER_MS,
  TmdbMovieIdentityResolver,
} from "@/specialists/movie/infrastructure/tmdb-movie-identity-resolver";

const TRACE_ID = "51f60b7e-47e0-4cf8-92b0-cbfc7b954428";

function unresolvedMovie(id = 278) {
  const result = validateMovieSubjectRef(
    SpecialistSubjectRefSchema.parse({
      type: "film",
      id: `tmdb:movie:${id}`,
      versionId: null,
    }),
  );
  if (!result.valid) throw new Error(result.reason);
  return result.subject;
}

function resolverWith(fetchImpl: typeof fetch, timeoutMs = 10_000) {
  return new TmdbMovieIdentityResolver({
    apiKey: "test-server-key",
    fetchImpl,
    now: () => new Date("2026-08-09T12:00:00.000Z"),
    createTraceId: () => TRACE_ID,
    timeoutMs,
  });
}

describe("TMDB movie identity resolver", () => {
  it("provider-verifies any valid movie id without creating research evidence", async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(input.toString());
      expect(url.pathname).toBe("/3/movie/278");
      expect(url.searchParams.get("language")).toBe("en-US");
      expect(url.searchParams.get("api_key")).toBe("test-server-key");
      return new Response(
        JSON.stringify({
          id: 278,
          title: "The Shawshank Redemption",
          original_title: "The Shawshank Redemption",
          original_language: "en",
          release_date: "1994-09-23",
          imdb_id: "tt0111161",
          overview: "Ignored provider copy, never evidence.",
          tagline: "Ignored provider marketing copy.",
        }),
        {
          status: 200,
          headers: {
            "content-type": "application/json",
            "x-request-id": "tmdb-request-1",
          },
        },
      );
    });

    const result = await resolverWith(fetchImpl).resolve(unresolvedMovie());

    expect(result.state).toBe("VERIFIED");
    if (result.state !== "VERIFIED") return;
    expect(result.subject.providerResolution).toMatchObject({
      state: "RESOLVER_VERIFIED",
      resolverId: "tmdb-movie-details",
    });
    expect(result.identity).toEqual(
      expect.objectContaining({
        providerMovieId: 278,
        title: "The Shawshank Redemption",
        releaseDate: "1994-09-23",
      }),
    );
    expect(result).not.toHaveProperty("evidence");
    expect(result).not.toHaveProperty("claims");
    expect(result.attempt).toMatchObject({
      traceId: TRACE_ID,
      model: null,
      promptVersion: null,
      httpStatus: 200,
      providerRequestId: "tmdb-request-1",
      telemetry: {
        telemetryState: "COMPLETE",
        providerRunId: "tmdb-request-1",
        usage: {
          inputTokens: 0,
          outputTokens: 0,
          toolCalls: 1,
          inputBytes: 0,
        },
        cost: {
          currency: "USD",
          pricingState: "UNPRICED",
          amountMicros: null,
        },
      },
    });
    expect(JSON.stringify(result)).not.toContain("test-server-key");
    expect(JSON.stringify(result)).not.toContain("Ignored provider");
    expect(JSON.stringify(result)).not.toContain("overview");
    expect(JSON.stringify(result)).not.toContain("tagline");
    expect(result).not.toHaveProperty("sourceCandidates");
    expect(result).not.toHaveProperty("evidence");
  });

  it.each([
    [404, "NOT_FOUND"],
    [401, "UNAVAILABLE"],
    [503, "UNAVAILABLE"],
    [418, "UNAVAILABLE"],
  ] as const)("maps provider status %s to %s and cancels its unused body", async (status, state) => {
    let cancellations = 0;
    const body = new ReadableStream<Uint8Array>({
      cancel() {
        cancellations += 1;
      },
    });
    const result = await resolverWith(
      vi.fn(async () => new Response(body, { status })),
    ).resolve(unresolvedMovie(991_991));

    expect(result.state).toBe(state);
    expect(result.attempt.httpStatus).toBe(status);
    expect(cancellations).toBe(1);
    if (status === 401 && result.state === "UNAVAILABLE") {
      expect(result).toMatchObject({
        reason: "AUTHENTICATION_FAILED",
        retryable: false,
      });
    }
    if (status === 503 && result.state === "UNAVAILABLE") {
      expect(result).toMatchObject({
        reason: "UPSTREAM_UNAVAILABLE",
        retryable: true,
      });
    }
  });

  it("preserves 429 retry guidance without pretending identity was resolved", async () => {
    let cancellations = 0;
    const result = await resolverWith(
      vi.fn(
        async () =>
          new Response(
            new ReadableStream<Uint8Array>({
              cancel() {
                cancellations += 1;
              },
            }),
            {
            status: 429,
            headers: { "retry-after": "3" },
            },
          ),
      ),
    ).resolve(unresolvedMovie());

    expect(result).toMatchObject({
      state: "RATE_LIMITED",
      retryAfterMs: 3_000,
    });
    expect(cancellations).toBe(1);
  });

  it("clamps an overflowing numeric Retry-After without losing 429 identity", async () => {
    const result = await resolverWith(
      vi.fn(
        async () =>
          new Response(null, {
            status: 429,
            headers: { "retry-after": "100000000000000000000" },
          }),
      ),
    ).resolve(unresolvedMovie());

    expect(result).toMatchObject({
      state: "RATE_LIMITED",
      retryAfterMs: MAX_TMDB_RETRY_AFTER_MS,
    });
    if (result.state === "RATE_LIMITED") {
      expect(Number.isSafeInteger(result.retryAfterMs)).toBe(true);
    }
  });

  it("rejects malformed or mismatched successful responses", async () => {
    const result = await resolverWith(
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              id: 999,
              title: "Wrong identity",
              original_title: "Wrong identity",
              original_language: "en",
              release_date: "2020-01-01",
            }),
            { status: 200 },
          ),
      ),
    ).resolve(unresolvedMovie(278));

    expect(result).toMatchObject({
      state: "UNAVAILABLE",
      reason: "INVALID_PROVIDER_RESPONSE",
      retryable: false,
    });
  });

  it("classifies invalid JSON as a non-retryable provider contract failure", async () => {
    const result = await resolverWith(
      vi.fn(
        async () =>
          new Response("{not-json", {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
      ),
    ).resolve(unresolvedMovie());

    expect(result).toMatchObject({
      state: "UNAVAILABLE",
      reason: "INVALID_PROVIDER_RESPONSE",
      retryable: false,
    });
  });

  it("drops malformed upstream request IDs instead of breaking degraded output", async () => {
    const result = await resolverWith(
      vi.fn(
        async () =>
          new Response(null, {
            status: 503,
            headers: { "x-request-id": "x".repeat(300) },
          }),
      ),
    ).resolve(unresolvedMovie());

    expect(result).toMatchObject({
      state: "UNAVAILABLE",
      reason: "UPSTREAM_UNAVAILABLE",
      retryable: true,
      attempt: { providerRequestId: null },
    });
  });

  it("never returns network exception text that could contain a secret URL", async () => {
    const result = await resolverWith(
      vi.fn(async () => {
        throw new Error(
          "request failed: https://api.themoviedb.org?api_key=test-server-key",
        );
      }),
    ).resolve(unresolvedMovie());

    expect(result).toMatchObject({
      state: "UNAVAILABLE",
      reason: "NETWORK_ERROR",
      retryable: true,
    });
    expect(JSON.stringify(result)).not.toContain("test-server-key");
  });

  it("propagates caller cancellation as a bounded abort instead of misreporting a timeout", async () => {
    const fetchImpl = vi.fn(
      async (_input: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => reject(new Error("provider body and test-server-key")),
            { once: true },
          );
        }),
    );
    const controller = new AbortController();
    const pending = resolverWith(fetchImpl).resolve(
      unresolvedMovie(603),
      controller.signal,
    );

    controller.abort("caller secret reason");

    await expect(pending).rejects.toMatchObject({
      name: "AbortError",
      message: "Movie identity resolution was aborted",
    });
    await expect(pending).rejects.not.toThrow(/provider body|test-server-key|caller secret/);
  });

  it("distinguishes the resolver's own timeout from caller cancellation", async () => {
    const fetchImpl = vi.fn(
      async (_input: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => reject(new DOMException("aborted", "AbortError")),
            { once: true },
          );
        }),
    );

    const result = await resolverWith(fetchImpl, 1).resolve(
      unresolvedMovie(603),
    );

    expect(result).toMatchObject({
      state: "UNAVAILABLE",
      reason: "REQUEST_TIMEOUT",
      retryable: true,
      attempt: {
        httpStatus: null,
        telemetry: {
          telemetryState: "COMPLETE",
          providerRunId: null,
          usage: { toolCalls: 1, outputBytes: 0 },
        },
      },
    });
  });

  it("preserves caller cancellation while a successful response body is being read", async () => {
    let bodyStarted!: () => void;
    const bodyIsBeingRead = new Promise<void>((resolve) => {
      bodyStarted = resolve;
    });
    const fetchImpl = vi.fn(
      async (_input: string | URL | Request, init?: RequestInit) =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              bodyStarted();
              init?.signal?.addEventListener(
                "abort",
                () => controller.error(new Error("private provider body")),
                { once: true },
              );
            },
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        ),
    );
    const controller = new AbortController();
    const pending = resolverWith(fetchImpl).resolve(
      unresolvedMovie(603),
      controller.signal,
    );
    await bodyIsBeingRead;

    controller.abort("private caller reason");

    await expect(pending).rejects.toMatchObject({
      name: "AbortError",
      message: "Movie identity resolution was aborted",
    });
  });

  it("classifies the resolver timeout while a successful response body is being read", async () => {
    const fetchImpl = vi.fn(
      async (_input: string | URL | Request, init?: RequestInit) =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              init?.signal?.addEventListener(
                "abort",
                () => controller.error(new Error("private provider body")),
                { once: true },
              );
            },
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        ),
    );

    const result = await resolverWith(fetchImpl, 1).resolve(
      unresolvedMovie(603),
    );

    expect(result).toMatchObject({
      state: "UNAVAILABLE",
      reason: "REQUEST_TIMEOUT",
      retryable: true,
      attempt: {
        httpStatus: 200,
        telemetry: { usage: { outputBytes: 0 } },
      },
    });
    expect(JSON.stringify(result)).not.toContain("private provider body");
  });

  it("rejects an oversized provider body without reading or retaining it", async () => {
    const text = vi.fn(async () => "private provider prose");
    const fetchImpl = vi.fn(
      async () =>
        ({
          status: 200,
          ok: true,
          headers: new Headers({ "content-length": "1048577" }),
          text,
        }) as unknown as Response,
    );

    const result = await resolverWith(fetchImpl).resolve(unresolvedMovie(603));

    expect(result).toMatchObject({
      state: "UNAVAILABLE",
      reason: "INVALID_PROVIDER_RESPONSE",
      retryable: false,
    });
    expect(text).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain("private provider prose");
  });

  it("measures and rejects an oversized provider body when content length is absent", async () => {
    const oversizedBody = "x".repeat(1_048_577);
    const result = await resolverWith(
      vi.fn(
        async () =>
          new Response(oversizedBody, {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
      ),
    ).resolve(unresolvedMovie(603));

    expect(result).toMatchObject({
      state: "UNAVAILABLE",
      reason: "INVALID_PROVIDER_RESPONSE",
      retryable: false,
      attempt: { telemetry: { usage: { outputBytes: 1_048_577 } } },
    });
    expect(JSON.stringify(result)).not.toContain(oversizedBody);
  });

  it("cancels a chunked hostile body as soon as the byte budget is exceeded", async () => {
    let pulls = 0;
    let cancellations = 0;
    const responseBody = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls += 1;
        controller.enqueue(new Uint8Array(300_000).fill(120));
      },
      cancel() {
        cancellations += 1;
      },
    });
    const result = await resolverWith(
      vi.fn(
        async () =>
          new Response(responseBody, {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
      ),
    ).resolve(unresolvedMovie(603));

    expect(result).toMatchObject({
      state: "UNAVAILABLE",
      reason: "INVALID_PROVIDER_RESPONSE",
      retryable: false,
      attempt: { telemetry: { usage: { outputBytes: 1_200_000 } } },
    });
    expect(pulls).toBeLessThanOrEqual(5);
    expect(cancellations).toBe(1);
  });

  it("decodes multibyte JSON split across stream chunks and counts bytes", async () => {
    const providerBody = JSON.stringify({
      id: 603,
      title: "Cinéma 🎬",
      original_title: "Cinéma 🎬",
      original_language: "fr",
      release_date: "1999-03-31",
      imdb_id: "tt0133093",
    });
    const encoded = new TextEncoder().encode(providerBody);
    const splitAt = encoded.indexOf(0xf0) + 2;
    const responseBody = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoded.slice(0, splitAt));
        controller.enqueue(encoded.slice(splitAt));
        controller.close();
      },
    });

    const result = await resolverWith(
      vi.fn(async () => new Response(responseBody, { status: 200 })),
    ).resolve(unresolvedMovie(603));

    expect(result).toMatchObject({
      state: "VERIFIED",
      identity: { title: "Cinéma 🎬" },
      attempt: {
        telemetry: { usage: { outputBytes: encoded.byteLength } },
      },
    });
  });
});
