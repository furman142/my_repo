/**
 * The assistant controller: owns the HUD state machine and wires text chat, push-to-talk,
 * approvals and voice playback to the backend. All state changes go through `dispatch`.
 */

import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { initialMachine, reduce, type HudState } from "../../app/stateMachine";
import { api, ApiError, speak, stream, type ApprovalRequest, type AssistantEvent, type Health } from "../../lib/api";
import { ReplyPlayer, unlockAudio, type LevelSource } from "../../hud/audio";
import { PushToTalk } from "../voice/recorder";

export interface ChatLine {
  id: string;
  role: "user" | "assistant" | "tool" | "system";
  text: string;
  link?: string;
  ok?: boolean;
}

export interface PendingApproval {
  request: ApprovalRequest;
  title: string;
  sideEffect: string;
}

export interface AssistantOptions {
  speakReplies: boolean;
  sttLanguage: "auto" | "en" | "he";
  reviewTranscript: boolean;
  bootAnimation: boolean;
}

const CID_KEY = "jarvis.conversation";
const MUTE_KEY = "jarvis.muted";
let lineSeq = 0;
const nextId = () => `l${++lineSeq}`;

function readLocal(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeLocal(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* storage unavailable (private mode) */
  }
}

export function useAssistant(opts: AssistantOptions) {
  const [machine, dispatch] = useReducer(reduce, initialMachine);
  const [lines, setLines] = useState<ChatLine[]>([]);
  const [approval, setApproval] = useState<PendingApproval | null>(null);
  const [subtitle, setSubtitle] = useState<{ who: "user" | "assistant"; text: string } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const [draft, setDraft] = useState("");
  const [lastModel, setLastModel] = useState<{ model: string; cloud: boolean; ms?: number } | null>(null);
  const [muted, setMutedState] = useState(() => readLocal(MUTE_KEY) === "1");
  const [canReplay, setCanReplay] = useState(false);
  const cidRef = useRef<string | null>(readLocal(CID_KEY));
  const player = useRef(new ReplyPlayer());
  const ptt = useRef(new PushToTalk());
  const abortRef = useRef<AbortController | null>(null);
  const spokenRef = useRef<string | null>(null);
  const stateRef = useRef<HudState>(machine.state);
  stateRef.current = machine.state;
  const optsRef = useRef(opts);
  optsRef.current = opts;
  const mutedRef = useRef(muted);
  mutedRef.current = muted;

  const getSource = useCallback((): LevelSource | null => {
    if (stateRef.current === "LISTENING") return ptt.current.level;
    if (stateRef.current === "SPEAKING") return player.current.active;
    return null;
  }, []);

  // ---------------------------------------------------------------- boot, health, history
  useEffect(() => {
    const t = window.setTimeout(() => dispatch({ type: "BOOT_DONE" }), opts.bootAnimation ? 2400 : 0);
    return () => window.clearTimeout(t);
  }, [opts.bootAnimation]);

  const checkHealth = useCallback(async () => {
    try {
      const h = await api.health();
      setHealth(h);
      if (stateRef.current === "OFFLINE") dispatch({ type: "CONNECTION_OK" });
      return h;
    } catch {
      setHealth(null);
      dispatch({ type: "CONNECTION_LOST", detail: "server unreachable" });
      return null;
    }
  }, []);

  useEffect(() => {
    void checkHealth();
    const id = window.setInterval(() => void checkHealth(), 10_000);
    const onOnline = () => void checkHealth();
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", () => dispatch({ type: "CONNECTION_LOST", detail: "device offline" }));
    return () => {
      window.clearInterval(id);
      window.removeEventListener("online", onOnline);
    };
  }, [checkHealth]);

  useEffect(() => {
    const cid = cidRef.current;
    if (!cid) return;
    api.messages(cid).then(
      (r) => setLines(r.messages.map((m) => ({ id: nextId(), role: m.role, text: m.content }))),
      () => {
        cidRef.current = null;
        writeLocal(CID_KEY, null);
      },
    );
    api.pendingApprovals().then((r) => {
      const p = r.pending.find((x) => x.conversation_id === cid);
      if (p) {
        setApproval({ request: p, title: p.tool_name, sideEffect: "" });
        window.setTimeout(() => dispatch({ type: "APPROVAL_NEEDED" }), 2600);
      }
    }, () => undefined);
  }, []);

  // ---------------------------------------------------------------- speech output
  const speakText = useCallback(async (text: string) => {
    if (!text || mutedRef.current || !optsRef.current.speakReplies) {
      dispatch({ type: "REPLY_DONE" });
      return;
    }
    try {
      const audio = await speak(text);
      await player.current.play(
        audio,
        () => {
          setCanReplay(true);
          dispatch({ type: "SPEAK_START" });
        },
        () => dispatch({ type: "SPEAK_END" }),
      );
    } catch (e) {
      dispatch({ type: "REPLY_DONE" });
      if (e instanceof ApiError) setNotice(e.code === "not_configured" ? "voice_not_configured" : e.message);
      else setNotice("Audio playback failed");
    }
  }, []);

  // ---------------------------------------------------------------- event handling
  const onEvent = useCallback((e: AssistantEvent) => {
    switch (e.type) {
      case "request_received":
        cidRef.current = e.conversation_id;
        writeLocal(CID_KEY, e.conversation_id);
        break;
      case "thinking":
        setLastModel({ model: e.model, cloud: e.cloud });
        break;
      case "token":
        setLines((ls) => {
          const last = ls[ls.length - 1];
          if (last && last.role === "assistant" && last.id.startsWith("s")) {
            return [...ls.slice(0, -1), { ...last, text: last.text + e.text }];
          }
          return [...ls, { id: "s" + nextId(), role: "assistant", text: e.text }];
        });
        setSubtitle((s) => ({ who: "assistant", text: (s?.who === "assistant" ? s.text : "") + e.text }));
        break;
      case "executing":
        dispatch({ type: "TOOL_EXECUTING", detail: e.title });
        break;
      case "tool_result": {
        dispatch({ type: "TOOL_DONE" });
        const url = typeof e.result.approved_url === "string" ? e.result.approved_url : undefined;
        const err = typeof e.result.error === "string" ? e.result.error : null;
        const denied = e.result.denied === true;
        setLines((ls) => [...ls, {
          id: nextId(), role: "tool", ok: e.ok, link: url,
          text: denied ? `${e.tool}: denied` : err ? `${e.tool}: ${err}` : `${e.tool}: ok`,
        }]);
        break;
      }
      case "approval_required":
        setApproval({ request: e.request, title: e.title, sideEffect: e.side_effect });
        dispatch({ type: "APPROVAL_NEEDED" });
        break;
      case "message":
        spokenRef.current = e.spoken;
        setLines((ls) => {
          const last = ls[ls.length - 1];
          const fin: ChatLine = { id: nextId(), role: "assistant", text: e.text };
          return last && last.role === "assistant" && last.id.startsWith("s") ? [...ls.slice(0, -1), fin] : [...ls, fin];
        });
        setSubtitle({ who: "assistant", text: e.text });
        setLastModel((m) => (m ? { ...m, ms: e.timing.llm_ms ?? undefined } : m));
        break;
      case "completed": {
        const spoken = spokenRef.current;
        spokenRef.current = null;
        void speakText(spoken ?? "");
        break;
      }
      case "cancelled":
        dispatch({ type: "CANCELLED" });
        break;
      case "failed":
        dispatch({ type: "FAIL", detail: e.message });
        setLines((ls) => [...ls, { id: nextId(), role: "system", text: e.message }]);
        break;
    }
  }, [speakText]);

  const runStream = useCallback(async (path: string, body: unknown) => {
    const ac = new AbortController();
    abortRef.current = ac;
    try {
      await stream(path, body, onEvent, ac.signal);
    } catch (e) {
      if ((e as Error).name === "AbortError") {
        dispatch({ type: "CANCELLED" });
      } else {
        const msg = e instanceof ApiError ? e.message : "Connection to JARVIS lost";
        dispatch({ type: "FAIL", detail: msg });
        setLines((ls) => [...ls, { id: nextId(), role: "system", text: msg }]);
        if (!(e instanceof ApiError)) void checkHealth();
      }
    } finally {
      if (abortRef.current === ac) abortRef.current = null;
    }
  }, [onEvent, checkHealth]);

  // ---------------------------------------------------------------- public actions
  const send = useCallback(async (text: string, fromVoice = false) => {
    const t = text.trim();
    if (!t) return;
    void unlockAudio();
    player.current.stop();
    setNotice(null);
    dispatch(fromVoice ? { type: "TRANSCRIBED" } : { type: "REQUEST_SENT" });
    setLines((ls) => [...ls, { id: nextId(), role: "user", text: t }]);
    setSubtitle({ who: "user", text: t });
    await runStream("/api/chat", { text: t, ...(cidRef.current ? { conversation_id: cidRef.current } : {}) });
  }, [runStream]);

  const decide = useCallback(async (approve: boolean) => {
    const a = approval;
    if (!a) return;
    void unlockAudio();
    setApproval(null);
    dispatch({ type: "APPROVAL_DECIDED" });
    await runStream(`/api/approvals/${a.request.id}`, { nonce: a.request.nonce, approve });
  }, [approval, runStream]);

  const stop = useCallback(() => {
    abortRef.current?.abort();
    if (cidRef.current) void api.cancel(cidRef.current).catch(() => undefined);
    player.current.stop();
    if (stateRef.current === "LISTENING") ptt.current.cancel();
    dispatch({ type: stateRef.current === "SPEAKING" ? "SPEAK_END" : "CANCELLED" });
  }, []);

  const micStart = useCallback(async () => {
    await unlockAudio();
    player.current.stop();
    setNotice(null);
    try {
      await ptt.current.start(() => void micStopRef.current());
      dispatch({ type: "MIC_START" });
    } catch (e) {
      const name = (e as Error).name;
      setNotice(name === "NotAllowedError" ? "mic_denied" : "mic_unavailable");
    }
  }, []);

  const micStop = useCallback(async () => {
    if (stateRef.current !== "LISTENING") return;
    dispatch({ type: "MIC_STOP" });
    const blob = await ptt.current.stop();
    if (!blob) {
      dispatch({ type: "MIC_CANCEL" });
      setNotice("Recording too short");
      return;
    }
    try {
      const tr = await api.transcribe(blob, optsRef.current.sttLanguage);
      setSubtitle({ who: "user", text: tr.text });
      if (optsRef.current.reviewTranscript) {
        dispatch({ type: "MIC_CANCEL" });
        setDraft(tr.text);
      } else {
        await send(tr.text, true);
      }
    } catch (e) {
      if (e instanceof ApiError && (e.code === "no_speech" || e.status === 422)) {
        dispatch({ type: "MIC_CANCEL" });
        setNotice(e.message);
      } else {
        dispatch({ type: "FAIL", detail: e instanceof ApiError ? e.message : "Transcription failed" });
      }
    }
  }, [send]);
  const micStopRef = useRef(micStop);
  micStopRef.current = micStop;

  const micCancel = useCallback(() => {
    ptt.current.cancel();
    dispatch({ type: "MIC_CANCEL" });
  }, []);

  const setMuted = useCallback((v: boolean) => {
    setMutedState(v);
    writeLocal(MUTE_KEY, v ? "1" : "0");
    if (v) {
      player.current.stop();
      if (stateRef.current === "SPEAKING") dispatch({ type: "SPEAK_END" });
    }
  }, []);

  const replay = useCallback(() => {
    void unlockAudio();
    player.current.replay(() => dispatch({ type: "SPEAK_START" }), () => dispatch({ type: "SPEAK_END" }));
  }, []);

  /** Play arbitrary audio (voice tests) through the same measured chain so the orb reacts. */
  const playTest = useCallback(async (audio: ArrayBuffer) => {
    await unlockAudio();
    await player.current.play(audio, () => {
      setCanReplay(true);
      dispatch({ type: "SPEAK_START" });
    }, () => dispatch({ type: "SPEAK_END" }));
  }, []);

  const newConversation = useCallback(() => {
    cidRef.current = null;
    writeLocal(CID_KEY, null);
    setLines([]);
    setSubtitle(null);
  }, []);

  const skipBoot = useCallback(() => dispatch({ type: "BOOT_DONE" }), []);
  const reset = useCallback(() => dispatch({ type: "RESET" }), []);

  return {
    machine, lines, approval, subtitle, notice, setNotice, health, draft, setDraft, lastModel, muted, setMuted,
    canReplay, getSource, send, decide, stop, micStart, micStop, micCancel, replay, playTest, newConversation,
    skipBoot, reset, checkHealth,
  };
}

export type Assistant = ReturnType<typeof useAssistant>;
