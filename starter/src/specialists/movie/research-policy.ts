import { z } from "zod";
import {
  SpecialistResearchPlanSchema,
  SpecialistSourceClassPolicySchema,
  type SpecialistResearchPlan,
  type SpecialistSourceClassPolicy,
} from "@/core/ports/investigation-specialist";
import {
  MovieSubjectSchema,
  type MovieSubject,
} from "@/specialists/movie/subject";

export const MovieSourceClassIdSchema = z.enum([
  "books",
  "video-podcasts",
  "articles-trades",
  "official-archive",
  "film-text-screenplay",
  "criticism",
  "community",
]);

export const MovieResearchAxisIdSchema = z.enum([
  "film-form",
  "production-authorship",
  "versions-cuts",
  "adaptation-source",
  "history-context",
  "reception-interpretation",
  "influence-intertext",
]);

export type MovieSourceClassId = z.infer<typeof MovieSourceClassIdSchema>;
export type MovieResearchAxisId = z.infer<typeof MovieResearchAxisIdSchema>;

const sourcePolicyInput = [
  {
    id: "books",
    label: "Books and scholarship",
    evidenceUse: "EVIDENCE_CAPABLE",
    useWhen: [
      "The question needs sustained historical, biographical, adaptation, or scholarly context",
    ],
    credibilityCriteria: [
      "Identify the author's expertise, role, proximity, and possible incentives",
      "Trace citations and repeated claims to their original source",
      "Distinguish contemporary records from retrospective reconstruction",
      "Record publisher, publication date, edition, and translation where relevant",
    ],
    locatorRequirements: [
      "Identify the edition or ISBN before asserting exact pages",
      "Store chapter or section when pagination cannot be verified",
    ],
    limitations: [
      "Publication in book form does not make a claim independent or authoritative",
      "Copyrighted text remains link-only or minimally excerpted unless rights permit more",
    ],
  },
  {
    id: "video-podcasts",
    label: "Video and podcast material",
    evidenceUse: "EVIDENCE_CAPABLE",
    useWhen: [
      "The question benefits from creator, crew, participant, archive, expert, or long-form interview material",
    ],
    credibilityCriteria: [
      "Verify speaker identity, role, date, uploader provenance, and recording context",
      "Distinguish an original recording from edited clips and derivative retellings",
      "Record transcript basis, translation, omissions, and retrospective memory limits",
    ],
    locatorRequirements: [
      "Resolve provider item identity and exact start and end timestamps",
      "Fingerprint transcript cues when a permitted transcript is available",
    ],
    limitations: [
      "A participant or creator statement establishes that person's account, not objective truth or group intent",
    ],
  },
  {
    id: "articles-trades",
    label: "Articles and industry trades",
    evidenceUse: "EVIDENCE_CAPABLE",
    useWhen: [
      "The question needs contemporary reporting, production chronology, interviews, corrections, or industry context",
    ],
    credibilityCriteria: [
      "Identify the author, publication, editorial standards, date, and correction history",
      "Separate original reporting from syndication, aggregation, and unattributed repetition",
      "Evaluate named sources, documentary support, access, expertise, and incentives",
    ],
    locatorRequirements: [
      "Store canonical URL, heading path, paragraph position, and text fingerprint",
      "Re-resolve changed pages before retaining verified status",
    ],
    limitations: [
      "Reputable branding cannot substitute for support in the specific article",
    ],
  },
  {
    id: "official-archive",
    label: "Official records and archives",
    evidenceUse: "EVIDENCE_CAPABLE",
    useWhen: [
      "The question concerns history, law, politics, science, technical facts, chronology, or primary production records",
    ],
    credibilityCriteria: [
      "Verify issuing body, collection, item, version, date, custody, and authenticity",
      "Assess the record's scope, method, institutional incentives, omissions, and correction history",
      "Compare the record with independent evidence when it makes a material claim",
    ],
    locatorRequirements: [
      "Resolve record or collection identity plus page, section, item, or stable range",
    ],
    limitations: [
      "Official status makes a record primary evidence of an institution's account, not automatically complete or neutral truth",
    ],
  },
  {
    id: "film-text-screenplay",
    label: "Film text and screenplays",
    evidenceUse: "EVIDENCE_CAPABLE",
    useWhen: [
      "The question depends on what a film version depicts or what a particular screenplay draft contains",
    ],
    credibilityCriteria: [
      "Identify the film cut, territory, medium, runtime, or screenplay draft before comparison",
      "Record whether the observation comes from a permitted asset, user-owned input, verified scene record, or lawful screenplay",
      "Keep depiction, draft content, production intention, and real-world fact separate",
    ],
    locatorRequirements: [
      "Use a version-specific scene and time range for film observations",
      "Use draft identity plus page, scene number, or scene heading for screenplays",
    ],
    limitations: [
      "Never imply full-film or full-screenplay access without an explicit permitted basis",
      "A film depiction cannot independently establish a historical or biographical fact",
    ],
  },
  {
    id: "criticism",
    label: "Criticism and specialist analysis",
    evidenceUse: "INTERPRETIVE_EVIDENCE",
    useWhen: [
      "The question concerns meaning, form, reception, ambiguity, cultural context, or competing interpretations",
    ],
    credibilityCriteria: [
      "Evaluate the critic's expertise, argument, evidence, publication context, and engagement with counterreadings",
      "Separate a critic's interpretation from creator intention and production fact",
      "Check whether later criticism independently reasons from the film or merely repeats an earlier reading",
    ],
    locatorRequirements: [
      "Use a stable locator appropriate to the original article, book, lecture, or recording",
    ],
    limitations: [
      "Interpretive disagreement should remain visible rather than being converted into a factual confidence score",
    ],
  },
  {
    id: "community",
    label: "Community theories and discussion",
    evidenceUse: "LEAD_ONLY",
    useWhen: [
      "The question explicitly concerns audience reception, fan theories, or leads worth independently testing",
    ],
    credibilityCriteria: [
      "Preserve the original context and trace factual or intentional claims to inspectable independent sources",
      "Treat popularity and repetition as reception signals, never corroboration",
    ],
    locatorRequirements: [
      "Retain the original discussion URL, author context when public, and observation date",
    ],
    limitations: [
      "Community material may nominate a lead or document reception but cannot establish fact, influence, or creator intention",
    ],
  },
] as const;

