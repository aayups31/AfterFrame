import { randomUUID } from "node:crypto";
import { z } from "zod";
import { MovieSubjectSchema, type MovieSubject } from "@/specialists/movie/subject";
import {
  EntityIdSchema,
  IsoDateTimeSchema,
  RecordOriginSchema,
} from "@/core/shared/schemas";

const RESOLVER_ID = "tmdb-movie-details" as const;
const RESOLVER_VERSION = "v3" as const;
const TOOL_NAME = "tmdb.movie-details" as const;
const OUTPUT_SCHEMA_VERSION = "movie-identity-v1" as const;

const TmdbMovieDetailsResponseSchema = z.object({
  id: z.number().int().positive().safe(),
  title: z.string().trim().min(1).max(500),
  original_title: z.string().trim().min(1).max(500),
  original_language: z.string().trim().min(1).max(20),
  release_date: z.string().max(10).nullable().optional(),
  imdb_id: z.string().trim().min(1).max(40).nullable().optional(),
});

export const MovieIdentityMetadataSchema = z
  .object({
    provider: z.literal("TMDB"),
    providerMovieId: z.number().int().positive().safe(),
    providerRef: z.string().regex(/^tmdb:movie:[1-9][0-9]*$/),
    title: z.string().trim().min(1).max(500),
    originalTitle: z.string().trim().min(1).max(500),
    originalLanguage: z.string().trim().min(1).max(20),
    releaseDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
    imdbId: z.string().trim().min(1).max(40).nullable(),
    resolvedAt: IsoDateTimeSchema,
  })
  .strict()
  .superRefine((identity, context) => {
    if (identity.providerRef !== `tmdb:movie:${identity.providerMovieId}`) {
      context.addIssue({
        code: "custom",
        path: ["providerRef"],
        message: "providerRef must contain providerMovieId",
      });
    }
  });

export const MovieIdentityResolutionAttemptSchema = z
  .object({
    traceId: EntityIdSchema,
    resolverId: z.literal(RESOLVER_ID),
    resolverVersion: z.literal(RESOLVER_VERSION),
    toolName: z.literal(TOOL_NAME),
    toolVersion: z.literal("3"),
    model: z.null(),
    promptVersion: z.null(),
    outputSchemaVersion: z.literal(OUTPUT_SCHEMA_VERSION),
    startedAt: IsoDateTimeSchema,
    completedAt: IsoDateTimeSchema,
    latencyMs: z.number().int().nonnegative(),
    httpStatus: z.number().int().min(100).max(599).nullable(),
    providerRequestId: z.string().trim().min(1).max(256).nullable(),
    estimatedCostUsd: z.literal(0),
    origin: RecordOriginSchema,
  })
  .strict()
  .superRefine((attempt, context) => {
    if (attempt.origin.kind !== "RESOLVER") {
      context.addIssue({
        code: "custom",
        path: ["origin", "kind"],
        message: "TMDB identity attempts require RESOLVER provenance",
      });
    }
    if (attempt.origin.version !== RESOLVER_VERSION) {
      context.addIssue({
        code: "custom",
        path: ["origin", "version"],
        message: "TMDB identity provenance must match the resolver version",
      });
    }
  });

export const MovieIdentityUnavailableReasonSchema = z.enum([
  "AUTHENTICATION_FAILED",
  "NETWORK_ERROR",
  "REQUEST_TIMEOUT",
  "UPSTREAM_UNAVAILABLE",
  "INVALID_PROVIDER_RESPONSE",
  "UNEXPECTED_PROVIDER_RESPONSE",
]);

const VerifiedMovieSubjectSchema = MovieSubjectSchema.refine(
  (subject) => subject.providerResolution.state === "RESOLVER_VERIFIED",
  "Verified resolution requires a RESOLVER_VERIFIED movie subject",
);

