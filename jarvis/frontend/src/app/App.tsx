import { useCallback, useEffect, useRef, useState } from "react";
import { api, setCsrf, type AuthState, type Prefs } from "../lib/api";
import { dictionaries, isHebrew, resolveLang } from "../lib/i18n";
import { OrbCanvas } from "../hud/OrbCanvas";
import { AuthScreen } from "../components/AuthScreen";
import { Drawer } from "../components/Drawer";
import { useAssistant } from "../features/chat/useAssistant";
import { TranscriptPanel } from "../features/chat/TranscriptPanel";
import { TasksPanel } from "../features/tasks/TasksPanel";
import { MemoryPanel } from "../features/memory/MemoryPanel";
import { SettingsPanel } from "../features/settings/SettingsPanel";
import { DiagnosticsPanel } from "../features/diagnostics/DiagnosticsPanel";
import { ApprovalSheet } from "../features/approvals/ApprovalSheet";
import { micSupported } from "../features/voice/recorder";
import { isBusy } from "./stateMachine";
import { useTelemetry, useClock } from "../hooks/useTelemetry";

type Panel = null | "transcript" | "tasks" | "memories" | "settings" | "diagnostics";
const REVIEW_KEY = "jarvis.reviewTranscript";

export function App() {
  const [auth, setAuth] = useState<AuthState | null>(null);
  const [authError, setAuthError] = useState(false);

  const refresh = useCallback(() => {
    api.authState().then((s) => {
      setCsrf(s.csrf_token);
      setAuth(s);
      setAuthError(false);
    }, () => setAuthError(true));
  }, []);
  useEffect(refresh, [refresh]);

  const t = dictionaries[resolveLang("auto")];
  if (authError) {
    return (
      <main className="auth">
        <div className="auth-card glass" role="alert">
          <div className="brand brand-lg">J.A.R.V.I.S.</div>
          <p>{t.reconnecting}</p>
          <p className="muted small">The JARVIS server on your PC is not reachable. Is it running and online?</p>
          <button className="btn primary" onClick={refresh}>{t.retry}</button>
        </div>
      </main>
    );
  }
  if (!auth) return <div className="scene" aria-busy="true" />;
  if (!auth.authenticated) {
    return <AuthScreen setupRequired={auth.setup_required} t={t} onAuthenticated={setAuth} />;
  }
  return <Hud onLogout={() => { void api.logout().finally(refresh); }} />;
}

