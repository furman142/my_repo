import { describe, expect, it, vi } from "vitest";
import { canTransition, initialMachine, reduce, type HudEvent, type Machine } from "../src/app/stateMachine";
import { drainSse, type AssistantEvent } from "../src/lib/api";
import { isHebrew, resolveLang } from "../src/lib/i18n";
import { pickMimeType } from "../src/features/voice/recorder";
import { drawOrb } from "../src/hud/orbRenderer";
import { formatDue } from "../src/features/tasks/TasksPanel";

const run = (events: HudEvent[], start: Machine = initialMachine) => events.reduce(reduce, start);

describe("HUD state machine", () => {
  it("walks a full voice round trip", () => {
    const states: string[] = [];
    let m = initialMachine;
    for (const e of [
      { type: "BOOT_DONE" }, { type: "MIC_START" }, { type: "MIC_STOP" }, { type: "TRANSCRIBED" },
      { type: "TOOL_EXECUTING", detail: "List tasks" }, { type: "TOOL_DONE" }, { type: "SPEAK_START" },
      { type: "SPEAK_END" },
    ] as HudEvent[]) {
      m = reduce(m, e);
      states.push(m.state);
    }
    expect(states).toEqual(["IDLE", "LISTENING", "TRANSCRIBING", "THINKING", "EXECUTING", "THINKING", "SPEAKING", "IDLE"]);
  });

  it("goes through approval and back", () => {
    const m = run([{ type: "BOOT_DONE" }, { type: "REQUEST_SENT" }, { type: "APPROVAL_NEEDED" }]);
    expect(m.state).toBe("APPROVAL_REQUIRED");
    expect(run([{ type: "APPROVAL_DECIDED" }, { type: "REPLY_DONE" }], m).state).toBe("IDLE");
  });

  it("ignores invalid transitions instead of faking states", () => {
    const idle = run([{ type: "BOOT_DONE" }]);
    expect(reduce(idle, { type: "SPEAK_END" })).toBe(idle);
    expect(reduce(idle, { type: "MIC_STOP" })).toBe(idle);
    expect(canTransition("BOOTING", "MIC_START")).toBe(false);
  });

  it("connection loss always wins and recovers to IDLE", () => {
    const m = run([{ type: "BOOT_DONE" }, { type: "REQUEST_SENT" }, { type: "CONNECTION_LOST" }]);
    expect(m.state).toBe("OFFLINE");
    expect(reduce(m, { type: "CONNECTION_OK" }).state).toBe("IDLE");
  });

  it("errors carry their detail and reset", () => {
    const m = run([{ type: "BOOT_DONE" }, { type: "REQUEST_SENT" }, { type: "FAIL", detail: "Ollama offline" }]);
    expect(m).toMatchObject({ state: "ERROR", detail: "Ollama offline" });
    expect(reduce(m, { type: "RESET" }).state).toBe("IDLE");
  });

  it("cancel from any busy state returns to IDLE", () => {
    for (const pre of [["REQUEST_SENT"], ["MIC_START"], ["REQUEST_SENT", "APPROVAL_NEEDED"]]) {
      const m = run([{ type: "BOOT_DONE" }, ...pre.map((t) => ({ type: t }) as HudEvent), { type: "CANCELLED" }]);
      expect(m.state).toBe("IDLE");
    }
  });
});

describe("SSE parsing", () => {
  it("parses complete events and keeps partial tail", () => {
    const got: AssistantEvent[] = [];
    const rest = drainSse('data: {"type":"token","text":"Hel"}\n\ndata: {"type":"token","text":"lo"}\n\ndata: {"ty', (e) =>
      got.push(e));
    expect(got.map((e) => (e as { text: string }).text)).toEqual(["Hel", "lo"]);
    expect(rest).toBe('data: {"ty');
    drainSse(rest + 'pe":"completed"}\n\n', (e) => got.push(e));
    expect(got.at(-1)).toEqual({ type: "completed" });
  });

  it("handles Hebrew text and ignores malformed blocks", () => {
    const got: AssistantEvent[] = [];
    drainSse('data: {not json}\n\ndata: {"type":"message","text":"שלום","spoken":"שלום","timing":{}}\n\n', (e) => got.push(e));
    expect(got).toHaveLength(1);
  });
});

describe("i18n", () => {
  it("detects Hebrew", () => {
    expect(isHebrew("ערב טוב. כל המערכות פעילות.")).toBe(true);
    expect(isHebrew("Good evening, sir")).toBe(false);
  });
  it("resolves explicit language preference", () => {
    expect(resolveLang("he")).toBe("he");
    expect(resolveLang("en")).toBe("en");
  });
});

describe("recorder MIME selection", () => {
  it("prefers WebM/Opus (Chrome) and falls back to MP4 (iOS Safari)", () => {
    expect(pickMimeType((t) => t.startsWith("audio/webm"))).toBe("audio/webm;codecs=opus");
    expect(pickMimeType((t) => t === "audio/mp4")).toBe("audio/mp4");
    expect(pickMimeType(() => false)).toBe("");
  });
});

describe("task due formatting", () => {
  it("uses the task's own timezone", () => {
    const base = { id: 1, title: "x", status: "open" as const, priority: null, timezone: "Asia/Jerusalem",
      created_at: "", completed_at: null };
    expect(formatDue({ ...base, due_at: "2030-05-01T09:30:00+03:00", due_all_day: false }, "en-GB")).toContain("09:30");
    expect(formatDue({ ...base, due_at: null, due_all_day: false }, "en-GB")).toBe("");
  });
});

describe("orb renderer", () => {
  function fakeCtx() {
    const calls: string[] = [];
    const grad = { addColorStop: vi.fn() };
    const ctx = new Proxy({} as Record<string, unknown>, {
      get: (_t, k: string) => {
        if (k === "createRadialGradient") return () => grad;
        return (..._args: unknown[]) => calls.push(k);
      },
      set: () => true,
    });
    return { ctx: ctx as unknown as CanvasRenderingContext2D, calls };
  }

  it.each(["BOOTING", "IDLE", "LISTENING", "THINKING", "APPROVAL_REQUIRED", "EXECUTING", "SPEAKING", "OFFLINE", "ERROR"] as const)(
    "draws %s without throwing", (state) => {
      const { ctx, calls } = fakeCtx();
      drawOrb(ctx, 800, 800, { t: 3.2, state, level: 0.4, spectrum: new Uint8Array(256).fill(120), boot: 1,
        reducedMotion: false });
      expect(calls.length).toBeGreaterThan(100);
    });

  it("draws the spectrum ring only from a real analyser source", () => {
    const a = fakeCtx();
    drawOrb(a.ctx, 800, 800, { t: 1, state: "SPEAKING", level: 0, spectrum: null, boot: 1, reducedMotion: true });
    const b = fakeCtx();
    drawOrb(b.ctx, 800, 800, { t: 1, state: "SPEAKING", level: 0, spectrum: new Uint8Array(256).fill(200), boot: 1,
      reducedMotion: true });
    expect(b.calls.length).toBeGreaterThan(a.calls.length);
  });
});
