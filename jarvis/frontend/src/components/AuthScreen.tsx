import { useState, type FormEvent } from "react";
import { api, ApiError, setCsrf, type AuthState } from "../lib/api";
import type { dictionaries } from "../lib/i18n";

interface Props {
  setupRequired: boolean;
  t: (typeof dictionaries)["en"];
  onAuthenticated: (s: AuthState) => void;
}

export function AuthScreen({ setupRequired, t, onAuthenticated }: Props) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (setupRequired && password !== confirm) {
      setError("Passwords do not match");
      return;
    }
    setBusy(true);
    try {
      const s = setupRequired ? await api.setup(username, password, code) : await api.login(username, password);
      setCsrf(s.csrf_token);
      onAuthenticated(s);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Server unreachable");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth">
      <form className="auth-card glass" onSubmit={submit} aria-labelledby="auth-title">
        <div className="brand brand-lg" aria-hidden="true">J.A.R.V.I.S.</div>
        <h1 id="auth-title">{setupRequired ? t.setup : t.login}</h1>
        {setupRequired && <p className="muted small">{t.setupHint}</p>}
        <label>
          {t.username}
          <input autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} required
            minLength={setupRequired ? 2 : 1} maxLength={40} autoCapitalize="none" spellCheck={false} />
        </label>
        <label>
          {t.password}
          <input type="password" autoComplete={setupRequired ? "new-password" : "current-password"} value={password}
            onChange={(e) => setPassword(e.target.value)} required minLength={setupRequired ? 10 : 1} />
        </label>
        {setupRequired && (
          <>
            <label>
              {t.confirmPassword}
              <input type="password" autoComplete="new-password" value={confirm}
                onChange={(e) => setConfirm(e.target.value)} required minLength={10} />
            </label>
            <label>
              {t.setupCode}
              <input value={code} onChange={(e) => setCode(e.target.value)} required autoCapitalize="characters"
                spellCheck={false} placeholder="XXXX-XXXX-XXXX" dir="ltr" />
            </label>
          </>
        )}
        {error && <p className="error" role="alert">{error}</p>}
        <button className="btn primary" type="submit" disabled={busy}>{setupRequired ? t.setup : t.login}</button>
      </form>
    </main>
  );
}
