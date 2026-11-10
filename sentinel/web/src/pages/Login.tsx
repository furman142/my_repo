import { Lock } from 'lucide-react';
import { useState } from 'react';
import { Logo } from '../components/Logo';
import { api } from '../lib/api';

export function Login({ onSuccess }: { onSuccess: () => void }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api('/api/auth/login', { method: 'POST', json: { password } });
      onSuccess();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <form onSubmit={submit} className="w-full max-w-sm rounded-2xl border border-ink-700 bg-ink-900 p-7">
        <div className="mb-6 flex justify-center">
          <Logo />
        </div>
        <label className="mb-1.5 block text-sm text-ink-300" htmlFor="pw">
          סיסמת גישה
        </label>
        <div className="relative">
          <Lock className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
          <input
            id="pw"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-lg border border-ink-600 bg-ink-850 py-2.5 pe-3 ps-9 text-ink-100 outline-none focus:border-signal"
            autoFocus
            required
          />
        </div>
        {error && <p className="mt-3 text-sm text-red-300">{error}</p>}
        <button disabled={busy} className="mt-5 w-full rounded-lg bg-signal py-2.5 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-60">
          {busy ? 'מתחבר…' : 'כניסה'}
        </button>
      </form>
    </div>
  );
}
