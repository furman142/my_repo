import { useCallback, useEffect, useState, type FormEvent } from "react";
import { api, ApiError, type Task } from "../../lib/api";
import type { dictionaries } from "../../lib/i18n";

export function formatDue(task: Task, locale: string): string {
  if (!task.due_at) return "";
  const d = new Date(task.due_at);
  const opts: Intl.DateTimeFormatOptions = task.due_all_day
    ? { dateStyle: "medium", timeZone: task.timezone }
    : { dateStyle: "medium", timeStyle: "short", timeZone: task.timezone };
  return new Intl.DateTimeFormat(locale, opts).format(d);
}

export function TasksPanel({ t, locale }: { t: (typeof dictionaries)["en"]; locale: string }) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [title, setTitle] = useState("");
  const [due, setDue] = useState("");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => api.tasks().then((r) => setTasks(r.tasks), (e) => setError(String(e.message))), []);
  useEffect(() => void load(), [load]);

  async function add(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api.addTask(title, due.trim() || null);
      setTitle("");
      setDue("");
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed");
    }
  }

  async function act(fn: () => Promise<unknown>) {
    try {
      await fn();
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed");
    }
  }

  const open = tasks.filter((x) => x.status === "open");
  const done = tasks.filter((x) => x.status === "done");

  return (
    <div className="panel">
      <form className="stack" onSubmit={add}>
        <input aria-label={t.addTask} placeholder={t.addTask} value={title} onChange={(e) => setTitle(e.target.value)}
          required maxLength={200} dir="auto" />
        <input aria-label={t.due} placeholder={t.due} value={due} onChange={(e) => setDue(e.target.value)} dir="ltr"
          pattern="\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?" />
        <button className="btn primary" type="submit">{t.addTask}</button>
      </form>
      {error && <p className="error" role="alert">{error}</p>}
      {tasks.length === 0 && <p className="muted">{t.noTasks}</p>}
      <ul className="items">
        {[...open, ...done].map((task) => (
          <li key={task.id} className={`item ${task.status}`}>
            <label className="check">
              <input type="checkbox" checked={task.status === "done"}
                onChange={() => act(() => (task.status === "done" ? api.reopenTask(task.id) : api.completeTask(task.id)))} />
              <span dir="auto">{task.title}</span>
            </label>
            <span className="meta">
              {task.priority === "high" && <span className="pill amber">!</span>}
              {formatDue(task, locale)}
            </span>
            <button className="icon-btn" aria-label={`${t.del} ${task.title}`} onClick={() => act(() => api.deleteTask(task.id))}>
              ✕
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
