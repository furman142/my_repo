import { describe, it, expect } from "vitest";
import { mockAnalyzeBio, mockAnalyzePhoto, mockGenerateBios } from "./mock-analyzer";
import type { AnalyzePhotoInput } from "../types";

const photo: AnalyzePhotoInput = { id: "p1", data: "AAAABBBBCCCC", mediaType: "image/jpeg" };

describe("mockAnalyzePhoto", () => {
  it("is deterministic for the same input", () => {
    const a = mockAnalyzePhoto(photo);
    const b = mockAnalyzePhoto(photo);
    expect(a).toEqual(b);
  });

  it("produces scores within 0–10 and a summary", () => {
    const result = mockAnalyzePhoto(photo);
    expect(result.score).toBeGreaterThanOrEqual(1);
    expect(result.score).toBeLessThanOrEqual(10);
    expect(result.summary).toBeTruthy();
    for (const attr of Object.values(result.attributes)) {
      expect(attr.score).toBeGreaterThanOrEqual(1);
      expect(attr.score).toBeLessThanOrEqual(10);
      expect(attr.why).toBeTruthy();
    }
  });

  it("differs for different inputs", () => {
    const other = mockAnalyzePhoto({ ...photo, id: "p2", data: "ZZZZYYYYXXXX" });
    expect(other.id).toBe("p2");
  });
});

describe("mockAnalyzeBio", () => {
  it("penalizes very short bios on length", () => {
    const short = mockAnalyzeBio("hi");
    expect(short.length.score).toBeLessThan(6);
  });
});

describe("mockGenerateBios", () => {
  it("returns three options", () => {
    expect(mockGenerateBios("funny")).toHaveLength(3);
  });

  it("falls back to confident for unknown tones", () => {
    expect(mockGenerateBios("unknown-tone")).toEqual(mockGenerateBios("confident"));
  });
});
