import { describe, expect, it, vi } from "vitest";
import { validateMovieSubjectRef } from "@/specialists/movie/subject";
import { SpecialistSubjectRefSchema } from "@/core/cases/schemas";
import { TmdbMovieIdentityResolver } from "@/specialists/movie/infrastructure/tmdb-movie-identity-resolver";

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

function resolverWith(fetchImpl: typeof fetch) {
  return new TmdbMovieIdentityResolver({
    apiKey: "test-server-key",
    fetchImpl,
    now: () => new Date("2026-08-09T12:00:00.000Z"),
    createTraceId: () => TRACE_ID,
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
      estimatedCostUsd: 0,
      httpStatus: 200,
      providerRequestId: "tmdb-request-1",
    });
    expect(JSON.stringify(result)).not.toContain("test-server-key");
  });

  it.each([
    [404, "NOT_FOUND"],
    [401, "UNAVAILABLE"],
    [503, "UNAVAILABLE"],
  ] as const)("maps provider status %s to %s", async (status, state) => {
    const result = await resolverWith(
      vi.fn(async () => new Response(null, { status })),
    ).resolve(unresolvedMovie(991_991));

    expect(result.state).toBe(state);
    expect(result.attempt.httpStatus).toBe(status);
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
    const result = await resolverWith(
      vi.fn(
        async () =>
          new Response(null, {
            status: 429,
            headers: { "retry-after": "3" },
          }),
      ),
    ).resolve(unresolvedMovie());

    expect(result).toMatchObject({
      state: "RATE_LIMITED",
      retryAfterMs: 3_000,
    });
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
});
