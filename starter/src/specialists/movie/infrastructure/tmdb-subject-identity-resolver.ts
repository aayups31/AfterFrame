import {
  SubjectIdentityResolverDescriptorSchema,
  SubjectIdentityResolverResultSchema,
  type SubjectIdentityResolver,
} from "@/application/research/subject-identity-port";
import { movieIdentityToPublicResearchIdentity } from "@/infrastructure/research/movie-public-subject-identity";
import { MOVIE_INVESTIGATOR_MANIFEST } from "@/specialists/movie/manifest";
import {
  MAX_TMDB_RETRY_AFTER_MS,
  TmdbMovieIdentityResolver,
  type TmdbMovieIdentityResolverOptions,
} from "@/specialists/movie/infrastructure/tmdb-movie-identity-resolver";
import { validateMovieSubjectRef } from "@/specialists/movie/subject";

const DEFAULT_RETRY_AFTER_MS = 1_000;

function boundedRetryAfter(value: number | null) {
  return Math.max(
    100,
    Math.min(MAX_TMDB_RETRY_AFTER_MS, value ?? DEFAULT_RETRY_AFTER_MS),
  );
}

export const TMDB_SUBJECT_IDENTITY_RESOLVER_DESCRIPTOR =
  SubjectIdentityResolverDescriptorSchema.parse({
    specialistId: MOVIE_INVESTIGATOR_MANIFEST.id,
    specialistVersion: MOVIE_INVESTIGATOR_MANIFEST.version,
    subjectType: "film",
    resolver: { id: "tmdb-movie-details", version: "v3" },
    resolvedRequirementIds: ["tmdb-film"],
  });

/**
 * Movie-only composition adapter. The application sees a domain-neutral
 * identity result; TMDB response bodies and descriptive provider copy never
 * cross this boundary.
 */
export class TmdbSubjectIdentityResolver implements SubjectIdentityResolver {
  readonly identity = TMDB_SUBJECT_IDENTITY_RESOLVER_DESCRIPTOR;
  readonly #resolver: TmdbMovieIdentityResolver;

  constructor(options: TmdbMovieIdentityResolverOptions) {
    this.#resolver = new TmdbMovieIdentityResolver(options);
  }

  async resolve(input: Parameters<SubjectIdentityResolver["resolve"]>[0]) {
    const validation = validateMovieSubjectRef(input.subjectRef);
    if (!validation.valid) {
      throw new Error("Movie identity resolver received an invalid subject reference");
    }

    const resolution = await this.#resolver.resolve(
      validation.subject,
      input.signal,
    );
    switch (resolution.state) {
      case "VERIFIED":
        return SubjectIdentityResolverResultSchema.parse({
          status: "VERIFIED",
          publicIdentity: movieIdentityToPublicResearchIdentity(
            resolution.identity,
          ),
          telemetry: resolution.attempt.telemetry,
        });
      case "NOT_FOUND":
        return SubjectIdentityResolverResultSchema.parse({
          status: "NOT_FOUND",
          providerStatusCode:
            resolution.attempt.httpStatus === 404 ? 404 : null,
          telemetry: resolution.attempt.telemetry,
        });
      case "RATE_LIMITED":
        return SubjectIdentityResolverResultSchema.parse({
          status: "RATE_LIMITED",
          retryAfterMs: boundedRetryAfter(resolution.retryAfterMs),
          providerStatusCode:
            resolution.attempt.httpStatus === 429 ? 429 : null,
          telemetry: resolution.attempt.telemetry,
        });
      case "UNAVAILABLE":
        return SubjectIdentityResolverResultSchema.parse({
          status: "UNAVAILABLE",
          reason: resolution.reason,
          retryable: resolution.retryable,
          retryAfterMs: resolution.retryable
            ? DEFAULT_RETRY_AFTER_MS
            : null,
          providerStatusCode: resolution.attempt.httpStatus,
          telemetry: resolution.attempt.telemetry,
        });
    }
  }
}
