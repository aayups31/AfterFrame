import {
  ResearchJobsStagedDomainEventSchema,
  ResearchRunCreatedDomainEventSchema,
  ResearchRunOutboxEventSchema,
  StartResearchRunCommandSchema,
  type ResearchRunOutboxEvent,
} from "@/contracts/research-runs";
import type { InvestigationSpecialistRegistry } from "@/core/ports/investigation-specialist";
import {
  START_RESEARCH_RUN_COMMAND,
  type ResearchContextReader,
  type ResearchRunFingerprintPort,
  type ResearchRunStartStore,
  type StoredResearchRunStart,
} from "@/core/research-runs/ports";
import {
  RESEARCH_STAGES,
  ResearchRunBundleSchema,
  ResearchScopePlanRecordSchema,
} from "@/core/research-runs/schemas";
import { EntityIdSchema, Sha256Schema } from "@/core/shared/schemas";

export type ResearchRunIdentifierKind =
  | "research_run"
  | "research_plan"
  | "research_job"
  | "research_trace"
  | "research_domain_event"
  | "research_outbox_event";

export type StartResearchRunDependencies = Readonly<{
  context: ResearchContextReader;
  store: ResearchRunStartStore<ResearchRunOutboxEvent>;
  specialists: InvestigationSpecialistRegistry;
  fingerprints: ResearchRunFingerprintPort;
  createId: (kind: ResearchRunIdentifierKind) => string;
  now: () => string;
}>;

export type StartResearchRunErrorCode =
  | "CASE_NOT_FOUND"
  | "CASE_NOT_ACTIVE"
  | "CASE_VERSION_CONFLICT"
  | "BRANCH_NOT_FOUND"
  | "BRANCH_NOT_RESEARCHABLE"
  | "SPECIALIST_NOT_AVAILABLE"
  | "SPECIALIST_SUBJECT_INVALID"
  | "IDEMPOTENCY_KEY_REUSED"
  | "RESEARCH_RUN_IN_PROGRESS";

export class StartResearchRunError extends Error {
  constructor(
    readonly code: StartResearchRunErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "StartResearchRunError";
  }
}

export type StartResearchRunResult = StoredResearchRunStart<ResearchRunOutboxEvent> &
  Readonly<{ replayed: boolean }>;

