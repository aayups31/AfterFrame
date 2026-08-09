import { NextResponse } from "next/server";

/**
 * The production application service exists, but HTTP composition requires
 * authenticated actor context and a durable Postgres adapter. Returning a fake
 * branch here would misrepresent the agent as working.
 */
export async function POST() {
  return NextResponse.json(
    {
      error: "DIRECTION_ADAPTER_NOT_COMPOSED",
      message:
        "Direction routing is available only through the deterministic application slice until auth and durable persistence are wired.",
    },
    { status: 501 },
  );
}
