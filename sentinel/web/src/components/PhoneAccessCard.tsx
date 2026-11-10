import { Loader2, RotateCw, ShieldCheck, Smartphone } from 'lucide-react';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { api } from '../lib/api';
import { cn } from '../lib/util';

interface Access {
  running: boolean;
  configured: boolean;
  hasPassword: boolean;
  fromEnv: boolean;
  restartRequired: boolean;
  canRestart: boolean;
  fromThisComputer: boolean;
  webrtc: boolean;
  urls: { lan: string[]; tailscale: string[] };
}

type CardT = (p: { title: string; icon?: ReactNode; children: ReactNode; aside?: ReactNode }) => JSX.Element;
const inputCls = 'rounded-lg border border-ink-600 bg-ink-850 px-3 py-1.5 text-sm text-ink-100 outline-none focus:border-signal';

export function PhoneAccessCard({ Card }: { Card: CardT }) {
  const [a, setA] = useState<Access | null>(null);
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [qr, setQr] = useState<string | null>(null);
  const isWindows = navigator.userAgent.includes('Windows');

  const load = useCallback(async () => {
    try {
      const r = await api<Access>('/api/access');
      setA(r);
      setQr((q) => q ?? r.urls.tailscale[0] ?? r.urls.lan[0] ?? null);
    } catch (e) {
      setMsg((e as Error).message);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const save = async (lanEnabled: boolean) => {
    setMsg(null);
    if (pw && pw !== pw2) return setMsg('הסיסמאות לא זהות');
    setBusy(true);
    try {
      await api('/api/access', { method: 'PUT', json: { lanEnabled, ...(pw ? { password: pw } : {}) } });
      setPw('');
      setPw2('');
      await load();
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const restart = async () => {
    setBusy(true);
    try {
      await api('/api/system/restart', { method: 'POST' });
      setMsg('SENTINEL מופעל מחדש… הדף יתרענן.');
      setTimeout(() => location.reload(), 6000);
    } catch (e) {
      setMsg((e as Error).message);
      setBusy(false);
    }
  };

  const firewall = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const r = await api<{ ok: boolean; error?: string }>('/api/system/firewall/fix', { method: 'POST', json: { lan: true } });
      setMsg(r.ok ? 'חומת האש עודכנה.' : r.error === 'cancelled' ? 'בוטל באישור המנהל.' : 'הפעולה נכשלה.');
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (!a) return null;
  const allUrls = [...a.urls.tailscale, ...a.urls.lan];

  return (
    <Card title="גישה מהטלפון" icon={<Smartphone className="h-4 w-4 text-signal-glow" />}>
      <div className="grid gap-6 md:grid-cols-[1fr_auto]">
        <div className="space-y-3 text-sm">
          <div className="flex items-center gap-2">
            <span className={cn('h-2 w-2 rounded-full', a.running ? 'bg-ok' : 'bg-ink-500')} />
            <span className="text-ink-100">{a.running ? 'פתוח לרשת הביתית (עם סיסמה)' : 'סגור — רק המחשב הזה'}</span>
          </div>

          {a.fromEnv ? (
            <p className="text-xs text-warn">הגישה מוגדרת בקובץ ההגדרות המתקדמות (SENTINEL_HOST / SENTINEL_PASSWORD), ולכן אי אפשר לשנות אותה מכאן.</p>
          ) : !a.fromThisComputer ? (
            <p className="text-xs text-ink-400">שינוי הגישה אפשרי רק מהמחשב שמריץ את SENTINEL.</p>
          ) : (
            <>
              <p className="text-xs text-ink-400">
                כשפותחים גישה, הטלפון נכנס עם סיסמה דרך הרשת הביתית. המערכת לא נחשפת לאינטרנט, ו<b>אין לפתוח פורטים בראוטר</b>. במצב הזה WebRTC מופעל (פורט 8555), כי באייפון זו הדרך שבה הווידאו עובד.
              </p>
              <div className="grid max-w-md gap-2">
                <input type="password" autoComplete="new-password" placeholder={a.hasPassword ? 'סיסמה חדשה (השאר ריק כדי לא לשנות)' : 'סיסמה (לפחות 10 תווים)'} value={pw} onChange={(e) => setPw(e.target.value)} className={inputCls} />
                {pw && <input type="password" autoComplete="new-password" placeholder="אימות סיסמה" value={pw2} onChange={(e) => setPw2(e.target.value)} className={inputCls} />}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {!a.configured ? (
                  <button disabled={busy || (!a.hasPassword && pw.length < 10)} onClick={() => save(true)} className="inline-flex items-center gap-1.5 rounded-lg bg-signal px-3 py-1.5 text-white hover:bg-blue-500 disabled:opacity-50">
                    {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Smartphone className="h-4 w-4" />} אפשר גישה מהטלפון
                  </button>
                ) : (
                  <>
                    <button disabled={busy} onClick={() => save(false)} className="rounded-lg border border-ink-600 px-3 py-1.5 text-ink-200 hover:text-white">
                      סגור את הגישה
                    </button>
                    {pw && (
                      <button disabled={busy || pw.length < 10} onClick={() => save(true)} className="rounded-lg bg-signal px-3 py-1.5 text-white disabled:opacity-50">
                        עדכן סיסמה
                      </button>
                    )}
                  </>
                )}
                {a.restartRequired && (
                  <button disabled={busy || !a.canRestart} onClick={restart} className="inline-flex items-center gap-1.5 rounded-lg border border-warn/50 bg-warn/10 px-3 py-1.5 text-warn">
                    <RotateCw className="h-4 w-4" /> {a.canRestart ? 'הפעל מחדש כדי להחיל' : 'הפעל מחדש את SENTINEL כדי להחיל'}
                  </button>
                )}
                {a.running && isWindows && (
                  <button disabled={busy} onClick={firewall} className="inline-flex items-center gap-1.5 rounded-lg border border-ink-600 px-3 py-1.5 text-ink-200 hover:text-white">
                    <ShieldCheck className="h-4 w-4" /> אשר בחומת האש של Windows
                  </button>
                )}
              </div>
            </>
          )}
          {msg && <p className="text-sm text-ink-100">{msg}</p>}

          {a.running && (
            <div className="space-y-2 rounded-lg border border-ink-700 bg-ink-850 p-3 text-xs text-ink-300">
              <div className="font-medium text-ink-100">כתובות לטלפון</div>
              {allUrls.length === 0 && <div>לא נמצאה כתובת רשת.</div>}
              {allUrls.map((u) => (
                <button key={u} onClick={() => setQr(u)} className={cn('flex w-full items-center gap-2 rounded px-2 py-1 text-start', qr === u ? 'bg-signal-soft/40' : 'hover:bg-ink-800')}>
                  <span className="font-mono text-ink-100" dir="ltr">
                    {u}
                  </span>
                  <span className="text-ink-400">{a.urls.tailscale.includes(u) ? '· Tailscale — עובד גם מחוץ לבית' : '· רשת ביתית'}</span>
                </button>
              ))}
              <div className="pt-1 leading-relaxed">
                <b className="text-ink-100">בטלפון:</b> סרוק את ה-QR, היכנס עם הסיסמה, ובדפדפן בחר "הוסף למסך הבית" — SENTINEL ייפתח כמו אפליקציה.
                <br />
                <b className="text-ink-100">מחוץ לבית:</b> התקן את Tailscale (חינם לשימוש אישי) על המחשב ועל הטלפון באותו חשבון. כתובת Tailscale תופיע כאן ותעבוד מכל מקום דרך חיבור מוצפן — בלי לפתוח שום פורט בראוטר.
              </div>
            </div>
          )}
        </div>
        {a.running && qr && (
          <div className="flex flex-col items-center gap-2">
            <img src={`/api/access/qr?url=${encodeURIComponent(qr)}`} alt={`QR: ${qr}`} className="h-44 w-44 rounded-lg bg-white p-2" />
            <span className="font-mono text-[11px] text-ink-400" dir="ltr">
              {qr}
            </span>
          </div>
        )}
      </div>
    </Card>
  );
}
