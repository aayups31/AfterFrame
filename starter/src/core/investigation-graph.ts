import { z } from "zod";
import { InvestigationCaseSchema } from "@/core/cases/schemas";
import {
  DirectionEventSchema,
  InvestigationBranchSchema,
} from "@/core/branches/schemas";
import { ProvenanceEdgeSchema } from "@/core/provenance/schemas";
import {
  ClaimEvidenceEdgeSchema,
  ClaimRecordSchema,
  EvidenceFragmentSchema,
  SourceLocatorSchema,
  SourceRecordSchema,
  SourceSnapshotSchema,
} from "@/core/research/schemas";

const InvestigationGraphRecordsSchema = z
  .object({
    case: InvestigationCaseSchema,
    sources: z.array(SourceRecordSchema),
    snapshots: z.array(SourceSnapshotSchema),
    locators: z.array(SourceLocatorSchema),
    evidence: z.array(EvidenceFragmentSchema),
    claims: z.array(ClaimRecordSchema),
    claimEvidenceEdges: z.array(ClaimEvidenceEdgeSchema),
    branches: z.array(InvestigationBranchSchema),
    directions: z.array(DirectionEventSchema),
    provenanceEdges: z.array(ProvenanceEdgeSchema),
  })
  .strict();

type GraphRecords = z.infer<typeof InvestigationGraphRecordsSchema>;

const acceptedLocatorStatuses = new Set([
  "VERIFIED_EXACT",
  "VERIFIED_APPROXIMATE",
]);

const acceptedRightsStates = new Set([
  "PERMITTED",
  "LINK_ONLY",
  "USER_OWNED",
  "PUBLIC_DOMAIN",
  "LICENSED",
]);

const contentRetentionRightsStates = new Set([
  "PERMITTED",
  "USER_OWNED",
  "PUBLIC_DOMAIN",
  "LICENSED",
]);

const acceptedAccessStates = new Set(["OPEN", "RESTRICTED"]);

const polarityRelationship = {
  SUPPORTS: "SUPPORTED_BY",
  CONTRADICTS: "CONTRADICTED_BY",
  CONTEXTUALIZES: "CONTEXTUALIZED_BY",
} as const;

const locatorKindForSourceMedium = {
  ARTICLE: "ARTICLE",
  WEBPAGE: "WEBPAGE",
  BOOK: "BOOK",
  VIDEO: "VIDEO",
  PODCAST: "PODCAST",
  PDF: "PDF",
  ARCHIVE: "ARCHIVE",
  OFFICIAL_RECORD: "OFFICIAL_RECORD",
  SCREENPLAY: "SCREENPLAY",
  USER_ASSET: "USER_ASSET",
  OTHER: null,
} as const;

function addIssue(
  context: z.RefinementCtx,
  path: (string | number)[],
  message: string,
) {
  context.addIssue({ code: "custom", path, message });
}

function indexById<T extends { id: string }>(values: T[]) {
  return new Map(values.map((value) => [value.id, value]));
}

function checkUniqueIds(
  context: z.RefinementCtx,
  collectionName: keyof GraphRecords,
  values: { id: string }[],
) {
  const seen = new Set<string>();
  values.forEach((value, index) => {
    if (seen.has(value.id)) {
      addIssue(
        context,
        [collectionName, index, "id"],
        `Duplicate ${String(collectionName)} id ${value.id}`,
      );
    }
    seen.add(value.id);
  });
}

