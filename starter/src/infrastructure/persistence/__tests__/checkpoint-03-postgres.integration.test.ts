import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Client } from "pg";
import { describe, expect, it } from "vitest";
import { createDurableResearchWorkerService } from "@/application/research-worker/execute-durable-research-job";
import { createStartResearchRunService } from "@/application/research/start-research-run";
import type {
  DurableResearchDiscoveryHandle,
  DurableResearchDiscoveryInput,
  DurableResearchDiscoveryProvider,
} from "@/application/research/durable-discovery-port";
import type { SourceMetadataProbeTransport } from "@/application/research/source-resolution-port";
import type { InvestigationBranch } from "@/core/branches/schemas";
import type { InvestigationCase } from "@/core/cases/schemas";
import type { ResearchRunFingerprintPort } from "@/core/research-runs/ports";
import { ResearchStageExecutionResultSchema } from "@/core/research-runs/schemas";
import {
  BLACK_HAWK_DOWN_CASE,
  BLACK_HAWK_DOWN_ROOT_BRANCH,
} from "@/fixtures/black-hawk-down/deterministic-spine.fixture";
import { BLACK_HAWK_DOWN_RESEARCH_COMMAND } from "@/fixtures/black-hawk-down/research-run.fixture";
import { SupabaseDurableResearchWorkerStore } from "@/infrastructure/persistence/supabase-durable-research-worker-store";
import {
  SupabaseInvestigationStore,
  type SupabaseRpcInvoker,
} from "@/infrastructure/persistence/supabase-investigation-store";
import { SupabaseResearchRunStartStore } from "@/infrastructure/persistence/supabase-research-run-start-store";
import { SupabaseResearchIdentityReader } from "@/infrastructure/persistence/supabase-research-identity-reader";
import { SupabaseSourceRetrievalPersistence } from "@/infrastructure/persistence/supabase-source-retrieval-persistence";
import {
  afterFrameV1IdentityExecutionPlan,
  afterFrameV1ScopingExecutionPlan,
  afterFrameV1SourceResolutionExecutionPlan,
  createAfterFrameV1ResearchExecutorRegistry,
} from "@/infrastructure/research/afterframe-v1-research-executor-registry";
import { DeterministicSourceMetadataResolver } from "@/infrastructure/research/deterministic-source-metadata-resolver";
import { openAIBackgroundDiscoveryExecutionIdentity } from "@/infrastructure/research/openai-background-discovery";
import { afterFrameV1SpecialistRegistry } from "@/specialists/registry";

const integrationEnabled =
  process.env.AFTERFRAME_DB_INTEGRATION === "1";
const durableResolutionLifecycleEnabled =
  process.env.AFTERFRAME_DB_MIGRATION_013_PREFLIGHT === "1" ||
  process.env.AFTERFRAME_DB_RESOLUTION_INTEGRATION === "1" ||
  process.env.AFTERFRAME_DB_MIGRATION_014_PREFLIGHT === "1";
const durableRetrievalLifecycleEnabled =
  process.env.AFTERFRAME_DB_MIGRATION_014_PREFLIGHT === "1";
const describeDatabase = integrationEnabled ? describe : describe.skip;
const projectRoot = fileURLToPath(new URL("../../../../", import.meta.url));
const rollbackSentinel = Symbol("checkpoint-03-rollback");
const candidateAxisMigration = readFileSync(
  fileURLToPath(
    new URL(
      "../../../../supabase/migrations/012_candidate_axis_bindings.sql",
      import.meta.url,
    ),
  ),
  "utf8",
);
const durableResolutionMigration = readFileSync(
  fileURLToPath(
    new URL(
      "../../../../supabase/migrations/013_durable_source_resolution_acceptance.sql",
      import.meta.url,
    ),
  ),
  "utf8",
);
const durableRetrievalMigration = readFileSync(
  fileURLToPath(
    new URL(
      "../../../../supabase/migrations/014_durable_source_retrieval_acceptance.sql",
      import.meta.url,
    ),
  ),
  "utf8",
);

const checkpoint03RpcNames = [
  "af_get_case_v1",
  "af_get_branch_v1",
  "af_reserve_research_run_start_v1",
  "af_release_research_run_start_reservation_v1",
  "af_commit_research_run_start_v1",
  "af_claim_research_job_v2",
  "af_heartbeat_research_job_v1",
  "af_checkpoint_research_job_v1",
  "af_complete_research_job_v2",
  "af_fail_research_job_v1",
  "af_release_research_job_v1",
  "af_get_research_identity_context_v1",
  "af_get_resolved_subject_identity_v1",
  "af_get_research_discovery_context_v1",
  "af_get_research_provider_run_v1",
  "af_accept_research_provider_run_v1",
] as const;
const allowedRpcNames = new Set<string>([
  ...checkpoint03RpcNames,
  "af_get_research_resolution_context_v1",
  "af_accept_source_resolution_v1",
  "af_get_source_resolution_records_v1",
  "af_get_normalization_retrieval_context_v1",
  "af_get_source_retrieval_records_v1",
  "af_accept_source_retrieval_v1",
]);

function loadDatabaseUrl() {
  if (process.env.SUPABASE_DB_URL === undefined) {
    try {
      process.loadEnvFile(`${projectRoot}/.env.local`);
    } catch {
      throw new Error(
        "Checkpoint-03 integration requires SUPABASE_DB_URL or starter/.env.local",
      );
    }
  }
  const databaseUrl = process.env.SUPABASE_DB_URL;
  if (databaseUrl === undefined || databaseUrl.length === 0) {
    throw new Error(
      "Checkpoint-03 integration requires a configured SUPABASE_DB_URL",
    );
  }
  try {
    const parsed = new URL(databaseUrl);
    if (
      !["postgres:", "postgresql:"].includes(parsed.protocol) ||
      parsed.username.length === 0 ||
      parsed.password.length === 0 ||
      parsed.hostname.length === 0 ||
      parsed.pathname.length <= 1
    ) {
      throw new Error("invalid database URL");
    }
  } catch {
    throw new Error(
      "Checkpoint-03 integration requires a credentialed PostgreSQL URL",
    );
  }
  return databaseUrl;
}

function loadTmdbApiKey() {
  if (process.env.TMDB_API_KEY === undefined) {
    try {
      process.loadEnvFile(`${projectRoot}/.env.local`);
    } catch {
      throw new Error(
        "Checkpoint-04A integration requires TMDB_API_KEY or starter/.env.local",
      );
    }
  }
  const apiKey = process.env.TMDB_API_KEY;
  if (apiKey === undefined || apiKey.trim().length === 0) {
    throw new Error(
      "Checkpoint-04A integration requires a configured TMDB_API_KEY",
    );
  }
  return apiKey;
}

function quoteIdentifier(identifier: string) {
  if (!/^[a-z][a-z0-9_]*$/.test(identifier)) {
    throw new Error("Integration SQL identifier is outside the allowlist");
  }
  return `"${identifier}"`;
}

function postgresErrorCode(error: unknown) {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
  ) {
    return error.code;
  }
  return undefined;
}

type RpcFailure = Readonly<{
  functionName: string;
  code: string | undefined;
  diagnostic: string;
}>;

