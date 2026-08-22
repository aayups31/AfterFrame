import { describe, expect, it } from "vitest";
import {
  ResearchAttemptInputManifestEnvelopeSchema,
  ResearchAttemptInputManifestSchema,
} from "@/core/research-runs/input-manifests";

const IDS = {
  run: "71000000-0000-4000-8000-000000000001",
  case: "71000000-0000-4000-8000-000000000002",
  branch: "71000000-0000-4000-8000-000000000003",
  plan: "71000000-0000-4000-8000-000000000004",
  identityJob: "71000000-0000-4000-8000-000000000005",
  scopingJob: "71000000-0000-4000-8000-000000000006",
  attempt: "71000000-0000-4000-8000-000000000007",
  output: "71000000-0000-4000-8000-000000000008",
  identity: "71000000-0000-4000-8000-000000000009",
} as const;

const HASHES = {
  subject: "1".repeat(64),
  objective: "2".repeat(64),
  request: "3".repeat(64),
  plan: "4".repeat(64),
  stage: "5".repeat(64),
  output: "6".repeat(64),
  identity: "7".repeat(64),
  manifest: "8".repeat(64),
} as const;

const rootManifest = {
  schemaVersion: 1,
  runId: IDS.run,
  caseId: IDS.case,
  branchId: IDS.branch,
  planId: IDS.plan,
  jobId: IDS.identityJob,
  stage: "IDENTITY",
  subjectRefFingerprint: HASHES.subject,
  objectiveFingerprint: HASHES.objective,
  runRequestFingerprint: HASHES.request,
  planFingerprint: HASHES.plan,
  stageSeedFingerprint: HASHES.stage,
  dependency: { state: "ROOT" },
  subjectIdentity: { state: "UNBOUND" },
} as const;

describe("database-authored causal research inputs", () => {
  it("accepts a root IDENTITY manifest and its opaque Postgres hash", () => {
    expect(ResearchAttemptInputManifestSchema.parse(rootManifest)).toEqual(
      rootManifest,
    );
    expect(
      ResearchAttemptInputManifestEnvelopeSchema.parse({
        schemaVersion: 1,
        authority: "POSTGRES",
        manifest: rootManifest,
        manifestFingerprint: HASHES.manifest,
        authoredAt: "2026-08-14T10:00:00.000Z",
      }).manifestFingerprint,
    ).toBe(HASHES.manifest);
  });

  it("requires every later stage to bind its immediate output and identity", () => {
    const scoping = {
      ...rootManifest,
      jobId: IDS.scopingJob,
      stage: "SCOPING",
      dependency: {
        state: "BOUND",
        predecessorJobId: IDS.identityJob,
        predecessorAttemptId: IDS.attempt,
        predecessorOutputId: IDS.output,
        predecessorOutputFingerprint: HASHES.output,
      },
      subjectIdentity: {
        state: "BOUND",
        subjectIdentityId: IDS.identity,
        identityFingerprint: HASHES.identity,
      },
    } as const;
    expect(ResearchAttemptInputManifestSchema.safeParse(scoping).success).toBe(
      true,
    );
    expect(
      ResearchAttemptInputManifestSchema.safeParse({
        ...scoping,
        dependency: { state: "ROOT" },
      }).success,
    ).toBe(false);
    expect(
      ResearchAttemptInputManifestSchema.safeParse({
        ...scoping,
        subjectIdentity: { state: "UNBOUND" },
      }).success,
    ).toBe(false);
  });

  it("rejects application authority, private text, and incomplete bindings", () => {
    expect(
      ResearchAttemptInputManifestEnvelopeSchema.safeParse({
        schemaVersion: 1,
        authority: "APPLICATION",
        manifest: rootManifest,
        manifestFingerprint: HASHES.manifest,
        authoredAt: "2026-08-14T10:00:00.000Z",
      }).success,
    ).toBe(false);
    expect(
      ResearchAttemptInputManifestSchema.safeParse({
        ...rootManifest,
        exactQuestion: "private question must never enter the manifest",
      }).success,
    ).toBe(false);
    expect(
      ResearchAttemptInputManifestSchema.safeParse({
        ...rootManifest,
        dependency: {
          state: "BOUND",
          predecessorJobId: IDS.identityJob,
        },
      }).success,
    ).toBe(false);
  });
});