export const MovieIdentityResolutionSchema = z.discriminatedUnion("state", [
  z
    .object({
      state: z.literal("VERIFIED"),
      subject: VerifiedMovieSubjectSchema,
      identity: MovieIdentityMetadataSchema,
      attempt: MovieIdentityResolutionAttemptSchema,
    })
    .strict(),
  z
    .object({
      state: z.literal("NOT_FOUND"),
      providerRef: z.string().regex(/^tmdb:movie:[1-9][0-9]*$/),
      attempt: MovieIdentityResolutionAttemptSchema,
    })
    .strict(),
  z
    .object({
      state: z.literal("RATE_LIMITED"),
      providerRef: z.string().regex(/^tmdb:movie:[1-9][0-9]*$/),
      retryAfterMs: z.number().int().nonnegative().nullable(),
      attempt: MovieIdentityResolutionAttemptSchema,
    })
    .strict(),
  z
    .object({
      state: z.literal("UNAVAILABLE"),
      providerRef: z.string().regex(/^tmdb:movie:[1-9][0-9]*$/),
      reason: MovieIdentityUnavailableReasonSchema,
      retryable: z.boolean(),
      attempt: MovieIdentityResolutionAttemptSchema,
    })
    .strict(),
]);

export type MovieIdentityMetadata = z.infer<
  typeof MovieIdentityMetadataSchema
>;
export type MovieIdentityResolution = z.infer<
  typeof MovieIdentityResolutionSchema
>;

type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export type TmdbMovieIdentityResolverOptions = Readonly<{
  apiKey: string;
  fetchImpl?: FetchLike;
  now?: () => Date;
  createTraceId?: () => string;
  timeoutMs?: number;
}>;

function normalizeReleaseDate(value: string | null | undefined): string | null {
  if (value === undefined || value === null || value === "") return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

function parseRetryAfter(value: string | null, nowMs: number): number | null {
  if (value === null) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.round(seconds * 1_000);
  }
  const dateMs = Date.parse(value);
  if (Number.isNaN(dateMs)) return null;
  return Math.max(0, dateMs - nowMs);
}

function safeProviderRequestId(value: string | null): string | null {
  if (value === null) return null;
  const normalized = value.trim();
  return normalized.length >= 1 && normalized.length <= 256
    ? normalized
    : null;
}

/**
 * Server-only Movie Investigator infrastructure. TMDB confirms subject
 * identity; its descriptive fields are never emitted as claims or evidence.
 */
export class TmdbMovieIdentityResolver {
  readonly #apiKey: string;
  readonly #fetch: FetchLike;
  readonly #now: () => Date;
  readonly #createTraceId: () => string;
  readonly #timeoutMs: number;

