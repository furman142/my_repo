import { describe, it, expect } from "vitest";
import {
  assembleReport,
  computeAuthenticity,
  computeOverallScore,
  computeVariety,
  detectGreenFlags,
  detectRedFlags,
  estimateMemorability,
  pickBestFirstPhoto,
  recommendOrder,
  photosToRemove,
  computeCategoryScores,
} from "./scoring";
import { makeAttributes, makeBio, makePhoto } from "@/test/factories";
import type { PhotoTag } from "./types";

describe("computeVariety", () => {
  it("is 0 for no photos", () => {
    expect(computeVariety([])).toBe(0);
  });

  it("rewards distinct positive contexts", () => {
    const photos = [
      makePhoto({ tags: ["travel"] }),
      makePhoto({ tags: ["pet"] }),
      makePhoto({ tags: ["outdoor"] }),
      makePhoto({ tags: ["group"] }),
    ];
    expect(computeVariety(photos)).toBeGreaterThan(7);
  });

  it("penalizes mirror-selfie-heavy sets", () => {
    const varied = [
      makePhoto({ tags: ["travel"] }),
      makePhoto({ tags: ["pet"] }),
      makePhoto({ tags: ["outdoor"] }),
    ];
    const selfies = [
      makePhoto({ tags: ["mirror_selfie"] }),
      makePhoto({ tags: ["mirror_selfie"] }),
      makePhoto({ tags: ["mirror_selfie"] }),
    ];
    expect(computeVariety(selfies)).toBeLessThan(computeVariety(varied));
  });
});

describe("computeAuthenticity", () => {
  it("drops when photos are over-edited", () => {
    const authentic = [makePhoto({ authentic: true, overEdited: false })];
    const edited = [makePhoto({ authentic: false, overEdited: true })];
    expect(computeAuthenticity(edited)).toBeLessThan(computeAuthenticity(authentic));
  });
});

describe("computeOverallScore", () => {
  const categories = computeCategoryScores(
    [makePhoto({ score: 8, attributes: makeAttributes(8) })],
    makeBio(8),
  );

  it("weights categories to sum to 1 with a bio", () => {
    const score = computeOverallScore(categories, true);
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThanOrEqual(10);
  });

  it("redistributes the bio weight when there's no bio", () => {
    const noBioCats = computeCategoryScores([makePhoto({ score: 8, attributes: makeAttributes(8) })]);
    const withRedistribution = computeOverallScore(noBioCats, false);
    // Without redistribution the 20% bio weight (score 0) would drag the total down.
    expect(withRedistribution).toBeGreaterThan(noBioCats.photos - 3);
  });
});

describe("recommendOrder / pickBestFirstPhoto", () => {
  it("puts the highest-scoring photo first, preferring strong openers", () => {
    const photos = [
      makePhoto({ id: "a", score: 6 }),
      makePhoto({ id: "b", score: 9, strongFirstPhoto: true }),
      makePhoto({ id: "c", score: 8 }),
    ];
    expect(recommendOrder(photos)[0]).toBe("b");
    expect(pickBestFirstPhoto(photos)).toBe("b");
  });
});

describe("photosToRemove", () => {
  it("flags photos scoring below 5", () => {
    const photos = [makePhoto({ id: "bad", score: 3 }), makePhoto({ id: "good", score: 8 })];
    const removals = photosToRemove(photos);
    expect(removals.map((r) => r.photoId)).toContain("bad");
    expect(removals.map((r) => r.photoId)).not.toContain("good");
  });
});

describe("flag detection", () => {
  it("detects too many mirror selfies", () => {
    const photos = Array.from({ length: 5 }, (_, i) =>
      makePhoto({ id: String(i), tags: ["mirror_selfie"] as PhotoTag[] }),
    );
    const red = detectRedFlags(photos);
    expect(red.some((f) => f.label.includes("mirror"))).toBe(true);
  });

  it("detects no genuine smile", () => {
    const photos = [makePhoto({ attributes: makeAttributes(3) })];
    expect(detectRedFlags(photos).some((f) => f.label.includes("smile"))).toBe(true);
  });

  it("awards a green flag for travel photos", () => {
    const green = detectGreenFlags([makePhoto({ tags: ["travel"] })]);
    expect(green.some((f) => f.label === "Travel")).toBe(true);
  });
});

describe("estimateMemorability", () => {
  it("returns a 0–100 value", () => {
    const photos = [makePhoto({ tags: ["travel"] }), makePhoto({ tags: ["pet"] })];
    const cats = computeCategoryScores(photos);
    const m = estimateMemorability(photos, cats);
    expect(m).toBeGreaterThanOrEqual(0);
    expect(m).toBeLessThanOrEqual(100);
  });
});

describe("assembleReport", () => {
  it("produces a complete, self-consistent report", () => {
    const photos = [
      makePhoto({ id: "a", score: 9, strongFirstPhoto: true, tags: ["travel"] }),
      makePhoto({ id: "b", score: 4, tags: ["mirror_selfie"] }),
      makePhoto({ id: "c", score: 7, tags: ["pet"] }),
    ];
    const report = assembleReport({ photos, bio: makeBio(7), hasBio: true, now: "2026-01-01T00:00:00Z" });

    expect(report.overallScore).toBeGreaterThan(0);
    expect(report.bestFirstPhotoId).toBe("a");
    expect(report.recommendedOrder[0]).toBe("a");
    expect(report.photosToRemove.map((r) => r.photoId)).toContain("b");
    expect(report.recommendations.length).toBeGreaterThan(0);
    expect(report.createdAt).toBe("2026-01-01T00:00:00Z");
    // Every category has an explanation.
    for (const key of Object.keys(report.categories)) {
      expect(report.categoryExplanations[key as keyof typeof report.categories]).toBeTruthy();
    }
  });
});
