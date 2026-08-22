import { describe, expect, it, vi } from "vitest";
import { SpecialistSubjectRefSchema } from "@/core/cases/schemas";
import {
  TMDB_SUBJECT_IDENTITY_RESOLVER_DESCRIPTOR,
  TmdbSubjectIdentityResolver,
} from "@/specialists/movie/infrastructure/tmdb-subject-identity-resolver";

const TRACE_ID = "72000000-0000-4000-8000-000000000001";
const subjectRef = SpecialistSubjectRefSchema.parse({
  type: "film",
  id: "tmdb:movie:603",
  versionId: null,
});

function adapter(fetchImpl: typeof fetch, timeoutMs = 10_000) {
  return new TmdbSubjectIdentityResolver({
    apiKey: "private-tmdb-key",
    fetchImpl,
    timeoutMs,
    createTraceId: () => TRACE_ID,
    now: () => new Date("2026-08-14T12:00:00.000Z"),
  });
}

function resolveWith(
  fetchImpl: typeof fetch,
  signal = new AbortController().signal,
) {
  return adapter(fetchImpl).resolve({ subjectRef, signal });
}

describe("TMDB domain-neutral subject identity adapter", () => {
  it("maps any valid movie to verified public identity without provider prose or research output", async () => {
    const result = await resolveWith(
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              id: 603,
              title: "The Matrix",
              original_title: "The Matrix",
              original_language: "en",
              release_date: "1999-03-31",
              imdb_id: "tt0133093",
              overview: "Provider synopsis must not cross the boundary.",
              tagline: "Provider marketing copy must not cross the boundary.",
            }),
            {
              status: 200,
              headers: { "x-request-id": "tmdb-generic-movie-603" },
            },
          ),
      ),
    );

    expect(TMDB_SUBJECT_IDENTITY_RESOLVER_DESCRIPTOR).toEqual({
      specialistId: "movie-investigator",
      specialistVersion: "0.1.0",
      subjectType: "film",
      resolver: { id: "tmdb-movie-details", version: "v3" },
      resolvedRequirementIds: ["tmdb-film"],
    });
    expect(result).toMatchObject({
      status: "VERIFIED",
      publicIdentity: {
        displayName: "The Matrix",
        dataClass: "PUBLIC",
        verificationState: "RESOLVER_VERIFIED",
        resolver: { id: "tmdb-movie-details", version: "v3" },
      },
      telemetry: {
        telemetryState: "COMPLETE",
        providerRunId: "tmdb-generic-movie-603",
        usage: { toolCalls: 1 },
        cost: { pricingState: "UNPRICED", amountMicros: null },
      },
    });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("overview");
    expect(serialized).not.toContain("tagline");
    expect(serialized).not.toContain("Provider synopsis");
    expect(serialized).not.toContain("private-tmdb-key");
    expect(result).not.toHaveProperty("sourceCandidates");
    expect(result).not.toHaveProperty("claims");
    expect(result).not.toHaveProperty("evidence");
  });

  it("maps not-found and authentication outcomes without provider bodies", async () => {
    const notFound = await resolveWith(
      vi.fn(
        async () =>
          new Response("private not-found provider body", { status: 404 }),
      ),
    );
    const authentication = await resolveWith(
      vi.fn(
        async () =>
          new Response("private authentication body", { status: 401 }),
      ),
    );

    expect(notFound).toMatchObject({
      status: "NOT_FOUND",
      providerStatusCode: 404,
    });
    expect(authentication).toMatchObject({
      status: "UNAVAILABLE",
      reason: "AUTHENTICATION_FAILED",
      retryable: false,
      retryAfterMs: null,
      providerStatusCode: 401,
    });
    expect(JSON.stringify([notFound, authentication])).not.toContain(
      "private",
    );
  });

  it("normalizes rate limits and retryable availability failures to bounded policy", async () => {
    const rateLimited = await resolveWith(
      vi.fn(
        async () =>
          new Response(null, {
            status: 429,
            headers: { "retry-after": "0" },
          }),
      ),
    );
    const unavailable = await resolveWith(
      vi.fn(async () => new Response(null, { status: 503 })),
    );
    const network = await resolveWith(
      vi.fn(async () => {
        throw new Error("private-tmdb-key and provider body");
      }),
    );

    expect(rateLimited).toMatchObject({
      status: "RATE_LIMITED",
      retryAfterMs: 100,
      providerStatusCode: 429,
    });
    expect(unavailable).toMatchObject({
      status: "UNAVAILABLE",
      reason: "UPSTREAM_UNAVAILABLE",
      retryable: true,
      retryAfterMs: 1_000,
      providerStatusCode: 503,
    });
    expect(network).toMatchObject({
      status: "UNAVAILABLE",
      reason: "NETWORK_ERROR",
      retryable: true,
      retryAfterMs: 1_000,
      providerStatusCode: null,
    });
    expect(JSON.stringify(network)).not.toContain("private-tmdb-key");
  });

  it("forwards caller cancellation and maps only its own deadline to a timeout result", async () => {
    const fetchImpl = vi.fn(
      async (_input: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => reject(new Error("private provider abort detail")),
            { once: true },
          );
        }),
    );
    const controller = new AbortController();
    const cancelled = adapter(fetchImpl).resolve({
      subjectRef,
      signal: controller.signal,
    });
    controller.abort("private caller abort detail");

    await expect(cancelled).rejects.toMatchObject({
      name: "AbortError",
      message: "Movie identity resolution was aborted",
    });

    const timedOut = await adapter(fetchImpl, 1).resolve({
      subjectRef,
      signal: new AbortController().signal,
    });
    expect(timedOut).toMatchObject({
      status: "UNAVAILABLE",
      reason: "REQUEST_TIMEOUT",
      retryable: true,
      retryAfterMs: 1_000,
      providerStatusCode: null,
    });
    expect(JSON.stringify(timedOut)).not.toContain("private provider");
  });
});
