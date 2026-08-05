import { z } from "zod";

export const ProductEventNameSchema = z.enum([
  "case_started",
  "intent_corrected",
  "investigation_activated",
  "beat_viewed",
  "source_hint_opened",
  "original_source_opened",
  "note_created",
  "note_revisited",
  "direction_submitted",
  "branch_opened",
  "branch_returned",
  "connection_accepted",
  "connection_dismissed",
  "case_paused",
  "case_reopened",
  "case_closed",
  "artifact_exported",
  "next_case_started",
  "locator_failed",
  "source_corrected",
]);

export const ProductEventSchema = z.object({
  name: ProductEventNameSchema,
  occurredAt: z.string().datetime(),
  anonymousUserId: z.string().min(8),
  sessionId: z.string().min(8),
  caseId: z.string().optional(),
  branchId: z.string().optional(),
  properties: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])),
});

export type ProductEvent = z.infer<typeof ProductEventSchema>;

const FORBIDDEN_PROPERTY_KEYS = [
  "note",
  "noteBody",
  "body",
  "selectedText",
  "excerpt",
  "sourceText",
  "curiosity",
  "theory",
  "projectName",
  "filmTitle",
];

export function redactEventProperties(
  properties: Record<string, unknown>,
): ProductEvent["properties"] {
  return Object.fromEntries(
    Object.entries(properties)
      .filter(([key]) => !FORBIDDEN_PROPERTY_KEYS.includes(key))
      .filter(([, value]) =>
        value === null || ["string", "number", "boolean"].includes(typeof value),
      )
      .map(([key, value]) => [key, value as string | number | boolean | null]),
  );
}
