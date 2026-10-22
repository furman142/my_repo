/**
 * The single, inspectable UI state machine that drives every visible HUD transition.
 * Components never toggle ad-hoc booleans for "busy/listening/speaking": they dispatch events here.
 */

export type HudState =
  | "BOOTING"
  | "IDLE"
  | "LISTENING"
  | "TRANSCRIBING"
  | "THINKING"
  | "APPROVAL_REQUIRED"
  | "EXECUTING"
  | "SPEAKING"
  | "OFFLINE"
  | "ERROR";

export type HudEvent =
  | { type: "BOOT_DONE" }
  | { type: "CONNECTION_LOST"; detail?: string }
  | { type: "CONNECTION_OK" }
  | { type: "MIC_START" }
  | { type: "MIC_STOP" }
  | { type: "MIC_CANCEL" }
  | { type: "TRANSCRIBED" }
  | { type: "REQUEST_SENT" }
  | { type: "TOOL_EXECUTING"; detail: string }
  | { type: "TOOL_DONE" }
  | { type: "APPROVAL_NEEDED" }
  | { type: "APPROVAL_DECIDED" }
  | { type: "REPLY_DONE" }
  | { type: "SPEAK_START" }
  | { type: "SPEAK_END" }
  | { type: "CANCELLED" }
  | { type: "FAIL"; detail: string }
  | { type: "RESET" };

export interface Machine {
  state: HudState;
  detail: string;
  /** Monotonic counter, handy for tests / debugging. */
  seq: number;
}

const BUSY: HudState[] = ["TRANSCRIBING", "THINKING", "EXECUTING", "APPROVAL_REQUIRED"];

/** Which states each event may fire from. Anything else is ignored (and reported in dev). */
const FROM: Record<HudEvent["type"], HudState[] | "*"> = {
  BOOT_DONE: ["BOOTING"],
  CONNECTION_LOST: "*",
  CONNECTION_OK: ["OFFLINE", "BOOTING"],
  MIC_START: ["IDLE", "SPEAKING", "ERROR"],
  MIC_STOP: ["LISTENING"],
  MIC_CANCEL: ["LISTENING", "TRANSCRIBING"],
  TRANSCRIBED: ["TRANSCRIBING"],
  REQUEST_SENT: ["IDLE", "TRANSCRIBING", "SPEAKING", "ERROR"],
  TOOL_EXECUTING: ["THINKING", "EXECUTING", "APPROVAL_REQUIRED"],
  TOOL_DONE: ["EXECUTING", "THINKING"],
  APPROVAL_NEEDED: ["THINKING", "EXECUTING", "IDLE"],
  APPROVAL_DECIDED: ["APPROVAL_REQUIRED", "IDLE", "ERROR"],
  REPLY_DONE: ["THINKING", "EXECUTING", "APPROVAL_REQUIRED"],
  SPEAK_START: ["IDLE", "THINKING", "EXECUTING"],
  SPEAK_END: ["SPEAKING"],
  CANCELLED: [...BUSY, "SPEAKING", "LISTENING"],
  FAIL: [...BUSY, "LISTENING", "SPEAKING", "IDLE"],
  RESET: ["ERROR", "IDLE", "SPEAKING"],
};

const TO: Record<HudEvent["type"], HudState> = {
  BOOT_DONE: "IDLE",
  CONNECTION_LOST: "OFFLINE",
  CONNECTION_OK: "IDLE",
  MIC_START: "LISTENING",
  MIC_STOP: "TRANSCRIBING",
  MIC_CANCEL: "IDLE",
  TRANSCRIBED: "THINKING",
  REQUEST_SENT: "THINKING",
  TOOL_EXECUTING: "EXECUTING",
  TOOL_DONE: "THINKING",
  APPROVAL_NEEDED: "APPROVAL_REQUIRED",
  APPROVAL_DECIDED: "THINKING",
  REPLY_DONE: "IDLE",
  SPEAK_START: "SPEAKING",
  SPEAK_END: "IDLE",
  CANCELLED: "IDLE",
  FAIL: "ERROR",
  RESET: "IDLE",
};

export const initialMachine: Machine = { state: "BOOTING", detail: "", seq: 0 };

export function canTransition(state: HudState, event: HudEvent["type"]): boolean {
  const from = FROM[event];
  return from === "*" || from.includes(state);
}

export function reduce(m: Machine, e: HudEvent): Machine {
  if (!canTransition(m.state, e.type)) {
    if (import.meta.env?.DEV) console.debug(`[hud] ignored ${e.type} in ${m.state}`);
    return m;
  }
  const detail = "detail" in e && e.detail ? e.detail : "";
  return { state: TO[e.type], detail, seq: m.seq + 1 };
}

export function isBusy(s: HudState): boolean {
  return BUSY.includes(s);
}
