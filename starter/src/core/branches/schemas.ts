import { z } from "zod";
import {
  EntityIdSchema,
  IsoDateTimeSchema,
  OpaqueReferenceSchema,
  RecordOriginSchema,
  SlugSchema,
} from "@/core/shared/schemas";

export const DirectionTypeSchema = z.enum([
  "THEORY",
  "QUESTION",
  "LEAD",
  "FOCUS",
  "WIDEN",
  "CHALLENGE",
  "COMPARE",
  "CONNECT",
  "STYLE",
  "RETURN",
]);

export const RequestedDirectionActionSchema = z.enum([
  "AUTO",
  "THEORY",
  "CHALLENGE",
  "COMPARE",
  "CONNECT",
  "RETURN",
]);

export const BranchActionSchema = z.enum([
  "CREATE",
  "REDIRECT",
  "DEEPEN",
  "DETOUR",
  "COMPARE",
  "PROPOSE_MERGE",
  "RETURN",
]);

export const DirectionAnchorSchema = z
  .object({
    branchId: EntityIdSchema,
    beatId: EntityIdSchema.nullable(),
    evidenceId: EntityIdSchema.nullable(),
    claimId: EntityIdSchema.nullable(),
    selectedTextFingerprint: OpaqueReferenceSchema.nullable(),
    readingSequenceKey: z.string().trim().min(1).max(200).nullable(),
  })
  .strict()
  .superRefine((anchor, context) => {
    if (
      anchor.beatId === null &&
      anchor.evidenceId === null &&
      anchor.claimId === null &&
      anchor.readingSequenceKey === null
    ) {
      context.addIssue({
        code: "custom",
        message: "A direction anchor requires a material or reading position",
      });
    }
  });

export const DirectionEventSchema = z
  .object({
    id: EntityIdSchema,
    caseId: EntityIdSchema,
    sourceBranchId: EntityIdSchema,
    actorId: EntityIdSchema,
    exactUserText: z
      .string()
      .min(3)
      .max(4_000)
      .refine((text) => text.trim().length >= 3, {
        message:
          "Direction text must contain at least three non-whitespace characters",
      }),
    requestedAction: RequestedDirectionActionSchema,
    directionType: DirectionTypeSchema,
    branchAction: BranchActionSchema,
    acknowledgement: z.string().trim().min(1).max(120).nullable(),
    anchor: DirectionAnchorSchema.nullable(),
    origin: RecordOriginSchema,
    createdAt: IsoDateTimeSchema,
  })
  .strict()
  .superRefine((direction, context) => {
    if (direction.origin.kind !== "USER") {
      context.addIssue({
        code: "custom",
        path: ["origin", "kind"],
        message: "Direction events must preserve a USER-authored submission",
      });
    }

    if (direction.origin.actorId !== direction.actorId) {
      context.addIssue({
        code: "custom",
        path: ["origin", "actorId"],
        message: "Direction origin must match actorId",
      });
    }
  });

export const BranchStatusSchema = z.enum([
  "PROPOSED",
  "PLANNED",
  "OPEN",
  "PAUSED",
  "MERGED",
  "CLOSED",
]);

export const BranchKindSchema = z.enum([
  "ROOT",
  "QUESTION",
  "THEORY",
  "LEAD",
  "FOCUS",
  "WIDEN",
  "CHALLENGE",
  "COMPARISON",
  "CONNECTION",
  "DETOUR",
]);

const CREATE_BRANCH_KIND_BY_DIRECTION = {
  QUESTION: "QUESTION",
  THEORY: "THEORY",
  LEAD: "LEAD",
  FOCUS: "FOCUS",
  WIDEN: "WIDEN",
  CHALLENGE: "CHALLENGE",
  CONNECT: "CONNECTION",
} as const;

/** Cross-field law for the child-branch creation slice. */
export function isChildBranchRouteCoherent(route: {
  directionType: z.infer<typeof DirectionTypeSchema>;
  branchAction: z.infer<typeof BranchActionSchema>;
  branchKind: z.infer<typeof BranchKindSchema>;
}): boolean {
  if (route.branchAction === "COMPARE") {
    return (
      route.directionType === "COMPARE" && route.branchKind === "COMPARISON"
    );
  }
  if (route.branchAction === "DETOUR") {
    return (
      route.branchKind === "DETOUR" &&
      !["RETURN", "STYLE", "COMPARE"].includes(route.directionType)
    );
  }
  if (route.branchAction === "CREATE") {
    return (
      CREATE_BRANCH_KIND_BY_DIRECTION[
        route.directionType as keyof typeof CREATE_BRANCH_KIND_BY_DIRECTION
      ] === route.branchKind
    );
  }
  return false;
}

