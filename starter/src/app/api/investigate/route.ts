import { NextResponse } from "next/server";
import { z } from "zod";
import { mockCase } from "@/lib/mock-case";

const RequestSchema = z
  .object({
    film: z
      .object({
        title: z.string().trim().min(1).max(300),
        year: z.number().int().min(1880).max(2200).optional(),
      })
      .strict(),
    curiosity: z.string().min(3).max(2000),
  })
  .strict();

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const parsed = RequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  if (process.env.AFTERFRAME_MOCK_MODE === "false") {
    return NextResponse.json(
      {
        error: "LIVE_RESEARCH_NOT_COMPOSED",
        message:
          "Live research stays disabled until retrieval, resolver verification, persistence, provenance, and run telemetry are wired.",
      },
      { status: 503 },
    );
  }

  return NextResponse.json(
    {
      mode: "prototype-mock",
      investigation: {
        ...mockCase,
        film: parsed.data.film.title,
        curiosity: parsed.data.curiosity,
      },
      warning:
        "Prototype content is non-authoritative and must not be presented as researched evidence.",
    },
    {
      headers: {
        "Cache-Control": "no-store",
        "X-AfterFrame-Mode": "prototype-mock",
      },
    },
  );
}
