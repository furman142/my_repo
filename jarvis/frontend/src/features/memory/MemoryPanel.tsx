import { useCallback, useEffect, useState, type FormEvent } from "react";
import { api, ApiError, type Memory } from "../../lib/api";
import type { dictionaries } from "../../lib/i18n";

const CATEGORIES = ["general", "preference", "person", "project", "routine"];

export function MemoryPanel({ t }: { t: (typeof dictionaries)["en"] }) {
  const [items, setItems] = useState<Memory[]>([]);
  const [q, setQ] = useState("");
  const [content, setContent] = useState("");
  const [category, setCategory] = useState("general");
  const [editing, setEditing] = useState<{ id: number; text: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback((query = "") => api.memories(query).then((r) => setItems(r.memories),
    (e) => setError(String(e.message))), []);
  useEffect(() => void load(), [load]);

  async function run(fn: () => Promise<unknown>) {
    setError(null);
    try {
      await fn();
      await load(q);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed");
    }
  }

  function add(e: FormEvent) {
    e.preventDefault();
    void run(async () => {
      await api.addMemory(content, category);
      setContent("");
    });
  }

  return (
    <div className="panel">
      <form className="stack" onSubmit={add}>
        <textarea aria-label={t.addMemory} placeholder="e.g. My sister's name is Noa" value={content}
          onChange={(e) => setContent(e.target.value)} required minLength={2} maxLength={500} rows={2} dir="auto" />
        <div className="row">
          <select aria-label="Category" value={category} onChange={(e) => setCategory(e.target.value)}>
            {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
          </select>
          <button className="btn primary" type="submit">{t.addMemory}</button>
        </div>
      </form>
      <form className="row" onSubmit={(e) => { e.preventDefault(); void load(q); }} role="search">
        <input aria-label={t.search} placeholder={t.search} value={q} onChange={(e) => setQ(e.target.value)} dir="auto" />
        <button className="btn" type="submit">{t.search}</button>
      </form>
      {error && <p className="error" role="alert">{error}</p>}
      {items.length === 0 && <p className="muted">{t.noMemories}</p>}
      <ul className="items">
        {items.map((m) => (
          <li key={m.id} className={`item mem ${m.consent_state}`}>
            {editing?.id === m.id ? (
              <form className="row grow" onSubmit={(e) => {
                e.preventDefault();
                void run(async () => { await api.patchMemory(m.id, { content: editing.text }); setEditing(null); });
              }}>
                <input value={editing.text} onChange={(e) => setEditing({ id: m.id, text: e.target.value })} dir="auto"
                  aria-label={t.edit} minLength={2} maxLength={500} />
                <button className="btn small primary" type="submit">{t.save}</button>
              </form>
            ) : (
              <span className="grow" dir="auto">
                {m.consent_state === "proposed" && <span className="pill amber">{t.proposed}</span>} {m.content}
                <span className="meta"> · {m.category}</span>
              </span>
            )}
            {m.consent_state === "proposed" ? (
              <>
                <button className="btn small" onClick={() => run(() => api.patchMemory(m.id, { consent_state: "approved" }))}>
                  {t.confirm}
                </button>
                <button className="btn small" onClick={() => run(() => api.patchMemory(m.id, { consent_state: "rejected" }))}>
                  {t.reject}
                </button>
              </>
            ) : (
              <button className="btn small" onClick={() => setEditing({ id: m.id, text: m.content })}>{t.edit}</button>
            )}
            <button className="icon-btn" aria-label={`${t.del}: ${m.content}`} onClick={() => run(() => api.deleteMemory(m.id))}>
              ✕
            </button>
          </li>
        ))}
      </ul>
      <div className="row end">
        <button className="btn danger small" onClick={() => {
          if (window.confirm("Permanently erase ALL memories?")) void run(() => api.eraseMemories());
        }}>{t.eraseAll}</button>
      </div>
    </div>
  );
}
