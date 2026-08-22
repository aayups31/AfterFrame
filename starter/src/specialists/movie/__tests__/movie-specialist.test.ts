import { describe, expect, it } from "vitest";
import { SpecialistSubjectRefSchema } from "@/core/cases/schemas";
import { SpecialistResearchPlanSchema } from "@/core/ports/investigation-specialist";
import { movieInvestigationSpecialist } from "@/specialists/movie/manifest";

function validatedSubject(id: string, versionId: string | null = null) {
  const result = movieInvestigationSpecialist.validateSubject(
    SpecialistSubjectRefSchema.parse({ type: "film", id, versionId }),
  );

  if (!result.valid) {
    throw new Error(result.reason);
  }

  return result.subject;
}

describe("Movie Investigator subject seam", () => {
  it.each(["tmdb:movie:1", "tmdb:movie:734991", "tmdb:movie:9999999"])(
    "accepts any structurally valid provider-qualified film reference: %s",
    (id) => {
      const result = movieInvestigationSpecialist.validateSubject(
        SpecialistSubjectRefSchema.parse({
          type: "film",
          id,
          versionId: null,
        }),
      );

      expect(result.valid).toBe(true);
      if (result.valid) {
        expect(result.subject.provider).toBe("TMDB");
        expect(result.subject.providerRef).toBe(id);
        expect(result.subject.providerResolution).toEqual({
          state: "UNRESOLVED",
        });
      }
    },
  );

  it("rejects unsupported subject types and malformed provider references", () => {
    const unsupported = movieInvestigationSpecialist.validateSubject(
      SpecialistSubjectRefSchema.parse({
        type: "series",
        id: "tmdb:tv:10",
        versionId: null,
      }),
    );
    const malformed = movieInvestigationSpecialist.validateSubject(
      SpecialistSubjectRefSchema.parse({
        type: "film",
        id: "tmdb:movie:0",
        versionId: null,
      }),
    );

    expect(unsupported).toMatchObject({
      valid: false,
      code: "UNSUPPORTED_SUBJECT_TYPE",
    });
    expect(malformed).toMatchObject({
      valid: false,
      code: "INVALID_SUBJECT_REFERENCE",
    });
  });

  it("keeps identified and unresolved film versions explicit", () => {
    const unresolved = validatedSubject("tmdb:movie:42");
    const identified = validatedSubject(
      "tmdb:movie:42",
      "cut:ca-theatrical:runtime-7200000",
    );

    expect(unresolved.versionIdentity).toEqual({
      state: "UNRESOLVED",
      ref: null,
    });
    expect(identified.versionIdentity).toEqual({
      state: "IDENTIFIED",
      ref: "cut:ca-theatrical:runtime-7200000",
    });
  });
});

describe("Movie Investigator source judgment", () => {
  it("exposes the promised source classes and makes community material lead-only", () => {
    const policy = movieInvestigationSpecialist.sourcePolicy();
    const byId = new Map(
      policy.map((sourceClass) => [sourceClass.id, sourceClass]),
    );

    expect([...byId.keys()]).toEqual([
      "books",
      "video-podcasts",
      "articles-trades",
      "official-archive",
      "film-text-screenplay",
      "criticism",
      "community",
    ]);
    expect(byId.get("community")?.evidenceUse).toBe("LEAD_ONLY");
    expect(
      policy.every(
        (sourceClass) =>
          sourceClass.credibilityCriteria.length > 0 &&
          sourceClass.locatorRequirements.length > 0,
      ),
    ).toBe(true);
  });

  it("selects source classes from the question instead of mechanically using every class", () => {
    const subject = validatedSubject("tmdb:movie:91");
    const historical = movieInvestigationSpecialist.planResearch({
      subject,
      question: "How historically accurate are the political events depicted?",
    });
    const production = movieInvestigationSpecialist.planResearch({
      subject,
      question:
        "How did the editor and cinematographer shape the production choice?",
    });

    expect(historical.sourceClassIds).toContain("official-archive");
    expect(historical.sourceClassIds).toContain("books");
    expect(historical.sourceClassIds).not.toContain("community");
    expect(production.sourceClassIds).toContain("video-podcasts");
    expect(production.sourceClassIds).toContain("articles-trades");
    expect(production.sourceClassIds).not.toContain("official-archive");
    expect(production.sourceClassIds).not.toEqual(historical.sourceClassIds);
  });

  it("requires version resolution before scene- or cut-dependent publication", () => {
    const unresolved = validatedSubject("tmdb:movie:123");
    const plan = movieInvestigationSpecialist.planResearch({
      subject: unresolved,
      question: "How does the alternate ending change the final scene?",
    });

    expect(plan.axes.map((axis) => axis.axisId)).toContain("versions-cuts");
    expect(plan.identityRequirements).toContainEqual(
      expect.objectContaining({
        id: "tmdb-film",
        state: "UNRESOLVED",
        basis: "STRUCTURAL_REFERENCE",
      }),
    );
    expect(plan.identityRequirements).toContainEqual(
      expect.objectContaining({
        id: "film-version",
        state: "UNRESOLVED",
        basis: "MISSING_REFERENCE",
      }),
    );
    expect(plan.coverageGaps).toContain(
      "TMDB film identity has not been provider-resolved",
    );
    expect(plan.coverageGaps).toContain(
      "Film version or cut identity has not been resolved",
    );
  });

  it("records an explicit version as identified without claiming resolver verification", () => {
    const identified = validatedSubject(
      "tmdb:movie:123",
      "cut:festival-premiere:runtime-6900000",
    );
    const plan = movieInvestigationSpecialist.planResearch({
      subject: identified,
      question: "What does the final shot suggest?",
    });

    expect(plan.identityRequirements).toContainEqual(
      expect.objectContaining({
        id: "film-version",
        state: "IDENTIFIED",
        basis: "EXPLICIT_REFERENCE",
      }),
    );
    expect(plan.identityRequirements).toContainEqual(
      expect.objectContaining({
        id: "tmdb-film",
        state: "UNRESOLVED",
        basis: "STRUCTURAL_REFERENCE",
      }),
    );
    expect(plan.identityRequirements).not.toContainEqual(
      expect.objectContaining({ state: "RESOLVER_VERIFIED" }),
    );
    expect(plan.coverageGaps).toEqual([
      "TMDB film identity has not been provider-resolved",
    ]);
  });

  it("rejects duplicate identity requirements before a plan can be persisted", () => {
    const plan = movieInvestigationSpecialist.planResearch({
      subject: validatedSubject("tmdb:movie:603"),
      question: "How did production choices shape the film's visual form?",
    });
    const firstRequirement = plan.identityRequirements[0];
    if (firstRequirement === undefined) {
      throw new Error("Movie research plan requires identity requirements");
    }

    expect(
      SpecialistResearchPlanSchema.safeParse({
        ...plan,
        identityRequirements: [
          ...plan.identityRequirements,
          firstRequirement,
        ],
      }).success,
    ).toBe(false);
    expect(
      SpecialistResearchPlanSchema.safeParse({
        ...plan,
        identityRequirements: Array.from({ length: 51 }, (_, index) => ({
          ...firstRequirement,
          id: `requirement-${index}`,
        })),
      }).success,
    ).toBe(false);
  });
});
