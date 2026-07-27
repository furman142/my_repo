import { describe, it, expect, beforeEach } from "vitest";
import { rateLimit, clientKey, _resetRateLimitStore } from "./rate-limit";

describe("rateLimit", () => {
  beforeEach(() => _resetRateLimitStore());

  it("allows requests up to the limit, then blocks", () => {
    const now = 1_000_000;
    for (let i = 0; i < 3; i++) {
      expect(rateLimit("k", 3, 1000, now).allowed).toBe(true);
    }
    expect(rateLimit("k", 3, 1000, now).allowed).toBe(false);
  });

  it("resets after the window elapses", () => {
    const start = 1_000_000;
    rateLimit("k", 1, 1000, start);
    expect(rateLimit("k", 1, 1000, start).allowed).toBe(false);
    expect(rateLimit("k", 1, 1000, start + 1001).allowed).toBe(true);
  });

  it("reports remaining budget", () => {
    const now = 1_000_000;
    expect(rateLimit("k", 5, 1000, now).remaining).toBe(4);
    expect(rateLimit("k", 5, 1000, now).remaining).toBe(3);
  });
});

describe("clientKey", () => {
  it("derives a key from x-forwarded-for", () => {
    const headers = new Headers({ "x-forwarded-for": "1.2.3.4, 5.6.7.8" });
    expect(clientKey(headers, "analyze")).toBe("analyze:1.2.3.4");
  });

  it("falls back to anonymous", () => {
    expect(clientKey(new Headers(), "bio")).toBe("bio:anonymous");
  });
});
