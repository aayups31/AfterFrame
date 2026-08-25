import { describe, expect, it } from "vitest";
import {
  DurableSourceResolutionContextSchema,
  DurableSourceResolutionRecordSchema,
} from "@/application/research/source-resolution-port";

const HASH = "a".repeat(64);
const RUN_ID = "71000000-0000-4000-8000-000000000001";
const JOB_ID = "71000000-0000-4000-8000-000000000002";
const ATTEMPT_ID = "71000000-0000-4000-8000-000000000003";
const CASE_ID = "71000000-0000-4000-8000-000000000004";
const CANDIDATE_ID = "71000000-0000-4000-8000-000000000005";
const SOURCE_ID = "71000000-0000-4000-8000-000000000006";
const LOCATOR_ID = "71000000-0000-4000-8000-000000000007";
const CREATED_AT = "2026-08-25T16:00:00.000Z";

function resolvedRecord() {
  return {
    schemaVersion: 1,
    id: "71000000-0000-4000-8000-000000000008",
    runId: RUN_ID,
    jobId: JOB_ID,
    attemptId: ATTEMPT_ID,
    caseId: CASE_ID,
    manifestFingerprint: HASH,
    idempotencyKey: "resolution:candidate:1",
    resolver: { id: "http-source-metadata", version: "1.0.0" },
    result: {
      status: "RESOLVED",
      proposal: {
        candidateId: CANDIDATE_ID,
        source: {
          id: SOURCE_ID,
          canonicalKey: `url-sha256:${HASH}`,
          canonicalUrl: "https://example.com/analysis",
          title: "An analysis",
          contributors: [],
          publisher: null,
          publishedAt: null,
          medium: "ARTICLE",
          sourceClass: "editorial-analysis",
          accessState: "OPEN",
          rightsState: "LINK_ONLY",
          independenceGroupId: null,
          origin: {
            kind: "RESOLVER",
            actorId: null,
            version: "1.0.0",
          },
          createdAt: CREATED_AT,
        },
        locator: {
          id: LOCATOR_ID,
          sourceId: SOURCE_ID,
          kind: "ARTICLE",
          status: "SOURCE_ONLY",
          resolver: { id: "http-source-metadata", version: "1.0.0" },
          revision: 1,
          supersedesLocatorId: null,
          openUrl: "https://example.com/analysis",
          resolvedAt: CREATED_AT,
          lastVerifiedAt: null,
          createdAt: CREATED_AT,
          headingPath: [],
          paragraphIndex: null,
          textFingerprint: null,
          textFragmentUrl: null,
        },
        reviewState: "PROPOSED",
        metadataTrust: "UNTRUSTED_SOURCE_DATA",
        evidenceStatus: "NOT_EVIDENCE",
        publicationAuthority: "NONE",
        contentBodyIncluded: false,
      },
    },
    createdAt: CREATED_AT,
  } as const;
}

function candidate(id = CANDIDATE_ID) {
  return {
    schemaVersion: 1,
    id,
    runId: RUN_ID,
    jobId: "71000000-0000-4000-8000-000000000009",
    attemptId: "71000000-0000-4000-8000-000000000010",
    candidateKey: `candidate:${id}`,
    title: "Candidate",
    canonicalUrl: "https://example.com/analysis",
    medium: "ARTICLE",
    sourceClass: "editorial-analysis",
    axisIds: ["production-history"],
    accessState: "UNKNOWN",
    rightsState: "UNKNOWN",
    discoveryInputFingerprint: "b".repeat(64),
    contentTrust: "UNTRUSTED",
    evidenceStatus: "NOT_EVIDENCE",
    reviewState: "PROPOSED",
    publicationAuthority: "NONE",
    createdAt: "2026-08-25T15:00:00.000Z",
  } as const;
}

describe("durable source resolution contracts", () => {
  it("accepts only body-free proposed source and source-level locator authority", () => {
    expect(DurableSourceResolutionRecordSchema.parse(resolvedRecord())).toEqual(
      resolvedRecord(),
    );
  });

  it("rejects provenance that does not match the durable resolver", () => {
    const record = resolvedRecord();
    expect(() =>
      DurableSourceResolutionRecordSchema.parse({
        ...record,
        resolver: { id: "spoofed-resolver", version: "1.0.0" },
      }),
    ).toThrow(/resolver provenance/);
  });

  it("rejects a locator that disagrees with canonical source identity", () => {
    const record = resolvedRecord();
    expect(() =>
      DurableSourceResolutionRecordSchema.parse({
        ...record,
        result: {
          ...record.result,
          proposal: {
            ...record.result.proposal,
            locator: {
              ...record.result.proposal.locator,
              openUrl: "https://other.example/analysis",
            },
          },
        },
      }),
    ).toThrow(/source identity/);
  });

  it("requires a unique, run-bound candidate set in resolution context", () => {
    const context = {
      schemaVersion: 1,
      runId: RUN_ID,
      jobId: JOB_ID,
      attemptId: ATTEMPT_ID,
      caseId: CASE_ID,
      manifestFingerprint: HASH,
      candidates: [candidate(), candidate()],
    };
    expect(() => DurableSourceResolutionContextSchema.parse(context)).toThrow(
      /unique/,
    );
    expect(() =>
      DurableSourceResolutionContextSchema.parse({
        ...context,
        candidates: [
          {
            ...candidate(),
            runId: "71000000-0000-4000-8000-000000000011",
          },
        ],
      }),
    ).toThrow(/active run/);
  });
});
