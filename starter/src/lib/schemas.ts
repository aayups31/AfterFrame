import { z } from "zod";

export const SourceLocatorSchema = z.object({
  kind: z.enum(["film_scene", "article", "video", "podcast", "pdf", "book", "archive", "webpage", "screenplay"]),
  canonicalUrl: z.string().url().optional(),
  originalUrl: z.string().url().optional(),
  providerId: z.string().optional(),
  filmVersionId: z.string().optional(),
  sceneId: z.string().optional(),
  timestampStartMs: z.number().int().nonnegative().optional(),
  timestampEndMs: z.number().int().nonnegative().optional(),
  editionId: z.string().optional(),
  isbn: z.string().optional(),
  pageStart: z.number().int().positive().optional(),
  pageEnd: z.number().int().positive().optional(),
  chapter: z.string().optional(),
  section: z.string().optional(),
  headingPath: z.array(z.string()).optional(),
  paragraphIndex: z.number().int().nonnegative().optional(),
  textFingerprint: z.string().optional(),
  status: z.enum(["verified", "approximate", "stale", "unavailable"]),
  resolverVersion: z.string(),
});

export const ProvisionalIntentSchema = z.object({
  objective: z.string(),
  scope: z.array(z.string()).min(1).max(8),
  excludedForNow: z.array(z.string()),
  researchDirections: z.array(z.string()).min(1).max(6),
  openingQuestion: z.string(),
});

export const DirectionRequestSchema = z.object({
  text: z.string().min(3).max(4000),
  anchor: z
    .object({
      beatId: z.string().optional(),
      evidenceId: z.string().optional(),
      selectedText: z.string().max(4000).optional(),
    })
    .optional(),
  requestedAction: z.enum(["auto", "theory", "challenge", "compare", "connect", "return"]).default("auto"),
});

export const DirectionResultSchema = z.object({
  directionId: z.string(),
  directionType: z.enum(["THEORY", "QUESTION", "LEAD", "FOCUS", "WIDEN", "CHALLENGE", "COMPARE", "CONNECT", "STYLE", "RETURN"]),
  branchAction: z.enum(["create", "redirect", "deepen", "detour", "compare", "propose_merge", "return"]),
  branchId: z.string(),
  acknowledgement: z.string().max(120),
  normalizedObjective: z.string(),
  researchAxes: z.array(z.string()),
});

export const ClosureRequestSchema = z.object({
  mode: z.enum(["case_world", "visual_script", "research_dossier", "outline", "director_brief", "evidence_appendix"]),
  includedBranchIds: z.array(z.string()).min(1),
  includeRejectedTheories: z.boolean().default(false),
  preserveOpenQuestions: z.boolean().default(true),
  generationLevel: z.enum(["structure_only", "structure_and_draft", "manual_blank"]).default("structure_and_draft"),
});
