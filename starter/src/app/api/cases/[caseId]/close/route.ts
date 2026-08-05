import { NextResponse } from "next/server";
import { ClosureRequestSchema } from "@/lib/schemas";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ caseId: string }> },
) {
  const { caseId } = await params;
  const parsed = ClosureRequestSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid closure request", details: parsed.error.flatten() }, { status: 400 });
  }

  return NextResponse.json({
    mode: "mock",
    closureSessionId: `closure_${Date.now()}`,
    caseId,
    requestedMode: parsed.data.mode,
    audit: {
      unresolvedBranches: 3,
      materialContradictions: 2,
      unusedUserNotes: 7,
      approximateLocators: 1,
    },
    status: parsed.data.mode === "case_world" ? "closed" : "artifact_preparing",
  });
}
