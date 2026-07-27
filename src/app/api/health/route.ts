import { NextResponse } from "next/server";
import { isAiEnabled } from "@/lib/ai/config";

/** Liveness + capability probe. Used by Docker healthcheck and monitoring. */
export function GET() {
  return NextResponse.json({
    status: "ok",
    aiEnabled: isAiEnabled(),
    mode: isAiEnabled() ? "live" : "demo",
    time: new Date().toISOString(),
  });
}
