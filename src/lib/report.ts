/**
 * Report orchestration: analyze photos + optional bio, then assemble the
 * weighted report. This is the single entry point the /api/analyze route uses.
 */
import { analyzeBio, analyzePhotos } from "./ai/analyzer";
import { assembleReport } from "./scoring";
import type { AnalyzeRequest, ProfileReport } from "./types";

export async function generateReport(req: AnalyzeRequest): Promise<ProfileReport> {
  const hasBio = Boolean(req.bio && req.bio.trim().length > 0);

  const [photos, bio] = await Promise.all([
    analyzePhotos(req.photos),
    hasBio ? analyzeBio(req.bio!.trim()) : Promise.resolve(undefined),
  ]);

  return assembleReport({ photos, bio, hasBio });
}

/** Compact text summary of a report for feeding to the AI coach as context. */
export function summarizeReport(report: ProfileReport): string {
  const lines = [
    `Overall score: ${report.overallScore}/10`,
    `Categories — photos ${report.categories.photos}, bio ${report.categories.bio}, variety ${report.categories.variety}, authenticity ${report.categories.authenticity}, conversation ${report.categories.conversationPotential}.`,
    `Photos: ${report.photos.length}. Best-first order (by id): ${report.recommendedOrder.join(", ")}.`,
    report.redFlags.length ? `Red flags: ${report.redFlags.map((f) => f.label).join(", ")}.` : "No red flags.",
    report.greenFlags.length ? `Green flags: ${report.greenFlags.map((f) => f.label).join(", ")}.` : "",
    `Top recommendations: ${report.recommendations.slice(0, 5).map((r) => r.action).join("; ")}.`,
  ];
  return lines.filter(Boolean).join("\n");
}