function Hud({ onLogout }: { onLogout: () => void }) {
  const [prefs, setPrefs] = useState<Prefs | null>(null);
  const [tz, setTz] = useState<string>("Asia/Jerusalem");
  const [panel, setPanel] = useState<Panel>(null);
  const [typing, setTyping] = useState(false);
  const [review, setReviewState] = useState(() => {
    try {
      return localStorage.getItem(REVIEW_KEY) === "1";
    } catch {
      return false;
    }
  });
  const setReview = (v: boolean) => {
    setReviewState(v);
    try {
      localStorage.setItem(REVIEW_KEY, v ? "1" : "0");
    } catch {
      /* ignore */
    }
  };

  useEffect(() => {
    api.settings().then((s) => {
      setPrefs(s.prefs);
      setTz(s.effective_timezone);
    }, () => undefined);
  }, []);

  const lang = resolveLang(prefs?.ui_language);
  const t = dictionaries[lang];
  const a = useAssistant({
    speakReplies: prefs?.speak_replies ?? true,
    sttLanguage: prefs?.stt_language ?? "auto",
    reviewTranscript: review,
    bootAnimation: prefs?.boot_animation ?? true,
  });
  const state = a.machine.state;
  const busy = isBusy(state);
  const telemetry = useTelemetry(state !== "OFFLINE");
  const clock = useClock(tz, lang === "he" ? "he-IL" : "en-GB");

  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === "he" ? "rtl" : "ltr";
  }, [lang]);

  useEffect(() => {
    if (a.draft) setTyping(true);
  }, [a.draft]);

  // ---- push-to-talk: hold (>350 ms) = PTT, short tap = toggle
  const pressAt = useRef(0);
  const onMicDown = async () => {
    if (state === "LISTENING") {
      void a.micStop();
      return;
    }
    pressAt.current = performance.now();
    await a.micStart();
  };
  const onMicUp = () => {
    if (performance.now() - pressAt.current > 350) void a.micStop();
  };

  useEffect(() => {
    const isField = (el: EventTarget | null) =>
      el instanceof HTMLElement && (el.closest("input, textarea, select, [contenteditable]") !== null);
    const down = (e: KeyboardEvent) => {
      if (state === "BOOTING") {
        a.skipBoot();
        return;
      }
      if (e.code === "Space" && !e.repeat && !isField(e.target) && !panel && !a.approval) {
        e.preventDefault();
        pressAt.current = performance.now() - 1000; // keyboard is always hold-to-talk
        void a.micStart();
      } else if (e.key === "Escape" && !panel) {
        if (state === "LISTENING") a.micCancel();
        else if (busy || state === "SPEAKING") a.stop();
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === "Space" && !isField(e.target)) void a.micStop();
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, [a, state, busy, panel]);

  const comps = a.health?.components;
  const online = !!a.health && state !== "OFFLINE";
  const notice = a.notice === "voice_not_configured" ? t.voiceNotConfigured
    : a.notice === "mic_denied" ? t.micDenied : a.notice === "mic_unavailable" ? t.noMic : a.notice;
  const sub = a.subtitle;
  const closePanel = useCallback(() => setPanel(null), []);

  return (
    <div className={`scene state-${state.toLowerCase()}${typing ? " typing" : ""}`} onClick={() => state === "BOOTING" && a.skipBoot()}>
      <div className="vignette" aria-hidden="true" />
      <div className="orb-wrap">
        <OrbCanvas state={state} getSource={a.getSource} bootMs={prefs?.boot_animation === false ? 0 : 2400} />
      </div>

      <header className="hud-top">
        <div className="hud-left">
          <div className="brand">J.A.R.V.I.S.</div>
          <div className="hud-state" aria-live="polite">
            <span className="dot" /> {t.states[state]}{a.machine.detail ? ` · ${a.machine.detail}` : ""}
          </div>
        </div>
        <div className="hud-right" aria-label="Status">
          <Indicator label={t.online} state={online ? "ready" : "unavailable"} />
          <Indicator label={t.llm} state={comps?.llm.state} />
          <Indicator label={t.stt} state={comps?.stt.state} />
          <Indicator label={t.voice} state={a.muted ? "muted" : comps?.tts.state} />
          <span className={`mic-live${state === "LISTENING" ? " on" : ""}`} aria-label={state === "LISTENING" ? "Microphone live" : "Microphone off"}>
            ● MIC
          </span>
          <time className="clock mono">{clock}</time>
        </div>
      </header>

      <aside className="hud-corner bl mono" aria-label="Host telemetry">
        {telemetry ? (
          <>
            <div>CPU {fmt(telemetry.cpu_percent)}%</div>
            <div>RAM {fmt(telemetry.ram_percent)}%</div>
            <div>GPU {telemetry.gpu}</div>
          </>
        ) : <div>TELEMETRY —</div>}
      </aside>
      <aside className="hud-corner br mono">
        {a.lastModel ? (
          <>
            <div>{a.lastModel.model}{a.lastModel.cloud ? " ☁" : ""}</div>
            {a.lastModel.ms !== undefined && <div>{(a.lastModel.ms / 1000).toFixed(1)} s</div>}
          </>
        ) : <div>LOCAL</div>}
      </aside>

      {state === "OFFLINE" && (
        <div className="banner" role="alert">
          {t.reconnecting} <button className="btn small" onClick={() => void a.checkHealth()}>{t.retry}</button>
        </div>
      )}
      {state === "ERROR" && (
        <div className="banner err" role="alert">
          {a.machine.detail || t.states.ERROR} <button className="btn small" onClick={a.reset}>OK</button>
        </div>
      )}

      <div className="subtitle" aria-live="polite" dir={sub && isHebrew(sub.text) ? "rtl" : "auto"}>
        {sub && <p className={sub.who}>{sub.text.length > 280 ? "…" + sub.text.slice(-280) : sub.text}</p>}
        {notice && <p className="notice" role="status">{notice}</p>}
      </div>

      {typing && (
        <form className="composer glass" onSubmit={(e) => {
          e.preventDefault();
          const text = a.draft;
          a.setDraft("");
          void a.send(text);
        }}>
          <input autoFocus value={a.draft} onChange={(e) => a.setDraft(e.target.value)} placeholder={t.placeholder}
            aria-label={t.keyboard} maxLength={4000} dir="auto" enterKeyHint="send" />
          <button className="btn primary" type="submit" disabled={!a.draft.trim() || busy}>{t.send}</button>
        </form>
      )}

      <nav className="dock" aria-label="Controls">
        <DockBtn label={t.transcript} icon="☰" onClick={() => setPanel("transcript")} />
        <DockBtn label={t.tasks} icon="✓" onClick={() => setPanel("tasks")} />
        <DockBtn label={t.memories} icon="◈" onClick={() => setPanel("memories")} />
        {busy || state === "SPEAKING" ? (
          <button className="mic stop" onClick={a.stop} aria-label={t.stop}><span>■</span></button>
        ) : (
          <button className={`mic${state === "LISTENING" ? " live" : ""}`} aria-label={t.micHold}
            aria-pressed={state === "LISTENING"} disabled={!micSupported() || state === "OFFLINE" || state === "BOOTING"}
            title={micSupported() ? t.micHold : t.noMic}
            onPointerDown={(e) => { e.preventDefault(); void onMicDown(); }} onPointerUp={onMicUp}
            onPointerLeave={() => state === "LISTENING" && performance.now() - pressAt.current > 350 && void a.micStop()}
            onContextMenu={(e) => e.preventDefault()}>
            <MicIcon />
          </button>
        )}
        <DockBtn label={t.keyboard} icon="⌨" onClick={() => setTyping((v) => !v)} pressed={typing} />
        <DockBtn label={a.muted ? t.unmute : t.mute} icon={a.muted ? "🔇" : "🔊"} onClick={() => a.setMuted(!a.muted)}
          pressed={a.muted} />
        {a.canReplay && <DockBtn label={t.replay} icon="↻" onClick={a.replay} />}
        <DockBtn label={t.settings} icon="⚙" onClick={() => setPanel("settings")} />
        <DockBtn label={t.diagnostics} icon="◎" onClick={() => setPanel("diagnostics")} />
      </nav>

      {panel === "transcript" && (
        <Drawer title={t.transcript} closeLabel={t.close} onClose={closePanel} wide>
          <TranscriptPanel lines={a.lines} t={t} onNew={a.newConversation} />
        </Drawer>
      )}
      {panel === "tasks" && (
        <Drawer title={t.tasks} closeLabel={t.close} onClose={closePanel}>
          <TasksPanel t={t} locale={lang === "he" ? "he-IL" : "en-GB"} />
        </Drawer>
      )}
      {panel === "memories" && (
        <Drawer title={t.memories} closeLabel={t.close} onClose={closePanel}>
          <MemoryPanel t={t} />
        </Drawer>
      )}
      {panel === "settings" && (
        <Drawer title={t.settings} closeLabel={t.close} onClose={closePanel} wide>
          <SettingsPanel t={t} onPrefs={(p) => { setPrefs(p); }} playTest={a.playTest} reviewTranscript={review}
            setReviewTranscript={setReview} onLogout={onLogout} />
        </Drawer>
      )}
      {panel === "diagnostics" && (
        <Drawer title={t.diagnostics} closeLabel={t.close} onClose={closePanel} wide>
          <DiagnosticsPanel onWarmup={() => void a.checkHealth()} />
        </Drawer>
      )}
      {a.approval && <ApprovalSheet approval={a.approval} t={t} onDecide={(ok) => void a.decide(ok)} />}
    </div>
  );
}

function fmt(v: unknown): string {
  return typeof v === "number" ? v.toFixed(0) : "—";
}

function Indicator({ label, state }: { label: string; state?: string }) {
  const s = state ?? "unknown";
  return (
    <span className={`ind ${s}`} title={`${label}: ${s.replace("_", " ")}`}>
      <span className="ind-dot" aria-hidden="true" />{label}
      <span className="sr-only">: {s.replace("_", " ")}</span>
    </span>
  );
}

function DockBtn({ label, icon, onClick, pressed }: { label: string; icon: string; onClick: () => void; pressed?: boolean }) {
  return (
    <button className="dock-btn" onClick={onClick} aria-label={label} title={label}
      {...(pressed !== undefined ? { "aria-pressed": pressed } : {})}>
      <span aria-hidden="true">{icon}</span>
    </button>
  );
}

function MicIcon() {
  return (
    <svg viewBox="0 0 24 24" width="28" height="28" aria-hidden="true">
      <rect x="9" y="3" width="6" height="12" rx="3" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M8.5 21h7" fill="none" stroke="currentColor" strokeWidth="1.6"
        strokeLinecap="round" />
    </svg>
  );
}
