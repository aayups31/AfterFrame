import { createHash, randomUUID } from "node:crypto";
import { createIdentityResearchStageExecutor } from "@/application/research-worker/executors/identity-research-stage-executor";
import { createScopingResearchStageExecutor } from "@/application/research-worker/executors/scoping-research-stage-executor";
import type {
  DurableResearchStageExecutor,
  DurableResearchStageExecutorRegistry,
} from "@/core/research-runs/ports";
import { ResearchWorkerExecutionPlanSchema } from "@/core/research-runs/worker-schemas";
import type { SupabaseRpcInvoker } from "@/infrastructure/persistence/supabase-investigation-store";
import { SupabaseResearchIdentityReader } from "@/infrastructure/persistence/supabase-research-identity-reader";
import { TmdbSubjectIdentityResolver } from "@/specialists/movie/infrastructure/tmdb-subject-identity-resolver";
import { openAIBackgroundDiscoveryExecutionIdentity } from "@/infrastructure/research/openai-background-discovery";

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

  constructor(
    identityExecutor: DurableResearchStageExecutor,
    scopingExecutor: DurableResearchStageExecutor,
  ) {
    this.#identityExecutor = identityExecutor;
    this.#scopingExecutor = scopingExecutor;
  }

  resolve(stage: Parameters<DurableResearchStageExecutorRegistry["resolve"]>[0]) {
    if (stage === "IDENTITY") return this.#identityExecutor;
    if (stage === "SCOPING") return this.#scopingExecutor;
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
  return new AfterFrameV1ResearchExecutorRegistry(
    identityExecutor,
    scopingExecutor,
  );
}
