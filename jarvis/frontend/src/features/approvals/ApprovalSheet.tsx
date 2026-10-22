import { useEffect, useRef, useState } from "react";
import type { PendingApproval } from "../chat/useAssistant";
import type { dictionaries } from "../../lib/i18n";

interface Props {
  approval: PendingApproval;
  t: (typeof dictionaries)["en"];
  onDecide: (approve: boolean) => void;
}

/** Prominent approval dialog. Nothing auto-approves: only an explicit click/tap on Approve does. */
export function ApprovalSheet({ approval, t, onDecide }: Props) {
  const denyRef = useRef<HTMLButtonElement>(null);
  const expires = new Date(approval.request.expires_at).getTime();
  const [left, setLeft] = useState(() => Math.max(0, Math.round((expires - Date.now()) / 1000)));

  useEffect(() => {
    denyRef.current?.focus(); // safe default focus
    const id = window.setInterval(() => setLeft(Math.max(0, Math.round((expires - Date.now()) / 1000))), 1000);
    return () => window.clearInterval(id);
  }, [expires]);

  const args = Object.entries(approval.request.arguments).filter(([, v]) => v !== null && v !== "");

  return (
    <div className="approval-backdrop">
      <section className="approval glass" role="alertdialog" aria-modal="true" aria-labelledby="appr-title"
        aria-describedby="appr-preview">
        <div className="approval-kicker">{t.approvalTitle} · {approval.title || approval.request.tool_name}</div>
        <h2 id="appr-title" className="sr-only">{t.approvalTitle}</h2>
        <p id="appr-preview" className="approval-preview" dir="auto">{approval.request.preview}</p>
        {args.length > 0 && (
          <dl className="approval-args">
            {args.map(([k, v]) => (
              <div key={k}><dt>{k}</dt><dd dir="auto">{typeof v === "string" ? v : JSON.stringify(v)}</dd></div>
            ))}
          </dl>
        )}
        <p className="muted small">{t.approvalNote}</p>
        <div className="approval-actions">
          <button ref={denyRef} className="btn" onClick={() => onDecide(false)}>{t.deny}</button>
          <button className="btn primary amber" onClick={() => onDecide(true)} disabled={left <= 0}>{t.approve}</button>
        </div>
        <div className="muted small" aria-live="polite">{left > 0 ? `${t.expiresIn} ${left}s` : "Expired"}</div>
      </section>
    </div>
  );
}
