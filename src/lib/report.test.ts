import { describe, it, expect } from "vitest";
import { generateReport, summarizeReport } from "./report";
import type { AnalyzeRequest } from "./types";

// With no ANTHROPIC_API_KEY (the CI/test default), generateReport runs the
// deterministic mock analyzer end-to-end — a genuine integration test of the
// analyze pipeline without any network calls.
describe("generateReport (integration, mock analyzer)", () => {
  const req: AnalyzeRequest = {
    photos: [
      { id: "a", data: "AAAABBBBCCCCDDDD", mediaType: "image/jpeg" },
      { id: "b", data: "EEEEFFFFGGGGHHHH", mediaType: "image/jpeg" },
      { id: "c", data: "IIIIJJJJKKKKLLLL", mediaType: "image/jpeg" },
    ],
    bio: "Coffee, mountains, and terrible puns. Ask me about my last hike.",
  };

  it("produces a full report from photos + bio", async () => {
    const report = await generateReport(req);
    expect(report.photos).toHaveLength(3);
    expect(report.overallScore).toBeGreaterThan(0);
    expect(report.overallScore).toBeLessThanOrEqual(10);
    expect(report.bio).toBeDefined();
    expect(report.recommendedOrder).toHaveLength(3);
    expect(report.bestFirstPhotoId).toBeTruthy();
  });

  it("is deterministic in mock mode", async () => {
    const a = await generateReport(req);
    const b = await generateReport(req);
    expect(a.overallScore).toBe(b.overallScore);
    expect(a.recommendedOrder).toEqual(b.recommendedOrder);
  });

  it("redistributes bio weight when no bio is provided", async () => {
    const withBio = await generateReport(req);
    const withoutBio = await generateReport({ photos: req.photos });
    expect(withoutBio.bio).toBeUndefined();
    // Photos-only score shouldn't be dragged to ~0 by a missing bio.
    expect(withoutBio.overallScore).toBeGreaterThan(3);
    expect(withBio.categories.bio).toBeGreaterThan(0);
  });

  it("summarizeReport yields coach-ready context text", async () => {
    const report = await generateReport(req);
    const summary = summarizeReport(report);
    expect(summary).toContain("Overall score");
    expect(summary).toContain("Categories");
  });
});
