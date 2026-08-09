import {
  InvestigationBranchSchema,
  type BranchStatus,
  type InvestigationBranch,
} from "@/core/branches/schemas";
import { IsoDateTimeSchema } from "@/core/shared/schemas";

const ALLOWED_BRANCH_TRANSITIONS: Readonly<
  Record<BranchStatus, readonly BranchStatus[]>
> = {
  PROPOSED: ["PLANNED"],
  PLANNED: ["OPEN"],
  OPEN: ["PAUSED", "MERGED", "CLOSED"],
  PAUSED: ["OPEN", "MERGED", "CLOSED"],
  MERGED: [],
  CLOSED: [],
};

export class BranchTransitionError extends Error {
  constructor(
    readonly code:
      | "INVALID_TRANSITION"
      | "VERSION_CONFLICT"
      | "TIME_REGRESSION",
    message: string,
  ) {
    super(message);
    this.name = "BranchTransitionError";
  }
}

export type BranchTransitionInput = Readonly<{
  targetStatus: BranchStatus;
  expectedVersion: number;
  occurredAt: string;
}>;

export function transitionBranch(
  current: InvestigationBranch,
  input: BranchTransitionInput,
): InvestigationBranch {
  const parsedCurrent = InvestigationBranchSchema.parse(current);
  const occurredAt = IsoDateTimeSchema.parse(input.occurredAt);

  if (parsedCurrent.aggregateVersion !== input.expectedVersion) {
    throw new BranchTransitionError(
      "VERSION_CONFLICT",
      `Expected branch version ${input.expectedVersion}, received ${parsedCurrent.aggregateVersion}`,
    );
  }

  if (
    new Date(occurredAt).getTime() < new Date(parsedCurrent.updatedAt).getTime()
  ) {
    throw new BranchTransitionError(
      "TIME_REGRESSION",
      `Transition time ${occurredAt} precedes current branch time ${parsedCurrent.updatedAt}`,
    );
  }

  if (parsedCurrent.status === input.targetStatus) {
    return parsedCurrent;
  }

  if (
    !ALLOWED_BRANCH_TRANSITIONS[parsedCurrent.status].includes(
      input.targetStatus,
    )
  ) {
    throw new BranchTransitionError(
      "INVALID_TRANSITION",
      `Cannot transition branch from ${parsedCurrent.status} to ${input.targetStatus}`,
    );
  }

  return InvestigationBranchSchema.parse({
    ...parsedCurrent,
    status: input.targetStatus,
    aggregateVersion: parsedCurrent.aggregateVersion + 1,
    updatedAt: occurredAt,
  });
}
