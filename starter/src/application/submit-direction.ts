import { z } from "zod";
import {
  SubmitDirectionCommandSchema,
  type SubmitDirectionCommand,
} from "@/contracts/directions";
import {
  BranchProposedDomainEventSchema,
  DirectionSubmittedDomainEventSchema,
  OutboxEventSchema,
  type OutboxEvent,
} from "@/contracts/domain-events";
import {
  BranchActionSchema,
  DirectionEventSchema,
  DirectionTypeSchema,
  InvestigationBranchSchema,
  isChildBranchRouteCoherent,
  isRequestedChildBranchActionSatisfied,
  type InvestigationBranch,
} from "@/core/branches/schemas";
import { InvestigationCaseSchema } from "@/core/cases/schemas";
import {
  SUBMIT_DIRECTION_COMMAND,
  InvestigationStoreError,
  type InvestigationStore,
  type StoredDirectionResult,
} from "@/core/ports/investigation-store";
import type {
  InvestigationSpecialistRegistry,
  SpecialistResearchPlan,
} from "@/core/ports/investigation-specialist";
import { ProvenanceEdgeSchema } from "@/core/provenance/schemas";
import {
  EntityIdSchema,
  Sha256Schema,
  SlugSchema,
} from "@/core/shared/schemas";

const ProposedBranchKindSchema = z.enum([
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

/**
 * Typed boundary for planner-produced direction routing. This slice composes a
 * trusted deterministic fixture planner; provenance does not come from this
 * untrusted output. A live variant requires run, trace, prompt, schema, tool,
 * cost, and provenance records. A proposal cannot mark research or evidence
 * verified.
 */
export const DirectionRouteProposalSchema = z
  .object({
    directionType: DirectionTypeSchema,
    branchAction: BranchActionSchema.refine(
      (action) => ["CREATE", "DETOUR", "COMPARE"].includes(action),
      "This slice only accepts actions that propose a child branch",
    ),
    branchKind: ProposedBranchKindSchema,
    title: z.string().trim().min(1).max(300),
    normalizedObjective: z.string().trim().min(1).max(2_000),
    acknowledgement: z.string().trim().min(1).max(120).nullable(),
    researchAxisIds: z.array(SlugSchema).min(1).max(20),
    unresolvedQuestions: z.array(z.string().trim().min(1).max(1_000)).max(30),
  })
  .strict()
  .superRefine((proposal, context) => {
    if (!isChildBranchRouteCoherent(proposal)) {
      context.addIssue({
        code: "custom",
        message:
          "Direction type, child branch kind, and branch action are incoherent",
      });
    }
  });

export type DirectionRouteProposal = z.infer<
  typeof DirectionRouteProposalSchema
>;

export const DeterministicPlannerIdentitySchema = z
  .object({
    kind: z.literal("DETERMINISTIC_FIXTURE"),
    fixtureId: SlugSchema,
    fixtureVersion: z.string().trim().min(1).max(120),
  })
  .strict();

export interface DirectionPlanningPort {
  /** Trusted composition metadata; it is never read from planner output. */
  readonly identity: z.infer<typeof DeterministicPlannerIdentitySchema>;
  proposeDirection(
    input: Readonly<{
      direction: Readonly<
        Pick<SubmitDirectionCommand, "userText" | "anchor" | "requestedAction">
      >;
      caseContext: Readonly<{
        id: string;
        specialistId: string;
        specialistVersion: string;
        subjectRef: z.infer<typeof InvestigationCaseSchema>["subjectRef"];
        exactCuriosity: string;
      }>;
      sourceBranchContext: Readonly<{
        id: string;
        kind: InvestigationBranch["kind"];
        title: string;
        normalizedObjective: string;
        researchAxisIds: readonly string[];
        unresolvedQuestions: readonly string[];
      }>;
      specialistResearchPlan: SpecialistResearchPlan;
    }>,
  ): Promise<unknown>;
}

export interface DirectionFingerprintPort {
  fingerprintCommand(actorId: string, command: SubmitDirectionCommand): string;
  fingerprintExactText(text: string): string;
}

export type DirectionIdentifierKind =
  | "direction"
  | "branch"
  | "provenance"
  | "domain_event"
  | "outbox_event";

export type SubmitDirectionDependencies = Readonly<{
  store: InvestigationStore<OutboxEvent>;
  specialists: InvestigationSpecialistRegistry;
  planner: DirectionPlanningPort;
  fingerprints: DirectionFingerprintPort;
  createId: (kind: DirectionIdentifierKind) => string;
  now: () => string;
}>;

export type SubmitDirectionResult = StoredDirectionResult<OutboxEvent> &
  Readonly<{ replayed: boolean }>;

export type SubmitDirectionErrorCode =
  | "CASE_NOT_FOUND"
  | "SOURCE_BRANCH_NOT_FOUND"
  | "CASE_NOT_ACTIVE"
  | "SOURCE_BRANCH_NOT_DIRECTIONAL"
  | "SPECIALIST_NOT_AVAILABLE"
  | "SPECIALIST_SUBJECT_INVALID"
  | "PLANNER_POLICY_MISMATCH"
  | "CASE_VERSION_CONFLICT"
  | "IDEMPOTENCY_KEY_REUSED"
  | "DIRECTION_IN_PROGRESS"
  | "RETURN_DIRECTION_NOT_IMPLEMENTED";

export class SubmitDirectionError extends Error {
  constructor(
    readonly code: SubmitDirectionErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "SubmitDirectionError";
  }
}

function throwMappedStoreError(error: unknown): never {
  if (
    error instanceof InvestigationStoreError &&
    error.code === "CASE_VERSION_CONFLICT"
  ) {
    throw new SubmitDirectionError("CASE_VERSION_CONFLICT", error.message);
  }
  if (
    error instanceof InvestigationStoreError &&
    error.code === "IDEMPOTENCY_KEY_REUSED"
  ) {
    throw new SubmitDirectionError("IDEMPOTENCY_KEY_REUSED", error.message);
  }
  throw error;
}

function eventAnchor(command: SubmitDirectionCommand) {
  if (command.anchor === null) return null;

  return {
    ...(command.anchor.beatId === undefined
      ? {}
      : { beatId: command.anchor.beatId }),
    ...(command.anchor.evidenceId === undefined
      ? {}
      : { evidenceId: command.anchor.evidenceId }),
  };
}

function readingSequenceKey(command: SubmitDirectionCommand): string {
  if (command.anchor?.beatId !== undefined) {
    return `beat:${command.anchor.beatId}`;
  }
  if (command.anchor?.evidenceId !== undefined) {
    return `evidence:${command.anchor.evidenceId}`;
  }
  return `branch:${command.sourceBranchId}`;
}

function requestedActionForDomain(
  command: SubmitDirectionCommand,
): z.infer<typeof DirectionEventSchema>["requestedAction"] {
  return command.requestedAction.toUpperCase() as z.infer<
    typeof DirectionEventSchema
  >["requestedAction"];
}

function assertProposalMatchesExplicitAction(
  command: SubmitDirectionCommand,
  proposal: DirectionRouteProposal,
) {
  if (
    !isRequestedChildBranchActionSatisfied({
      requestedAction: requestedActionForDomain(command),
      directionType: proposal.directionType,
      branchAction: proposal.branchAction,
      branchKind: proposal.branchKind,
    })
  ) {
    throw new SubmitDirectionError(
      "PLANNER_POLICY_MISMATCH",
      `Planner proposal contradicts explicit ${command.requestedAction} intent`,
    );
  }
}

export function createSubmitDirectionService(
  dependencies: SubmitDirectionDependencies,
) {
  return async function submitDirection(
    actorIdInput: unknown,
    commandInput: unknown,
  ): Promise<SubmitDirectionResult> {
    const actorId = EntityIdSchema.parse(actorIdInput);
    const command = SubmitDirectionCommandSchema.parse(commandInput);
    const requestFingerprint = Sha256Schema.parse(
      dependencies.fingerprints.fingerprintCommand(actorId, command),
    );
    const scope = {
      actorId,
      commandName: SUBMIT_DIRECTION_COMMAND,
      idempotencyKey: command.idempotencyKey,
    } as const;

    let reservation;
    try {
      reservation = await dependencies.store.reserveDirection({
        scope,
        requestFingerprint,
      });
    } catch (error) {
      throwMappedStoreError(error);
    }
    if (reservation.status === "REPLAY") {
      return { ...reservation.replay.result, replayed: true };
    }
    if (reservation.status === "IN_PROGRESS") {
      throw new SubmitDirectionError(
        "DIRECTION_IN_PROGRESS",
        "This direction is already being routed; retry with the same key",
      );
    }
    const reservationToken = reservation.reservationToken;

    try {
      if (command.requestedAction === "return") {
        throw new SubmitDirectionError(
          "RETURN_DIRECTION_NOT_IMPLEMENTED",
          "Return navigation is a separate branch transition and is not available in this slice",
        );
      }

      const investigationCase = await dependencies.store.getCase(
        command.caseId,
      );
      // Do not reveal another actor's private case by distinguishing ownership.
      if (investigationCase === null || investigationCase.ownerId !== actorId) {
        throw new SubmitDirectionError("CASE_NOT_FOUND", "Case was not found");
      }
      if (investigationCase.aggregateVersion !== command.expectedCaseVersion) {
        throw new SubmitDirectionError(
          "CASE_VERSION_CONFLICT",
          `Expected case version ${command.expectedCaseVersion}, received ${investigationCase.aggregateVersion}`,
        );
      }
      if (investigationCase.status !== "ACTIVE") {
        throw new SubmitDirectionError(
          "CASE_NOT_ACTIVE",
          "Directions can only change an active investigation",
        );
      }

      const sourceBranch = await dependencies.store.getBranch(
        command.sourceBranchId,
      );
      if (
        sourceBranch === null ||
        sourceBranch.caseId !== investigationCase.id
      ) {
        throw new SubmitDirectionError(
          "SOURCE_BRANCH_NOT_FOUND",
          "Source branch was not found",
        );
      }
      if (sourceBranch.status !== "OPEN" && sourceBranch.status !== "PAUSED") {
        throw new SubmitDirectionError(
          "SOURCE_BRANCH_NOT_DIRECTIONAL",
          `Directions cannot fork from a ${sourceBranch.status} branch`,
        );
      }

      const specialist = dependencies.specialists.resolve(
        investigationCase.specialistId,
        investigationCase.specialistVersion,
      );
      if (specialist === null) {
        throw new SubmitDirectionError(
          "SPECIALIST_NOT_AVAILABLE",
          `Specialist ${investigationCase.specialistId}@${investigationCase.specialistVersion} is not available`,
        );
      }
      const preparation = specialist.prepareResearch(
        investigationCase.subjectRef,
        `${investigationCase.exactCuriosity}\n\nDirection: ${command.userText}`,
      );
      if (!preparation.valid) {
        throw new SubmitDirectionError(
          "SPECIALIST_SUBJECT_INVALID",
          preparation.reason,
        );
      }

      const proposal = DirectionRouteProposalSchema.parse(
        await dependencies.planner.proposeDirection({
          direction: {
            userText: command.userText,
            anchor: command.anchor,
            requestedAction: command.requestedAction,
          },
          caseContext: {
            id: investigationCase.id,
            specialistId: investigationCase.specialistId,
            specialistVersion: investigationCase.specialistVersion,
            subjectRef: investigationCase.subjectRef,
            exactCuriosity: investigationCase.exactCuriosity,
          },
          sourceBranchContext: {
            id: sourceBranch.id,
            kind: sourceBranch.kind,
            title: sourceBranch.title,
            normalizedObjective: sourceBranch.normalizedObjective,
            researchAxisIds: sourceBranch.researchAxisIds,
            unresolvedQuestions: sourceBranch.unresolvedQuestions,
          },
          specialistResearchPlan: preparation.plan,
        }),
      );
      const plannerIdentity = DeterministicPlannerIdentitySchema.parse(
        dependencies.planner.identity,
      );
      assertProposalMatchesExplicitAction(command, proposal);
      const permittedAxes = new Set(
        preparation.plan.axes.map((axis) => axis.axisId),
      );
      if (
        !proposal.researchAxisIds.every((axisId) => permittedAxes.has(axisId))
      ) {
        throw new SubmitDirectionError(
          "PLANNER_POLICY_MISMATCH",
          "Planner proposed a research axis outside the active specialist plan",
        );
      }
      const occurredAt = dependencies.now();
      const directionId = dependencies.createId("direction");
      const branchId = dependencies.createId("branch");

      const direction = DirectionEventSchema.parse({
        id: directionId,
        caseId: investigationCase.id,
        sourceBranchId: sourceBranch.id,
        actorId,
        exactUserText: command.userText,
        requestedAction: requestedActionForDomain(command),
        directionType: proposal.directionType,
        branchAction: proposal.branchAction,
        acknowledgement: proposal.acknowledgement,
        anchor:
          command.anchor === null
            ? null
            : {
                branchId: sourceBranch.id,
                beatId: command.anchor.beatId ?? null,
                evidenceId: command.anchor.evidenceId ?? null,
                claimId: null,
                selectedTextFingerprint:
                  command.anchor.selectedText === undefined
                    ? null
                    : Sha256Schema.parse(
                        dependencies.fingerprints.fingerprintExactText(
                          command.anchor.selectedText,
                        ),
                      ),
                readingSequenceKey: readingSequenceKey(command),
              },
        origin: { kind: "USER", actorId, version: null },
        createdAt: occurredAt,
      });

      const proposedBranch = InvestigationBranchSchema.parse({
        id: branchId,
        caseId: investigationCase.id,
        parentBranchId: sourceBranch.id,
        originDirectionId: direction.id,
        kind: proposal.branchKind,
        title: proposal.title,
        normalizedObjective: proposal.normalizedObjective,
        status: "PROPOSED",
        researchAxisIds: proposal.researchAxisIds,
        unresolvedQuestions: proposal.unresolvedQuestions,
        returnAnchor: {
          branchId: sourceBranch.id,
          readingSequenceKey: readingSequenceKey(command),
          beatId: command.anchor?.beatId ?? null,
        },
        aggregateVersion: 0,
        createdAt: occurredAt,
        updatedAt: occurredAt,
      });

      const nextCase = InvestigationCaseSchema.parse({
        ...investigationCase,
        activeBranchId: proposedBranch.id,
        aggregateVersion: investigationCase.aggregateVersion + 1,
        eventSequence: investigationCase.eventSequence + 2,
        updatedAt: occurredAt,
      });

      const provenanceEdges = [
        ProvenanceEdgeSchema.parse({
          id: dependencies.createId("provenance"),
          caseId: investigationCase.id,
          output: { type: "BRANCH", id: proposedBranch.id },
          input: { type: "DIRECTION", id: direction.id },
          relationship: "TRIGGERED_BY",
          origin: {
            kind: "DETERMINISTIC_SYSTEM",
            actorId: null,
            version: `${plannerIdentity.fixtureId}@${plannerIdentity.fixtureVersion}`,
          },
          method: {
            name: plannerIdentity.fixtureId,
            version: plannerIdentity.fixtureVersion,
          },
          runId: null,
          createdAt: occurredAt,
        }),
        ProvenanceEdgeSchema.parse({
          id: dependencies.createId("provenance"),
          caseId: investigationCase.id,
          output: { type: "DIRECTION", id: direction.id },
          input: { type: "BRANCH", id: sourceBranch.id },
          relationship: "SCOPED_TO",
          origin: {
            kind: "DETERMINISTIC_SYSTEM",
            actorId: null,
            version: `${plannerIdentity.fixtureId}@${plannerIdentity.fixtureVersion}`,
          },
          method: {
            name: plannerIdentity.fixtureId,
            version: plannerIdentity.fixtureVersion,
          },
          runId: null,
          createdAt: occurredAt,
        }),
      ] as const;

      const directionEvent = DirectionSubmittedDomainEventSchema.parse({
        id: dependencies.createId("domain_event"),
        type: "direction.submitted",
        schemaVersion: 1,
        aggregateType: "case",
        aggregateId: investigationCase.id,
        sequence: investigationCase.eventSequence + 1,
        aggregateVersion: nextCase.aggregateVersion,
        occurredAt,
        payload: {
          directionId: direction.id,
          sourceBranchId: sourceBranch.id,
          requestedAction: command.requestedAction,
          anchor: eventAnchor(command),
        },
      });
      const branchEvent = BranchProposedDomainEventSchema.parse({
        id: dependencies.createId("domain_event"),
        type: "branch.proposed",
        schemaVersion: 1,
        aggregateType: "case",
        aggregateId: investigationCase.id,
        sequence: investigationCase.eventSequence + 2,
        aggregateVersion: nextCase.aggregateVersion,
        occurredAt,
        payload: {
          branchId: proposedBranch.id,
          parentBranchId: sourceBranch.id,
          originDirectionId: direction.id,
        },
      });
      const outboxEvents = [directionEvent, branchEvent].map((event) =>
        OutboxEventSchema.parse({
          id: dependencies.createId("outbox_event"),
          event,
          recordedAt: occurredAt,
          publicationAttempts: 0,
          publishedAt: null,
        }),
      );

      const result: StoredDirectionResult<OutboxEvent> = {
        investigationCase: nextCase,
        direction,
        proposedBranch,
        provenanceEdges,
        outboxEvents,
      };

      const committed = await dependencies.store.commitDirection({
        scope,
        requestFingerprint,
        reservationToken,
        expectedCaseVersion: command.expectedCaseVersion,
        result,
      });
      return { ...committed.result, replayed: committed.replayed };
    } catch (error) {
      await dependencies.store.releaseDirectionReservation({
        scope,
        requestFingerprint,
        reservationToken,
      });
      throwMappedStoreError(error);
    }
  };
}
