import { describe, expect, it } from "vitest";
import { decideEvidenceReview, EvidenceReviewCandidateSchema, EvidenceSemanticAssessmentSchema } from "@/core/research/evidence-review";

const candidate = {
  id: "99200000-0000-4000-8000-000000000001",
  finding: "A synthetic document records a production date.", whySurfaced: "Fixture for source support.",
  shortQuote: null, epistemicKind: "FACTUAL_CLAIM", attributedSourceId: null,
  declaredRisks: [], limitations: ["Synthetic evaluation input."], reviewState: "PROPOSED", publicationAuthority: "NONE",
};
const assessment = {
  support: "SUPPORTED", sourceBasis: "DOCUMENT_OBSERVATION", recommendedEpistemicKind: "FACTUAL_CLAIM",
  contextSufficient: true, reasoning: "The synthetic passage directly records the date.",
  limitations: [], detectedRisks: [], supportRanges: [{ start: 0, end: 10 }],
  reviewState: "PROPOSED", instructionAuthority: "NONE", publicationAuthority: "NONE",
};

describe("evidence review policy", () => {
  it("makes supported material eligible for persistence without granting evidence or publication authority", () => {
    expect(decideEvidenceReview(candidate, assessment)).toMatchObject({
      status: "ELIGIBLE_FOR_PERSISTENCE", reviewState: "PROPOSED", evidenceStatus: "NOT_EVIDENCE", publicationAuthority: "NONE",
    });
  });
  it.each(["UNSUPPORTED", "CONTRADICTED"])("retains a %s decision instead of approving the finding", (support) => {
    expect(decideEvidenceReview(candidate, { ...assessment, support })).toMatchObject({ status: "REJECTED" });
  });
  it("preserves partial support and missing context", () => {
    expect(decideEvidenceReview(candidate, { ...assessment, support: "PARTIAL" })).toMatchObject({ status: "NEEDS_MORE_CONTEXT", reason: "PARTIAL_SUPPORT" });
    expect(decideEvidenceReview(candidate, { ...assessment, contextSufficient: false })).toMatchObject({ status: "NEEDS_MORE_CONTEXT", reason: "INSUFFICIENT_CONTEXT" });
  });
  it.each(["COMMUNITY_LEAD", "UNKNOWN"])("cannot promote %s to supported fact", (sourceBasis) => {
    expect(decideEvidenceReview(candidate, { ...assessment, sourceBasis })).toMatchObject({ status: "NEEDS_MORE_CONTEXT" });
  });
  it("requires source accounts to remain attributed", () => {
    expect(decideEvidenceReview(candidate, { ...assessment, sourceBasis: "SOURCE_ACCOUNT" })).toMatchObject({ status: "REJECTED", reason: "ATTRIBUTION_REQUIRED" });
    const account = { ...candidate, epistemicKind: "ATTRIBUTED_ACCOUNT", attributedSourceId: "99200000-0000-4000-8000-000000000002" };
    expect(decideEvidenceReview(account, { ...assessment, sourceBasis: "SOURCE_ACCOUNT", recommendedEpistemicKind: "ATTRIBUTED_ACCOUNT" })).toMatchObject({ status: "ELIGIBLE_FOR_PERSISTENCE" });
  });
  it("does not silently rewrite an interpretation into a factual claim", () => {
    expect(decideEvidenceReview({ ...candidate, epistemicKind: "INTERPRETATION" }, assessment)).toMatchObject({ status: "REJECTED", reason: "EPISTEMIC_KIND_MISMATCH" });
  });
  it("unions candidate and reviewer risk flags, even if the reviewer omits a declared risk", () => {
    expect(decideEvidenceReview({ ...candidate, declaredRisks: ["MATERIAL_ALLEGATION"] },
      { ...assessment, detectedRisks: ["RIGHTS_AMBIGUOUS"] })).toMatchObject({
      status: "NEEDS_HUMAN_REVIEW", riskFlags: ["MATERIAL_ALLEGATION", "RIGHTS_AMBIGUOUS"],
    });
  });
  it("rejects source text that attempts to set its own authority", () => {
    expect(EvidenceSemanticAssessmentSchema.safeParse({ ...assessment, reviewState: "ACCEPTED" }).success).toBe(false);
    expect(EvidenceReviewCandidateSchema.safeParse({ ...candidate, publicationAuthority: "GRANTED" }).success).toBe(false);
    expect(EvidenceSemanticAssessmentSchema.safeParse({ ...assessment, tools: ["fetch-secret"] }).success).toBe(false);
  });
  it("rejects missing, overlapping, reversed and out-of-bounds support ranges", () => {
    for (const supportRanges of [[], [{ start: 2, end: 1 }], [{ start: 0, end: 501 }], [{ start: 0, end: 10 }, { start: 5, end: 15 }]]) {
      expect(EvidenceSemanticAssessmentSchema.safeParse({ ...assessment, supportRanges }).success).toBe(false);
    }
  });
  it("requires source identity on an attributed account and preserves candidate wording exactly", () => {
    expect(EvidenceReviewCandidateSchema.safeParse({ ...candidate, epistemicKind: "ATTRIBUTED_ACCOUNT" }).success).toBe(false);
    expect(EvidenceReviewCandidateSchema.parse({ ...candidate, finding: "  Original wording.  " }).finding).toBe("  Original wording.  ");
  });
});
