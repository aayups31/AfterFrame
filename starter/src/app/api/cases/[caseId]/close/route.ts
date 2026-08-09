import { NextResponse } from "next/server";

/** Closure is intentionally deferred until the versioned audit path exists. */
export async function POST() {
  return NextResponse.json(
    {
      error: "CLOSURE_NOT_IMPLEMENTED",
      message:
        "Closure cannot run before branches, contradictions, locators, notes, and provenance can be audited durably.",
    },
    { status: 501 },
  );
}
