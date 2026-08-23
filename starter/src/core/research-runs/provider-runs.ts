import { z } from "zod";
import { NoPublicationAuthoritySchema } from "@/core/research-runs/schemas";
import {
  ResearchJobLeaseCursorSchema,
  ResearchWorkerCheckpointRecordSchema,
} from "@/core/research-runs/worker-schemas";
import {
  EntityIdSchema,
  IsoDateTimeSchema,
  OpaqueReferenceSchema,
  Sha256Schema,
} from "@/core/shared/schemas";

/** Provider-neutral worker recovery record; source/private bodies are absent. */
export const ResearchProviderRunRecordSchema = z
  .object({
    schemaVersion: z.literal(1),
    runId: EntityIdSchema,
    jobId: EntityIdSchema,
    attemptId: EntityIdSchema,
    caseId: EntityIdSchema,
    provider: z.literal("openai"),
    providerResponseId: OpaqueReferenceSchema,
    state: z.enum([
      "QUEUED",
      "IN_PROGRESS",
      "COMPLETED",
      "FAILED",
      "INCOMPLETE",
      "CANCELLED",
    ]),
    requestedModel: z.string().trim().min(1).max(200),
    providerModel: z.string().trim().min(1).max(200),
    traceId: OpaqueReferenceSchema,
    manifestFingerprint: Sha256Schema,
    externalIdempotencyKey: Sha256Schema,
    startedAt: IsoDateTimeSchema,
    acceptedAt: IsoDateTimeSchema,
    lastObservedAt: IsoDateTimeSchema,
    inputBytes: z.number().int().nonnegative(),
    dataControlMode: z.literal("MODIFIED_ABUSE_MONITORING"),
    projectIdFingerprint: Sha256Schema,
    privateContentIncluded: z.literal(true),
    publicationAuthority: NoPublicationAuthoritySchema,
  })
  .strict()
  .superRefine((record, context) => {
    const startedAt = new Date(record.startedAt).getTime();
    if (
      new Date(record.acceptedAt).getTime() < startedAt ||
      new Date(record.lastObservedAt).getTime() < startedAt
    ) {
      context.addIssue({
        code: "custom",
        path: ["acceptedAt"],
        message: "Provider acceptance and observation cannot precede provider start",
      });
    }
  });

export const ResearchProviderAcceptanceResultSchema = z.discriminatedUnion(
  "status",
  [
    z
      .object({
        status: z.enum(["COMMITTED", "REPLAY"]),
        lease: ResearchJobLeaseCursorSchema,
        checkpoint: ResearchWorkerCheckpointRecordSchema,
        providerRun: ResearchProviderRunRecordSchema,
      })
      .strict(),
    z.object({ status: z.enum(["CANCELLED", "LEASE_LOST"]) }).strict(),
  ],
);

export type ResearchProviderRunRecord = z.infer<
  typeof ResearchProviderRunRecordSchema
>;
export type ResearchProviderAcceptanceResult = z.infer<
  typeof ResearchProviderAcceptanceResultSchema
>;
