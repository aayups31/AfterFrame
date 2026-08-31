import { describe, expect, it } from "vitest";
import {
  readAfterFrameServerEnvironment,
  serverEnvironmentReadiness,
} from "@/infrastructure/config/server-environment";

const environment = {
  OPENAI_API_KEY: "openai-secret",
  TMDB_API_KEY: "tmdb-secret",
  NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "public-anon-key",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-secret",
  SUPABASE_DB_URL:
    "postgresql://postgres.project:database-secret@session.pooler.supabase.com:5432/postgres",
};

describe("server environment", () => {
  it("defaults to fixture mode even when live credentials exist", () => {
    const parsed = readAfterFrameServerEnvironment(environment);

    expect(parsed.AFTERFRAME_RESEARCH_MODE).toBe("fixture");
    expect(parsed.OPENAI_RESEARCH_MODEL).toBe("gpt-5.6-sol");
    expect(parsed.AFTERFRAME_SOURCE_METADATA_PROBE_ENABLED).toBe(false);
    expect(parsed.AFTERFRAME_SOURCE_PAYLOAD_RETRIEVAL_ENABLED).toBe(false);
  });

  it("allows live calls only through an explicit shadow-mode switch", () => {
    const parsed = readAfterFrameServerEnvironment({
      ...environment,
      AFTERFRAME_RESEARCH_MODE: "shadow",
      OPENAI_RESEARCH_MODEL: "gpt-5.6-terra",
      AFTERFRAME_SOURCE_METADATA_PROBE_ENABLED: "true",
      AFTERFRAME_SOURCE_PAYLOAD_RETRIEVAL_ENABLED: "true",
    });

    expect(serverEnvironmentReadiness(parsed)).toEqual({
      mode: "shadow",
      researchModel: "gpt-5.6-terra",
      openAIConfigured: true,
      tmdbConfigured: true,
      supabaseConfigured: true,
      databaseConfigured: true,
      sourceMetadataProbeEnabled: true,
      sourcePayloadRetrievalEnabled: true,
    });
  });

  it("never includes secret values in its readiness projection", () => {
    const readiness = serverEnvironmentReadiness(
      readAfterFrameServerEnvironment(environment),
    );

    const serialized = JSON.stringify(readiness);
    expect(serialized).not.toContain("openai-secret");
    expect(serialized).not.toContain("tmdb-secret");
    expect(serialized).not.toContain("service-role-secret");
    expect(serialized).not.toContain("database-secret");
  });

  it("fails closed when any required server credential is absent", () => {
    const missingServiceRole: Record<string, string | undefined> = {
      ...environment,
    };
    delete missingServiceRole.SUPABASE_SERVICE_ROLE_KEY;

    expect(() => readAfterFrameServerEnvironment(missingServiceRole)).toThrow();
  });

  it("rejects database URL templates before a migration tool can use them", () => {
    expect(() =>
      readAfterFrameServerEnvironment({
        ...environment,
        SUPABASE_DB_URL:
          "postgresql://postgres:[YOUR-PASSWORD]@db.project.supabase.co:5432/postgres",
      }),
    ).toThrow();
  });

  it("rejects a pooler URI copied from a different Supabase project", () => {
    expect(() =>
      readAfterFrameServerEnvironment({
        ...environment,
        SUPABASE_DB_URL:
          "postgresql://postgres.other-project:database-secret@session.pooler.supabase.com:5432/postgres",
      }),
    ).toThrow(/must belong to the same Supabase project/);
  });
});
