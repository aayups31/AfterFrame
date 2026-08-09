import {
  InvestigationCaseSchema,
  type CaseStatus,
  type InvestigationCase,
} from "@/core/cases/schemas";
import { IsoDateTimeSchema } from "@/core/shared/schemas";

const ALLOWED_CASE_TRANSITIONS: Readonly<
  Record<CaseStatus, readonly CaseStatus[]>
> = {
  DRAFT: ["INTENT_PROPOSED"],
  INTENT_PROPOSED: ["READY"],
  READY: ["ACTIVE"],
  ACTIVE: ["PAUSED", "CLOSURE_REVIEW"],
  PAUSED: ["ACTIVE"],
  CLOSURE_REVIEW: ["CLOSED"],
  CLOSED: ["ACTIVE"],
};

export class CaseTransitionError extends Error {
  constructor(
    readonly code:
      | "INVALID_TRANSITION"
      | "VERSION_CONFLICT"
      | "TIME_REGRESSION",
    message: string,
  ) {
    super(message);
    this.name = "CaseTransitionError";
  }
}

export type CaseTransitionInput = Readonly<{
  targetStatus: CaseStatus;
  expectedVersion: number;
  occurredAt: string;
}>;

export function transitionCase(
  current: InvestigationCase,
  input: CaseTransitionInput,
): InvestigationCase {
  const parsedCurrent = InvestigationCaseSchema.parse(current);
  const occurredAt = IsoDateTimeSchema.parse(input.occurredAt);

  if (parsedCurrent.aggregateVersion !== input.expectedVersion) {
    throw new CaseTransitionError(
      "VERSION_CONFLICT",
      `Expected case version ${input.expectedVersion}, received ${parsedCurrent.aggregateVersion}`,
    );
  }

  if (
    new Date(occurredAt).getTime() < new Date(parsedCurrent.updatedAt).getTime()
  ) {
    throw new CaseTransitionError(
      "TIME_REGRESSION",
      `Transition time ${occurredAt} precedes current case time ${parsedCurrent.updatedAt}`,
    );
  }

  if (parsedCurrent.status === input.targetStatus) {
    return parsedCurrent;
  }

  if (
    !ALLOWED_CASE_TRANSITIONS[parsedCurrent.status].includes(input.targetStatus)
  ) {
    throw new CaseTransitionError(
      "INVALID_TRANSITION",
      `Cannot transition case from ${parsedCurrent.status} to ${input.targetStatus}`,
    );
  }

  return InvestigationCaseSchema.parse({
    ...parsedCurrent,
    status: input.targetStatus,
    aggregateVersion: parsedCurrent.aggregateVersion + 1,
    updatedAt: occurredAt,
  });
}
