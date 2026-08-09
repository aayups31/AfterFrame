import {
  createClient,
  isAuthRetryableFetchError,
  type SupabaseClient,
} from "@supabase/supabase-js";
import { z } from "zod";
import { EntityIdSchema } from "@/core/shared/schemas";

export const AuthenticatedActorSchema = z
  .object({
    id: EntityIdSchema,
    provider: z.literal("SUPABASE_AUTH"),
  })
  .strict();

export type AuthenticatedActor = z.infer<typeof AuthenticatedActorSchema>;

export type AuthenticatedActorResult =
  | Readonly<{ authenticated: true; actor: AuthenticatedActor }>
  | Readonly<{
      authenticated: false;
      reason:
        | "MISSING_BEARER_TOKEN"
        | "INVALID_BEARER_TOKEN"
        | "AUTH_PROVIDER_UNAVAILABLE";
    }>;

type AuthClient = Pick<SupabaseClient, "auth">;

export type SupabaseAuthenticatedActorResolverOptions = Readonly<{
  supabaseUrl?: string;
  anonKey?: string;
  authClient?: AuthClient;
}>;

function bearerToken(authorizationHeader: string | null): string | null {
  if (authorizationHeader === null) return null;
  const match = /^Bearer ([^\s]+)$/.exec(authorizationHeader);
  return match?.[1] ?? null;
}

function isAuthProviderOutage(error: unknown) {
  if (isAuthRetryableFetchError(error)) return true;
  if (typeof error !== "object" || error === null || !("status" in error)) {
    return false;
  }
  const status = error.status;
  return (
    typeof status === "number" &&
    (status === 429 || (status >= 500 && status <= 599))
  );
}

/**
 * Verifies the caller with Supabase Auth before any service-role persistence
 * call. The access token and provider error body are never returned or logged.
 */
export class SupabaseAuthenticatedActorResolver {
  readonly #authClient: AuthClient;

  constructor(options: SupabaseAuthenticatedActorResolverOptions) {
    if (options.authClient !== undefined) {
      this.#authClient = options.authClient;
      return;
    }

    const supabaseUrl = options.supabaseUrl?.trim();
    const anonKey = options.anonKey?.trim();
    if (!supabaseUrl || !anonKey) {
      throw new Error("Supabase URL and anonymous key are required");
    }

    this.#authClient = createClient(supabaseUrl, anonKey, {
      auth: {
        autoRefreshToken: false,
        detectSessionInUrl: false,
        persistSession: false,
      },
    });
  }

  async resolve(request: Request): Promise<AuthenticatedActorResult> {
    const token = bearerToken(request.headers.get("authorization"));
    if (token === null) {
      return { authenticated: false, reason: "MISSING_BEARER_TOKEN" };
    }

    try {
      const { data, error } = await this.#authClient.auth.getUser(token);
      if (error !== null) {
        return {
          authenticated: false,
          reason: isAuthProviderOutage(error)
            ? "AUTH_PROVIDER_UNAVAILABLE"
            : "INVALID_BEARER_TOKEN",
        };
      }
      if (data.user === null) {
        return { authenticated: false, reason: "INVALID_BEARER_TOKEN" };
      }

      const actor = AuthenticatedActorSchema.safeParse({
        id: data.user.id,
        provider: "SUPABASE_AUTH",
      });
      if (!actor.success) {
        return { authenticated: false, reason: "INVALID_BEARER_TOKEN" };
      }

      return { authenticated: true, actor: actor.data };
    } catch {
      return { authenticated: false, reason: "AUTH_PROVIDER_UNAVAILABLE" };
    }
  }
}

export function createSupabaseServiceRoleClient(input: {
  supabaseUrl: string;
  serviceRoleKey: string;
}): SupabaseClient {
  if (input.supabaseUrl.trim().length === 0) {
    throw new Error("Supabase URL is required");
  }
  if (input.serviceRoleKey.trim().length === 0) {
    throw new Error("Supabase service-role key is required");
  }

  // This client must remain isolated from user sessions. Actor authorization is
  // checked separately and every RPC receives the verified actor ID explicitly.
  return createClient(input.supabaseUrl, input.serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  });
}
