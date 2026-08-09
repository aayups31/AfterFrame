import { describe, expect, it, vi } from "vitest";
import { AuthRetryableFetchError } from "@supabase/supabase-js";
import { SupabaseAuthenticatedActorResolver } from "@/infrastructure/auth/supabase-authenticated-actor";

const ACTOR_ID = "aa35eab5-7d31-4a60-a87a-9df47bb61709";

function request(authorization?: string) {
  return new Request("https://afterframe.test/api/cases", {
    headers:
      authorization === undefined ? undefined : { authorization },
  });
}

describe("Supabase authenticated actor boundary", () => {
  it("returns only the verified stable actor id", async () => {
    const getUser = vi.fn(async (jwt: string) => {
      expect(jwt).toBe("valid-user-jwt");
      return {
        data: {
          user: {
            id: ACTOR_ID,
            email: "private@example.test",
            user_metadata: { private_project: "never-forward" },
          },
        },
        error: null,
      };
    });
    const resolver = new SupabaseAuthenticatedActorResolver({
      authClient: { auth: { getUser } } as never,
    });

    const result = await resolver.resolve(
      request("Bearer valid-user-jwt"),
    );

    expect(result).toEqual({
      authenticated: true,
      actor: { id: ACTOR_ID, provider: "SUPABASE_AUTH" },
    });
    expect(JSON.stringify(result)).not.toContain("private@example.test");
    expect(JSON.stringify(result)).not.toContain("valid-user-jwt");
  });

  it.each([
    undefined,
    "",
    "Basic abc",
    "Bearer",
    "Bearer two tokens",
  ])("rejects a missing or malformed bearer header", async (header) => {
    const getUser = vi.fn();
    const resolver = new SupabaseAuthenticatedActorResolver({
      authClient: { auth: { getUser } } as never,
    });

    const result = await resolver.resolve(request(header));

    expect(result).toEqual({
      authenticated: false,
      reason: "MISSING_BEARER_TOKEN",
    });
    expect(getUser).not.toHaveBeenCalled();
  });

  it("maps rejected JWTs without exposing provider errors", async () => {
    const resolver = new SupabaseAuthenticatedActorResolver({
      authClient: {
        auth: {
          getUser: vi.fn(async () => ({
            data: { user: null },
            error: { message: "secret provider diagnostic" },
          })),
        },
      } as never,
    });

    const result = await resolver.resolve(request("Bearer rejected-jwt"));

    expect(result).toEqual({
      authenticated: false,
      reason: "INVALID_BEARER_TOKEN",
    });
    expect(JSON.stringify(result)).not.toContain("secret provider diagnostic");
    expect(JSON.stringify(result)).not.toContain("rejected-jwt");
  });

  it("distinguishes an auth outage from an invalid identity", async () => {
    const resolver = new SupabaseAuthenticatedActorResolver({
      authClient: {
        auth: {
          getUser: vi.fn(async () => {
            throw new Error("provider unavailable");
          }),
        },
      } as never,
    });

    await expect(
      resolver.resolve(request("Bearer structurally-valid-jwt")),
    ).resolves.toEqual({
      authenticated: false,
      reason: "AUTH_PROVIDER_UNAVAILABLE",
    });
  });

  it("distinguishes a returned retryable provider error from a rejected JWT", async () => {
    const resolver = new SupabaseAuthenticatedActorResolver({
      authClient: {
        auth: {
          getUser: vi.fn(async () => ({
            data: { user: null },
            error: new AuthRetryableFetchError(
              "private upstream diagnostic",
              503,
            ),
          })),
        },
      } as never,
    });

    const result = await resolver.resolve(
      request("Bearer structurally-valid-jwt"),
    );

    expect(result).toEqual({
      authenticated: false,
      reason: "AUTH_PROVIDER_UNAVAILABLE",
    });
    expect(JSON.stringify(result)).not.toContain("private upstream diagnostic");
  });
});
