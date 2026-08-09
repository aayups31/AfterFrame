import { describe, expect, it } from "vitest";
import { movieIdentityToPublicResearchIdentity } from "@/infrastructure/research/movie-public-subject-identity";

describe("Movie identity research bridge", () => {
  it("creates only resolver-verified public discovery context", () => {
    const identity = movieIdentityToPublicResearchIdentity({
      provider: "TMDB",
      providerMovieId: 278,
      providerRef: "tmdb:movie:278",
      title: "Localized title",
      originalTitle: "Original title",
      originalLanguage: "en",
      releaseDate: "1994-09-23",
      imdbId: "tt0111161",
      resolvedAt: "2026-08-09T12:00:00.000Z",
    });

    expect(identity).toMatchObject({
      displayName: "Localized title",
      alternateNames: ["Original title"],
      dataClass: "PUBLIC",
      verificationState: "RESOLVER_VERIFIED",
      resolver: { id: "tmdb-movie-details", version: "v3" },
    });
    expect(identity.disambiguators).toEqual(
      expect.arrayContaining([
        { label: "provider-id", value: "278" },
        { label: "release-date", value: "1994-09-23" },
      ]),
    );
    expect(identity.identityFingerprint).toMatch(/^[a-f0-9]{64}$/);
  });
});
