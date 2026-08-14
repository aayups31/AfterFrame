import { createHash, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { Client } from "pg";
import { describe, expect, it } from "vitest";
import { createStartResearchRunService } from "@/application/research/start-research-run";
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
import { afterFrameV1SpecialistRegistry } from "@/specialists/registry";

const integrationEnabled =
  process.env.AFTERFRAME_DB_INTEGRATION === "1";
const describeDatabase = integrationEnabled ? describe : describe.skip;
const projectRoot = fileURLToPath(new URL("../../../../", import.meta.url));
const rollbackSentinel = Symbol("checkpoint-03-rollback");

const checkpoint03RpcNames = [
  "af_get_case_v1",
  "af_get_branch_v1",
  "af_reserve_research_run_start_v1",
  "af_release_research_run_start_reservation_v1",
  "af_commit_research_run_start_v1",
  "af_claim_research_job_v1",
  "af_heartbeat_research_job_v1",
  "af_checkpoint_research_job_v1",
  "af_complete_research_job_v1",
  "af_fail_research_job_v1",
  "af_release_research_job_v1",
] as const;
const allowedRpcNames = new Set<string>(checkpoint03RpcNames);

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

async function waitForRetry(client: Client, retryAt: string) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const result = await client.query<{ ready: boolean }>(
      "select clock_timestamp() >= $1::timestamptz as ready",
      [retryAt],
    );
    if (result.rows[0]?.ready === true) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("The bounded research retry did not become claimable");
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
    "rolls back start, resumable handoff, reclaim, completion, and replay",
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
          const requestFingerprint = fingerprints.fingerprintAttemptRequest(
            started.bundle.run.id,
            job.id,
            claimIdempotencyKey,
          );
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
            automaticRetrySafety: "RESUMABLE_PROVIDER_RUN" as const,
          };
          const claimInput = {
            actorId,
            runId: started.bundle.run.id,
            jobId: job.id,
            stage: "IDENTITY" as const,
            expectedRunVersion: started.bundle.run.aggregateVersion,
            expectedJobVersion: job.aggregateVersion,
            idempotencyKey: claimIdempotencyKey,
            requestFingerprint,
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

          const releaseTime = await databaseTimestamp(client);
          const handoffInput = {
            actorId,
            lease:
              checkpointReplay.status === "REPLAY"
                ? checkpointReplay.lease
                : checkpointed.lease,
            idempotencyKey: "checkpoint-03:release-once",
            failure: {
              schemaVersion: 1 as const,
              code: "provider-timeout",
              category: "TIMEOUT" as const,
              phase: "EXTERNAL_CALL" as const,
              retryDirective: "RETRY_WITH_BACKOFF" as const,
              retryAfterMs: 100,
              providerStatusCode: null,
              diagnosticFingerprint: sha256("checkpoint-03-timeout"),
              redactionState: "BODY_FREE" as const,
            },
            execution: {
              telemetryState: "PARTIAL" as const,
              providerRunId,
              usage: null,
              cost: null,
              latencyMs: 100,
              completedAt: releaseTime,
            },
          };
          const released = await workerStore.releaseResearchJob(handoffInput);
          expect(released.status).toBe("RELEASED");
          if (released.status !== "RELEASED") {
            throw new Error("Resumable attempt was not released");
          }
          const releaseReplay = await workerStore.releaseResearchJob(
            handoffInput,
          );
          expect(releaseReplay).toMatchObject({
            status: "REPLAY",
            attemptId,
            retryAt: released.retryAt,
          });

          await waitForRetry(client, released.retryAt);
          const reclaimed = await workerStore.claimResearchJob({
            ...claimInput,
            workerId: "checkpoint-03-integration-worker-b",
          });
          expect(reclaimed.status).toBe("CLAIMED");
          if (reclaimed.status !== "CLAIMED") {
            throw new Error("Released attempt was not reclaimed");
          }
          expect(reclaimed.claim.attempt.id).toBe(attemptId);
          expect(reclaimed.claim.lease.leaseEpoch).toBe(
            claimed.claim.lease.leaseEpoch + 1,
          );
          expect(reclaimed.claim.resumed).toBe(true);
          expect(reclaimed.claim.replayed).toBe(true);
          expect(reclaimed.claim.latestCheckpoint).toEqual(
            checkpointed.checkpoint,
          );
          expect(reclaimed.claim.providerCheckpoint).toEqual(
            checkpointed.checkpoint,
          );

          const completionTime = await databaseTimestamp(client);
          const result = ResearchStageExecutionResultSchema.parse({
            outcome: "SUCCEEDED",
            boundedReasonCodes: [],
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
              resolvedRequirementIds: ["tmdb-film"],
              unresolvedRequirementIds: ["film-version"],
            },
            sourceCandidates: [],
            untrustedContent: [],
          });
          const completeInput = {
            actorId,
            lease: reclaimed.claim.lease,
            idempotencyKey: "checkpoint-03:complete-once",
            result,
            outputFingerprint:
              fingerprints.fingerprintExecutionOutput(result.output),
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
            outcome: "SUCCEEDED",
            terminal: { attemptId, jobStatus: "SUCCEEDED" },
          });
          const completionReplay = await workerStore.completeResearchJob(
            completeInput,
          );
          expect(completionReplay).toMatchObject({
            status: "REPLAY",
            outcome: "SUCCEEDED",
            terminal: { attemptId, jobStatus: "SUCCEEDED" },
          });
          const terminalClaim = await workerStore.claimResearchJob({
            ...claimInput,
            workerId: "checkpoint-03-integration-worker-c",
          });
          expect(terminalClaim).toMatchObject({
            status: "TERMINAL",
            replayed: true,
            terminal: { attemptId, jobStatus: "SUCCEEDED" },
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
            handoffs: "1",
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
});
