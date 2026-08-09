import { z } from "zod";

const NonEmptySecretSchema = z.string().min(1);

export const AfterFrameServerEnvironmentSchema = z
  .object({
    OPENAI_API_KEY: NonEmptySecretSchema,
    TMDB_API_KEY: NonEmptySecretSchema,
    NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
    NEXT_PUBLIC_SUPABASE_ANON_KEY: NonEmptySecretSchema,
    SUPABASE_SERVICE_ROLE_KEY: NonEmptySecretSchema,
    AFTERFRAME_RESEARCH_MODE: z
      .enum(["fixture", "shadow"])
      .default("fixture"),
    OPENAI_RESEARCH_MODEL: z.string().trim().min(1).default("gpt-5.6-sol"),
  })
  .strict();

export type AfterFrameServerEnvironment = z.infer<
  typeof AfterFrameServerEnvironmentSchema
>;

const SERVER_ENV_KEYS = [
  "OPENAI_API_KEY",
  "TMDB_API_KEY",
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "AFTERFRAME_RESEARCH_MODE",
  "OPENAI_RESEARCH_MODEL",
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
  } as const;
}
