/**
 * Typed fetch wrappers for the browser. All requests are JSON except the
 * coach stream, which returns text chunks.
 */
import type { BioAnalysis, BioTone, CoachMessage, ProfileReport } from "./types";
import type { PreparedImage } from "./image";

export async function requestReport(
  photos: PreparedImage[],
  bio?: string,
): Promise<ProfileReport> {
  const res = await fetch("/api/analyze", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      photos: photos.map((p) => ({ id: p.id, data: p.data, mediaType: p.mediaType })),
      bio: bio?.trim() || undefined,
    }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? "Analysis failed.");
  }
  const { report } = (await res.json()) as { report: ProfileReport };
  return report;
}

export async function generateBiosRequest(
  tone: BioTone,
  about?: string,
  interests?: string[],
): Promise<string[]> {
  const res = await fetch("/api/bio", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ mode: "generate", tone, about, interests }),
  });
  if (!res.ok) throw new Error("Bio generation failed.");
  const { bios } = (await res.json()) as { bios: string[] };
  return bios;
}

export async function analyzeBioRequest(bio: string): Promise<BioAnalysis> {
  const res = await fetch("/api/bio", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ mode: "analyze", bio }),
  });
  if (!res.ok) throw new Error("Bio analysis failed.");
  const { analysis } = (await res.json()) as { analysis: BioAnalysis };
  return analysis;
}

/** Stream a coach reply, invoking `onChunk` as text arrives. */
export async function streamCoach(
  messages: CoachMessage[],
  reportSummary: string | undefined,
  onChunk: (text: string) => void,
): Promise<void> {
  const res = await fetch("/api/coach", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ messages, reportSummary }),
  });
  if (!res.ok || !res.body) throw new Error("Coach request failed.");
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    onChunk(decoder.decode(value, { stream: true }));
  }
}
