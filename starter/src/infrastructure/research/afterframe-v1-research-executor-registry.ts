import { createHash, randomUUID } from "node:crypto";
import { createIdentityResearchStageExecutor } from "@/application/research-worker/executors/identity-research-stage-executor";
import { createScopingResearchStageExecutor } from "@/application/research-worker/executors/scoping-research-stage-executor";
import { DiscoveryResearchStageExecutor } from "@/application/research-worker/executors/discovery-research-stage-executor";
import { SourceResolutionStageExecutor } from "@/application/research-worker/executors/source-resolution-stage-executor";
import type { DurableResearchDiscoveryProvider } from "@/application/research/durable-discovery-port";
import type { SourceCandidateResolver } from "@/application/research/source-resolution-port";
import type {
  DurableResearchStageExecutor,
  DurableResearchStageExecutorRegistry,
} from "@/core/research-runs/ports";
import { ResearchWorkerExecutionPlanSchema } from "@/core/research-runs/worker-schemas";
import type { SupabaseRpcInvoker } from "@/infrastructure/persistence/supabase-investigation-store";
import { SupabaseResearchIdentityReader } from "@/infrastructure/persistence/supabase-research-identity-reader";
import { SupabaseResearchDiscoveryContextReader } from "@/infrastructure/persistence/supabase-research-discovery-context-reader";
import { SupabaseResearchProviderRunReader } from "@/infrastructure/persistence/supabase-research-provider-run-reader";
import { SupabaseSourceResolutionPersistence } from "@/infrastructure/persistence/supabase-source-resolution-persistence";
import { TmdbSubjectIdentityResolver } from "@/specialists/movie/infrastructure/tmdb-subject-identity-resolver";
import {
  createOpenAIBackgroundResearchDiscoveryProvider,
  openAIBackgroundDiscoveryExecutionIdentity,
  type OpenAIBackgroundDiscoveryOptions,
} from "@/infrastructure/research/openai-background-discovery";
import { Sha256ResearchRunFingerprintAdapter } from "@/infrastructure/research/research-run-fingerprints";
import {
  createNodePublicSourceMetadataResolver,
  type NodePublicSourceMetadataProbeOptions,
} from "@/infrastructure/research/node-public-source-metadata-probe";

const DEFAULT_TMDB_TIMEOUT_MS = 10_000;

