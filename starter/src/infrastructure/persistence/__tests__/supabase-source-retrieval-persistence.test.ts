import { describe, expect, it, vi } from "vitest";
import { SupabaseSourceRetrievalPersistence } from "@/infrastructure/persistence/supabase-source-retrieval-persistence";

const ACTOR_ID = "84000000-0000-4000-8000-000000000001";
const OTHER_ACTOR_ID = "84000000-0000-4000-8000-000000000002";
const RUN_ID = "84000000-0000-4000-8000-000000000003";
const JOB_ID = "84000000-0000-4000-8000-000000000004";
const ATTEMPT_ID = "84000000-0000-4000-8000-000000000005";
const CASE_ID = "84000000-0000-4000-8000-000000000006";
const CANDIDATE_ID = "84000000-0000-4000-8000-000000000007";
const SOURCE_ID = "84000000-0000-4000-8000-000000000008";
const LOCATOR_ID = "84000000-0000-4000-8000-000000000009";
const RESOLUTION_ID = "84000000-0000-4000-8000-000000000010";
const RETRIEVAL_ID = "84000000-0000-4000-8000-000000000011";
const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const T1 = "2026-08-30T19:00:00.000Z";
const T2 = "2026-08-30T19:01:00.000Z";

const candidate = {
  schemaVersion: 1,
  id: CANDIDATE_ID,
  runId: RUN_ID,
  jobId: "84000000-0000-4000-8000-000000000012",
  attemptId: "84000000-0000-4000-8000-000000000013",
  candidateKey: "candidate:article",
  title: "Resolved article",
  canonicalUrl: "https://example.com/article",
  medium: "ARTICLE",
  sourceClass: "editorial-analysis",
  axisIds: ["production-history"],
  accessState: "UNKNOWN",
  rightsState: "UNKNOWN",
  discoveryInputFingerprint: HASH_A,
  contentTrust: "UNTRUSTED",
  evidenceStatus: "NOT_EVIDENCE",
  reviewState: "PROPOSED",
  publicationAuthority: "NONE",
  createdAt: T1,
} as const;

const source = {
  id: SOURCE_ID,
  canonicalKey: "url-sha256:example",
  canonicalUrl: "https://example.com/article",
  title: "Resolved article",
  contributors: [],
  publisher: null,
  publishedAt: null,
  medium: "ARTICLE",
  sourceClass: "editorial-analysis",
  accessState: "OPEN",
  rightsState: "LINK_ONLY",
  independenceGroupId: null,
  origin: { kind: "RESOLVER", actorId: null, version: "1.0.0" },
  createdAt: T1,
} as const;

const locator = {
  id: LOCATOR_ID,
  sourceId: SOURCE_ID,
  kind: "ARTICLE",
  status: "SOURCE_ONLY",
  resolver: { id: "http-source-metadata", version: "1.0.0" },
  revision: 1,
  supersedesLocatorId: null,
  openUrl: "https://example.com/article",
  resolvedAt: T1,
  lastVerifiedAt: null,
  createdAt: T1,
  headingPath: [],
  paragraphIndex: null,
  textFingerprint: null,
  textFragmentUrl: null,
} as const;

const context = {
  schemaVersion: 1,
  runId: RUN_ID,
  jobId: JOB_ID,
  attemptId: ATTEMPT_ID,
  caseId: CASE_ID,
  manifestFingerprint: HASH_A,
  sources: [
    {
      candidate,
      resolutionRecordId: RESOLUTION_ID,
      resolutionFingerprint: HASH_B,
      source,
      locator,
    },
  ],
} as const;

const retrieval = {
  schemaVersion: 1,
  id: RETRIEVAL_ID,
  runId: RUN_ID,
  jobId: JOB_ID,
  attemptId: ATTEMPT_ID,
  caseId: CASE_ID,
  manifestFingerprint: HASH_A,
  resolutionRecordId: RESOLUTION_ID,
  idempotencyKey: "retrieve-article-once",
  policy: { id: "lawful-source-retrieval", version: "1.0.0" },
  retriever: { id: "public-source-retriever", version: "1.0.0" },
  result: {
    status: "UNAVAILABLE",
    candidateId: CANDIDATE_ID,
    sourceId: SOURCE_ID,
    sourceLocatorId: LOCATOR_ID,
    code: "retrieval-upstream-unavailable",
    instructionAuthority: "NONE",
    publicationAuthority: "NONE",
  },
  createdAt: T1,
  retrievalFingerprint: HASH_B,
  acceptedAt: T2,
} as const;

describe("SupabaseSourceRetrievalPersistence", () => {
  it("reads typed normalization context and accepted decisions through actor-scoped RPCs", async () => {
    const invokeRpc = vi.fn(async (name: string) => ({
      data:
        name === "af_get_normalization_retrieval_context_v1"
          ? context
          : [retrieval],
      error: null,
    }));
    const persistence = new SupabaseSourceRetrievalPersistence({
      actorId: ACTOR_ID,
      invokeRpc,
    });

    await expect(
      persistence.getNormalizationRetrievalContext({
        actorId: ACTOR_ID,
        runId: RUN_ID,
        jobId: JOB_ID,
        attemptId: ATTEMPT_ID,
      }),
    ).resolves.toEqual(context);
    await expect(
      persistence.listAcceptedRetrievals({
        actorId: ACTOR_ID,
        runId: RUN_ID,
        jobId: JOB_ID,
        attemptId: ATTEMPT_ID,
      }),
    ).resolves.toEqual([retrieval]);
    expect(invokeRpc).toHaveBeenNthCalledWith(
      1,
      "af_get_normalization_retrieval_context_v1",
      {
        p_actor_id: ACTOR_ID,
        p_run_id: RUN_ID,
        p_job_id: JOB_ID,
        p_attempt_id: ATTEMPT_ID,
      },
    );
  });

  it("fails closed before an RPC for actor substitution", async () => {
    const invokeRpc = vi.fn();
    const persistence = new SupabaseSourceRetrievalPersistence({
      actorId: ACTOR_ID,
      invokeRpc,
    });

    await expect(
      persistence.getNormalizationRetrievalContext({
        actorId: OTHER_ACTOR_ID,
        runId: RUN_ID,
        jobId: JOB_ID,
        attemptId: ATTEMPT_ID,
      }),
    ).resolves.toBeNull();
    await expect(
      persistence.listAcceptedRetrievals({
        actorId: OTHER_ACTOR_ID,
        runId: RUN_ID,
        jobId: JOB_ID,
        attemptId: ATTEMPT_ID,
      }),
    ).resolves.toEqual([]);
    expect(invokeRpc).not.toHaveBeenCalled();
  });

  it("rejects malformed database contracts without echoing data", async () => {
    const persistence = new SupabaseSourceRetrievalPersistence({
      actorId: ACTOR_ID,
      invokeRpc: vi.fn(async () => ({
        data: { ...context, sourceBody: "hostile private data" },
        error: null,
      })),
    });

    await expect(
      persistence.getNormalizationRetrievalContext({
        actorId: ACTOR_ID,
        runId: RUN_ID,
        jobId: JOB_ID,
        attemptId: ATTEMPT_ID,
      }),
    ).rejects.toMatchObject({
      code: "RPC_CONTRACT_INVALID",
      message: "Postgres returned an invalid normalization retrieval context",
    });
  });
});