function transactionalRpcInvoker(
  client: Client,
  recordFailure: (failure: RpcFailure) => void,
): SupabaseRpcInvoker {
  return async (functionName, parameters) => {
    if (!allowedRpcNames.has(functionName)) {
      throw new Error("Integration attempted an RPC outside the allowlist");
    }
    const entries = Object.entries(parameters);
    const argumentsSql = entries
      .map(
        ([parameterName], index) =>
          `${quoteIdentifier(parameterName)} => $${index + 1}`,
      )
      .join(", ");
    try {
      const result = await client.query<{ data: unknown }>(
        `select public.${quoteIdentifier(functionName)}(${argumentsSql}) as data`,
        entries.map(([, value]) => value),
      );
      return { data: result.rows[0]?.data ?? null, error: null };
    } catch (error) {
      const code = postgresErrorCode(error);
      recordFailure({
        functionName,
        code,
        diagnostic:
          error instanceof Error ? error.message : "unknown Postgres error",
      });
      return {
        data: null,
        error: {
          ...(code === undefined ? {} : { code }),
          message: "Postgres rejected the guarded integration operation",
        },
      };
    }
  };
}

async function checkpoint03FunctionsAreDeployed(client: Client) {
  const result = await client.query<{ function_name: string }>(
    `select distinct procedure.proname as function_name
     from pg_catalog.pg_proc procedure
     join pg_catalog.pg_namespace namespace
       on namespace.oid = procedure.pronamespace
     where namespace.nspname = 'public'
       and procedure.proname = any($1::text[])
     order by procedure.proname`,
    [checkpoint03RpcNames],
  );
  return new Set(result.rows.map(({ function_name }) => function_name));
}

async function afTableCounts(client: Client) {
  const tableResult = await client.query<{ table_name: string }>(
    `select tablename as table_name
     from pg_catalog.pg_tables
     where schemaname = 'public' and tablename like 'af\\_%' escape '\\'
     order by tablename`,
  );
  if (tableResult.rows.length === 0) {
    throw new Error("Checkpoint-03 integration requires deployed af_* tables");
  }
  const countSql = tableResult.rows
    .map(({ table_name }) => {
      const table = quoteIdentifier(table_name);
      return `select '${table_name}'::text as table_name, count(*)::text as row_count from public.${table}`;
    })
    .join(" union all ");
  const countResult = await client.query<{
    table_name: string;
    row_count: string;
  }>(`select * from (${countSql}) counts order by table_name`);
  return countResult.rows.map(({ table_name, row_count }) => ({
    tableName: table_name,
    rowCount: BigInt(row_count),
  }));
}

async function fixtureActorCount(client: Client, actorId: string) {
  const result = await client.query<{ row_count: string }>(
    "select count(*)::text as row_count from auth.users where id = $1",
    [actorId],
  );
  return BigInt(result.rows[0]?.row_count ?? "0");
}

