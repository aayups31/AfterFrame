import { z } from "zod";

const NonEmptySecretSchema = z.string().min(1);

function projectReferenceFromSupabaseUrl(value: string) {
  try {
    const match = new URL(value).hostname.match(
      /^([a-z0-9]+)\.supabase\.co$/,
    );
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}

function projectReferenceFromDatabaseUrl(value: string) {
  try {
    const parsed = new URL(value);
    const directHost = parsed.hostname.match(
      /^db\.([a-z0-9]+)\.supabase\.co$/,
    );
    if (directHost?.[1] !== undefined) return directHost[1];
    if (parsed.hostname.endsWith(".pooler.supabase.com")) {
      const username = decodeURIComponent(parsed.username);
      return username.startsWith("postgres.")
        ? username.slice("postgres.".length)
        : null;
    }
    return null;
  } catch {
    return null;
  }
}

const PostgresConnectionStringSchema = z
  .string()
  .min(1)
  .superRefine((value, context) => {
    try {
      const parsed = new URL(value);
      if (
        !["postgres:", "postgresql:"].includes(parsed.protocol) ||
        parsed.username.length === 0 ||
        parsed.password.length === 0 ||
        parsed.hostname.length === 0 ||
        parsed.pathname.length <= 1
      ) {
        context.addIssue({
          code: "custom",
          message: "SUPABASE_DB_URL must be a credentialed PostgreSQL URL",
        });
      }
      if (/\[|\]|your[-_ ]?password|replace|example/i.test(value)) {
        context.addIssue({
          code: "custom",
          message: "SUPABASE_DB_URL cannot contain a placeholder",
        });
      }
    } catch {
      context.addIssue({
        code: "custom",
        message: "SUPABASE_DB_URL must be a valid URL",
      });
    }
  });

export const AfterFrameServerEnvironmentSchema = z
  .object({
    OPENAI_API_KEY: NonEmptySecretSchema,
    TMDB_API_KEY: NonEmptySecretSchema,
    NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
    NEXT_PUBLIC_SUPABASE_ANON_KEY: NonEmptySecretSchema,
    SUPABASE_SERVICE_ROLE_KEY: NonEmptySecretSchema,
    SUPABASE_DB_URL: PostgresConnectionStringSchema,
    AFTERFRAME_RESEARCH_MODE: z
      .enum(["fixture", "shadow"])
      .default("fixture"),
    OPENAI_RESEARCH_MODEL: z.string().trim().min(1).default("gpt-5.6-sol"),
    AFTERFRAME_SOURCE_METADATA_PROBE_ENABLED: z
      .enum(["true", "false"])
      .default("false")
      .transform((value) => value === "true"),
    AFTERFRAME_SOURCE_PAYLOAD_RETRIEVAL_ENABLED: z
      .enum(["true", "false"])
      .default("false")
      .transform((value) => value === "true"),
  })
  .strict()
  .superRefine((environment, context) => {
    const publicProjectRef = projectReferenceFromSupabaseUrl(
      environment.NEXT_PUBLIC_SUPABASE_URL,
    );
    const databaseProjectRef = projectReferenceFromDatabaseUrl(
      environment.SUPABASE_DB_URL,
    );
    if (
      publicProjectRef !== null &&
      databaseProjectRef !== null &&
      publicProjectRef !== databaseProjectRef
    ) {
      context.addIssue({
        code: "custom",
        path: ["SUPABASE_DB_URL"],
        message:
          "SUPABASE_DB_URL and NEXT_PUBLIC_SUPABASE_URL must belong to the same Supabase project",
      });
    }
  });

export type AfterFrameServerEnvironment = z.infer<
  typeof AfterFrameServerEnvironmentSchema
>;

const SERVER_ENV_KEYS = [
  "OPENAI_API_KEY",
  "TMDB_API_KEY",
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "SUPABASE_DB_URL",
  "AFTERFRAME_RESEARCH_MODE",
  "OPENAI_RESEARCH_MODEL",
  "AFTERFRAME_SOURCE_METADATA_PROBE_ENABLED",
  "AFTERFRAME_SOURCE_PAYLOAD_RETRIEVAL_ENABLED",
] as const;

/** Reads only the server configuration AfterFrame owns; unrelated process env is ignored. */
export function readAfterFrameServerEnvironment(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): AfterFrameServerEnvironment {
  const selected = Object.fromEntries(
    SERVER_ENV_KEYS.flatMap((key) => {
      const value = environment[key];
      return value === undefined ? [] : [[key, value]];
    }),
  );
  return AfterFrameServerEnvironmentSchema.parse(selected);
}

export function serverEnvironmentReadiness(
  environment: AfterFrameServerEnvironment,
) {
  return {
    mode: environment.AFTERFRAME_RESEARCH_MODE,
    researchModel: environment.OPENAI_RESEARCH_MODEL,
    openAIConfigured: environment.OPENAI_API_KEY.length > 0,
    tmdbConfigured: environment.TMDB_API_KEY.length > 0,
    supabaseConfigured:
      environment.NEXT_PUBLIC_SUPABASE_URL.length > 0 &&
      environment.NEXT_PUBLIC_SUPABASE_ANON_KEY.length > 0 &&
      environment.SUPABASE_SERVICE_ROLE_KEY.length > 0,
    databaseConfigured: environment.SUPABASE_DB_URL.length > 0,
    sourceMetadataProbeEnabled:
      environment.AFTERFRAME_SOURCE_METADATA_PROBE_ENABLED,
    sourcePayloadRetrievalEnabled:
      environment.AFTERFRAME_SOURCE_PAYLOAD_RETRIEVAL_ENABLED,
  } as const;
}
