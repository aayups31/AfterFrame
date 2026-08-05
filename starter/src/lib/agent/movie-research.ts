import type { MovieResearchAxis } from "./contracts";

export const MOVIE_RESEARCH_AXES: Record<
  MovieResearchAxis,
  { label: string; preferredSourceClasses: string[]; warning?: string }
> = {
  film_text: {
    label: "Film text",
    preferredSourceClasses: ["verified scene record", "user-provided frame", "permitted clip", "screenplay"],
    warning: "Never imply full-film access without an explicit permitted input.",
  },
  script_development: {
    label: "Script and development",
    preferredSourceClasses: ["screenplay draft", "treatment", "storyboard", "production archive", "trade report"],
  },
  authorship_collaboration: {
    label: "Authorship and collaboration",
    preferredSourceClasses: ["director interview", "writer interview", "cinematographer interview", "editor interview", "commentary"],
    warning: "Do not reduce collaborative choices to director intent alone.",
  },
  versions_cuts: {
    label: "Versions and cuts",
    preferredSourceClasses: ["release record", "cut comparison", "restoration notes", "ratings record"],
  },
  adaptation: {
    label: "Adaptation",
    preferredSourceClasses: ["source text", "edition record", "screenplay", "adapter interview", "scholarship"],
  },
  history_politics: {
    label: "History and politics",
    preferredSourceClasses: ["official record", "archive", "first-hand account", "scholarly history", "contemporary reporting"],
  },
  science_technology: {
    label: "Science and technology",
    preferredSourceClasses: ["peer-reviewed paper", "technical consultant interview", "institutional source", "specialist analysis"],
  },
  mythology_religion: {
    label: "Mythology and religion",
    preferredSourceClasses: ["primary text", "critical edition", "scholarship", "creator interview"],
  },
  reception_criticism: {
    label: "Reception and criticism",
    preferredSourceClasses: ["contemporary review", "scholarly criticism", "retrospective criticism", "community interpretation"],
  },
  influence_intertext: {
    label: "Influence and intertext",
    preferredSourceClasses: ["explicit creator acknowledgement", "production source", "chronology", "formal comparison"],
    warning: "Resemblance alone is not evidence of influence.",
  },
};
