import { useEffect, useRef } from "react";
import type { ChatLine } from "./useAssistant";
import type { dictionaries } from "../../lib/i18n";

interface Props {
  lines: ChatLine[];
  t: (typeof dictionaries)["en"];
  onNew: () => void;
}

export function TranscriptPanel({ lines, t, onNew }: Props) {
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => end.current?.scrollIntoView({ block: "end" }), [lines]);
  return (
    <div className="transcript">
      <div className="row end"><button className="btn small" onClick={onNew}>+ New conversation</button></div>
      {lines.length === 0 && <p className="muted">—</p>}
      <ol className="lines" aria-live="polite">
        {lines.map((l) => (
          <li key={l.id} className={`line ${l.role}${l.ok === false ? " bad" : ""}`} dir="auto">
            {l.role === "tool" ? <span className="tool-chip">⚙ {l.text}</span> : l.text}
            {l.link && (
              <a className="btn small link-btn" href={l.link} target="_blank" rel="noopener noreferrer">
                {t.openLink} ↗
              </a>
            )}
          </li>
        ))}
      </ol>
      <div ref={end} />
    </div>
  );
}
