import {
  bindInvestigationSpecialist,
  type InvestigationSpecialistRegistry,
  type ResolvedInvestigationSpecialist,
} from "@/core/ports/investigation-specialist";
import { movieInvestigationSpecialist } from "@/specialists/movie/manifest";

export class StaticInvestigationSpecialistRegistry
  implements InvestigationSpecialistRegistry
{
  readonly #specialists: ReadonlyMap<string, ResolvedInvestigationSpecialist>;

  constructor(specialists: readonly ResolvedInvestigationSpecialist[]) {
    this.#specialists = new Map(
      specialists.map((specialist) => [
        `${specialist.manifest.id}@${specialist.manifest.version}`,
        specialist,
      ]),
    );
  }

  resolve(
    specialistId: string,
    specialistVersion: string,
  ): ResolvedInvestigationSpecialist | null {
    return (
      this.#specialists.get(`${specialistId}@${specialistVersion}`) ?? null
    );
  }
}

/** V1 deliberately composes one specialist: Movie Investigator. */
export const afterFrameV1SpecialistRegistry =
  new StaticInvestigationSpecialistRegistry([
    bindInvestigationSpecialist(movieInvestigationSpecialist),
  ]);
