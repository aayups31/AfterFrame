import { z } from "zod";
import type { SpecialistSubjectRef } from "@/core/cases/schemas";
import type { SpecialistSubjectValidation } from "@/core/ports/investigation-specialist";

const TMDB_MOVIE_REF_PATTERN = /^tmdb:movie:([1-9][0-9]*)$/;

export const MovieProviderResolutionSchema = z.discriminatedUnion("state", [
  z
    .object({
      state: z.literal("UNRESOLVED"),
    })
    .strict(),
  z
    .object({
      state: z.literal("RESOLVER_VERIFIED"),
      resolverId: z.string().trim().min(1).max(80),
      resolverVersion: z.string().trim().min(1).max(120),
      resolvedAt: z.string().datetime({ offset: true }),
    })
    .strict(),
]);

export const MovieVersionIdentitySchema = z.discriminatedUnion("state", [
  z
    .object({
      state: z.literal("IDENTIFIED"),
      ref: z.string().trim().min(1).max(512),
    })
    .strict(),
  z
    .object({
      state: z.literal("UNRESOLVED"),
      ref: z.null(),
    })
    .strict(),
]);

export const MovieSubjectSchema = z
  .object({
    type: z.literal("film"),
    provider: z.literal("TMDB"),
    providerMovieId: z.number().int().positive().safe(),
    providerRef: z.string().regex(TMDB_MOVIE_REF_PATTERN),
    providerResolution: MovieProviderResolutionSchema,
    versionIdentity: MovieVersionIdentitySchema,
  })
  .strict()
  .superRefine((subject, context) => {
    const matchedId = TMDB_MOVIE_REF_PATTERN.exec(subject.providerRef)?.[1];
    if (
      matchedId === undefined ||
      Number(matchedId) !== subject.providerMovieId
    ) {
      context.addIssue({
        code: "custom",
        path: ["providerRef"],
        message: "providerRef must contain providerMovieId",
      });
    }
  });

export type MovieVersionIdentity = z.infer<typeof MovieVersionIdentitySchema>;
export type MovieSubject = z.infer<typeof MovieSubjectSchema>;

/**
 * Performs structural validation only. Provider existence is resolved later by
 * infrastructure; accepting a reference never implies that a live lookup ran.
 */
export function validateMovieSubjectRef(
  reference: SpecialistSubjectRef,
): SpecialistSubjectValidation<MovieSubject> {
  if (reference.type !== "film") {
    return {
      valid: false,
      code: "UNSUPPORTED_SUBJECT_TYPE",
      reason: "Movie Investigator accepts film subjects only",
    };
  }

  const match = TMDB_MOVIE_REF_PATTERN.exec(reference.id);
  if (match === null) {
    return {
      valid: false,
      code: "INVALID_SUBJECT_REFERENCE",
      reason:
        "Film subjects require an opaque tmdb:movie:<positive-id> reference",
    };
  }

  const providerMovieId = Number(match[1]);
  if (!Number.isSafeInteger(providerMovieId)) {
    return {
      valid: false,
      code: "INVALID_SUBJECT_REFERENCE",
      reason: "TMDB movie identifier exceeds the supported integer range",
    };
  }

  const subject = MovieSubjectSchema.parse({
    type: "film",
    provider: "TMDB",
    providerMovieId,
    providerRef: reference.id,
    providerResolution: { state: "UNRESOLVED" },
    versionIdentity:
      reference.versionId === null
        ? { state: "UNRESOLVED", ref: null }
        : { state: "IDENTIFIED", ref: reference.versionId },
  });

  return { valid: true, subject };
}