export function createStartResearchRunService(
  dependencies: StartResearchRunDependencies,
) {
  return async function startResearchRun(
    actorIdInput: unknown,
    commandInput: unknown,
  ): Promise<StartResearchRunResult> {
    const actorId = EntityIdSchema.parse(actorIdInput);
    const command = StartResearchRunCommandSchema.parse(commandInput);
    const requestFingerprint = Sha256Schema.parse(
      dependencies.fingerprints.fingerprintStartRequest(actorId, command),
    );
    const scope = {
      actorId,
      commandName: START_RESEARCH_RUN_COMMAND,
      idempotencyKey: command.idempotencyKey,
    } as const;

    const reservation = await dependencies.store.reserveResearchRunStart({
      scope,
      requestFingerprint,
    });
    if (reservation.status === "REPLAY") {
      if (reservation.requestFingerprint !== requestFingerprint) {
        throw new StartResearchRunError(
          "IDEMPOTENCY_KEY_REUSED",
          "The idempotency key was already used for a different request",
        );
      }
      return { ...reservation.result, replayed: true };
    }
    if (reservation.status === "IN_PROGRESS") {
      throw new StartResearchRunError(
        "RESEARCH_RUN_IN_PROGRESS",
        "This research run is already being staged; retry with the same key",
      );
    }
    const reservationToken = reservation.reservationToken;

    try {
      const investigationCase = await dependencies.context.getCase(
        command.caseId,
      );
      // Owner privacy: another actor's case is indistinguishable from absent.
      if (investigationCase === null || investigationCase.ownerId !== actorId) {
        throw new StartResearchRunError(
          "CASE_NOT_FOUND",
          "Case was not found",
        );
      }
      if (investigationCase.aggregateVersion !== command.expectedCaseVersion) {
        throw new StartResearchRunError(
          "CASE_VERSION_CONFLICT",
          `Expected case version ${command.expectedCaseVersion}, received ${investigationCase.aggregateVersion}`,
        );
      }
      if (investigationCase.status !== "ACTIVE") {
        throw new StartResearchRunError(
          "CASE_NOT_ACTIVE",
          "Research can only start for an active investigation",
        );
      }

      const branch =
        command.branchId === null
          ? null
          : await dependencies.context.getBranch(command.branchId);
      if (
        command.branchId !== null &&
        (branch === null || branch.caseId !== investigationCase.id)
      ) {
        throw new StartResearchRunError(
          "BRANCH_NOT_FOUND",
          "Branch was not found",
        );
      }
      if (
        branch !== null &&
        branch.status !== "PROPOSED" &&
        branch.status !== "PLANNED" &&
        branch.status !== "OPEN" &&
        branch.status !== "PAUSED"
      ) {
        throw new StartResearchRunError(
          "BRANCH_NOT_RESEARCHABLE",
          `Research cannot attach to a ${branch.status} branch`,
        );
      }

      const specialist = dependencies.specialists.resolve(
        investigationCase.specialistId,
        investigationCase.specialistVersion,
      );
      if (specialist === null) {
        throw new StartResearchRunError(
          "SPECIALIST_NOT_AVAILABLE",
          `Specialist ${investigationCase.specialistId}@${investigationCase.specialistVersion} is unavailable`,
        );
      }
      const exactObjective =
        branch === null
          ? investigationCase.exactCuriosity
          : `${investigationCase.exactCuriosity}\n\nBranch objective: ${branch.normalizedObjective}`;
      const preparation = specialist.prepareResearch(
        investigationCase.subjectRef,
        exactObjective,
      );
      if (!preparation.valid) {
        throw new StartResearchRunError(
          "SPECIALIST_SUBJECT_INVALID",
          preparation.reason,
        );
      }

      const occurredAt = dependencies.now();
      const runId = dependencies.createId("research_run");
      const planId = dependencies.createId("research_plan");
      const objectiveFingerprint = Sha256Schema.parse(
        dependencies.fingerprints.fingerprintObjective(exactObjective),
      );
      const planFingerprint = Sha256Schema.parse(
        dependencies.fingerprints.fingerprintPlan(preparation.plan),
      );
      const plan = ResearchScopePlanRecordSchema.parse({
        id: planId,
        runId,
        specialistId: investigationCase.specialistId,
        specialistVersion: investigationCase.specialistVersion,
        inputFingerprint: objectiveFingerprint,
        planFingerprint,
        plan: preparation.plan,
        publicationAuthority: "NONE",
        createdAt: occurredAt,
      });

      const jobs = RESEARCH_STAGES.map((stage, index) => {
        const stageInputFingerprint = Sha256Schema.parse(
          dependencies.fingerprints.fingerprintStageInput({
            runId,
            stage,
            objectiveFingerprint,
            planFingerprint,
          }),
        );
        return {
          schemaVersion: 1 as const,
          id: dependencies.createId("research_job"),
          runId,
          caseId: investigationCase.id,
          stage,
          stageOrdinal: index,
          dependsOnJobId: null,
          logicalJobKey: `${runId}:${stage}:${stageInputFingerprint}`,
          stageInputFingerprint,
          status: "QUEUED" as const,
          attemptCount: 0,
          maxAttempts: 3,
          checkpointCount: 0,
          activeAttemptId: null,
          firstStartedAt: null,
          terminalAt: null,
          publicationAuthority: "NONE" as const,
          aggregateVersion: 0,
          createdAt: occurredAt,
          updatedAt: occurredAt,
        };
      });

      // Array.map cannot refer to not-yet-created job IDs, so link the already
      // materialized stable job records in a second deterministic pass.
      const linkedJobs = jobs.map((job, index) => ({
        ...job,
        dependsOnJobId: index === 0 ? null : jobs[index - 1]?.id ?? null,
      }));
      const bundle = ResearchRunBundleSchema.parse({
        run: {
          schemaVersion: 1,
          id: runId,
          caseId: investigationCase.id,
          branchId: branch?.id ?? null,
          planId,
          specialistId: investigationCase.specialistId,
          specialistVersion: investigationCase.specialistVersion,
          objectiveFingerprint,
          requestFingerprint,
          traceId: dependencies.createId("research_trace"),
          status: "QUEUED",
          health: "HEALTHY",
          currentStage: null,
          publicationAuthority: "NONE",
          aggregateVersion: 0,
          createdAt: occurredAt,
          updatedAt: occurredAt,
          startedAt: null,
          completedAt: null,
        },
        plan,
        jobs: linkedJobs,
        attempts: [],
        outputs: [],
        sourceCandidates: [],
        untrustedContent: [],
      });

      const runCreated = ResearchRunCreatedDomainEventSchema.parse({
        id: dependencies.createId("research_domain_event"),
        type: "research.run_created",
        schemaVersion: 1,
        aggregateType: "research_run",
        aggregateId: runId,
        sequence: 1,
        aggregateVersion: bundle.run.aggregateVersion,
        occurredAt,
        publicationAuthority: "NONE",
        payload: {
          caseId: investigationCase.id,
          branchId: branch?.id ?? null,
          planId,
          specialistId: investigationCase.specialistId,
          specialistVersion: investigationCase.specialistVersion,
        },
      });
      const jobsStaged = ResearchJobsStagedDomainEventSchema.parse({
        id: dependencies.createId("research_domain_event"),
        type: "research.jobs_staged",
        schemaVersion: 1,
        aggregateType: "research_run",
        aggregateId: runId,
        sequence: 2,
        aggregateVersion: bundle.run.aggregateVersion,
        occurredAt,
        publicationAuthority: "NONE",
        payload: {
          jobs: bundle.jobs.map((job) => ({
            jobId: job.id,
            stage: job.stage,
            dependsOnJobId: job.dependsOnJobId,
          })),
        },
      });
      const outboxEvents = [runCreated, jobsStaged].map((event) =>
        ResearchRunOutboxEventSchema.parse({
          id: dependencies.createId("research_outbox_event"),
          event,
          recordedAt: occurredAt,
          deliveryAttempts: 0,
          deliveredAt: null,
        }),
      );
      const result = { bundle, outboxEvents };
      const committed = await dependencies.store.commitResearchRunStart({
        scope,
        requestFingerprint,
        reservationToken,
        expectedCaseVersion: command.expectedCaseVersion,
        result,
      });
      return { ...committed.result, replayed: committed.replayed };
    } catch (error) {
      await dependencies.store.releaseResearchRunStart({
        scope,
        requestFingerprint,
        reservationToken,
      });
      throw error;
    }
  };
}
