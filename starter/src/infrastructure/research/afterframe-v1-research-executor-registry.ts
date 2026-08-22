import { createHash, randomUUID } from "node:crypto";
import { createIdentityResearchStageExecutor } from "@/application/research-worker/executors/identity-research-stage-executor";
import type {
  DurableResearchStageExecutor,
  DurableResearchStageExecutorRegistry,
} from "@/core/research-runs/ports";
import { ResearchWorkerExecutionPlanSchema } from "@/core/research-runs/worker-schemas";
import type { SupabaseRpcInvoker } from "@/infrastructure/persistence/supabase-investigation-store";
import { SupabaseResearchIdentityReader } from "@/infrastructure/persistence/supabase-research-identity-reader";
import { TmdbSubjectIdentityResolver } from "@/specialists/movie/infrastructure/tmdb-subject-identity-resolver";

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

export class AfterFrameV1ResearchExecutorRegistry
  implements DurableResearchStageExecutorRegistry
{
  readonly #identityExecutor: DurableResearchStageExecutor;

  constructor(identityExecutor: DurableResearchStageExecutor) {
    this.#identityExecutor = identityExecutor;
  }

  resolve(stage: Parameters<DurableResearchStageExecutorRegistry["resolve"]>[0]) {
    return stage === "IDENTITY" ? this.#identityExecutor : null;
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
 * V1 production composition deliberately registers only Movie IDENTITY.
 * Discovery and every factual downstream stage remain disabled here.
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
  return new AfterFrameV1ResearchExecutorRegistry(identityExecutor);
}
