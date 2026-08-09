import { z } from "zod";
import {
  EntityIdSchema,
  IsoDateTimeSchema,
  RecordOriginSchema,
  SlugSchema,
  VersionTagSchema,
} from "@/core/shared/schemas";

export const ProvenanceRecordTypeSchema = z.enum([
  "CASE",
  "SUBJECT",
  "SOURCE",
  "SOURCE_SNAPSHOT",
  "LOCATOR",
  "EVIDENCE",
  "CLAIM",
  "CLAIM_EVIDENCE_EDGE",
  "DIRECTION",
  "BRANCH",
]);

export const ProvenanceRecordRefSchema = z
  .object({
    type: ProvenanceRecordTypeSchema,
    id: z.string().trim().min(1).max(512),
  })
  .strict();

export const ProvenanceRelationshipSchema = z.enum([
  "DERIVED_FROM",
  "EXTRACTED_FROM",
  "LOCATED_BY",
  "SUPPORTED_BY",
  "CONTRADICTED_BY",
  "CONTEXTUALIZED_BY",
  "TRIGGERED_BY",
  "SCOPED_TO",
  "SUPERSEDES",
  "VERIFIED_BY",
]);

export const DerivationMethodSchema = z
  .object({
    name: SlugSchema,
    version: VersionTagSchema,
  })
  .strict();

export const ProvenanceEdgeSchema = z
  .object({
    id: EntityIdSchema,
    caseId: EntityIdSchema,
    output: ProvenanceRecordRefSchema,
    input: ProvenanceRecordRefSchema,
    relationship: ProvenanceRelationshipSchema,
    origin: RecordOriginSchema,
    method: DerivationMethodSchema,
    runId: EntityIdSchema.nullable(),
    createdAt: IsoDateTimeSchema,
  })
  .strict()
  .superRefine((edge, context) => {
    if (
      edge.output.type === edge.input.type &&
      edge.output.id === edge.input.id
    ) {
      context.addIssue({
        code: "custom",
        path: ["input"],
        message: "A provenance record cannot derive from itself",
      });
    }
  });

export type ProvenanceRecordType = z.infer<typeof ProvenanceRecordTypeSchema>;
export type ProvenanceRecordRef = z.infer<typeof ProvenanceRecordRefSchema>;
export type ProvenanceEdge = z.infer<typeof ProvenanceEdgeSchema>;