function sha256(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function afterFrameV1IdentityExecutionPlan(
  resolverTimeoutMs = DEFAULT_TMDB_TIMEOUT_MS,
) {
  return ResearchWorkerExecutionPlanSchema.parse({
    executorId: "identity-stage-executor",
    executorVersion: "1.0.0",
    configurationFingerprint: sha256(
      JSON.stringify({
        stage: "IDENTITY",
        specialist: "movie-investigator@0.1.0",
        resolver: "tmdb-movie-details@v3",
        resolverTimeoutMs,
      }),
    ),
    executionKind: "RESOLVER",
    model: null,
    prompt: null,
    schema: {
      id: "identity-stage-result",
      version: "1.0.0",
      schemaFingerprint: sha256(
        "afterframe:identity-stage-result:resolved-subject-identity:v1",
      ),
    },
    tool: { id: "tmdb-movie-details", version: "v3" },
    privateContentIncluded: false,
    automaticRetrySafety: "IDEMPOTENT_PROVIDER_REQUEST",
  });
}

export function afterFrameV1ScopingExecutionPlan() {
  return ResearchWorkerExecutionPlanSchema.parse({
    executorId: "scoping-stage-executor",
    executorVersion: "1.0.0",
    configurationFingerprint: sha256(
      "afterframe:scoping-stage-executor:movie-investigator@0.1.0:v1",
    ),
    executionKind: "DETERMINISTIC",
    model: null,
    prompt: null,
    schema: {
      id: "scoping-stage-result",
      version: "1.0.0",
      schemaFingerprint: sha256(
        "afterframe:scoping-stage-result:axes-source-classes-coverage-gaps:v1",
      ),
    },
    tool: null,
    privateContentIncluded: false,
    automaticRetrySafety: "IDEMPOTENT_PROVIDER_REQUEST",
  });
}

export function afterFrameV1SourceResolutionExecutionPlan() {
  return ResearchWorkerExecutionPlanSchema.parse({
    executorId: "source-resolution-stage-executor",
    executorVersion: "1.0.0",
    configurationFingerprint: sha256(
      "afterframe:source-resolution:http-source-metadata@1.0.0:v1",
    ),
    executionKind: "RESOLVER",
    model: null,
    prompt: null,
    schema: {
      id: "source-resolution-stage-result",
      version: "1.0.0",
      schemaFingerprint: sha256(
        "afterframe:source-resolution:body-free-acceptance:v1",
      ),
    },
    tool: { id: "http-source-metadata", version: "1.0.0" },
    privateContentIncluded: false,
    automaticRetrySafety: "IDEMPOTENT_PROVIDER_REQUEST",
  });
}

/**
 * Claim-time identity for the resumable DISCOVERY executor. The provider
 * snapshot is explicit so an alias cannot silently become audit provenance.
 * Production registration remains gated on controlled live evaluation.
 */
export function afterFrameV1DiscoveryExecutionPlan(
  requestedModel: string,
  expectedProviderSnapshot: string,
) {
  const identity = openAIBackgroundDiscoveryExecutionIdentity(
    requestedModel,
    expectedProviderSnapshot,
  );
  return ResearchWorkerExecutionPlanSchema.parse({
    executorId: "discovery-stage-executor",
    executorVersion: "1.0.0",
    configurationFingerprint: sha256(
      JSON.stringify({
        stage: "DISCOVERY",
        specialist: "movie-investigator@0.1.0",
        requestedModel,
        expectedProviderSnapshot,
        prompt: identity.prompt,
        schema: identity.schema,
        tool: identity.tool,
      }),
    ),
    executionKind: "MODEL_TOOL",
    ...identity,
    privateContentIncluded: true,
    automaticRetrySafety: "RESUMABLE_PROVIDER_RUN",
  });
}

export class AfterFrameV1ResearchExecutorRegistry
  implements DurableResearchStageExecutorRegistry
{
  readonly #identityExecutor: DurableResearchStageExecutor;
  readonly #scopingExecutor: DurableResearchStageExecutor;
  readonly #discoveryExecutor: DurableResearchStageExecutor | null;
  readonly #resolutionExecutor: DurableResearchStageExecutor | null;

  constructor(
    identityExecutor: DurableResearchStageExecutor,
    scopingExecutor: DurableResearchStageExecutor,
    discoveryExecutor: DurableResearchStageExecutor | null = null,
    resolutionExecutor: DurableResearchStageExecutor | null = null,
  ) {
    this.#identityExecutor = identityExecutor;
    this.#scopingExecutor = scopingExecutor;
    this.#discoveryExecutor = discoveryExecutor;
    this.#resolutionExecutor = resolutionExecutor;
  }

  resolve(stage: Parameters<DurableResearchStageExecutorRegistry["resolve"]>[0]) {
    if (stage === "IDENTITY") return this.#identityExecutor;
    if (stage === "SCOPING") return this.#scopingExecutor;
    if (stage === "DISCOVERY") return this.#discoveryExecutor;
    if (stage === "RESOLUTION") return this.#resolutionExecutor;
    return null;
  }
}

export type AfterFrameV1ResearchExecutorRegistryOptions = Readonly<{
  actorId: string;
  invokeRpc: SupabaseRpcInvoker;
  tmdbApiKey: string;
  fetchImpl?: typeof fetch;
  resolverTimeoutMs?: number;
  now?: () => Date;
  createId?: () => string;
  discovery?: Readonly<{
    provider: DurableResearchDiscoveryProvider;
    requestedModel: string;
    expectedProviderSnapshot: string;
    pollIntervalMs?: number;
    maxPollsPerExecution?: number;
    delay?: (milliseconds: number, signal: AbortSignal) => Promise<void>;
  }>;
  resolution?:
    | Readonly<{
        resolver: SourceCandidateResolver;
        publicMetadataProbe?: never;
        maxCandidatesPerExecution?: number;
      }>
    | Readonly<{
        resolver?: never;
        publicMetadataProbe: NodePublicSourceMetadataProbeOptions;
        maxCandidatesPerExecution?: number;
      }>;
}>;

/**
 * V1 production composition registers resolver-backed IDENTITY and the
 * deterministic SCOPING projection. Discovery and every factual downstream
 * stage remain disabled here.
 */
export function createAfterFrameV1ResearchExecutorRegistry(
  options: AfterFrameV1ResearchExecutorRegistryOptions,
) {
  const resolverTimeoutMs =
    options.resolverTimeoutMs ?? DEFAULT_TMDB_TIMEOUT_MS;
  const now = options.now ?? (() => new Date());
  const createId = options.createId ?? randomUUID;
  const context = new SupabaseResearchIdentityReader({
    actorId: options.actorId,
    invokeRpc: options.invokeRpc,
  });
  const resolver = new TmdbSubjectIdentityResolver({
    apiKey: options.tmdbApiKey,
    ...(options.fetchImpl === undefined
      ? {}
      : { fetchImpl: options.fetchImpl }),
    timeoutMs: resolverTimeoutMs,
    now,
    createTraceId: createId,
  });
  const identityExecutor = createIdentityResearchStageExecutor({
    context,
    resolver,
    execution: afterFrameV1IdentityExecutionPlan(resolverTimeoutMs),
    createId: () => createId(),
    now: () => now().toISOString(),
  });
  const scopingExecutor = createScopingResearchStageExecutor({
    execution: afterFrameV1ScopingExecutionPlan(),
  });
  const discoveryExecutor =
    options.discovery === undefined
      ? null
      : new DiscoveryResearchStageExecutor({
          context: new SupabaseResearchDiscoveryContextReader({
            actorId: options.actorId,
            invokeRpc: options.invokeRpc,
          }),
          providerRuns: new SupabaseResearchProviderRunReader({
            actorId: options.actorId,
            invokeRpc: options.invokeRpc,
          }),
          provider: options.discovery.provider,
          fingerprints: new Sha256ResearchRunFingerprintAdapter(),
          execution: afterFrameV1DiscoveryExecutionPlan(
            options.discovery.requestedModel,
            options.discovery.expectedProviderSnapshot,
          ),
          now: () => now().toISOString(),
          ...(options.discovery.pollIntervalMs === undefined
            ? {}
            : { pollIntervalMs: options.discovery.pollIntervalMs }),
          ...(options.discovery.maxPollsPerExecution === undefined
            ? {}
            : { maxPollsPerExecution: options.discovery.maxPollsPerExecution }),
          ...(options.discovery.delay === undefined
            ? {}
            : { delay: options.discovery.delay }),
        });
  const resolutionPersistence =
    options.resolution === undefined
      ? null
      : new SupabaseSourceResolutionPersistence({
          actorId: options.actorId,
          invokeRpc: options.invokeRpc,
        });
  const sourceResolver =
    options.resolution === undefined
      ? null
      : options.resolution.resolver ??
        createNodePublicSourceMetadataResolver(
          options.resolution.publicMetadataProbe,
        );
  const resolutionExecutor =
    options.resolution === undefined ||
    resolutionPersistence === null ||
    sourceResolver === null
      ? null
      : new SourceResolutionStageExecutor({
          context: resolutionPersistence,
          records: resolutionPersistence,
          resolver: sourceResolver,
          fingerprints: new Sha256ResearchRunFingerprintAdapter(),
          execution: afterFrameV1SourceResolutionExecutionPlan(),
          now: () => now().toISOString(),
          ...(options.resolution.maxCandidatesPerExecution === undefined
            ? {}
            : {
                maxCandidatesPerExecution:
                  options.resolution.maxCandidatesPerExecution,
              }),
        });
  return new AfterFrameV1ResearchExecutorRegistry(
    identityExecutor,
    scopingExecutor,
    discoveryExecutor,
    resolutionExecutor,
  );
}

export type AfterFrameV1ShadowResearchExecutorRegistryOptions = Omit<
  AfterFrameV1ResearchExecutorRegistryOptions,
  "discovery"
> &
  Readonly<{
    openAiApiKey: string;
    requestedModel: string;
    expectedProviderSnapshot: string;
    dataControlAttestation: OpenAIBackgroundDiscoveryOptions["dataControlAttestation"];
    reasoningEffort?: "medium" | "high" | "xhigh";
    pollIntervalMs?: number;
    maxPollsPerExecution?: number;
  }>;

/**
 * The only production-oriented V1 composition that registers DISCOVERY. Its
 * provider constructor validates the explicit MAM attestation before any
 * executor can be resolved or any paid request can be attempted.
 */
export function createAfterFrameV1ShadowResearchExecutorRegistry(
  options: AfterFrameV1ShadowResearchExecutorRegistryOptions,
) {
  const provider = createOpenAIBackgroundResearchDiscoveryProvider({
    apiKey: options.openAiApiKey,
    model: options.requestedModel,
    dataControlAttestation: options.dataControlAttestation,
    ...(options.reasoningEffort === undefined
      ? {}
      : { reasoningEffort: options.reasoningEffort }),
  });
  return createAfterFrameV1ResearchExecutorRegistry({
    actorId: options.actorId,
    invokeRpc: options.invokeRpc,
    tmdbApiKey: options.tmdbApiKey,
    ...(options.fetchImpl === undefined ? {} : { fetchImpl: options.fetchImpl }),
    ...(options.resolverTimeoutMs === undefined
      ? {}
      : { resolverTimeoutMs: options.resolverTimeoutMs }),
    ...(options.now === undefined ? {} : { now: options.now }),
    ...(options.createId === undefined ? {} : { createId: options.createId }),
    ...(options.resolution === undefined
      ? {}
      : { resolution: options.resolution }),
    discovery: {
      provider,
      requestedModel: options.requestedModel,
      expectedProviderSnapshot: options.expectedProviderSnapshot,
      ...(options.pollIntervalMs === undefined
        ? {}
        : { pollIntervalMs: options.pollIntervalMs }),
      ...(options.maxPollsPerExecution === undefined
        ? {}
        : { maxPollsPerExecution: options.maxPollsPerExecution }),
    },
  });
}