  constructor(options: TmdbMovieIdentityResolverOptions) {
    if (options.apiKey.trim().length === 0) {
      throw new Error("TMDB API key is required");
    }
    this.#apiKey = options.apiKey;
    this.#fetch = options.fetchImpl ?? globalThis.fetch;
    this.#now = options.now ?? (() => new Date());
    this.#createTraceId = options.createTraceId ?? randomUUID;
    this.#timeoutMs = options.timeoutMs ?? 10_000;
    if (!Number.isInteger(this.#timeoutMs) || this.#timeoutMs <= 0) {
      throw new Error("TMDB request timeout must be a positive integer");
    }
  }

  async resolve(subjectInput: MovieSubject): Promise<MovieIdentityResolution> {
    const subject = MovieSubjectSchema.parse(subjectInput);
    const traceId = EntityIdSchema.parse(this.#createTraceId());
    const started = this.#now();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.#timeoutMs);
    let httpStatus: number | null = null;
    let providerRequestId: string | null = null;

    const attempt = () => {
      const completed = this.#now();
      return MovieIdentityResolutionAttemptSchema.parse({
        traceId,
        resolverId: RESOLVER_ID,
        resolverVersion: RESOLVER_VERSION,
        toolName: TOOL_NAME,
        toolVersion: "3",
        model: null,
        promptVersion: null,
        outputSchemaVersion: OUTPUT_SCHEMA_VERSION,
        startedAt: started.toISOString(),
        completedAt: completed.toISOString(),
        latencyMs: Math.max(0, completed.getTime() - started.getTime()),
        httpStatus,
        providerRequestId,
        estimatedCostUsd: 0,
        origin: { kind: "RESOLVER", actorId: null, version: RESOLVER_VERSION },
      });
    };

    try {
      const url = new URL(
        `https://api.themoviedb.org/3/movie/${subject.providerMovieId}`,
      );
      url.searchParams.set("language", "en-US");
      url.searchParams.set("api_key", this.#apiKey);

      const response = await this.#fetch(url, {
        method: "GET",
        headers: { accept: "application/json" },
        signal: controller.signal,
        cache: "no-store",
      });
      httpStatus = response.status;
      providerRequestId = safeProviderRequestId(
        response.headers.get("x-request-id"),
      );

      if (response.status === 404) {
        return MovieIdentityResolutionSchema.parse({
          state: "NOT_FOUND",
          providerRef: subject.providerRef,
          attempt: attempt(),
        });
      }

      if (response.status === 429) {
        return MovieIdentityResolutionSchema.parse({
          state: "RATE_LIMITED",
          providerRef: subject.providerRef,
          retryAfterMs: parseRetryAfter(
            response.headers.get("retry-after"),
            this.#now().getTime(),
          ),
          attempt: attempt(),
        });
      }

      if (response.status === 401 || response.status === 403) {
        return MovieIdentityResolutionSchema.parse({
          state: "UNAVAILABLE",
          providerRef: subject.providerRef,
          reason: "AUTHENTICATION_FAILED",
          retryable: false,
          attempt: attempt(),
        });
      }

      if (response.status >= 500) {
        return MovieIdentityResolutionSchema.parse({
          state: "UNAVAILABLE",
          providerRef: subject.providerRef,
          reason: "UPSTREAM_UNAVAILABLE",
          retryable: true,
          attempt: attempt(),
        });
      }

      if (!response.ok) {
        return MovieIdentityResolutionSchema.parse({
          state: "UNAVAILABLE",
          providerRef: subject.providerRef,
          reason: "UNEXPECTED_PROVIDER_RESPONSE",
          retryable: false,
          attempt: attempt(),
        });
      }

      let providerBody: unknown;
      try {
        providerBody = await response.json();
      } catch {
        return MovieIdentityResolutionSchema.parse({
          state: "UNAVAILABLE",
          providerRef: subject.providerRef,
          reason: "INVALID_PROVIDER_RESPONSE",
          retryable: false,
          attempt: attempt(),
        });
      }
      const parsed = TmdbMovieDetailsResponseSchema.safeParse(providerBody);
      if (!parsed.success || parsed.data.id !== subject.providerMovieId) {
        return MovieIdentityResolutionSchema.parse({
          state: "UNAVAILABLE",
          providerRef: subject.providerRef,
          reason: "INVALID_PROVIDER_RESPONSE",
          retryable: false,
          attempt: attempt(),
        });
      }

      const resolvedAt = this.#now().toISOString();
      const verifiedSubject = MovieSubjectSchema.parse({
        ...subject,
        providerResolution: {
          state: "RESOLVER_VERIFIED",
          resolverId: RESOLVER_ID,
          resolverVersion: RESOLVER_VERSION,
          resolvedAt,
        },
      });
      const identity = MovieIdentityMetadataSchema.parse({
        provider: "TMDB",
        providerMovieId: parsed.data.id,
        providerRef: subject.providerRef,
        title: parsed.data.title,
        originalTitle: parsed.data.original_title,
        originalLanguage: parsed.data.original_language,
        releaseDate: normalizeReleaseDate(parsed.data.release_date),
        imdbId: parsed.data.imdb_id ?? null,
        resolvedAt,
      });

      return MovieIdentityResolutionSchema.parse({
        state: "VERIFIED",
        subject: verifiedSubject,
        identity,
        attempt: attempt(),
      });
    } catch (error) {
      const timedOut =
        controller.signal.aborted ||
        (error instanceof DOMException && error.name === "AbortError");
      return MovieIdentityResolutionSchema.parse({
        state: "UNAVAILABLE",
        providerRef: subject.providerRef,
        reason: timedOut ? "REQUEST_TIMEOUT" : "NETWORK_ERROR",
        retryable: true,
        attempt: attempt(),
      });
    } finally {
      clearTimeout(timeout);
    }
  }
}
