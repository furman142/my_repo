import { AlertTriangle } from 'lucide-react';
import { Component, type ReactNode } from 'react';

/** One broken player must never take down the whole command center. */
export class TileBoundary extends Component<{ name: string; children: ReactNode }, { error: string | null }> {
  state = { error: null as string | null };

  static getDerivedStateFromError(err: Error) {
    return { error: err.message };
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="flex aspect-video flex-col items-center justify-center gap-2 rounded-xl border border-live/40 bg-ink-900 p-6 text-center">
        <AlertTriangle className="h-6 w-6 text-live" />
        <p className="text-sm text-ink-100">{this.props.name}: שגיאה בנגן</p>
        <p className="font-mono text-xs text-ink-400" dir="ltr">{this.state.error}</p>
        <button onClick={() => this.setState({ error: null })} className="text-xs text-signal-glow underline">
          טען מחדש
        </button>
      </div>
    );
  }
}
