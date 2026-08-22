import { describe, expect, it, vi } from "vitest";
import { SupabaseResearchIdentityReader } from "@/infrastructure/persistence/supabase-research-identity-reader";

const ACTOR_ID = "73000000-0000-4000-8000-000000000001";
const OTHER_ACTOR_ID = "73000000-0000-4000-8000-000000000002";
const CASE_ID = "73000000-0000-4000-8000-000000000003";
const RUN_ID = "73000000-0000-4000-8000-000000000004";
const JOB_ID = "73000000-0000-4000-8000-000000000005";
const ATTEMPT_ID = "73000000-0000-4000-8000-000000000006";
const IDENTITY_ID = "73000000-0000-4000-8000-000000000007";
const HASH = "a".repeat(64);
const TIME = "2026-08-14T12:00:00.000Z";

const context = {
  schemaVersion: 1,
  runId: RUN_ID,
  jobId: JOB_ID,
  caseId: CASE_ID,
  specialistId: "movie-investigator",
  specialistVersion: "0.1.0",
  subjectRef: { type: "film", id: "tmdb:movie:603", versionId: null },
  subjectRefFingerprint: HASH,
  identityRequirements: [
    {
      id: "tmdb-film",
      state: "UNRESOLVED",
      basis: "STRUCTURAL_REFERENCE",
      reason: "Provider identity remains unresolved.",
    },
  ],
} as const;

const resolvedIdentity = {
  schemaVersion: 1,
  id: IDENTITY_ID,
  caseId: CASE_ID,
  runId: RUN_ID,
  jobId: JOB_ID,
  attemptId: ATTEMPT_ID,
  subjectRefFingerprint: HASH,
  publicIdentity: {
    displayName: "The Matrix",
    alternateNames: [],
    disambiguators: [{ label: "provider-id", value: "603" }],
    identityFingerprint: HASH,
    dataClass: "PUBLIC",
    verificationState: "RESOLVER_VERIFIED",
    resolver: { id: "tmdb-movie-details", version: "v3" },
    resolvedAt: TIME,
  },
  evidenceStatus: "NOT_EVIDENCE",
  reviewState: "PROPOSED",
  publicationAuthority: "NONE",
  provenanceInputs: [
    { recordType: "JOB", recordId: JOB_ID },
    { recordType: "ATTEMPT", recordId: ATTEMPT_ID },
  ],
  createdAt: TIME,
} as const;

describe("Supabase research identity reader", () => {
  it("uses actor-scoped v1 reads and strictly parses both contracts", async () => {
    const invokeRpc = vi.fn(async (name: string) => ({
      data:
        name === "af_get_research_identity_context_v1"
          ? context
          : resolvedIdentity,
      error: null,
    }));
    const reader = new SupabaseResearchIdentityReader({
      actorId: ACTOR_ID,
      invokeRpc,
    });

    await expect(
      reader.getSubjectIdentityContext({
        actorId: ACTOR_ID,
        runId: RUN_ID,
        jobId: JOB_ID,
      }),
    ).resolves.toEqual(context);
    await expect(
      reader.getResolvedSubjectIdentity({ actorId: ACTOR_ID, runId: RUN_ID }),
    ).resolves.toEqual(resolvedIdentity);
    expect(invokeRpc).toHaveBeenNthCalledWith(
      1,
      "af_get_research_identity_context_v1",
      { p_actor_id: ACTOR_ID, p_run_id: RUN_ID, p_job_id: JOB_ID },
    );
    expect(invokeRpc).toHaveBeenNthCalledWith(
      2,
      "af_get_resolved_subject_identity_v1",
      { p_actor_id: ACTOR_ID, p_run_id: RUN_ID },
    );
  });

  it("preserves owner privacy without issuing an RPC for actor substitution", async () => {
    const invokeRpc = vi.fn();
    const reader = new SupabaseResearchIdentityReader({
      actorId: ACTOR_ID,
      invokeRpc,
    });

    await expect(
      reader.getSubjectIdentityContext({
        actorId: OTHER_ACTOR_ID,
        runId: RUN_ID,
        jobId: JOB_ID,
      }),
    ).resolves.toBeNull();
    await expect(
      reader.getResolvedSubjectIdentity({
        actorId: OTHER_ACTOR_ID,
        runId: RUN_ID,
      }),
    ).resolves.toBeNull();
    expect(invokeRpc).not.toHaveBeenCalled();
  });

  it("returns the same non-disclosing absence for actor-owned records that do not exist", async () => {
    const invokeRpc = vi.fn(async () => ({ data: null, error: null }));
    const reader = new SupabaseResearchIdentityReader({
      actorId: ACTOR_ID,
      invokeRpc,
    });

    await expect(
      reader.getSubjectIdentityContext({
        actorId: ACTOR_ID,
        runId: RUN_ID,
        jobId: JOB_ID,
      }),
    ).resolves.toBeNull();
    await expect(
      reader.getResolvedSubjectIdentity({
        actorId: ACTOR_ID,
        runId: RUN_ID,
      }),
    ).resolves.toBeNull();
    expect(invokeRpc).toHaveBeenCalledTimes(2);
  });

  it("rejects malformed data and redacts database diagnostics", async () => {
    const malformed = new SupabaseResearchIdentityReader({
      actorId: ACTOR_ID,
      invokeRpc: async () => ({
        data: { ...context, providerBody: "private provider body" },
        error: null,
      }),
    });
    await expect(
      malformed.getSubjectIdentityContext({
        actorId: ACTOR_ID,
        runId: RUN_ID,
        jobId: JOB_ID,
      }),
    ).rejects.toMatchObject({
      code: "RPC_CONTRACT_INVALID",
      message: "Postgres returned an invalid research identity context",
    });

    const unavailable = new SupabaseResearchIdentityReader({
      actorId: ACTOR_ID,
      invokeRpc: async () => ({
        data: null,
        error: { code: "XX000", message: "private database body" },
      }),
    });
    let caught: unknown;
    try {
      await unavailable.getResolvedSubjectIdentity({
        actorId: ACTOR_ID,
        runId: RUN_ID,
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toMatchObject({
      code: "PERSISTENCE_UNAVAILABLE",
      message: "The research identity reader is unavailable",
    });
    expect(String(caught)).not.toContain("private database body");
  });
});
