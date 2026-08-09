import {
  SpecialistManifestSchema,
  type InvestigationSpecialist,
} from "@/core/ports/investigation-specialist";
import {
  getMovieSourcePolicy,
  planMovieResearch,
} from "@/specialists/movie/research-policy";
import {
  validateMovieSubjectRef,
  type MovieSubject,
} from "@/specialists/movie/subject";

export const MOVIE_INVESTIGATOR_MANIFEST = SpecialistManifestSchema.parse({
  id: "movie-investigator",
  version: "0.1.0",
  supportedSubjectTypes: ["film"],
});

export const movieInvestigationSpecialist: InvestigationSpecialist<MovieSubject> =
  {
    manifest: MOVIE_INVESTIGATOR_MANIFEST,
    validateSubject: validateMovieSubjectRef,
    sourcePolicy: getMovieSourcePolicy,
    planResearch: ({ subject, question }) =>
      planMovieResearch(subject, question),
  };