export function isRequestedChildBranchActionSatisfied(route: {
  requestedAction: z.infer<typeof RequestedDirectionActionSchema>;
  directionType: z.infer<typeof DirectionTypeSchema>;
  branchAction: z.infer<typeof BranchActionSchema>;
  branchKind: z.infer<typeof BranchKindSchema>;
}): boolean {
  if (!isChildBranchRouteCoherent(route)) return false;
  if (route.requestedAction === "AUTO") return true;
  if (route.requestedAction === "RETURN") return false;

  const expectation = {
    THEORY: { directionType: "THEORY", branchKind: "THEORY" },
    CHALLENGE: { directionType: "CHALLENGE", branchKind: "CHALLENGE" },
    COMPARE: { directionType: "COMPARE", branchKind: "COMPARISON" },
    CONNECT: { directionType: "CONNECT", branchKind: "CONNECTION" },
  } as const;
  const expected = expectation[route.requestedAction];
  return (
    route.directionType === expected.directionType &&
    route.branchKind === expected.branchKind
  );
}

export const BranchReturnAnchorSchema = z
  .object({
    branchId: EntityIdSchema,
    readingSequenceKey: z.string().trim().min(1).max(200),
    beatId: EntityIdSchema.nullable(),
  })
  .strict();

export const InvestigationBranchSchema = z
  .object({
    id: EntityIdSchema,
    caseId: EntityIdSchema,
    parentBranchId: EntityIdSchema.nullable(),
    originDirectionId: EntityIdSchema.nullable(),
    kind: BranchKindSchema,
    title: z.string().trim().min(1).max(300),
    normalizedObjective: z.string().trim().min(1).max(2_000),
    status: BranchStatusSchema,
    researchAxisIds: z.array(SlugSchema).max(20),
    unresolvedQuestions: z.array(z.string().trim().min(1).max(1_000)).max(30),
    returnAnchor: BranchReturnAnchorSchema.nullable(),
    aggregateVersion: z.number().int().nonnegative(),
    createdAt: IsoDateTimeSchema,
    updatedAt: IsoDateTimeSchema,
  })
  .strict()
  .superRefine((branch, context) => {
    const isRoot = branch.kind === "ROOT";
    if (isRoot && branch.parentBranchId !== null) {
      context.addIssue({
        code: "custom",
        path: ["parentBranchId"],
        message: "ROOT branches cannot have a parent",
      });
    }
    if (isRoot && branch.originDirectionId !== null) {
      context.addIssue({
        code: "custom",
        path: ["originDirectionId"],
        message: "ROOT branches cannot originate from a direction",
      });
    }
    if (!isRoot && branch.parentBranchId === null) {
      context.addIssue({
        code: "custom",
        path: ["parentBranchId"],
        message: "Child branches require a parentBranchId",
      });
    }
    if (!isRoot && branch.originDirectionId === null) {
      context.addIssue({
        code: "custom",
        path: ["originDirectionId"],
        message: "Child branches require an originDirectionId",
      });
    }
    if (
      branch.returnAnchor !== null &&
      branch.parentBranchId !== branch.returnAnchor.branchId
    ) {
      context.addIssue({
        code: "custom",
        path: ["returnAnchor", "branchId"],
        message: "A child branch must return to its parent branch",
      });
    }
    if (
      new Date(branch.updatedAt).getTime() <
      new Date(branch.createdAt).getTime()
    ) {
      context.addIssue({
        code: "custom",
        path: ["updatedAt"],
        message: "updatedAt cannot precede createdAt",
      });
    }
  });

export type DirectionType = z.infer<typeof DirectionTypeSchema>;
export type DirectionEvent = z.infer<typeof DirectionEventSchema>;
export type BranchStatus = z.infer<typeof BranchStatusSchema>;
export type InvestigationBranch = z.infer<typeof InvestigationBranchSchema>;
