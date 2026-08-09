import { describe, expect, it } from "vitest";
import {
  InvestigationGraphSchema,
  validateInvestigationGraph,
} from "@/core/investigation-graph";
import { makeValidGraph } from "@/core/__tests__/test-fixtures";

describe("investigation graph integrity", () => {
  it("accepts a normalized, fully traceable investigation", () => {
    const graph = validateInvestigationGraph(makeValidGraph());
    expect(graph.sources).toHaveLength(1);
    expect(graph.locators).toHaveLength(1);
    expect(graph.evidence).toHaveLength(1);
    expect(graph.claims).toHaveLength(1);
  });

  it("rejects evidence whose locator belongs to another source", () => {
    const graph = makeValidGraph();
    graph.locators[0].sourceId = "00000000-0000-4000-8000-000000000099";
    expect(InvestigationGraphSchema.safeParse(graph).success).toBe(false);
  });

  it("rejects a locator whose kind is incompatible with its source medium", () => {
    const graph = makeValidGraph();
    graph.sources[0].medium = "VIDEO";
    expect(InvestigationGraphSchema.safeParse(graph).success).toBe(false);
  });

  it("rejects self-supersession and non-initial root revisions", () => {
    const selfSuperseding = makeValidGraph();
    selfSuperseding.locators[0].supersedesLocatorId =
      selfSuperseding.locators[0].id;
    selfSuperseding.locators[0].revision = 2;
    expect(InvestigationGraphSchema.safeParse(selfSuperseding).success).toBe(
      false,
    );

    const nonInitialRoot = makeValidGraph();
    nonInitialRoot.locators[0].revision = 2;
    expect(InvestigationGraphSchema.safeParse(nonInitialRoot).success).toBe(
      false,
    );
  });

  it("requires locator revisions to supersede the same source sequentially", () => {
    const wrongSource = makeValidGraph();
    const secondSourceId = "00000000-0000-4000-8000-000000000097";
    wrongSource.sources.push({
      ...wrongSource.sources[0],
      id: secondSourceId,
      canonicalKey: "isbn:9780000000001",
    });
    wrongSource.locators.push({
      ...wrongSource.locators[0],
      id: "00000000-0000-4000-8000-000000000098",
      sourceId: secondSourceId,
      supersedesLocatorId: wrongSource.locators[0].id,
      revision: 2,
    });
    expect(InvestigationGraphSchema.safeParse(wrongSource).success).toBe(false);

    const skippedRevision = makeValidGraph();
    skippedRevision.locators.push({
      ...skippedRevision.locators[0],
      id: "00000000-0000-4000-8000-000000000099",
      supersedesLocatorId: skippedRevision.locators[0].id,
      revision: 3,
    });
    expect(InvestigationGraphSchema.safeParse(skippedRevision).success).toBe(
      false,
    );
  });

  it("rejects accepted evidence backed only by a source-level locator", () => {
    const graph = makeValidGraph();
    graph.locators[0].status = "SOURCE_ONLY";
    expect(InvestigationGraphSchema.safeParse(graph).success).toBe(false);
  });

  it("rejects cross-case private snapshots and link-only quotations", () => {
    const crossCase = makeValidGraph();
    crossCase.snapshots[0].caseId = "00000000-0000-4000-8000-000000000099";
    expect(InvestigationGraphSchema.safeParse(crossCase).success).toBe(false);

    const quotedLinkOnly = makeValidGraph();
    quotedLinkOnly.sources[0].rightsState = "LINK_ONLY";
    quotedLinkOnly.snapshots[0].rightsState = "LINK_ONLY";
    quotedLinkOnly.snapshots[0].storageRef = null;
    quotedLinkOnly.evidence[0].shortQuote = "A retained excerpt";
    quotedLinkOnly.evidence[0].reviewState = "PROPOSED";
    expect(InvestigationGraphSchema.safeParse(quotedLinkOnly).success).toBe(
      false,
    );
  });

  it("does not accept evidence from unavailable source material", () => {
    const graph = makeValidGraph();
    graph.sources[0].accessState = "UNAVAILABLE";
    graph.snapshots[0].accessState = "UNAVAILABLE";
    graph.snapshots[0].storageRef = null;

    expect(InvestigationGraphSchema.safeParse(graph).success).toBe(false);
  });

  it("rejects a child branch with no direction provenance", () => {
    const graph = makeValidGraph();
    graph.provenanceEdges = graph.provenanceEdges.filter(
      (edge) => edge.relationship !== "TRIGGERED_BY",
    );
    expect(InvestigationGraphSchema.safeParse(graph).success).toBe(false);
  });

  it("rejects accepted claim edges without matching epistemic provenance", () => {
    const graph = makeValidGraph();
    graph.provenanceEdges = graph.provenanceEdges.filter(
      (edge) => edge.relationship !== "SUPPORTED_BY",
    );
    expect(InvestigationGraphSchema.safeParse(graph).success).toBe(false);
  });

  it("rejects duplicate normalized claim/evidence relationships", () => {
    const graph = makeValidGraph();
    graph.claimEvidenceEdges.push({
      ...graph.claimEvidenceEdges[0],
      id: "00000000-0000-4000-8000-000000000099",
    });
    expect(InvestigationGraphSchema.safeParse(graph).success).toBe(false);
  });
});
