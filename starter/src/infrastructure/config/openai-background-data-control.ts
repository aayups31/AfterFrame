import { createHash } from "node:crypto";
import { z } from "zod";
import { IsoDateTimeSchema, OpaqueReferenceSchema, Sha256Schema } from "@/core/shared/schemas";
import { OpenAIBackgroundDataControlAttestationSchema } from "@/infrastructure/research/openai-background-discovery";

const OpenAIBackgroundDataControlEnvironmentSchema = z
  .object({
    AFTERFRAME_OPENAI_BACKGROUND_DATA_CONTROL_MODE: z.literal(
      "MODIFIED_ABUSE_MONITORING",
    ),
    AFTERFRAME_OPENAI_PROJECT_ID: z.string().trim().min(1).max(256),
    AFTERFRAME_OPENAI_DATA_CONTROL_ATTESTED_AT: IsoDateTimeSchema,
    AFTERFRAME_OPENAI_DATA_CONTROL_ATTESTED_BY: OpaqueReferenceSchema,
  })
  .strict();

const DATA_CONTROL_ENVIRONMENT_KEYS = [
  "AFTERFRAME_OPENAI_BACKGROUND_DATA_CONTROL_MODE",
  "AFTERFRAME_OPENAI_PROJECT_ID",
  "AFTERFRAME_OPENAI_DATA_CONTROL_ATTESTED_AT",
  "AFTERFRAME_OPENAI_DATA_CONTROL_ATTESTED_BY",
] as const;

function projectIdFingerprint(projectId: string) {
  return Sha256Schema.parse(
    createHash("sha256")
      .update("afterframe:openai-project-id:v1\0", "utf8")
      .update(projectId, "utf8")
      .digest("hex"),
  );
}

/**
 * Reads the deployment's explicit server-only assertion for OpenAI Background
 * mode. Absence or any other retention mode fails closed. The raw project ID
 * is reduced to a domain-separated fingerprint before it can enter a durable
 * provider record or trace.
 */
export function readOpenAIBackgroundDataControlAttestation(
  environment: Readonly<Record<string, string | undefined>> = process.env,
) {
  if (typeof window !== "undefined") {
    throw new Error("OpenAI data-control attestation is server-only");
  }
  const selected = Object.fromEntries(
    DATA_CONTROL_ENVIRONMENT_KEYS.flatMap((key) => {
      const value = environment[key];
      return value === undefined ? [] : [[key, value]];
    }),
  );
  const parsed = OpenAIBackgroundDataControlEnvironmentSchema.parse(selected);
  return OpenAIBackgroundDataControlAttestationSchema.parse({
    mode: parsed.AFTERFRAME_OPENAI_BACKGROUND_DATA_CONTROL_MODE,
    projectIdFingerprint: projectIdFingerprint(
      parsed.AFTERFRAME_OPENAI_PROJECT_ID,
    ),
    attestedAt: parsed.AFTERFRAME_OPENAI_DATA_CONTROL_ATTESTED_AT,
    attestedBy: parsed.AFTERFRAME_OPENAI_DATA_CONTROL_ATTESTED_BY,
  });
}

