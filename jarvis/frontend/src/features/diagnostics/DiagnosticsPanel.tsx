import { useCallback, useEffect, useState } from "react";
import { api } from "../../lib/api";

type Diag = {
  version: string;
  components: Record<string, { state: string; detail: string; cloud?: boolean; provider?: string }>;
  config: Record<string, unknown>;
  system: Record<string, unknown> & { gpu?: { state: string; gpus?: Record<string, unknown>[]; reason?: string } };
  recent_tool_audit: { id: number; tool_name: string; outcome: string; detail: string | null; created_at: string;
    duration_ms: number | null }[];
};

const LABEL: Record<string, string> = { ready: "READY", not_configured: "NOT CONFIGURED", unavailable: "UNAVAILABLE" };

/** Honest self-check: every value shown here comes from the backend's real probes. */
export function DiagnosticsPanel({ onWarmup }: { onWarmup?: () => void }) {
  const [d, setD] = useState<Diag | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [warming, setWarming] = useState(false);
  const load = useCallback(() => api.diagnostics().then((x) => setD(x as unknown as Diag), (e) => setErr(String(e.message))), []);
  useEffect(() => void load(), [load]);

  if (err) return <p className="error">{err}</p>;
  if (!d) return <p className="muted">Running self-check…</p>;
  return (
    <div className="panel diag">
      <table className="kv">
        <tbody>
          {Object.entries(d.components).map(([k, v]) => (
            <tr key={k}>
              <th>{k.toUpperCase()}</th>
              <td><span className={`badge ${v.state}`}>{LABEL[v.state] ?? v.state}</span>{v.cloud ? " ☁" : ""}</td>
              <td className="small">{v.detail}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="row">
        <button className="btn small" onClick={() => void load()}>Re-run self-check</button>
        <button className="btn small" disabled={warming} onClick={async () => {
          setWarming(true);
          try {
            await api.warmupStt();
          } catch (e) {
            setErr(String((e as Error).message));
          } finally {
            setWarming(false);
            onWarmup?.();
            void load();
          }
        }}>{warming ? "Loading Whisper…" : "Load speech model now"}</button>
      </div>
      <h3>System (live)</h3>
      <pre className="mono small">{JSON.stringify(d.system, null, 2)}</pre>
      <h3>Configuration (non-secret)</h3>
      <pre className="mono small">{JSON.stringify(d.config, null, 2)}</pre>
      <h3>Recent tool audit</h3>
      <ul className="items small">
        {d.recent_tool_audit.map((a) => (
          <li key={a.id} className="item">
            <span className="mono">{a.created_at.slice(11, 19)}</span> {a.tool_name}
            <span className={`badge ${a.outcome === "ok" ? "ready" : "unavailable"}`}>{a.outcome}</span>
            <span className="meta">{a.detail ?? ""} {a.duration_ms ?? ""}ms</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
