import { createHash } from "node:crypto";
import { ResolvedPublicSubjectIdentitySchema } from "@/application/research/discovery-port";
import {
  MovieIdentityMetadataSchema,
  type MovieIdentityMetadata,
} from "@/specialists/movie/infrastructure/tmdb-movie-identity-resolver";

/** V1 composition bridge; domain-neutral research jobs never import Movie. */
export function movieIdentityToPublicResearchIdentity(
  identityInput: MovieIdentityMetadata,
) {
  const identity = MovieIdentityMetadataSchema.parse(identityInput);
  const canonicalIdentity = JSON.stringify({
    provider: identity.provider,
    providerMovieId: identity.providerMovieId,
    title: identity.title,
    originalTitle: identity.originalTitle,
    originalLanguage: identity.originalLanguage,
    releaseDate: identity.releaseDate,
    imdbId: identity.imdbId,
  });

  const disambiguators = [
    { label: "provider-id", value: String(identity.providerMovieId) },
    { label: "original-language", value: identity.originalLanguage },
    ...(identity.releaseDate === null
      ? []
      : [{ label: "release-date", value: identity.releaseDate }]),
    ...(identity.imdbId === null
      ? []
      : [{ label: "imdb-id", value: identity.imdbId }]),
  ];

  return ResolvedPublicSubjectIdentitySchema.parse({
    displayName: identity.title,
    alternateNames:
      identity.originalTitle === identity.title ? [] : [identity.originalTitle],
    disambiguators,
    identityFingerprint: createHash("sha256")
      .update(canonicalIdentity, "utf8")
      .digest("hex"),
    dataClass: "PUBLIC",
    verificationState: "RESOLVER_VERIFIED",
    resolver: { id: "tmdb-movie-details", version: "v3" },
    resolvedAt: identity.resolvedAt,
  });
}
