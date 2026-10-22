import { useEffect, useState } from "react";
import { api, ApiError, speak, type Prefs, type SettingsPayload, type Voice } from "../../lib/api";
import type { dictionaries } from "../../lib/i18n";

export const SAMPLE_EN = "Good evening, sir. JARVIS is online. All systems are operational and awaiting your instructions.";
export const SAMPLE_HE = "ערב טוב. כל המערכות פעילות. איך אוכל לעזור לך?";

interface Props {
  t: (typeof dictionaries)["en"];
  onPrefs: (p: Prefs) => void;
  playTest: (audio: ArrayBuffer) => Promise<void>;
  reviewTranscript: boolean;
  setReviewTranscript: (v: boolean) => void;
  onLogout: () => void;
}

export function SettingsPanel({ t, onPrefs, playTest, reviewTranscript, setReviewTranscript, onLogout }: Props) {
  const [data, setData] = useState<SettingsPayload | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [query, setQuery] = useState("british male");
  const [voices, setVoices] = useState<Voice[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.settings().then(setData, (e) => setStatus(String(e.message)));
  }, []);

  async function save(p: Partial<Prefs>) {
    try {
      const r = await api.saveSettings(p);
      setData(r);
      onPrefs(r.prefs);
      setStatus("Saved");
    } catch (e) {
      setStatus(e instanceof ApiError ? e.message : "Failed");
    }
  }

  async function test(lang: "en" | "he", ref?: string) {
    setBusy(true);
    setStatus(lang === "he" ? "Synthesising Hebrew sample…" : "Synthesising English sample…");
    try {
      const audio = await speak(lang === "he" ? SAMPLE_HE : SAMPLE_EN, { raw: true, language: lang,
        ...(ref ? { reference_id: ref } : {}) });
      await playTest(audio);
      setStatus(`Played ${lang === "he" ? "Hebrew" : "English"} sample from Fish Audio.` +
        (lang === "he" ? " Listen for pronunciation — an English-accented voice may sound unnatural in Hebrew." : ""));
    } catch (e) {
      setStatus(e instanceof ApiError ? `${e.code}: ${e.message}` : "Playback failed");
    } finally {
      setBusy(false);
    }
  }

  async function search() {
    setStatus(null);
    try {
      setVoices((await api.searchVoices(query, "en")).voices);
    } catch (e) {
      setStatus(e instanceof ApiError ? e.message : "Search failed");
    }
  }

  if (!data) return <p className="muted">{status ?? "…"}</p>;
  const p = data.prefs;

  return (
    <div className="panel settings">
      <section>
        <h3>General</h3>
        <label className="row">
          Interface language
          <select value={p.ui_language} onChange={(e) => save({ ui_language: e.target.value as Prefs["ui_language"] })}>
            <option value="auto">Auto</option><option value="en">English</option><option value="he">עברית</option>
          </select>
        </label>
        <label className="row">
          Speech recognition language
          <select value={p.stt_language} onChange={(e) => save({ stt_language: e.target.value as Prefs["stt_language"] })}>
            <option value="auto">Auto-detect</option><option value="en">English</option><option value="he">עברית</option>
          </select>
        </label>
        <TimezoneField value={data.effective_timezone} onSave={(tz) => save({ timezone: tz })} />
        <label className="row check">
          <input type="checkbox" checked={reviewTranscript} onChange={(e) => setReviewTranscript(e.target.checked)} />
          {t.reviewTranscript}
        </label>
        <label className="row check">
          <input type="checkbox" checked={p.boot_animation} onChange={(e) => save({ boot_animation: e.target.checked })} />
          Boot animation
        </label>
      </section>

      <section>
        <h3>Language model</h3>
        <label className="row">
          Provider
          <select value={p.llm_provider} onChange={(e) => save({ llm_provider: e.target.value as Prefs["llm_provider"] })}>
            <option value="ollama">Ollama (local, private)</option>
            <option value="groq" disabled={!data.groq_available}>
              Groq (cloud){data.groq_available ? "" : " — not configured"}
            </option>
          </select>
        </label>
        {p.llm_provider === "groq" && <p className="warn small">Cloud inference: your messages are sent to Groq.</p>}
      </section>

      <section>
        <h3>Voice (Fish Audio)</h3>
        <p className="muted small">{t.cloudNotice}</p>
        {!data.fish_key_present && (
          <p className="warn small">{t.voiceNotConfigured}: add FISH_API_KEY to the server's .env file and restart.</p>
        )}
        <label className="row check">
          <input type="checkbox" checked={p.speak_replies} onChange={(e) => save({ speak_replies: e.target.checked })} />
          Speak replies aloud
        </label>
        <RefField label="Voice reference_id (English / default)" value={p.voice_reference_en}
          placeholder={data.env_voice_reference_set ? "(using FISH_REFERENCE_ID from .env)" : "paste a Fish Audio voice id"}
          onSave={(v) => save({ voice_reference_en: v })} />
        <RefField label="Optional separate Hebrew voice reference_id" value={p.voice_reference_he} placeholder="optional"
          onSave={(v) => save({ voice_reference_he: v })} />
        <label className="row check">
          <input type="checkbox" checked={p.use_hebrew_voice} onChange={(e) => save({ use_hebrew_voice: e.target.checked })} />
          Use the separate Hebrew voice for Hebrew replies
        </label>
        <div className="row">
          <button className="btn" disabled={busy || !data.fish_key_present} onClick={() => test("en")}>▶ Test English</button>
          <button className="btn" disabled={busy || !data.fish_key_present} onClick={() => test("he")}>▶ בדיקת עברית</button>
        </div>
        <details>
          <summary>Find a voice in the Fish Audio library</summary>
          <p className="muted small">
            Choose a licensed library voice or your own authorised one. Do not clone a real actor's voice without
            permission. Audition with the test buttons before saving.
          </p>
          <form className="row" onSubmit={(e) => { e.preventDefault(); void search(); }}>
            <input value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Voice search" />
            <button className="btn" type="submit" disabled={!data.fish_key_present}>{t.search}</button>
          </form>
          <ul className="items">
            {voices.map((v) => (
              <li key={v.id} className="item">
                <span className="grow">
                  <strong>{v.title}</strong> <span className="meta">{v.languages.join(", ")} · {v.author ?? ""}</span>
                  <br /><span className="meta mono">{v.id}</span>
                </span>
                <button className="btn small" disabled={busy} onClick={() => test("en", v.id)}>▶</button>
                <button className="btn small" onClick={() => save({ voice_reference_en: v.id })}>Use</button>
              </li>
            ))}
          </ul>
        </details>
      </section>

      <section>
        <h3>Privacy</h3>
        <div className="row">
          <button className="btn danger small" onClick={async () => {
            if (window.confirm("Erase all conversation history?")) {
              const r = await api.eraseConversations();
              setStatus(`Erased ${r.deleted} conversations`);
            }
          }}>Erase conversation history</button>
          <button className="btn small" onClick={onLogout}>{t.logout}</button>
        </div>
      </section>
      {status && <p className="status small" role="status" dir="auto">{status}</p>}
    </div>
  );
}

function RefField({ label, value, placeholder, onSave }: {
  label: string; value: string; placeholder: string; onSave: (v: string) => void;
}) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  return (
    <form className="stack" onSubmit={(e) => { e.preventDefault(); onSave(v.trim()); }}>
      <label>{label}
        <div className="row">
          <input className="mono" value={v} onChange={(e) => setV(e.target.value)} placeholder={placeholder} dir="ltr"
            pattern="[A-Za-z0-9_\-]*" maxLength={64} spellCheck={false} />
          <button className="btn small" type="submit">Save</button>
        </div>
      </label>
    </form>
  );
}

function TimezoneField({ value, onSave }: { value: string; onSave: (tz: string) => void }) {
  const [v, setV] = useState(value);
  return (
    <form className="row" onSubmit={(e) => { e.preventDefault(); onSave(v.trim()); }}>
      <label className="grow">Timezone <input value={v} onChange={(e) => setV(e.target.value)} dir="ltr" /></label>
      <button className="btn small" type="submit">Save</button>
    </form>
  );
}