async function databaseTimestamp(client: Client, offsetMilliseconds = 25) {
  const result = await client.query<{ database_now: Date | string }>(
    "select clock_timestamp() as database_now",
  );
  const value = result.rows[0]?.database_now;
  if (value === undefined) {
    throw new Error("Postgres did not return its current timestamp");
  }
  const timestamp = value instanceof Date ? value : new Date(value);
  return new Date(timestamp.getTime() + offsetMilliseconds).toISOString();
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

const fingerprints: ResearchRunFingerprintPort = {
  fingerprintStartRequest: (actorId, input) =>
    sha256(`${actorId}:${JSON.stringify(input)}`),
  fingerprintObjective: sha256,
  fingerprintPlan: (plan) => sha256(JSON.stringify(plan)),
  fingerprintStageInput: (input) => sha256(JSON.stringify(input)),
  fingerprintAttemptRequest: (runId, jobId, idempotencyKey) =>
    sha256(`${runId}:${jobId}:${idempotencyKey}`),
  fingerprintExecutionOutput: (output) => sha256(JSON.stringify(output)),
};

class DeterministicPendingThenCompletedDiscoveryProvider
  implements DurableResearchDiscoveryProvider
{
  startCalls = 0;
  retrieveCalls = 0;
  readonly requestedModel = "gpt-5.6-sol";
  readonly providerSnapshot = "gpt-5.6-sol";

  async start(input: DurableResearchDiscoveryInput) {
    this.startCalls += 1;
    const observedAt = new Date().toISOString();
    const handle: DurableResearchDiscoveryHandle = {
      providerResponseId: "resp_checkpoint_04b_deterministic",
      state: "QUEUED",
      requestedModel: this.requestedModel,
      providerModel: this.providerSnapshot,
      traceId: "trace-checkpoint-04b-deterministic",
      binding: {
        runId: input.runId,
        jobId: input.jobId,
        attemptId: input.attemptId,
        caseId: input.caseId,
        manifestFingerprint: input.manifestFingerprint,
        externalIdempotencyKey: input.externalIdempotencyKey,
      },
      startedAt: observedAt,
      lastObservedAt: observedAt,
      inputBytes: 512,
      dataControlMode: "MODIFIED_ABUSE_MONITORING",
      projectIdFingerprint: "a".repeat(64),
      privateContentIncluded: true,
    };
    return { kind: "STARTED" as const, state: "QUEUED" as const, handle };
  }

  async retrieve(
    input: DurableResearchDiscoveryInput,
    handle: DurableResearchDiscoveryHandle,
  ) {
    this.retrieveCalls += 1;
    const observedAt = new Date().toISOString();
    if (this.retrieveCalls === 1) {
      return {
        kind: "PENDING" as const,
        state: "IN_PROGRESS" as const,
        handle: { ...handle, state: "IN_PROGRESS" as const, lastObservedAt: observedAt },
      };
    }
    const sourceClass = input.sourceClassIds[0];
    const axis = input.axes.find((candidate) =>
      sourceClass === undefined
        ? false
        : candidate.sourceClassIds.includes(sourceClass),
    );
    if (sourceClass === undefined || axis === undefined) {
      throw new Error("Deterministic discovery input has no covered source class");
    }
    const completedHandle = {
      ...handle,
      state: "COMPLETED" as const,
      lastObservedAt: observedAt,
    };
    return {
      kind: "COMPLETED" as const,
      state: "COMPLETED" as const,
      handle: completedHandle,
      output: {
        candidates: [
          {
            candidateKey: "sha256:checkpoint-04b-deterministic-candidate",
            title: "Deterministic source candidate",
            canonicalUrl: "https://example.org/afterframe-source",
            medium: "WEBPAGE" as const,
            sourceClass,
            axisIds: [axis.axisId],
            accessState: "UNKNOWN" as const,
            rightsState: "UNKNOWN" as const,
            discoveryInputFingerprint: input.manifestFingerprint,
            contentTrust: "UNTRUSTED" as const,
            evidenceStatus: "NOT_EVIDENCE" as const,
            reviewState: "PROPOSED" as const,
            publicationAuthority: "NONE" as const,
          },
          {
            candidateKey: "sha256:checkpoint-04b-deterministic-candidate-two",
            title: "Second deterministic source candidate",
            canonicalUrl: "https://example.org/afterframe-source-two",
            medium: "WEBPAGE" as const,
            sourceClass,
            axisIds: [axis.axisId],
            accessState: "UNKNOWN" as const,
            rightsState: "UNKNOWN" as const,
            discoveryInputFingerprint: input.manifestFingerprint,
            contentTrust: "UNTRUSTED" as const,
            evidenceStatus: "NOT_EVIDENCE" as const,
            reviewState: "PROPOSED" as const,
            publicationAuthority: "NONE" as const,
          },
        ],
        execution: {
          executionKind: "MODEL_TOOL" as const,
          traceId: completedHandle.traceId,
          providerRunId: completedHandle.providerResponseId,
          ...openAIBackgroundDiscoveryExecutionIdentity(
            this.requestedModel,
            this.providerSnapshot,
          ),
          telemetryState: "COMPLETE" as const,
          usage: {
            inputTokens: 100,
            outputTokens: 20,
            toolCalls: 1,
            inputBytes: completedHandle.inputBytes,
            outputBytes: 256,
          },
          cost: {
            currency: "USD" as const,
            pricingState: "UNPRICED" as const,
            amountMicros: null,
          },
          latencyMs: 100,
          provenanceInputs: [
            { recordType: "CASE" as const, recordId: input.caseId },
            { recordType: "RUN" as const, recordId: input.runId },
            { recordType: "JOB" as const, recordId: input.jobId },
            { recordType: "ATTEMPT" as const, recordId: input.attemptId },
          ],
          privateContentIncluded: true,
        },
      },
    };
  }
}

async function seedCase(
  client: Client,
  investigationCase: InvestigationCase,
  rootBranch: InvestigationBranch,
) {
  await client.query("set constraints all deferred");
  await client.query(
    `insert into auth.users (
       instance_id, id, aud, role, email, encrypted_password,
       email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
       created_at, updated_at
     ) values (
       '00000000-0000-0000-0000-000000000000', $1,
       'authenticated', 'authenticated', $2, '', clock_timestamp(),
       '{}'::jsonb, '{}'::jsonb, clock_timestamp(), clock_timestamp()
     )`,
    [
      investigationCase.ownerId,
      `afterframe-checkpoint-03-${investigationCase.ownerId}@invalid.example`,
    ],
  );
  await client.query(
    `insert into public.af_cases (
       id, owner_id, specialist_id, specialist_version,
       subject_type, subject_id, subject_version_id, exact_curiosity,
       status, health, active_branch_id, aggregate_version, event_sequence,
       created_at, updated_at
     ) values (
       $1, $2, $3, $4, $5, $6, $7, $8,
       $9, $10, $11, $12, $13, $14, $15
     )`,
    [
      investigationCase.id,
      investigationCase.ownerId,
      investigationCase.specialistId,
      investigationCase.specialistVersion,
      investigationCase.subjectRef.type,
      investigationCase.subjectRef.id,
      investigationCase.subjectRef.versionId,
      investigationCase.exactCuriosity,
      investigationCase.status,
      investigationCase.health,
      investigationCase.activeBranchId,
      investigationCase.aggregateVersion,
      investigationCase.eventSequence,
      investigationCase.createdAt,
      investigationCase.updatedAt,
    ],
  );
  await client.query(
    `insert into public.af_branches (
       id, case_id, parent_branch_id, origin_direction_id, kind, title,
       normalized_objective, status, research_axis_ids,
       unresolved_questions, return_branch_id, return_reading_sequence_key,
       return_beat_id, aggregate_version, created_at, updated_at
     ) values (
       $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
       null, null, null, $11, $12, $13
     )`,
    [
      rootBranch.id,
      rootBranch.caseId,
      rootBranch.parentBranchId,
      rootBranch.originDirectionId,
      rootBranch.kind,
      rootBranch.title,
      rootBranch.normalizedObjective,
      rootBranch.status,
      rootBranch.researchAxisIds,
      rootBranch.unresolvedQuestions,
      rootBranch.aggregateVersion,
      rootBranch.createdAt,
      rootBranch.updatedAt,
    ],
  );
}

describeDatabase("checkpoint-03 real Postgres lifecycle", () => {
  it(
    "rolls back start, idempotent identity completion, and replay",
    async () => {
      const client = new Client({
        connectionString: loadDatabaseUrl(),
        ssl: { rejectUnauthorized: false },
        application_name: "afterframe-checkpoint-03-integration",
      });
      try {
        try {
          await client.connect();
        } catch {
          throw new Error(
            "Checkpoint-03 integration could not connect using SUPABASE_DB_URL",
          );
        }

        const deployedFunctions = await checkpoint03FunctionsAreDeployed(client);
        expect([...deployedFunctions].sort()).toEqual(
          [...checkpoint03RpcNames].sort(),
        );
        const actorId = randomUUID();
        const caseId = randomUUID();
        const branchId = randomUUID();
        const investigationCase: InvestigationCase = {
          ...BLACK_HAWK_DOWN_CASE,
          id: caseId,
          ownerId: actorId,
          activeBranchId: branchId,
        };
        const rootBranch: InvestigationBranch = {
          ...BLACK_HAWK_DOWN_ROOT_BRANCH,
          id: branchId,
          caseId,
        };
        const researchCommand = {
          ...BLACK_HAWK_DOWN_RESEARCH_COMMAND,
          caseId,
          branchId,
        };
        const baselineTableCounts = await afTableCounts(client);
        const baselineActorCount = await fixtureActorCount(client, actorId);
        expect(baselineActorCount).toBe(0n);

        await client.query("begin");
        let lifecycleError: unknown;
        let rpcFailure: RpcFailure | undefined;
        try {
          if (process.env.AFTERFRAME_DB_MIGRATION_012_PREFLIGHT === "1") {
            await client.query(candidateAxisMigration);
          }
          if (process.env.AFTERFRAME_DB_MIGRATION_013_PREFLIGHT === "1") {
            await client.query(durableResolutionMigration);
          }
          if (process.env.AFTERFRAME_DB_MIGRATION_014_PREFLIGHT === "1") {
            await client.query(durableRetrievalMigration);
          }
          await seedCase(client, investigationCase, rootBranch);
          const invokeRpc = transactionalRpcInvoker(client, (failure) => {
            rpcFailure = failure;
          });
          const investigationStore = new SupabaseInvestigationStore({
            actorId,
            invokeRpc,
          });
          const startStore = new SupabaseResearchRunStartStore({
            actorId,
            invokeRpc,
            reservationLeaseSeconds: 60,
          });
          const workerStore = new SupabaseDurableResearchWorkerStore({
            actorId,
            invokeRpc,
          });
          const startTime = await databaseTimestamp(client);
          const startResearch = createStartResearchRunService({
            context: investigationStore,
            store: startStore,
            specialists: afterFrameV1SpecialistRegistry,
            fingerprints,
            createId: () => randomUUID(),
            now: () => startTime,
          });

          const started = await startResearch(
            actorId,
            researchCommand,
          );
          expect(started.replayed).toBe(false);
          expect(started.bundle.jobs).toHaveLength(7);
          const job = started.bundle.jobs[0];
          if (job === undefined) throw new Error("Start did not stage IDENTITY");

          const attemptId = randomUUID();
          const claimIdempotencyKey = "checkpoint-03:identity:claim-once";
          const execution = {
            executorId: "identity-resolver",
            executorVersion: "1.0.0",
            configurationFingerprint: sha256("checkpoint-03-resolver-config"),
            executionKind: "RESOLVER" as const,
            model: null,
            prompt: null,
            schema: {
              id: "identity-result",
              version: "1.0.0",
              schemaFingerprint: sha256("checkpoint-03-identity-schema"),
            },
            tool: { id: "movie-identity", version: "1.0.0" },
            privateContentIncluded: false,
            automaticRetrySafety: "IDEMPOTENT_PROVIDER_REQUEST" as const,
          };
          const claimInput = {
            actorId,
            runId: started.bundle.run.id,
            jobId: job.id,
            stage: "IDENTITY" as const,
            expectedRunVersion: started.bundle.run.aggregateVersion,
            expectedJobVersion: job.aggregateVersion,
            idempotencyKey: claimIdempotencyKey,
            attemptId,
            workerId: "checkpoint-03-integration-worker-a",
            execution,
            leaseDurationSeconds: 60,
          };
          const claimed = await workerStore.claimResearchJob(claimInput);
          expect(claimed.status).toBe("CLAIMED");
          if (claimed.status !== "CLAIMED") {
            throw new Error("IDENTITY was not claimed");
          }
          expect(claimed.claim.latestCheckpoint).toBeNull();
          expect(claimed.claim.providerCheckpoint).toBeNull();

          const providerRunId = "checkpoint-03-provider-run-1";
          const checkpointTime = await databaseTimestamp(client);
          const checkpointInput = {
            actorId,
            lease: claimed.claim.lease,
            checkpoint: {
              schemaVersion: 1 as const,
              id: randomUUID(),
              runId: started.bundle.run.id,
              jobId: job.id,
              attemptId,
              idempotencyKey: "checkpoint-03:provider-accepted-once",
              sequence: 1,
              kind: "PROVIDER_ACCEPTED" as const,
              completedUnits: 0,
              totalUnits: 1,
              providerRunId,
              resumeTokenFingerprint: sha256("checkpoint-03-resume-token"),
              outputFingerprint: null,
              publicationAuthority: "NONE" as const,
              createdAt: checkpointTime,
            },
            leaseDurationSeconds: 60,
          };
          const checkpointed = await workerStore.checkpointResearchJob(
            checkpointInput,
          );
          expect(checkpointed.status).toBe("COMMITTED");
          if (checkpointed.status !== "COMMITTED") {
            throw new Error("Provider checkpoint was not committed");
          }
          const checkpointReplay = await workerStore.checkpointResearchJob({
            ...checkpointInput,
            lease: checkpointed.lease,
          });
          expect(checkpointReplay).toMatchObject({
            status: "REPLAY",
            checkpoint: checkpointed.checkpoint,
          });

          const completionTime = await databaseTimestamp(client);
          const subjectIdentityId = randomUUID();
          const result = ResearchStageExecutionResultSchema.parse({
            outcome: "DEGRADED",
            boundedReasonCodes: ["identity-requirements-unresolved"],
            output: {
              schemaVersion: 1,
              id: randomUUID(),
              runId: started.bundle.run.id,
              jobId: job.id,
              attemptId,
              kind: "IDENTITY_RESULT",
              stage: "IDENTITY",
              reviewState: "PROPOSED",
              publicationAuthority: "NONE",
              provenanceInputs: [
                { recordType: "JOB", recordId: job.id },
                { recordType: "ATTEMPT", recordId: attemptId },
              ],
              createdAt: completionTime,
              subjectIdentityId,
              resolvedRequirementIds: ["tmdb-film"],
              unresolvedRequirementIds: ["film-version"],
            },
            subjectIdentities: [
              {
                schemaVersion: 1,
                id: subjectIdentityId,
                caseId,
                runId: started.bundle.run.id,
                jobId: job.id,
                attemptId,
                subjectRefFingerprint:
                  claimed.claim.inputManifest.manifest.subjectRefFingerprint,
                publicIdentity: {
                  displayName: "Checkpoint worker fixture film",
                  alternateNames: [],
                  disambiguators: [
                    { label: "provider-id", value: "855" },
                  ],
                  identityFingerprint: sha256(
                    "checkpoint-03-worker-fixture-identity",
                  ),
                  dataClass: "PUBLIC",
                  verificationState: "RESOLVER_VERIFIED",
                  resolver: { id: "movie-identity", version: "1.0.0" },
                  resolvedAt: completionTime,
                },
                evidenceStatus: "NOT_EVIDENCE",
                reviewState: "PROPOSED",
                publicationAuthority: "NONE",
                provenanceInputs: [
                  { recordType: "JOB", recordId: job.id },
                  { recordType: "ATTEMPT", recordId: attemptId },
                ],
                createdAt: completionTime,
              },
            ],
            sourceCandidates: [],
            untrustedContent: [],
          });
          const completeInput = {
            actorId,
            lease:
              checkpointReplay.status === "REPLAY"
                ? checkpointReplay.lease
                : checkpointed.lease,
            idempotencyKey: "checkpoint-03:complete-once",
            result,
            outputFingerprint:
              fingerprints.fingerprintExecutionOutput(result),
            execution: {
              telemetryState: "COMPLETE" as const,
              providerRunId,
              usage: {
                inputTokens: 10,
                outputTokens: 20,
                toolCalls: 1,
                inputBytes: 100,
                outputBytes: 200,
              },
              cost: {
                currency: "USD" as const,
                pricingState: "UNPRICED" as const,
                amountMicros: null,
              },
              latencyMs: 200,
              completedAt: completionTime,
            },
          };
          const completed = await workerStore.completeResearchJob(
            completeInput,
          );
          expect(completed).toMatchObject({
            status: "COMMITTED",
            outcome: "DEGRADED",
            terminal: { attemptId, jobStatus: "DEGRADED" },
          });
          const completionReplay = await workerStore.completeResearchJob(
            completeInput,
          );
          expect(completionReplay).toMatchObject({
            status: "REPLAY",
            outcome: "DEGRADED",
            terminal: { attemptId, jobStatus: "DEGRADED" },
          });
          const terminalClaim = await workerStore.claimResearchJob({
            ...claimInput,
            workerId: "checkpoint-03-integration-worker-c",
          });
          expect(terminalClaim).toMatchObject({
            status: "TERMINAL",
            replayed: true,
            terminal: { attemptId, jobStatus: "DEGRADED" },
          });

          const startReplay = await startResearch(
            actorId,
            researchCommand,
          );
          expect(startReplay.replayed).toBe(true);
          expect(startReplay.bundle).toEqual(started.bundle);

          const durableCounts = await client.query<{
            attempts: string;
            checkpoints: string;
            handoffs: string;
            outputs: string;
          }>(
            `select
               (select count(*)::text from public.af_research_attempts
                 where run_id = $1) as attempts,
               (select count(*)::text from public.af_research_attempt_checkpoints
                 where run_id = $1) as checkpoints,
               (select count(*)::text from public.af_research_attempt_handoffs
                 where run_id = $1) as handoffs,
               (select count(*)::text from public.af_research_stage_outputs
                 where run_id = $1) as outputs`,
            [started.bundle.run.id],
          );
          expect(durableCounts.rows[0]).toEqual({
            attempts: "1",
            checkpoints: "1",
            handoffs: "0",
            outputs: "1",
          });

          throw rollbackSentinel;
        } catch (error) {
          lifecycleError = error;
        }

        await client.query("rollback");
        expect(await afTableCounts(client)).toEqual(baselineTableCounts);
        expect(await fixtureActorCount(client, actorId)).toBe(
          baselineActorCount,
        );
        if (lifecycleError !== rollbackSentinel) {
          if (rpcFailure !== undefined) {
            throw new Error(
              `Checkpoint-03 RPC ${rpcFailure.functionName} failed with SQLSTATE ${rpcFailure.code ?? "unknown"}: ${rpcFailure.diagnostic}`,
            );
          }
          throw lifecycleError;
        }
      } finally {
        await client.end().catch(() => undefined);
      }
    },
    60_000,
  );

  it(
    "durably resolves a generic movie and completes resumable DISCOVERY",
    async () => {
      const client = new Client({
        connectionString: loadDatabaseUrl(),
        ssl: { rejectUnauthorized: false },
        application_name: "afterframe-checkpoint-04a-integration",
      });
      try {
        try {
          await client.connect();
        } catch {
          throw new Error(
            "Checkpoint-04A integration could not connect using SUPABASE_DB_URL",
          );
        }

        const deployedFunctions = await checkpoint03FunctionsAreDeployed(client);
        expect([...deployedFunctions].sort()).toEqual(
          [...checkpoint03RpcNames].sort(),
        );
        const actorId = randomUUID();
        const caseId = randomUUID();
        const branchId = randomUUID();
        const exactCuriosity =
          "How did production choices shape this film's visual language?";
        const investigationCase: InvestigationCase = {
          ...BLACK_HAWK_DOWN_CASE,
          id: caseId,
          ownerId: actorId,
          subjectRef: {
            type: "film",
            id: "tmdb:movie:603",
            versionId: null,
          },
          exactCuriosity,
          activeBranchId: branchId,
        };
        const rootBranch: InvestigationBranch = {
          ...BLACK_HAWK_DOWN_ROOT_BRANCH,
          id: branchId,
          caseId,
          title: "Production choices and visual form",
          normalizedObjective:
            "Investigate how production decisions shaped the film's visual form without assuming a single author or intention.",
          researchAxisIds: ["film-form", "production-authorship"],
          unresolvedQuestions: [
            "Which production decisions are supported by inspectable sources?",
          ],
        };
        const researchCommand = {
          caseId,
          branchId,
          expectedCaseVersion: investigationCase.aggregateVersion,
          idempotencyKey: "checkpoint-04a:generic-movie:research-run:v1",
        };
        const baselineTableCounts = await afTableCounts(client);
        const baselineActorCount = await fixtureActorCount(client, actorId);
        expect(baselineActorCount).toBe(0n);

        await client.query("begin");
        let lifecycleError: unknown;
        let rpcFailure: RpcFailure | undefined;
        try {
          if (process.env.AFTERFRAME_DB_MIGRATION_012_PREFLIGHT === "1") {
            await client.query(candidateAxisMigration);
          }
          if (process.env.AFTERFRAME_DB_MIGRATION_013_PREFLIGHT === "1") {
            await client.query(durableResolutionMigration);
          }
          if (process.env.AFTERFRAME_DB_MIGRATION_014_PREFLIGHT === "1") {
            await client.query(durableRetrievalMigration);
          }
          await seedCase(client, investigationCase, rootBranch);
          const invokeRpc = transactionalRpcInvoker(client, (failure) => {
            rpcFailure = failure;
          });
          const investigationStore = new SupabaseInvestigationStore({
            actorId,
            invokeRpc,
          });
          const startStore = new SupabaseResearchRunStartStore({
            actorId,
            invokeRpc,
            reservationLeaseSeconds: 60,
          });
          const workerStore = new SupabaseDurableResearchWorkerStore({
            actorId,
            invokeRpc,
          });
          const startedAt = await databaseTimestamp(client);
          const startResearch = createStartResearchRunService({
            context: investigationStore,
            store: startStore,
            specialists: afterFrameV1SpecialistRegistry,
            fingerprints,
            createId: () => randomUUID(),
            now: () => startedAt,
          });
          const started = await startResearch(actorId, researchCommand);
          expect(started.replayed).toBe(false);
          expect(started.bundle.subjectIdentities).toEqual([]);
          const identityJob = started.bundle.jobs[0];
          if (identityJob === undefined || identityJob.stage !== "IDENTITY") {
            throw new Error("Research start did not stage IDENTITY first");
          }

          const discoveryProvider =
            new DeterministicPendingThenCompletedDiscoveryProvider();
          let resolutionProbeCalls = 0;
          const resolutionResolver = new DeterministicSourceMetadataResolver({
            async probe(url) {
              resolutionProbeCalls += 1;
              return {
                requestedUrl: url,
                hops: [
                  {
                    url,
                    statusCode: 200,
                    resolvedAddresses: ["93.184.216.34"],
                    contentType: "text/html; charset=utf-8",
                    contentLength: 4_096,
                    title: "Deterministic source candidate",
                    observedAt: new Date().toISOString(),
                  },
                ],
                bodyIncluded: false,
              };
            },
          } satisfies SourceMetadataProbeTransport);
          const registry = createAfterFrameV1ResearchExecutorRegistry({
            actorId,
            invokeRpc,
            tmdbApiKey: loadTmdbApiKey(),
            resolverTimeoutMs: 20_000,
            createId: () => randomUUID(),
            now: () => new Date(),
            discovery: {
              provider: discoveryProvider,
              requestedModel: discoveryProvider.requestedModel,
              expectedProviderSnapshot: discoveryProvider.providerSnapshot,
              pollIntervalMs: 100,
              maxPollsPerExecution: 1,
            },
            resolution: {
              resolver: resolutionResolver,
              maxCandidatesPerExecution: 1,
            },
          });
          expect(registry.resolve("IDENTITY")?.identity.execution).toEqual(
            afterFrameV1IdentityExecutionPlan(20_000),
          );
          const executeResearchJob = createDurableResearchWorkerService({
            store: workerStore,
            executors: registry,
            fingerprints,
            workerId: "checkpoint-04a-identity-worker",
            leaseDurationSeconds: 60,
            heartbeatIntervalMs: 1_000,
            createId: () => randomUUID(),
            now: () => new Date().toISOString(),
          });
          const identityExecution = await executeResearchJob(actorId, {
            runId: started.bundle.run.id,
            jobId: identityJob.id,
            stage: "IDENTITY",
            expectedRunVersion: started.bundle.run.aggregateVersion,
            expectedJobVersion: identityJob.aggregateVersion,
            idempotencyKey: "checkpoint-04a:generic-movie:identity:v1",
          });
          expect(["SUCCEEDED", "DEGRADED"]).toContain(
            identityExecution.disposition,
          );

          const identityRows = await client.query<{
            identity_id: string;
            identity_fingerprint: string;
            output_id: string;
            output_fingerprint: string;
            attempt_id: string;
            job_id: string;
            identity_manifest: unknown;
          }>(
            `select identity.id::text as identity_id,
               identity.identity_fingerprint::text as identity_fingerprint,
               output.id::text as output_id,
               attempt.output_fingerprint::text as output_fingerprint,
               attempt.id::text as attempt_id,
               attempt.job_id::text as job_id,
               manifest.manifest as identity_manifest
             from public.af_resolved_subject_identities identity
             join public.af_research_stage_outputs output
               on output.run_id = identity.run_id
              and output.attempt_id = identity.attempt_id
              and output.subject_identity_id = identity.id
             join public.af_research_attempts attempt
               on attempt.id = identity.attempt_id
             join public.af_research_attempt_input_manifests manifest
               on manifest.attempt_id = identity.attempt_id
             where identity.run_id = $1`,
            [started.bundle.run.id],
          );
          expect(identityRows.rows).toHaveLength(1);
          const identityRow = identityRows.rows[0];
          if (identityRow === undefined) {
            throw new Error("Identity completion did not persist its record");
          }
          expect(identityRow.identity_manifest).toMatchObject({
            stage: "IDENTITY",
            dependency: { state: "ROOT" },
            subjectIdentity: { state: "UNBOUND" },
          });
          expect(JSON.stringify(identityRow.identity_manifest)).not.toContain(
            exactCuriosity,
          );

          const identityReader = new SupabaseResearchIdentityReader({
            actorId,
            invokeRpc,
          });
          const resolvedIdentity = await identityReader.getResolvedSubjectIdentity({
            actorId,
            runId: started.bundle.run.id,
          });
          expect(resolvedIdentity).toMatchObject({
            id: identityRow.identity_id,
            evidenceStatus: "NOT_EVIDENCE",
            publicationAuthority: "NONE",
            publicIdentity: {
              dataClass: "PUBLIC",
              verificationState: "RESOLVER_VERIFIED",
              resolver: { id: "tmdb-movie-details", version: "v3" },
            },
          });
          expect(JSON.stringify(resolvedIdentity)).not.toContain(
            exactCuriosity,
          );

          const nextState = await client.query<{
            run_version: string;
            job_id: string;
            job_version: string;
            job_status: string;
          }>(
            `select run.aggregate_version::text as run_version,
               job.id::text as job_id,
               job.aggregate_version::text as job_version,
               job.status::text as job_status
             from public.af_research_runs run
             join public.af_research_jobs job on job.run_id = run.id
             where run.id = $1 and job.stage = 'SCOPING'`,
            [started.bundle.run.id],
          );
          const scopingState = nextState.rows[0];
          if (scopingState === undefined) {
            throw new Error("Identity completion did not expose SCOPING");
          }
          expect(scopingState.job_status).toBe("QUEUED");
          expect(registry.resolve("SCOPING")?.identity.execution).toEqual(
            afterFrameV1ScopingExecutionPlan(),
          );
          const scopingExecution = await executeResearchJob(actorId, {
            runId: started.bundle.run.id,
            jobId: scopingState.job_id,
            stage: "SCOPING",
            expectedRunVersion: Number(scopingState.run_version),
            expectedJobVersion: Number(scopingState.job_version),
            idempotencyKey: "checkpoint-04a:generic-movie:scoping:v1",
          });
          expect(["SUCCEEDED", "DEGRADED"]).toContain(
            scopingExecution.disposition,
          );

          const scopingRows = await client.query<{
            manifest: unknown;
            kind: string;
            stage: string;
            axis_ids: string[];
            source_class_ids: string[];
            coverage_gap_codes: string[];
            output_count: string;
            candidate_count: string;
            discovery_status: string;
          }>(
            `select manifest.manifest,
               output.kind::text as kind,
               output.stage::text as stage,
               output.axis_ids,
               output.source_class_ids,
               output.coverage_gap_codes,
               (select count(*)::text from public.af_research_stage_outputs
                 where run_id = $1 and stage = 'SCOPING') as output_count,
               (select count(*)::text from public.af_source_candidates
                 where run_id = $1) as candidate_count,
               (select status::text from public.af_research_jobs
                 where run_id = $1 and stage = 'DISCOVERY') as discovery_status
             from public.af_research_attempt_input_manifests manifest
             join public.af_research_stage_outputs output
               on output.run_id = manifest.run_id
              and output.job_id = manifest.job_id
              and output.attempt_id = manifest.attempt_id
             where manifest.run_id = $1 and manifest.stage = 'SCOPING'`,
            [started.bundle.run.id],
          );
          expect(scopingRows.rows).toHaveLength(1);
          const scopingRow = scopingRows.rows[0];
          if (scopingRow === undefined) {
            throw new Error("SCOPING did not persist its deterministic output");
          }
          expect(scopingRow.manifest).toMatchObject({
            stage: "SCOPING",
            dependency: {
              state: "BOUND",
              predecessorJobId: identityRow.job_id,
              predecessorAttemptId: identityRow.attempt_id,
              predecessorOutputId: identityRow.output_id,
              predecessorOutputFingerprint: identityRow.output_fingerprint,
            },
            subjectIdentity: {
              state: "BOUND",
              subjectIdentityId: identityRow.identity_id,
              identityFingerprint: identityRow.identity_fingerprint,
            },
          });
          expect(scopingRow).toMatchObject({
            kind: "SCOPE_RESULT",
            stage: "SCOPING",
            axis_ids: started.bundle.plan.plan.axes.map(({ axisId }) => axisId),
            source_class_ids: started.bundle.plan.plan.sourceClassIds,
          });
          expect(scopingRow.coverage_gap_codes).toEqual(
            started.bundle.plan.plan.coverageGaps.length === 0
              ? []
              : ["specialist-plan-coverage-gaps"],
          );
          expect(scopingRow.output_count).toBe("1");
          expect(scopingRow.candidate_count).toBe("0");
          expect(scopingRow.discovery_status).toBe("QUEUED");
          const serializedManifest = JSON.stringify(scopingRow.manifest);
          expect(serializedManifest).not.toContain(exactCuriosity);
          expect(serializedManifest).not.toContain(
            resolvedIdentity?.publicIdentity.displayName ?? "unreachable-name",
          );

          const discoveryStateResult = await client.query<{
            run_version: string;
            job_id: string;
            job_version: string;
          }>(
            `select run.aggregate_version::text as run_version,
               job.id::text as job_id,
               job.aggregate_version::text as job_version
             from public.af_research_runs run
             join public.af_research_jobs job on job.run_id = run.id
             where run.id = $1 and job.stage = 'DISCOVERY'`,
            [started.bundle.run.id],
          );
          const discoveryState = discoveryStateResult.rows[0];
          if (discoveryState === undefined) {
            throw new Error("SCOPING did not expose DISCOVERY");
          }
          const firstDiscoveryWorker = createDurableResearchWorkerService({
            store: workerStore,
            executors: registry,
            fingerprints,
            workerId: "checkpoint-04b-discovery-worker-a",
            leaseDurationSeconds: 60,
            heartbeatIntervalMs: 1_000,
            createId: () => randomUUID(),
            now: () => new Date().toISOString(),
          });
          const discoveryCommand = {
            runId: started.bundle.run.id,
            jobId: discoveryState.job_id,
            stage: "DISCOVERY" as const,
            expectedRunVersion: Number(discoveryState.run_version),
            expectedJobVersion: Number(discoveryState.job_version),
            idempotencyKey: "checkpoint-04b:generic-movie:discovery:v1",
          };
          const handedOff = await firstDiscoveryWorker(
            actorId,
            discoveryCommand,
          );
          expect(handedOff.disposition).toBe("RELEASED");
          expect(discoveryProvider.startCalls).toBe(1);
          expect(discoveryProvider.retrieveCalls).toBe(1);

          await new Promise((resolve) => setTimeout(resolve, 150));
          const takeoverStateResult = await client.query<{
            run_version: string;
            job_version: string;
          }>(
            `select run.aggregate_version::text as run_version,
               job.aggregate_version::text as job_version
             from public.af_research_runs run
             join public.af_research_jobs job on job.run_id = run.id
             where run.id = $1 and job.id = $2`,
            [started.bundle.run.id, discoveryState.job_id],
          );
          const takeoverState = takeoverStateResult.rows[0];
          if (takeoverState === undefined) {
            throw new Error("DISCOVERY handoff state disappeared");
          }
          const takeoverWorker = createDurableResearchWorkerService({
            store: workerStore,
            executors: registry,
            fingerprints,
            workerId: "checkpoint-04b-discovery-worker-b",
            leaseDurationSeconds: 60,
            heartbeatIntervalMs: 1_000,
            createId: () => randomUUID(),
            now: () => new Date().toISOString(),
          });
          const discovered = await takeoverWorker(actorId, {
            ...discoveryCommand,
            expectedRunVersion: Number(takeoverState.run_version),
            expectedJobVersion: Number(takeoverState.job_version),
          });
          expect(discovered.disposition).toBe("SUCCEEDED");
          expect(discoveryProvider.startCalls).toBe(1);
          expect(discoveryProvider.retrieveCalls).toBe(2);

          if (durableResolutionLifecycleEnabled) {
            const resolutionStateResult = await client.query<{
              run_version: string;
              job_id: string;
              job_version: string;
              job_status: string;
            }>(
              `select run.aggregate_version::text as run_version,
                 job.id::text as job_id,
                 job.aggregate_version::text as job_version,
                 job.status::text as job_status
               from public.af_research_runs run
               join public.af_research_jobs job on job.run_id = run.id
               where run.id = $1 and job.stage = 'RESOLUTION'`,
              [started.bundle.run.id],
            );
            const resolutionState = resolutionStateResult.rows[0];
            if (resolutionState === undefined) {
              throw new Error("DISCOVERY did not expose RESOLUTION");
            }
            expect(resolutionState.job_status).toBe("QUEUED");

            expect(registry.resolve("RESOLUTION")?.identity.execution).toEqual(
              afterFrameV1SourceResolutionExecutionPlan(),
            );
            const resolutionCommand = {
              runId: started.bundle.run.id,
              jobId: resolutionState.job_id,
              stage: "RESOLUTION" as const,
              expectedRunVersion: Number(resolutionState.run_version),
              expectedJobVersion: Number(resolutionState.job_version),
              idempotencyKey: "checkpoint-04c:resolution:executor:v1",
            };
            const handedOffResolution = await executeResearchJob(
              actorId,
              resolutionCommand,
            );
            expect(handedOffResolution.disposition).toBe("RELEASED");
            expect(resolutionProbeCalls).toBe(1);

            await new Promise((resolve) => setTimeout(resolve, 150));
            const resumedResolutionState = await client.query<{
              run_version: string;
              job_version: string;
            }>(
              `select run.aggregate_version::text as run_version,
                 job.aggregate_version::text as job_version
               from public.af_research_runs run
               join public.af_research_jobs job on job.run_id = run.id
               where run.id = $1 and job.id = $2`,
              [started.bundle.run.id, resolutionState.job_id],
            );
            const resumedState = resumedResolutionState.rows[0];
            if (resumedState === undefined) {
              throw new Error("RESOLUTION handoff state disappeared");
            }
            const resolved = await executeResearchJob(actorId, {
              ...resolutionCommand,
              expectedRunVersion: Number(resumedState.run_version),
              expectedJobVersion: Number(resumedState.job_version),
            });
            expect(resolved.disposition).toBe("SUCCEEDED");
            expect(resolutionProbeCalls).toBe(2);

            const resolutionCounts = await client.query<{
              sources: string;
              locators: string;
              resolutions: string;
              outputs: string;
              normalization_status: string;
            }>(
              `select
                 (select count(*)::text from public.af_sources source
                   join public.af_source_resolution_records resolution
                     on resolution.source_id = source.id
                   where resolution.run_id = $1) as sources,
                 (select count(*)::text from public.af_source_locators locator
                   join public.af_source_resolution_records resolution
                     on resolution.locator_id = locator.id
                   where resolution.run_id = $1) as locators,
                 (select count(*)::text from public.af_source_resolution_records
                   where run_id = $1) as resolutions,
                 (select count(*)::text from public.af_research_stage_outputs
                   where run_id = $1 and stage = 'RESOLUTION') as outputs,
                 (select status::text from public.af_research_jobs
                   where run_id = $1 and stage = 'NORMALIZATION') as normalization_status`,
              [started.bundle.run.id],
            );
            expect(resolutionCounts.rows[0]).toEqual({
              sources: "2",
              locators: "2",
              resolutions: "2",
              outputs: "1",
              normalization_status: "QUEUED",
            });

            if (durableRetrievalLifecycleEnabled) {
              const normalizationStateResult = await client.query<{
                run_version: string;
                job_id: string;
                job_version: string;
              }>(
                `select run.aggregate_version::text as run_version,
                   job.id::text as job_id,
                   job.aggregate_version::text as job_version
                 from public.af_research_runs run
                 join public.af_research_jobs job on job.run_id = run.id
                 where run.id = $1 and job.stage = 'NORMALIZATION'`,
                [started.bundle.run.id],
              );
              const normalizationState = normalizationStateResult.rows[0];
              if (normalizationState === undefined) {
                throw new Error("RESOLUTION did not expose NORMALIZATION");
              }
              const normalizationAttemptId = randomUUID();
              const normalizationClaim = await workerStore.claimResearchJob({
                actorId,
                runId: started.bundle.run.id,
                jobId: normalizationState.job_id,
                stage: "NORMALIZATION",
                expectedRunVersion: Number(normalizationState.run_version),
                expectedJobVersion: Number(normalizationState.job_version),
                idempotencyKey: "checkpoint-04d:normalization:claim:v1",
                attemptId: normalizationAttemptId,
                workerId: "checkpoint-04d-retrieval-worker-a",
                execution: {
                  executorId: "normalization-retrieval-executor",
                  executorVersion: "1.0.0",
                  configurationFingerprint: sha256(
                    "checkpoint-04d-normalization-retrieval-config",
                  ),
                  executionKind: "RESOLVER",
                  model: null,
                  prompt: null,
                  schema: {
                    id: "source-retrieval-record",
                    version: "1.0.0",
                    schemaFingerprint: sha256(
                      "checkpoint-04d-source-retrieval-record-schema",
                    ),
                  },
                  tool: {
                    id: "public-source-retriever",
                    version: "1.0.0",
                  },
                  privateContentIncluded: true,
                  automaticRetrySafety: "IDEMPOTENT_PROVIDER_REQUEST",
                },
                leaseDurationSeconds: 60,
              });
              expect(normalizationClaim.status).toBe("CLAIMED");
              if (normalizationClaim.status !== "CLAIMED") {
                throw new Error("NORMALIZATION retrieval was not claimed");
              }

              const retrievalPersistence =
                new SupabaseSourceRetrievalPersistence({ actorId, invokeRpc });
              const retrievalContext =
                await retrievalPersistence.getNormalizationRetrievalContext({
                  actorId,
                  runId: started.bundle.run.id,
                  jobId: normalizationState.job_id,
                  attemptId: normalizationAttemptId,
                });
              expect(retrievalContext?.sources).toHaveLength(2);
              if (retrievalContext === null) {
                throw new Error("NORMALIZATION retrieval context was unavailable");
              }
              const [firstSource, secondSource] = retrievalContext.sources;
              if (firstSource === undefined || secondSource === undefined) {
                throw new Error("NORMALIZATION did not expose both resolved sources");
              }
              const makeRecord = (
                sourceContext: typeof firstSource,
                createdAt: string,
              ) => ({
                schemaVersion: 1 as const,
                id: randomUUID(),
                runId: retrievalContext.runId,
                jobId: retrievalContext.jobId,
                attemptId: retrievalContext.attemptId,
                caseId: retrievalContext.caseId,
                manifestFingerprint: retrievalContext.manifestFingerprint,
                resolutionRecordId: sourceContext.resolutionRecordId,
                idempotencyKey: `checkpoint-04d:retrieve:${sourceContext.candidate.id}`,
                policy: {
                  id: "lawful-source-retrieval",
                  version: "1.0.0",
                },
                retriever: {
                  id: "public-source-retriever",
                  version: "1.0.0",
                },
                result: {
                  status: "RETRIEVED" as const,
                  receipt: {
                    schemaVersion: 1 as const,
                    id: randomUUID(),
                    snapshotId: randomUUID(),
                    runId: retrievalContext.runId,
                    candidateId: sourceContext.candidate.id,
                    sourceId: sourceContext.source.id,
                    sourceLocatorId: sourceContext.locator.id,
                    requestedUrl: sourceContext.source.canonicalUrl!,
                    finalUrl: sourceContext.source.canonicalUrl!,
                    redirectChainFingerprint: sha256(
                      JSON.stringify([sourceContext.source.canonicalUrl]),
                    ),
                    declaredMediaType: "text/html; charset=utf-8",
                    verifiedMediaType: "text/html",
                    wireContentLength: 128,
                    decodedContentLength: 128,
                    contentFingerprint: sha256(
                      `checkpoint-04d-hostile-bytes:${sourceContext.candidate.id}`,
                    ),
                    retention: "TRANSIENT_ONLY" as const,
                    storageRef: null,
                    accessState: "OPEN" as const,
                    rightsState: "LINK_ONLY" as const,
                    trustBoundary: "UNTRUSTED_SOURCE_DATA" as const,
                    instructionAuthority: "NONE" as const,
                    screeningState: "UNSCREENED" as const,
                    publicationAuthority: "NONE" as const,
                    retriever: {
                      id: "public-source-retriever",
                      version: "1.0.0",
                    },
                    capturedAt: createdAt,
                  },
                },
                createdAt,
              });

              const firstRecord = makeRecord(
                firstSource,
                await databaseTimestamp(client),
              );
              const firstAccepted = await workerStore.acceptSourceRetrieval({
                actorId,
                lease: normalizationClaim.claim.lease,
                record: firstRecord,
                leaseDurationSeconds: 60,
              });
              expect(firstAccepted.status).toBe("COMMITTED");
              if (firstAccepted.status !== "COMMITTED") {
                throw new Error("First retrieval was not committed");
              }
              const firstReplay = await workerStore.acceptSourceRetrieval({
                actorId,
                lease: firstAccepted.lease,
                record: firstRecord,
                leaseDurationSeconds: 60,
              });
              expect(firstReplay).toMatchObject({
                status: "REPLAY",
                record: firstAccepted.record,
              });
              if (firstReplay.status !== "REPLAY") {
                throw new Error("First retrieval did not replay exactly");
              }

              const secondRecord = makeRecord(
                secondSource,
                await databaseTimestamp(client),
              );
              const staleAcceptance = await workerStore.acceptSourceRetrieval({
                actorId,
                lease: normalizationClaim.claim.lease,
                record: secondRecord,
                leaseDurationSeconds: 60,
              });
              expect(staleAcceptance).toEqual({ status: "LEASE_LOST" });

              const secondAccepted = await workerStore.acceptSourceRetrieval({
                actorId,
                lease: firstReplay.lease,
                record: secondRecord,
                leaseDurationSeconds: 60,
              });
              expect(secondAccepted.status).toBe("COMMITTED");

              const acceptedRetrievals =
                await retrievalPersistence.listAcceptedRetrievals({
                  actorId,
                  runId: retrievalContext.runId,
                  jobId: retrievalContext.jobId,
                  attemptId: retrievalContext.attemptId,
                });
              expect(acceptedRetrievals).toHaveLength(2);
              expect(
                acceptedRetrievals.every(
                  (record) =>
                    record.result.status === "RETRIEVED" &&
                    record.result.receipt.retention === "TRANSIENT_ONLY" &&
                    record.result.receipt.storageRef === null,
                ),
              ).toBe(true);

              const retrievalCounts = await client.query<{
                receipts: string;
                snapshots: string;
                retained_bodies: string;
              }>(
                `select
                   (select count(*)::text
                      from public.af_source_retrieval_records
                      where run_id = $1) as receipts,
                   (select count(*)::text
                      from public.af_source_snapshots
                      where created_by_run_id = $1) as snapshots,
                   (select count(*)::text
                      from public.af_source_snapshots
                      where created_by_run_id = $1 and storage_ref is not null)
                     as retained_bodies`,
                [retrievalContext.runId],
              );
              expect(retrievalCounts.rows[0]).toEqual({
                receipts: "2",
                snapshots: "2",
                retained_bodies: "0",
              });
            }
          }

          const durableCounts = await client.query<{
            attempts: string;
            checkpoints: string;
            handoffs: string;
            identities: string;
            manifests: string;
            outputs: string;
            provider_runs: string;
            candidates: string;
          }>(
            `select
               (select count(*)::text
                  from public.af_research_attempts
                  where run_id = $1) as attempts,
               (select count(*)::text
                  from public.af_research_attempt_checkpoints
                  where run_id = $1) as checkpoints,
               (select count(*)::text
                  from public.af_research_attempt_handoffs
                  where run_id = $1) as handoffs,
               (select count(*)::text
                  from public.af_resolved_subject_identities
                  where run_id = $1) as identities,
               (select count(*)::text
                  from public.af_research_attempt_input_manifests
                  where run_id = $1) as manifests,
               (select count(*)::text
                  from public.af_research_stage_outputs
                  where run_id = $1) as outputs,
               (select count(*)::text
                  from public.af_research_provider_runs
                  where run_id = $1) as provider_runs,
               (select count(*)::text
                  from public.af_source_candidates
                  where run_id = $1) as candidates`,
            [started.bundle.run.id],
          );
          expect(durableCounts.rows[0]).toEqual({
            attempts:
              durableRetrievalLifecycleEnabled
                ? "5"
                : durableResolutionLifecycleEnabled
                  ? "4"
                  : "3",
            checkpoints: durableResolutionLifecycleEnabled ? "3" : "2",
            handoffs: durableResolutionLifecycleEnabled ? "2" : "1",
            identities: "1",
            manifests:
              durableRetrievalLifecycleEnabled
                ? "5"
                : durableResolutionLifecycleEnabled
                  ? "4"
                  : "3",
            outputs:
              durableResolutionLifecycleEnabled
                ? "4"
                : "3",
            provider_runs: "1",
            candidates: "2",
          });

          throw rollbackSentinel;
        } catch (error) {
          lifecycleError = error;
        }

        await client.query("rollback");
        expect(await afTableCounts(client)).toEqual(baselineTableCounts);
        expect(await fixtureActorCount(client, actorId)).toBe(
          baselineActorCount,
        );
        if (lifecycleError !== rollbackSentinel) {
          if (rpcFailure !== undefined) {
            throw new Error(
              `Checkpoint-04A RPC ${rpcFailure.functionName} failed with SQLSTATE ${rpcFailure.code ?? "unknown"}: ${rpcFailure.diagnostic}`,
            );
          }
          throw lifecycleError;
        }
      } finally {
        await client.end().catch(() => undefined);
      }
    },
    90_000,
  );
});