export const InvestigationGraphSchema =
  InvestigationGraphRecordsSchema.superRefine((graph, context) => {
    checkUniqueIds(context, "sources", graph.sources);
    checkUniqueIds(context, "snapshots", graph.snapshots);
    checkUniqueIds(context, "locators", graph.locators);
    checkUniqueIds(context, "evidence", graph.evidence);
    checkUniqueIds(context, "claims", graph.claims);
    checkUniqueIds(context, "claimEvidenceEdges", graph.claimEvidenceEdges);
    checkUniqueIds(context, "branches", graph.branches);
    checkUniqueIds(context, "directions", graph.directions);
    checkUniqueIds(context, "provenanceEdges", graph.provenanceEdges);

    const sources = indexById(graph.sources);
    const snapshots = indexById(graph.snapshots);
    const locators = indexById(graph.locators);
    const evidence = indexById(graph.evidence);
    const claims = indexById(graph.claims);
    const claimEvidenceEdges = indexById(graph.claimEvidenceEdges);
    const branches = indexById(graph.branches);
    const directions = indexById(graph.directions);

    graph.snapshots.forEach((snapshot, index) => {
      if (!sources.has(snapshot.sourceId)) {
        addIssue(context, ["snapshots", index, "sourceId"], "Unknown sourceId");
      }
      if (snapshot.caseId !== null && snapshot.caseId !== graph.case.id) {
        addIssue(
          context,
          ["snapshots", index, "caseId"],
          "Private snapshot belongs to another case",
        );
      }
    });

    graph.locators.forEach((locator, index) => {
      const source = sources.get(locator.sourceId);
      if (!source) {
        addIssue(context, ["locators", index, "sourceId"], "Unknown sourceId");
      } else if (locatorKindForSourceMedium[source.medium] !== locator.kind) {
        addIssue(
          context,
          ["locators", index, "kind"],
          `A ${source.medium} source cannot use a ${locator.kind} locator`,
        );
      }

      if (locator.supersedesLocatorId === null) {
        if (locator.revision !== 1) {
          addIssue(
            context,
            ["locators", index, "revision"],
            "A locator without a predecessor must begin at revision 1",
          );
        }
      } else {
        const superseded = locators.get(locator.supersedesLocatorId);
        if (locator.supersedesLocatorId === locator.id) {
          addIssue(
            context,
            ["locators", index, "supersedesLocatorId"],
            "A locator cannot supersede itself",
          );
        } else if (!superseded) {
          addIssue(
            context,
            ["locators", index, "supersedesLocatorId"],
            "Unknown superseded locator",
          );
        } else {
          if (superseded.sourceId !== locator.sourceId) {
            addIssue(
              context,
              ["locators", index, "supersedesLocatorId"],
              "A locator can only supersede a locator for the same source",
            );
          }
          if (locator.revision !== superseded.revision + 1) {
            addIssue(
              context,
              ["locators", index, "revision"],
              "Locator revisions must advance exactly once from their predecessor",
            );
          }
        }
      }
    });

    graph.evidence.forEach((fragment, index) => {
      const snapshot = snapshots.get(fragment.snapshotId);
      const locator = locators.get(fragment.locatorId);
      const source = sources.get(fragment.sourceId);

      if (fragment.caseId !== graph.case.id) {
        addIssue(
          context,
          ["evidence", index, "caseId"],
          "Evidence belongs to another case",
        );
      }
      if (!source) {
        addIssue(context, ["evidence", index, "sourceId"], "Unknown sourceId");
      }
      if (!snapshot) {
        addIssue(
          context,
          ["evidence", index, "snapshotId"],
          "Unknown snapshotId",
        );
      } else if (snapshot.sourceId !== fragment.sourceId) {
        addIssue(
          context,
          ["evidence", index, "snapshotId"],
          "Snapshot belongs to another source",
        );
      }
      if (!locator) {
        addIssue(
          context,
          ["evidence", index, "locatorId"],
          "Unknown locatorId",
        );
      } else if (locator.sourceId !== fragment.sourceId) {
        addIssue(
          context,
          ["evidence", index, "locatorId"],
          "Locator belongs to another source",
        );
      }

      if (fragment.reviewState === "ACCEPTED") {
        if (!locator || !acceptedLocatorStatuses.has(locator.status)) {
          addIssue(
            context,
            ["evidence", index, "reviewState"],
            "Accepted evidence requires a verified locator",
          );
        }
        if (!source || !acceptedRightsStates.has(source.rightsState)) {
          addIssue(
            context,
            ["evidence", index, "reviewState"],
            "Accepted evidence requires an accepted source rights state",
          );
        }
        if (!snapshot || !acceptedRightsStates.has(snapshot.rightsState)) {
          addIssue(
            context,
            ["evidence", index, "reviewState"],
            "Accepted evidence requires an accepted snapshot rights state",
          );
        }
        if (!source || !acceptedAccessStates.has(source.accessState)) {
          addIssue(
            context,
            ["evidence", index, "reviewState"],
            "Accepted evidence requires an accessible source",
          );
        }
        if (!snapshot || !acceptedAccessStates.has(snapshot.accessState)) {
          addIssue(
            context,
            ["evidence", index, "reviewState"],
            "Accepted evidence requires an accessible snapshot",
          );
        }
      }

      if (
        fragment.shortQuote !== null &&
        (!source ||
          !snapshot ||
          !contentRetentionRightsStates.has(source.rightsState) ||
          !contentRetentionRightsStates.has(snapshot.rightsState) ||
          !acceptedAccessStates.has(source.accessState) ||
          !acceptedAccessStates.has(snapshot.accessState))
      ) {
        addIssue(
          context,
          ["evidence", index, "shortQuote"],
          "Quoted excerpts require explicit content-retention rights",
        );
      }
    });

    graph.branches.forEach((branch, index) => {
      if (branch.caseId !== graph.case.id) {
        addIssue(
          context,
          ["branches", index, "caseId"],
          "Branch belongs to another case",
        );
      }

      if (branch.parentBranchId !== null) {
        const parent = branches.get(branch.parentBranchId);
        if (!parent || parent.caseId !== graph.case.id) {
          addIssue(
            context,
            ["branches", index, "parentBranchId"],
            "Unknown parent branch",
          );
        }
      }

      if (branch.originDirectionId !== null) {
        const direction = directions.get(branch.originDirectionId);
        if (!direction) {
          addIssue(
            context,
            ["branches", index, "originDirectionId"],
            "Unknown origin direction",
          );
        } else if (direction.sourceBranchId !== branch.parentBranchId) {
          addIssue(
            context,
            ["branches", index, "originDirectionId"],
            "Origin direction must come from the parent branch",
          );
        }
      }

      const visited = new Set([branch.id]);
      let parentId = branch.parentBranchId;
      while (parentId !== null) {
        if (visited.has(parentId)) {
          addIssue(
            context,
            ["branches", index, "parentBranchId"],
            "Branch ancestry contains a cycle",
          );
          break;
        }
        visited.add(parentId);
        parentId = branches.get(parentId)?.parentBranchId ?? null;
      }
    });

    const rootBranches = graph.branches.filter(
      (branch) => branch.kind === "ROOT",
    );
    if (rootBranches.length !== 1) {
      addIssue(
        context,
        ["branches"],
        "An investigation requires exactly one ROOT branch",
      );
    }
    if (
      graph.case.activeBranchId !== null &&
      !branches.has(graph.case.activeBranchId)
    ) {
      addIssue(context, ["case", "activeBranchId"], "Unknown active branch");
    }

    graph.directions.forEach((direction, index) => {
      const sourceBranch = branches.get(direction.sourceBranchId);
      if (direction.caseId !== graph.case.id) {
        addIssue(
          context,
          ["directions", index, "caseId"],
          "Direction belongs to another case",
        );
      }
      if (!sourceBranch || sourceBranch.caseId !== graph.case.id) {
        addIssue(
          context,
          ["directions", index, "sourceBranchId"],
          "Unknown source branch",
        );
      }
      if (direction.anchor !== null) {
        if (direction.anchor.branchId !== direction.sourceBranchId) {
          addIssue(
            context,
            ["directions", index, "anchor", "branchId"],
            "Anchor must belong to the source branch",
          );
        }
        if (
          direction.anchor.evidenceId !== null &&
          !evidence.has(direction.anchor.evidenceId)
        ) {
          addIssue(
            context,
            ["directions", index, "anchor", "evidenceId"],
            "Unknown anchored evidence",
          );
        }
        if (
          direction.anchor.claimId !== null &&
          !claims.has(direction.anchor.claimId)
        ) {
          addIssue(
            context,
            ["directions", index, "anchor", "claimId"],
            "Unknown anchored claim",
          );
        }
      }
    });

    graph.claims.forEach((claim, index) => {
      if (claim.caseId !== graph.case.id) {
        addIssue(
          context,
          ["claims", index, "caseId"],
          "Claim belongs to another case",
        );
      }
      if (claim.branchId !== null && !branches.has(claim.branchId)) {
        addIssue(
          context,
          ["claims", index, "branchId"],
          "Unknown claim branch",
        );
      }
      if (claim.supersedesClaimId !== null) {
        const superseded = claims.get(claim.supersedesClaimId);
        if (!superseded || superseded.caseId !== claim.caseId) {
          addIssue(
            context,
            ["claims", index, "supersedesClaimId"],
            "Unknown superseded claim",
          );
        }
        if (claim.supersedesClaimId === claim.id) {
          addIssue(
            context,
            ["claims", index, "supersedesClaimId"],
            "A claim cannot supersede itself",
          );
        }
      }
    });

    const normalizedEdgeKeys = new Set<string>();
    graph.claimEvidenceEdges.forEach((edge, index) => {
      const claim = claims.get(edge.claimId);
      const fragment = evidence.get(edge.evidenceId);
      const key = `${edge.claimId}:${edge.evidenceId}:${edge.polarity}`;

      if (normalizedEdgeKeys.has(key)) {
        addIssue(
          context,
          ["claimEvidenceEdges", index],
          "Duplicate claim/evidence polarity edge",
        );
      }
      normalizedEdgeKeys.add(key);

      if (edge.caseId !== graph.case.id) {
        addIssue(
          context,
          ["claimEvidenceEdges", index, "caseId"],
          "Claim edge belongs to another case",
        );
      }
      if (!claim || claim.caseId !== edge.caseId) {
        addIssue(
          context,
          ["claimEvidenceEdges", index, "claimId"],
          "Unknown claimId",
        );
      }
      if (!fragment || fragment.caseId !== edge.caseId) {
        addIssue(
          context,
          ["claimEvidenceEdges", index, "evidenceId"],
          "Unknown evidenceId",
        );
      }
      if (
        edge.reviewState === "ACCEPTED" &&
        (claim?.reviewState !== "ACCEPTED" ||
          fragment?.reviewState !== "ACCEPTED")
      ) {
        addIssue(
          context,
          ["claimEvidenceEdges", index, "reviewState"],
          "Accepted claim edges require accepted claim and evidence records",
        );
      }
    });

    graph.claims.forEach((claim, index) => {
      if (
        claim.reviewState === "ACCEPTED" &&
        claim.epistemicKind !== "QUESTION" &&
        claim.epistemicKind !== "UNCERTAINTY" &&
        claim.assessmentState !== "UNRESOLVED" &&
        !graph.claimEvidenceEdges.some(
          (edge) =>
            edge.claimId === claim.id && edge.reviewState === "ACCEPTED",
        )
      ) {
        addIssue(
          context,
          ["claims", index, "assessmentState"],
          "An assessed accepted claim requires accepted evidence",
        );
      }
    });

    const recordExists = (type: string, id: string): boolean => {
      switch (type) {
        case "CASE":
          return id === graph.case.id;
        case "SUBJECT":
          return id === graph.case.subjectRef.id;
        case "SOURCE":
          return sources.has(id);
        case "SOURCE_SNAPSHOT":
          return snapshots.has(id);
        case "LOCATOR":
          return locators.has(id);
        case "EVIDENCE":
          return evidence.has(id);
        case "CLAIM":
          return claims.has(id);
        case "CLAIM_EVIDENCE_EDGE":
          return claimEvidenceEdges.has(id);
        case "DIRECTION":
          return directions.has(id);
        case "BRANCH":
          return branches.has(id);
        default:
          return false;
      }
    };

    const provenanceKeys = new Set<string>();
    graph.provenanceEdges.forEach((edge, index) => {
      const key = `${edge.output.type}:${edge.output.id}:${edge.relationship}:${edge.input.type}:${edge.input.id}`;
      if (provenanceKeys.has(key)) {
        addIssue(
          context,
          ["provenanceEdges", index],
          "Duplicate provenance relationship",
        );
      }
      provenanceKeys.add(key);

      if (edge.caseId !== graph.case.id) {
        addIssue(
          context,
          ["provenanceEdges", index, "caseId"],
          "Provenance belongs to another case",
        );
      }
      if (!recordExists(edge.output.type, edge.output.id)) {
        addIssue(
          context,
          ["provenanceEdges", index, "output"],
          "Unknown provenance output",
        );
      }
      if (!recordExists(edge.input.type, edge.input.id)) {
        addIssue(
          context,
          ["provenanceEdges", index, "input"],
          "Unknown provenance input",
        );
      }
    });

    const hasProvenance = (
      outputType: string,
      outputId: string,
      relationship: string,
      inputType: string,
      inputId: string,
    ) =>
      graph.provenanceEdges.some(
        (edge) =>
          edge.output.type === outputType &&
          edge.output.id === outputId &&
          edge.relationship === relationship &&
          edge.input.type === inputType &&
          edge.input.id === inputId,
      );

    graph.snapshots.forEach((snapshot, index) => {
      if (
        !hasProvenance(
          "SOURCE_SNAPSHOT",
          snapshot.id,
          "DERIVED_FROM",
          "SOURCE",
          snapshot.sourceId,
        )
      ) {
        addIssue(
          context,
          ["snapshots", index],
          "Snapshot requires source provenance",
        );
      }
    });

    graph.evidence.forEach((fragment, index) => {
      if (
        !hasProvenance(
          "EVIDENCE",
          fragment.id,
          "EXTRACTED_FROM",
          "SOURCE_SNAPSHOT",
          fragment.snapshotId,
        )
      ) {
        addIssue(
          context,
          ["evidence", index],
          "Evidence requires snapshot provenance",
        );
      }
      if (
        !hasProvenance(
          "EVIDENCE",
          fragment.id,
          "LOCATED_BY",
          "LOCATOR",
          fragment.locatorId,
        )
      ) {
        addIssue(
          context,
          ["evidence", index],
          "Evidence requires locator provenance",
        );
      }
    });

    graph.claimEvidenceEdges.forEach((edge, index) => {
      if (
        edge.reviewState === "ACCEPTED" &&
        !hasProvenance(
          "CLAIM",
          edge.claimId,
          polarityRelationship[edge.polarity],
          "EVIDENCE",
          edge.evidenceId,
        )
      ) {
        addIssue(
          context,
          ["claimEvidenceEdges", index],
          "Accepted claim edge requires matching provenance",
        );
      }
    });

    graph.branches.forEach((branch, index) => {
      if (
        branch.originDirectionId !== null &&
        !hasProvenance(
          "BRANCH",
          branch.id,
          "TRIGGERED_BY",
          "DIRECTION",
          branch.originDirectionId,
        )
      ) {
        addIssue(
          context,
          ["branches", index],
          "Child branch requires direction provenance",
        );
      }
    });
  });

export type InvestigationGraph = z.infer<typeof InvestigationGraphSchema>;

export function validateInvestigationGraph(input: unknown): InvestigationGraph {
  return InvestigationGraphSchema.parse(input);
}
