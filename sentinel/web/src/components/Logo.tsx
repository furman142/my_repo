export function Logo({ compact }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-2.5" dir="ltr">
      <svg viewBox="0 0 32 32" className="h-7 w-7 shrink-0" aria-hidden>
        <path d="M16 3 5 7.5v7.2C5 21.6 9.7 27 16 29c6.3-2 11-7.4 11-14.3V7.5L16 3Z" fill="none" stroke="#3b82f6" strokeWidth="2" strokeLinejoin="round" />
        <circle cx="16" cy="15.5" r="3.6" fill="#3b82f6" />
        <path d="M9.5 15.5h2.4M20.1 15.5h2.4" stroke="#60a5fa" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
      {!compact && (
        <div className="leading-none">
          <div className="font-mono text-[15px] font-bold tracking-[0.32em] text-ink-100">SENTINEL</div>
          <div className="mt-1 whitespace-nowrap text-[9px] font-medium uppercase tracking-[0.14em] text-ink-400">Security Command Center</div>
        </div>
      )}
    </div>
  );
}
