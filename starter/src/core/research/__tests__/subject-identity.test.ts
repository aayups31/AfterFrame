import { describe, expect, it } from "vitest";
import { ResolvedSubjectIdentityRecordSchema } from "@/core/research/subject-identity";

const IDS = {
  identity: "72000000-0000-4000-8000-000000000001",
  case: "72000000-0000-4000-8000-000000000002",
  run: "72000000-0000-4000-8000-000000000003",
  job: "72000000-0000-4000-8000-000000000004",
  attempt: "72000000-0000-4000-8000-000000000005",
} as const;

const identity = {
  schemaVersion: 1,
  id: IDS.identity,
  caseId: IDS.case,
  runId: IDS.run,
  jobId: IDS.job,
  attemptId: IDS.attempt,
  subjectRefFingerprint: "1".repeat(64),
  publicIdentity: {
    displayName: "Black Hawk Down",
    alternateNames: [],
    disambiguators: [
      { label: "release-year", value: "2001" },
      { label: "provider-id", value: "tmdb:movie:855" },
    ],
    identityFingerprint: "2".repeat(64),
    dataClass: "PUBLIC",
    verificationState: "RESOLVER_VERIFIED",
    resolver: { id: "test-resolver", version: "1" },
    resolvedAt: "2026-08-14T10:00:00.000Z",
  },
  evidenceStatus: "NOT_EVIDENCE",
  reviewState: "PROPOSED",
  publicationAuthority: "NONE",
  provenanceInputs: [
    { recordType: "JOB", recordId: IDS.job },
    { recordType: "ATTEMPT", recordId: IDS.attempt },
  ],
  createdAt: "2026-08-14T10:00:01.000Z",
} as const;

describe("resolved subject identity records", () => {
  it("accepts a resolver-verified, body-free, non-evidence identity", () => {
    expect(ResolvedSubjectIdentityRecordSchema.parse(identity)).toEqual(
      identity,
    );
  });

  it("rejects provider bodies and any evidence or publication authority", () => {
    expect(
      ResolvedSubjectIdentityRecordSchema.safeParse({
        ...identity,
        providerBody: "untrusted provider response",
      }).success,
    ).toBe(false);
    expect(
      ResolvedSubjectIdentityRecordSchema.safeParse({
        ...identity,
        evidenceStatus: "VERIFIED",
      }).success,
    ).toBe(false);
    expect(
      ResolvedSubjectIdentityRecordSchema.safeParse({
        ...identity,
        publicationAuthority: "PUBLISH",
      }).success,
    ).toBe(false);
  });

  it("requires the exact producing job and attempt provenance", () => {
    expect(
      ResolvedSubjectIdentityRecordSchema.safeParse({
        ...identity,
        provenanceInputs: [
          { recordType: "JOB", recordId: IDS.job },
          { recordType: "JOB", recordId: IDS.job },
        ],
      }).success,
    ).toBe(false);
    expect(
      ResolvedSubjectIdentityRecordSchema.safeParse({
        ...identity,
        provenanceInputs: [
          { recordType: "JOB", recordId: IDS.job },
          { recordType: "ATTEMPT", recordId: IDS.identity },
        ],
      }).success,
    ).toBe(false);
  });

  it("cannot claim durable creation before resolver verification", () => {
    expect(
      ResolvedSubjectIdentityRecordSchema.safeParse({
        ...identity,
        createdAt: "2026-08-14T09:59:59.999Z",
      }).success,
    ).toBe(false);
  });
});
