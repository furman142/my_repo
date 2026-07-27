/**
 * POST /api/bio
 * Body (generate): { mode: "generate", tone, about?, interests? }
 * Body (analyze):  { mode: "analyze", bio }
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { bioAnalyzeSchema, bioGenerateSchema } from "@/lib/schemas";
import { generateBios } from "@/lib/ai/bio";
import { analyzeBio } from "@/lib/ai/analyzer";
import { clientKey, rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";

const bodySchema = z.discriminatedUnion("mode", [
  bioGenerateSchema.extend({ mode: z.literal("generate") }),
  bioAnalyzeSchema.extend({ mode: z.literal("analyze") }),
]);

export async function POST(request: Request) {
  const rl = rateLimit(clientKey(request.headers, "bio"), 30, 60_000);
  if (!rl.allowed) {
    return NextResponse.json({ error: "Rate limit exceeded." }, { status: 429 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request.", details: parsed.error.flatten() }, { status: 400 });
  }

  try {
    if (parsed.data.mode === "generate") {
      const bios = await generateBios(parsed.data.tone, parsed.data.about, parsed.data.interests);
      return NextResponse.json({ bios });
    }
    const analysis = await analyzeBio(parsed.data.bio);
    return NextResponse.json({ analysis });
  } catch (err) {
    console.error("[api/bio] failed:", err);
    return NextResponse.json({ error: "Request failed. Please try again." }, { status: 500 });
  }
}
