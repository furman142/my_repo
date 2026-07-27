/**
 * POST /api/coach
 * Body: { messages: CoachMessage[], reportSummary?: string }
 * Returns a streamed text/plain response.
 */
import { coachSchema } from "@/lib/schemas";
import { coachStream } from "@/lib/ai/coach";
import { clientKey, rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const rl = rateLimit(clientKey(request.headers, "coach"), 40, 60_000);
  if (!rl.allowed) {
    return new Response(JSON.stringify({ error: "Rate limit exceeded." }), {
      status: 429,
      headers: { "content-type": "application/json" },
    });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body." }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }

  const parsed = coachSchema.safeParse(body);
  if (!parsed.success) {
    return new Response(JSON.stringify({ error: "Invalid request." }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }

  const stream = await coachStream(parsed.data.messages, parsed.data.reportSummary);
  return new Response(stream, {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-cache, no-transform",
    },
  });
}
