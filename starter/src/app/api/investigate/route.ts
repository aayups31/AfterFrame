import OpenAI from "openai";
import { NextResponse } from "next/server";
import { z } from "zod";
import { mockCase } from "@/lib/mock-case";

const RequestSchema = z.object({
  film: z.object({
    title: z.string().min(1),
    year: z.number().int().optional(),
  }),
  curiosity: z.string().min(3).max(2000),
});

export async function POST(request: Request) {
  const parsed = RequestSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const mockMode = process.env.AFTERFRAME_MOCK_MODE !== "false";
  if (mockMode || !process.env.OPENAI_API_KEY) {
    return NextResponse.json({
      mode: "mock",
      investigation: {
        ...mockCase,
        film: parsed.data.film.title,
        curiosity: parsed.data.curiosity,
      },
    });
  }

  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const response = await client.responses.create({
    model: process.env.OPENAI_MODEL ?? "gpt-5.6",
    tools: [{ type: "web_search" }],
    input: [
      {
        role: "system",
        content:
          "Interpret the user's film curiosity and produce a concise provisional investigation intent. Do not write an article. Identify the case objective, three research directions, and the first unresolved question. Clearly separate facts from provisional directions.",
      },
      {
        role: "user",
        content: `Film: ${parsed.data.film.title}\nCuriosity: ${parsed.data.curiosity}`,
      },
    ],
  });

  return NextResponse.json({
    mode: "live-provisional",
    outputText: response.output_text,
    warning:
      "This starter route demonstrates tool-enabled intent research only. Add strict schemas, resolver validation, persistence, and evidence verification before rendering factual beats.",
  });
}
