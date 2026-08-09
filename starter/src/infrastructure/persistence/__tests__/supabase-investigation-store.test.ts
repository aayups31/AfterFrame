import { describe, expect, it, vi } from "vitest";
import {
  BLACK_HAWK_DOWN_CASE,
  BLACK_HAWK_DOWN_DIRECTION_COMMAND,
  BLACK_HAWK_DOWN_ROOT_BRANCH,
  BLACK_HAWK_DOWN_SPINE_IDS,
} from "@/fixtures/black-hawk-down/deterministic-spine.fixture";
import {
  SUBMIT_DIRECTION_COMMAND,
  InvestigationStoreError,
} from "@/core/ports/investigation-store";
import {
  SupabaseInvestigationStore,
  SupabasePersistenceError,
} from "@/infrastructure/persistence/supabase-investigation-store";

const FINGERPRINT = "a".repeat(64);
const RESERVATION = "10000000-0000-4000-8000-000000000099";

function setup(
  responder: (name: string, parameters: Record<string, unknown>) => unknown,
) {
  const invokeRpc = vi.fn(async (name: string, parameters: Record<string, unknown>) => ({
    data: responder(name, parameters),
    error: null,
  }));
  const store = new SupabaseInvestigationStore({
    actorId: BLACK_HAWK_DOWN_SPINE_IDS.owner,
    invokeRpc,
  });
  return { store, invokeRpc };
}

const scope = {
  actorId: BLACK_HAWK_DOWN_SPINE_IDS.owner,
  commandName: SUBMIT_DIRECTION_COMMAND,
  idempotencyKey: BLACK_HAWK_DOWN_DIRECTION_COMMAND.idempotencyKey,
} as const;

describe("Supabase investigation store", () => {
  it("reads owner-scoped cases and branches through versioned RPCs", async () => {
    const { store, invokeRpc } = setup((name) =>
      name === "af_get_case_v1"
        ? BLACK_HAWK_DOWN_CASE
        : BLACK_HAWK_DOWN_ROOT_BRANCH,
    );

    await expect(store.getCase(BLACK_HAWK_DOWN_CASE.id)).resolves.toEqual(
      BLACK_HAWK_DOWN_CASE,
    );
    await expect(
      store.getBranch(BLACK_HAWK_DOWN_ROOT_BRANCH.id),
    ).resolves.toEqual(BLACK_HAWK_DOWN_ROOT_BRANCH);
    expect(invokeRpc).toHaveBeenNthCalledWith(1, "af_get_case_v1", {
      p_actor_id: BLACK_HAWK_DOWN_SPINE_IDS.owner,
      p_case_id: BLACK_HAWK_DOWN_CASE.id,
    });
    expect(invokeRpc).toHaveBeenNthCalledWith(2, "af_get_branch_v1", {
      p_actor_id: BLACK_HAWK_DOWN_SPINE_IDS.owner,
      p_branch_id: BLACK_HAWK_DOWN_ROOT_BRANCH.id,
    });
  });

  it("acquires and releases an expiring reservation before planner work", async () => {
    const { store, invokeRpc } = setup((name) =>
      name === "af_reserve_direction_v1"
        ? { status: "ACQUIRED", reservationToken: RESERVATION }
        : true,
    );

    await expect(
      store.reserveDirection({ scope, requestFingerprint: FINGERPRINT }),
    ).resolves.toEqual({
      status: "ACQUIRED",
      reservationToken: RESERVATION,
    });
    await expect(
      store.releaseDirectionReservation({
        scope,
        requestFingerprint: FINGERPRINT,
        reservationToken: RESERVATION,
      }),
    ).resolves.toBeUndefined();
    expect(invokeRpc).toHaveBeenNthCalledWith(
      1,
      "af_reserve_direction_v1",
      expect.objectContaining({
        p_actor_id: BLACK_HAWK_DOWN_SPINE_IDS.owner,
        p_lease_seconds: 60,
      }),
    );
  });

  it("never lets a caller substitute another actor into a service-role RPC", async () => {
    const { store, invokeRpc } = setup(() => null);

    await expect(
      store.reserveDirection({
        scope: {
          ...scope,
          actorId: "20000000-0000-4000-8000-000000000001",
        },
        requestFingerprint: FINGERPRINT,
      }),
    ).rejects.toMatchObject({ code: "INVALID_ATOMIC_MUTATION" });
    expect(invokeRpc).not.toHaveBeenCalled();
  });

  it("rejects malformed database JSON instead of widening the domain contract", async () => {
    const { store } = setup(() => ({
      ...BLACK_HAWK_DOWN_CASE,
      ownerId: "not-a-uuid",
      injected: "database data is still untrusted",
    }));

    await expect(store.getCase(BLACK_HAWK_DOWN_CASE.id)).rejects.toBeInstanceOf(
      SupabasePersistenceError,
    );
  });

  it("maps stable SQLSTATEs without leaking provider diagnostics", async () => {
    const invokeRpc = vi.fn(async () => ({
      data: null,
      error: {
        code: "AFD02",
        message: "private database diagnostic with exact direction text",
      },
    }));
    const store = new SupabaseInvestigationStore({
      actorId: BLACK_HAWK_DOWN_SPINE_IDS.owner,
      invokeRpc,
    });

    const rejection = store.reserveDirection({
      scope,
      requestFingerprint: FINGERPRINT,
    });
    await expect(rejection).rejects.toBeInstanceOf(InvestigationStoreError);
    await expect(rejection).rejects.toMatchObject({
      code: "IDEMPOTENCY_KEY_REUSED",
    });
    await expect(rejection).rejects.not.toThrow(/private database diagnostic/);
  });
});
