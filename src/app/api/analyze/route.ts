/**
 * POST /api/analyze
 * Body: { photos: AnalyzePhotoInput[], bio?: string }
 *
 * Analyzes up to 9 photos + an optional bio and returns a full ProfileReport.
 * Photos are processed in memory and discarded when the request completes —
 * nothing is written to disk.
 */
import { NextResponse } from "next/server";
import { analyzeRequestSchema } from "@/lib/schemas";
import { generateReport } from "@/lib/report";
import { clientKey, rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(request: Request) {
  const rl = rateLimit(clientKey(request.headers, "analyze"), 20, 60_000);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Rate limit exceeded. Please wait a moment and try again." },
      { status: 429, headers: { "Retry-After": String(Math.ceil((rl.resetAt - Date.now()) / 1000)) } },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const parsed = analyzeRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request.", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  try {
    const report = await generateReport(parsed.data);
    return NextResponse.json({ report });
  } catch (err) {
    console.error("[api/analyze] failed:", err);
    return NextResponse.json({ error: "Analysis failed. Please try again." }, { status: 500 });
  }
}
