import { useEffect, useRef, type ReactNode } from "react";

interface Props {
  title: string;
  closeLabel: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}

/** Accessible side sheet (bottom sheet on phones). Esc closes, focus moves in and is restored on close. */
export function Drawer({ title, closeLabel, onClose, children, wide }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      prev?.focus?.();
    };
  }, [onClose]);

  return (
    <div className="drawer-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} className={`drawer glass${wide ? " wide" : ""}`} role="dialog" aria-modal="true" aria-label={title}
        tabIndex={-1}>
        <header className="drawer-head">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label={closeLabel}>✕</button>
        </header>
        <div className="drawer-body">{children}</div>
      </div>
    </div>
  );
}
