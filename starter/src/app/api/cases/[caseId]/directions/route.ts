import { NextResponse } from "next/server";
import { DirectionRequestSchema } from "@/lib/schemas";

function classify(text: string) {
  const value = text.toLowerCase();
  if (value.includes("i think") || value.includes("theory")) return "THEORY" as const;
  if (value.includes("compare")) return "COMPARE" as const;
  if (value.includes("challenge")) return "CHALLENGE" as const;
  if (value.includes("connect")) return "CONNECT" as const;
  return "QUESTION" as const;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ caseId: string }> },
) {
  const { caseId } = await params;
  const parsed = DirectionRequestSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid direction", details: parsed.error.flatten() }, { status: 400 });
  }

  const directionType = classify(parsed.data.text);
  return NextResponse.json({
    mode: "mock",
    directionId: `dir_${Date.now()}`,
    directionType,
    branchAction: "create",
    branchId: `${caseId}_branch_${Date.now()}`,
    acknowledgement: directionType === "THEORY" ? "Whoa—let me get in on that." : "That changes the trail. I’m following it.",
    normalizedObjective: parsed.data.text,
    researchAxes: ["film_text", "production", "independent_context"],
    eventStreamUrl: `/api/cases/${caseId}/events`,
  });
}