export const MOVIE_SOURCE_POLICY: readonly SpecialistSourceClassPolicy[] =
  SpecialistSourceClassPolicySchema.array().parse(sourcePolicyInput);

type AxisDefinition = Readonly<{
  id: MovieResearchAxisId;
  signals: readonly RegExp[];
  objective: string;
  sourceClassIds: readonly MovieSourceClassId[];
  requiresVersionIdentity: boolean;
  adversarialQuestion: string | null;
}>;

const AXES: readonly AxisDefinition[] = [
  {
    id: "versions-cuts",
    signals: [
      /\bcut\b/i,
      /\bversions?\b/i,
      /director(?:'s)? cut/i,
      /alternate ending/i,
      /deleted scenes?/i,
      /\bruntime\b/i,
      /\brestoration\b/i,
    ],
    objective:
      "Resolve which release version is being discussed and compare only version-matched material.",
    sourceClassIds: [
      "film-text-screenplay",
      "articles-trades",
      "video-podcasts",
    ],
    requiresVersionIdentity: true,
    adversarialQuestion:
      "Could an apparent difference come from mismatched releases, territories, media, or runtimes?",
  },
  {
    id: "adaptation-source",
    signals: [
      /\badapt(?:ed|ation|ing)?\b/i,
      /source material/i,
      /\bnovel\b/i,
      /\bbook\b/i,
      /\bscreenplays?\b/i,
      /\bscripts?\b/i,
      /true stor(?:y|ies)/i,
    ],
    objective:
      "Compare the film with identified source works and screenplay drafts without collapsing changes into mistakes.",
    sourceClassIds: [
      "film-text-screenplay",
      "books",
      "articles-trades",
      "video-podcasts",
      "criticism",
    ],
    requiresVersionIdentity: true,
    adversarialQuestion:
      "Is the claimed change actually present in the identified source edition, draft, and film version?",
  },
  {
    id: "history-context",
    signals: [
      /\bhistor(?:y|ic|ical|ically)\b/i,
      /\baccur(?:ate|acy)\b/i,
      /actually happen/i,
      /real events?/i,
      /\bmissions?\b/i,
      /\boperations?\b/i,
      /\bbattles?\b/i,
      /\bwar\b/i,
      /\bpolitic(?:s|al)?\b/i,
      /\bscience\b/i,
      /\btechnical(?:ly)?\b/i,
      /\bmyth(?:ology|ological)?\b/i,
      /\breligio(?:n|us)\b/i,
    ],
    objective:
      "Separate what the film depicts from what independent records and domain evidence establish.",
    sourceClassIds: [
      "official-archive",
      "books",
      "articles-trades",
      "film-text-screenplay",
    ],
    requiresVersionIdentity: true,
    adversarialQuestion:
      "Which apparent agreement comes from sources repeating one origin, and what credible evidence contests it?",
  },
  {
    id: "production-authorship",
    signals: [
      /\bdirector\b/i,
      /\bwriter\b/i,
      /\bactor\b/i,
      /\bperformance\b/i,
      /cinematograph/i,
      /\bedit(?:or|ing)\b/i,
      /\bproduction\b/i,
      /behind the scenes/i,
      /\bfilmed\b/i,
      /\bintent(?:ion)?\b/i,
    ],
    objective:
      "Trace collaborative production choices through role-specific accounts and contemporary records.",
    sourceClassIds: [
      "video-podcasts",
      "articles-trades",
      "film-text-screenplay",
    ],
    requiresVersionIdentity: false,
    adversarialQuestion:
      "Does one creator's retrospective account overstate intention, consensus, or control over a collaborative choice?",
  },
  {
    id: "reception-interpretation",
    signals: [
      /\breception\b/i,
      /\breviews?\b/i,
      /\bcritics?\b/i,
      /\baudiences?\b/i,
      /\bcontrovers/i,
      /\blegacy\b/i,
      /fan theor/i,
      /\bcommunity\b/i,
      /what does .* mean/i,
    ],
    objective:
      "Compare bounded interpretations and reception contexts while preserving disagreement and ambiguity.",
    sourceClassIds: [
      "criticism",
      "articles-trades",
      "film-text-screenplay",
      "community",
    ],
    requiresVersionIdentity: true,
    adversarialQuestion:
      "Is a popular interpretation supported by the film, or primarily evidence of a later reception community?",
  },
  {
    id: "influence-intertext",
    signals: [
      /\binfluenc(?:e|ed|es)\b/i,
      /\binspir(?:e|ed|ation)\b/i,
      /\breferences?\b/i,
      /\bintertext/i,
      /\bhomage\b/i,
      /\bsimilar(?:ity|ities)?\b/i,
    ],
    objective:
      "Test proposed influence through chronology, explicit acknowledgement, production evidence, and close comparison.",
    sourceClassIds: [
      "film-text-screenplay",
      "video-podcasts",
      "articles-trades",
      "criticism",
    ],
    requiresVersionIdentity: true,
    adversarialQuestion:
      "Could resemblance reflect a shared convention or coincidence rather than direct influence?",
  },
  {
    id: "film-form",
    signals: [
      /\bscenes?\b/i,
      /\bshots?\b/i,
      /\bending\b/i,
      /\bopening\b/i,
      /\bcamera\b/i,
      /\bframes?\b/i,
      /\bcolou?r\b/i,
      /\bsound\b/i,
      /\bmusic\b/i,
      /\bsymbol/i,
      /\bthemes?\b/i,
      /\bcharacters?\b/i,
      /\bdialogue\b/i,
      /\bmontage\b/i,
      /\blighting\b/i,
      /\bcomposition\b/i,
    ],
    objective:
      "Begin with version-specific film evidence, then compare production accounts and bounded critical readings.",
    sourceClassIds: ["film-text-screenplay", "criticism", "video-podcasts"],
    requiresVersionIdentity: true,
    adversarialQuestion:
      "What other reading fits the same formal evidence without requiring unverified creator intention?",
  },
];

const DEFAULT_AXIS: AxisDefinition = {
  id: "film-form",
  signals: [],
  objective:
    "Establish what the identified film version supports before expanding into production or interpretation.",
  sourceClassIds: ["film-text-screenplay", "criticism"],
  requiresVersionIdentity: true,
  adversarialQuestion:
    "What evidence would distinguish a grounded reading from an attractive but unsupported interpretation?",
};

const QuestionSchema = z.string().trim().min(3).max(4_000);

function matchesQuestion(question: string, axis: AxisDefinition): boolean {
  return axis.signals.some((signal) => signal.test(question));
}

export function planMovieResearch(
  subjectInput: MovieSubject,
  questionInput: string,
): SpecialistResearchPlan {
  const subject = MovieSubjectSchema.parse(subjectInput);
  const question = QuestionSchema.parse(questionInput);
  const matchedAxes = AXES.filter((axis) => matchesQuestion(question, axis));
  const selectedAxes = matchedAxes.length > 0 ? matchedAxes : [DEFAULT_AXIS];
  const sourceClassIds = [
    ...new Set(selectedAxes.flatMap((axis) => axis.sourceClassIds)),
  ];
  const needsVersion = selectedAxes.some(
    (axis) => axis.requiresVersionIdentity,
  );

  return SpecialistResearchPlanSchema.parse({
    axes: selectedAxes.map((axis) => ({
      axisId: axis.id,
      objective: axis.objective,
      sourceClassIds: [...axis.sourceClassIds],
      adversarialQuestion: axis.adversarialQuestion,
    })),
    sourceClassIds,
    identityRequirements: [
      {
        id: "tmdb-film",
        state:
          subject.providerResolution.state === "RESOLVER_VERIFIED"
            ? "RESOLVER_VERIFIED"
            : "UNRESOLVED",
        basis:
          subject.providerResolution.state === "RESOLVER_VERIFIED"
            ? "RESOLVER"
            : "STRUCTURAL_REFERENCE",
        reason:
          subject.providerResolution.state === "RESOLVER_VERIFIED"
            ? `Provider identity ${subject.providerRef} was verified by ${subject.providerResolution.resolverId}@${subject.providerResolution.resolverVersion}.`
            : `Reference ${subject.providerRef} is structurally valid, but provider existence has not been resolved.`,
      },
      {
        id: "film-version",
        state:
          subject.versionIdentity.state === "IDENTIFIED"
            ? "IDENTIFIED"
            : needsVersion
              ? "UNRESOLVED"
              : "NOT_REQUIRED",
        basis:
          subject.versionIdentity.state === "IDENTIFIED"
            ? "EXPLICIT_REFERENCE"
            : needsVersion
              ? "MISSING_REFERENCE"
              : "POLICY",
        reason:
          subject.versionIdentity.state === "IDENTIFIED"
            ? `Research is scoped to explicit version reference ${subject.versionIdentity.ref}; this identifies the requested cut but does not resolver-verify it.`
            : needsVersion
              ? "This question can produce scene- or cut-dependent claims, so a film version must be resolved before publication."
              : "The opening source plan is not cut-dependent; version identity remains unresolved and no timecode claim may be published.",
      },
    ],
    coverageGaps: [
      ...(subject.providerResolution.state === "UNRESOLVED"
        ? ["TMDB film identity has not been provider-resolved"]
        : []),
      ...(needsVersion && subject.versionIdentity.state === "UNRESOLVED"
        ? ["Film version or cut identity has not been resolved"]
        : []),
    ],
  });
}

export function getMovieSourcePolicy(): readonly SpecialistSourceClassPolicy[] {
  return MOVIE_SOURCE_POLICY;
}
