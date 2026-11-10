import {
  Activity,
  ArrowDown,
  Circle as RecIcon,
  ArrowUp,
  CheckCircle2,
  Circle,
  ExternalLink,
  FlaskConical,
  KeyRound,
  Loader2,
  LogOut,
  Plus,
  RefreshCw,
  Save,
  Search,
  ShieldCheck,
  Stethoscope,
  Trash2,
  XCircle,
} from 'lucide-react';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { NetDiagCard, isUdpTimeout } from '../components/NetDiagCard';
import { PhoneAccessCard } from '../components/PhoneAccessCard';
import { PageHeader } from '../components/PageHeader';
import { api } from '../lib/api';
import type { Camera, ProbeResult, RecordingStatus, Settings as SettingsT, SetupState, SystemStatus, XiaomiDevice } from '../lib/types';
import { cn, formatBytes, formatGb } from '../lib/util';

export function Settings({ status, refresh, loginRequired }: { status: SystemStatus; refresh: () => void; loginRequired: boolean }) {
  const [settings, setSettings] = useState<SettingsT | null>(null);
  const reload = useCallback(async () => {
    setSettings(await api<SettingsT>('/api/settings'));
    refresh();
  }, [refresh]);
  useEffect(() => {
    void reload();
  }, [reload]);

  return (
    <>
      <PageHeader title="הגדרות" subtitle="חיבור מצלמות, שמות, איכות ואבטחה. נשמר מקומית במחשב (sentinel/data)." />
      <div className="grid max-w-5xl gap-5">
        <SetupWizard onAdded={reload} />
        {settings && <CamerasEditor settings={settings} onSaved={reload} />}
        <NetDiagCard Card={Card} />
        {settings && <MotionCard settings={settings} onSaved={reload} />}
        {settings && <RecordingCard settings={settings} onSaved={reload} />}
        {settings && <Preferences settings={settings} onSaved={reload} />}
        <PhoneAccessCard Card={Card} />
        <SecurityCard status={status} loginRequired={loginRequired} />
      </div>
    </>
  );
}

// ------------------------------------------------------------------------------------------
function Card({ title, icon, children, aside }: { title: string; icon?: ReactNode; children: ReactNode; aside?: ReactNode }) {
  return (
    <section className="rounded-xl border border-ink-700 bg-ink-900">
      <header className="flex items-center gap-2.5 border-b border-ink-700 px-5 py-3.5">
        {icon}
        <h2 className="flex-1 font-semibold text-ink-100">{title}</h2>
        {aside}
      </header>
      <div className="p-5">{children}</div>
    </section>
  );
}

function Btn({
  children,
  onClick,
  disabled,
  variant = 'secondary',
  type = 'button',
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  variant?: 'primary' | 'secondary' | 'danger';
  type?: 'button' | 'submit';
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50',
        variant === 'primary' && 'bg-signal text-white hover:bg-blue-500',
        variant === 'secondary' && 'border border-ink-600 text-ink-200 hover:border-ink-400 hover:text-white',
        variant === 'danger' && 'border border-live/40 text-red-300 hover:bg-live/10',
      )}
    >
      {children}
    </button>
  );
}

/** Running inside the SENTINEL desktop app (Electron). */
const isDesktopApp = navigator.userAgent.includes('Electron');

const inputCls = 'rounded-lg border border-ink-600 bg-ink-850 px-3 py-1.5 text-sm text-ink-100 outline-none focus:border-signal';

// ------------------------------------------------------------------------------------------
function Step({ n, done, title, children }: { n: number; done: boolean; title: string; children: ReactNode }) {
  return (
    <li className="relative flex gap-4 pb-6 last:pb-0">
      <div className="flex flex-col items-center">
        {done ? <CheckCircle2 className="h-6 w-6 text-ok" /> : <Circle className="h-6 w-6 text-ink-500" />}
        <span className="mt-1 w-px flex-1 bg-ink-700" />
      </div>
      <div className="min-w-0 flex-1 pt-0.5">
        <h3 className="text-sm font-semibold text-ink-100">
          <span className="font-mono text-ink-400">{n}.</span> {title}
        </h3>
        <div className="mt-2 space-y-3 text-sm text-ink-300">{children}</div>
      </div>
    </li>
  );
}

function SetupWizard({ onAdded }: { onAdded: () => void }) {
  const [state, setState] = useState<SetupState | null>(null);
  const [creds, setCreds] = useState<{ url: string; username: string; password: string } | null>(null);
  const [region, setRegion] = useState('all');
  const [devices, setDevices] = useState<XiaomiDevice[] | null>(null);
  const [discoverErrors, setDiscoverErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setState(await api<SetupState>('/api/setup/state'));
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    void load();
    const t = window.setInterval(load, 5000); // picks up the Xiaomi login as soon as it completes
    return () => window.clearInterval(t);
  }, [load]);

  const showCreds = async () => {
    try {
      setCreds(await api('/api/setup/go2rtc-credentials'));
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const discover = async () => {
    setBusy(true);
    setError(null);
    setDevices(null);
    try {
      const r = await api<{ devices: XiaomiDevice[]; errors: string[] }>(`/api/setup/xiaomi/devices?region=${region}`);
      setDevices(r.devices);
      setDiscoverErrors(r.errors);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const go2rtcOk = state?.go2rtcState === 'running';
  const accountOk = (state?.xiaomiAccounts ?? 0) > 0;

  return (
    <Card title="חיבור מצלמות Xiaomi" icon={<KeyRound className="h-4 w-4 text-signal-glow" />} aside={<Btn onClick={load}><RefreshCw className="h-3.5 w-3.5" /></Btn>}>
      <ol>
        <Step n={1} done={go2rtcOk} title="שרת השידורים go2rtc">
          {go2rtcOk ? (
            <p>go2rtc פועל ומאזין רק על המחשב הזה (127.0.0.1), מוגן בסיסמה שנוצרה אוטומטית.</p>
          ) : (
            <p className="text-warn">
              go2rtc לא פועל ({state?.go2rtcState ?? '…'}). אם הקובץ חסר, הרץ בתיקיית sentinel: <code dir="ltr">npm run install:go2rtc</code> ואז הפעל מחדש את SENTINEL.
            </p>
          )}
        </Step>

        <Step n={2} done={accountOk} title="התחברות לחשבון Xiaomi — בממשק הרשמי של go2rtc">
          {accountOk ? (
            <p>חשבון Xiaomi מחובר ב-go2rtc ({state?.xiaomiAccounts}). הטוקן נשמר רק בקובץ <code dir="ltr">sentinel/data/go2rtc.yaml</code> שמוחרג מ-Git.</p>
          ) : (
            <>
              <p>
                SENTINEL לא מבקש ולא רואה את סיסמת Xiaomi שלך. ההתחברות מתבצעת בממשק של go2rtc עצמו, שמדבר ישירות עם השרתים של Xiaomi (כולל קוד אימות ו-captcha אם יידרשו).
              </p>
              <ol className="list-decimal space-y-1 ps-5 text-ink-300">
                {isDesktopApp ? (
                  <li>לחץ "פתח את go2rtc" למטה. בגרסת הדסקטופ go2rtc נפתח בחלון נפרד, מחובר אוטומטית.</li>
                ) : (
                  <li>פתח במחשב הזה את ממשק go2rtc (הכפתור למטה). הדפדפן יבקש שם משתמש וסיסמה של go2rtc — הצג אותם כאן.</li>
                )}
                <li>
                  בתפריט העליון בחר <b>Add</b>, ואז גלול ל-<b>Xiaomi</b>.
                </li>
                <li>בחר את האזור (Region) של החשבון שלך כפי שמוגדר באפליקציית Xiaomi Home, הזן משתמש וסיסמה של Xiaomi ולחץ Login.</li>
                <li>אם נשלח קוד אימות במייל/SMS או מוצג captcha — השלם אותו שם.</li>
                <li>חזור לכאן. השלב יסומן כמושלם אוטומטית תוך כמה שניות.</li>
              </ol>
              {state?.fromThisComputer ? (
                <div className="flex flex-wrap items-center gap-2">
                  <a href={state.go2rtcWebUi} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1.5 rounded-lg bg-signal px-3 py-1.5 text-sm text-white hover:bg-blue-500">
                    פתח את go2rtc <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                  {!isDesktopApp && (
                    <Btn onClick={showCreds}>
                      <KeyRound className="h-3.5 w-3.5" /> הצג פרטי כניסה ל-go2rtc
                    </Btn>
                  )}
                </div>
              ) : (
                <p className="text-warn">השלב הזה אפשרי רק מהמחשב שמריץ את SENTINEL (go2rtc לא נגיש מהרשת, בכוונה).</p>
              )}
              {creds && (
                <div className="grid gap-1 rounded-lg border border-ink-600 bg-ink-850 p-3 font-mono text-xs text-ink-100" dir="ltr">
                  <div>URL: {creds.url}</div>
                  <div>user: {creds.username}</div>
                  <div>password: {creds.password}</div>
                </div>
              )}
            </>
          )}
        </Step>

        <Step n={3} done={(state?.cameras ?? 0) > 0} title="איתור המצלמות בחשבון והוספתן">
          <div className="flex flex-wrap items-center gap-2">
            <select value={region} onChange={(e) => setRegion(e.target.value)} className={inputCls} aria-label="אזור שרת Xiaomi">
              <option value="all">כל האזורים</option>
              <option value="de">Europe (de)</option>
              <option value="cn">China (cn)</option>
              <option value="sg">Singapore (sg)</option>
              <option value="us">United States (us)</option>
              <option value="i2">India (i2)</option>
              <option value="ru">Russia (ru)</option>
            </select>
            <Btn variant="primary" onClick={discover} disabled={!accountOk || busy}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />} חפש מצלמות
            </Btn>
          </div>
          {error && <p className="text-red-300">{error}</p>}
          {discoverErrors.length > 0 && (
            <p className="font-mono text-xs text-warn" dir="ltr">
              {discoverErrors.join(' | ')}
            </p>
          )}
          {devices && devices.length === 0 && <p className="text-warn">לא נמצאו מצלמות באזור שנבחר.</p>}
          {devices && devices.length > 0 && (
            <div className="space-y-3">
              {devices.map((d) => (
                <DeviceRow key={d.source} device={d} onAdded={() => { onAdded(); void discover(); }} />
              ))}
            </div>
          )}
        </Step>
      </ol>
    </Card>
  );
}

function DeviceRow({ device, onAdded }: { device: XiaomiDevice; onAdded: () => void }) {
  const guessOutdoor = /outdoor|cw\d|aw\d|חיצונ/i.test(device.name + device.product);
  const [name, setName] = useState(device.name);
  const [location, setLocation] = useState<'indoor' | 'outdoor'>(guessOutdoor ? 'outdoor' : 'indoor');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const add = async () => {
    setBusy(true);
    setError(null);
    try {
      await api('/api/setup/cameras', { method: 'POST', json: { source: device.source, name, location } });
      onAdded();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-lg border border-ink-700 bg-ink-850 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium text-ink-100">{device.name}</span>
        <code className="rounded bg-ink-800 px-1.5 py-0.5 text-[11px] text-ink-300" dir="ltr">
          {device.model}
        </code>
        <span className="font-mono text-[11px] text-ink-400" dir="ltr">
          {device.ip} · {device.region}
        </span>
        {device.compat === 'confirmed' ? (
          <span className="rounded border border-ok/40 px-1.5 text-[11px] text-ok">נתמך ומאומת ב-go2rtc</span>
        ) : (
          <span className="rounded border border-warn/40 px-1.5 text-[11px] text-warn">לא מאומת — נדרשת בדיקה</span>
        )}
      </div>
      <p className="mt-1.5 text-xs text-ink-400">{device.compatNote}</p>
      {device.added ? (
        <p className="mt-2 text-xs text-ok">כבר נוספה ל-SENTINEL.</p>
      ) : (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} className={cn(inputCls, 'w-48')} aria-label="שם תצוגה" />
          <select value={location} onChange={(e) => setLocation(e.target.value as 'indoor' | 'outdoor')} className={inputCls} aria-label="מיקום">
            <option value="indoor">פנימית</option>
            <option value="outdoor">חיצונית</option>
          </select>
          <Btn variant="primary" onClick={add} disabled={busy || !name.trim()}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} הוסף
          </Btn>
        </div>
      )}
      {error && <p className="mt-2 text-xs text-red-300">{error}</p>}
    </div>
  );
}

// ------------------------------------------------------------------------------------------
function CamerasEditor({ settings, onSaved }: { settings: SettingsT; onSaved: () => void }) {
  const [rows, setRows] = useState<Camera[]>(settings.cameras);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [probes, setProbes] = useState<Record<string, ProbeResult | 'running'>>({});
  useEffect(() => setRows(settings.cameras), [settings.cameras]);

  const dirty = JSON.stringify(rows) !== JSON.stringify(settings.cameras);
  const update = (i: number, patch: Partial<Camera>) => setRows((r) => r.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  const move = (i: number, d: -1 | 1) =>
    setRows((r) => {
      const n = [...r];
      const j = i + d;
      if (j < 0 || j >= n.length) return r;
      [n[i], n[j]] = [n[j], n[i]];
      return n;
    });

  const save = async () => {
    setSaving(true);
    setMsg(null);
    try {
      await api('/api/settings', {
        method: 'PUT',
        json: { cameras: rows.map(({ id, name, location, enabled, transport, record, motion, alerts }) => ({ id, name, location, enabled, transport, record, motion, alerts })) },
      });
      setMsg('נשמר');
      onSaved();
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const remove = async (c: Camera) => {
    if (!confirm(`להסיר את "${c.name}" מ-SENTINEL? (החשבון ב-Xiaomi לא משתנה)`)) return;
    await api(`/api/setup/cameras/${c.id}`, { method: 'DELETE' });
    onSaved();
  };

  const probe = async (c: Camera) => {
    setProbes((p) => ({ ...p, [c.id]: 'running' }));
    try {
      const r = await api<ProbeResult>(`/api/cameras/${c.id}/probe`, { method: 'POST' });
      setProbes((p) => ({ ...p, [c.id]: r }));
    } catch (e) {
      setProbes((p) => ({ ...p, [c.id]: { stream: c.stream, ok: false, bytes: 0, fragments: 0, codec: null, width: null, height: null, elapsedMs: 0, error: (e as Error).message } }));
    }
  };

  return (
    <Card
      title="מצלמות"
      icon={<Stethoscope className="h-4 w-4 text-signal-glow" />}
      aside={
        <div className="flex items-center gap-2">
          {msg && <span className="text-xs text-ink-300">{msg}</span>}
          <Btn variant="primary" onClick={save} disabled={!dirty || saving}>
            <Save className="h-4 w-4" /> שמור
          </Btn>
        </div>
      }
    >
      {rows.length === 0 ? (
        <p className="text-sm text-ink-400">אין מצלמות. השתמש באשף למעלה.</p>
      ) : (
        <div className="space-y-3">
          {rows.map((c, i) => {
            const pr = probes[c.id];
            return (
              <div key={c.id} className="rounded-lg border border-ink-700 bg-ink-850 p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <div className="flex flex-col">
                    <button onClick={() => move(i, -1)} disabled={i === 0} className="text-ink-400 hover:text-white disabled:opacity-30" aria-label="הזז למעלה">
                      <ArrowUp className="h-3.5 w-3.5" />
                    </button>
                    <button onClick={() => move(i, 1)} disabled={i === rows.length - 1} className="text-ink-400 hover:text-white disabled:opacity-30" aria-label="הזז למטה">
                      <ArrowDown className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <input value={c.name} onChange={(e) => update(i, { name: e.target.value })} maxLength={40} className={cn(inputCls, 'w-52')} aria-label="שם תצוגה" />
                  <select value={c.location} onChange={(e) => update(i, { location: e.target.value as Camera['location'] })} className={inputCls} aria-label="מיקום">
                    <option value="indoor">פנימית</option>
                    <option value="outdoor">חיצונית</option>
                  </select>
                  <select
                    value={c.transport}
                    onChange={(e) => update(i, { transport: e.target.value as Camera['transport'] })}
                    className={inputCls}
                    aria-label="פרוטוקול חיבור"
                    title="TCP מתקן אובדן חבילות ב-Wi-Fi חלש. אם המצלמה לא תומכת — חזור לאוטומטי."
                  >
                    <option value="auto">חיבור: אוטומטי</option>
                    <option value="tcp">חיבור: TCP (יציב ב-Wi-Fi)</option>
                  </select>
                  <select
                    value={c.motion}
                    onChange={(e) => update(i, { motion: e.target.value as Camera['motion'] })}
                    className={inputCls}
                    aria-label="רגישות זיהוי תנועה"
                  >
                    <option value="off">תנועה: כבוי</option>
                    <option value="low">תנועה: רגישות נמוכה</option>
                    <option value="medium">תנועה: בינונית</option>
                    <option value="high">תנועה: גבוהה</option>
                  </select>
                  <label className="flex items-center gap-1.5 text-sm text-ink-300" title="התראה כשמתחילה תנועה">
                    <input type="checkbox" checked={c.alerts} onChange={(e) => update(i, { alerts: e.target.checked })} className="accent-amber-500" /> התראות
                  </label>
                  <label className="flex items-center gap-1.5 text-sm text-ink-300" title="כלול את המצלמה בהקלטה הרציפה">
                    <input type="checkbox" checked={c.record} onChange={(e) => update(i, { record: e.target.checked })} className="accent-red-500" /> מקליטה
                  </label>
                  <label className="flex items-center gap-1.5 text-sm text-ink-300">
                    <input type="checkbox" checked={c.enabled} onChange={(e) => update(i, { enabled: e.target.checked })} className="accent-blue-500" /> מוצגת
                  </label>
                  <code className="text-[11px] text-ink-400" dir="ltr">
                    {c.model}
                  </code>
                  <div className="flex-1" />
                  <Btn onClick={() => probe(c)} disabled={pr === 'running'}>
                    {pr === 'running' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Stethoscope className="h-4 w-4" />} בדיקת חיבור
                  </Btn>
                  <Btn variant="danger" onClick={() => remove(c)}>
                    <Trash2 className="h-4 w-4" />
                  </Btn>
                </div>
                {pr === 'running' && <p className="mt-2 text-xs text-ink-400">מושך 6 שניות של וידאו אמיתי דרך go2rtc… (עד ~40 שניות)</p>}
                {pr && pr !== 'running' && <ProbeView r={pr} />}
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}

function ProbeView({ r }: { r: ProbeResult }) {
  return (
    <div className={cn('mt-2 flex items-start gap-2 rounded-md border p-2.5 text-xs', r.ok ? 'border-ok/30 bg-ok/5' : 'border-live/30 bg-live/5')}>
      {r.ok ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-ok" /> : <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-live" />}
      <div className="space-y-0.5">
        <div className={r.ok ? 'text-ok' : 'text-red-300'}>{r.ok ? 'התקבל וידאו אמיתי מהמצלמה' : 'הבדיקה נכשלה — לא התקבל וידאו'}</div>
        <div className="font-mono text-ink-300" dir="ltr">
          {formatBytes(r.bytes)} · {r.fragments} fragments · {r.codec ?? 'codec ?'}
          {r.width ? ` · ${r.width}×${r.height}` : ''} · {(r.elapsedMs / 1000).toFixed(1)}s
        </div>
        {r.error && (
          <div className="break-all font-mono text-red-300/90" dir="ltr">
            {r.error}
          </div>
        )}
        {isUdpTimeout(r.error) && (
          <div className="text-warn">
            המצלמה לא ענתה ברשת המקומית. ברוב המקרים זו חומת האש של Windows או רשת שונה — הרץ "אבחון חיבור למצלמות" למטה.
          </div>
        )}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------------------------------
function Preferences({ settings, onSaved }: { settings: SettingsT; onSaved: () => void }) {
  const save = async (patch: Partial<Pick<SettingsT, 'defaultQuality' | 'demoMode'>>) => {
    await api('/api/settings', { method: 'PUT', json: patch });
    onSaved();
  };
  return (
    <Card title="העדפות תצוגה" icon={<FlaskConical className="h-4 w-4 text-signal-glow" />}>
      <div className="grid gap-5 md:grid-cols-2">
        <div>
          <div className="mb-1.5 text-sm text-ink-200">איכות ברירת מחדל</div>
          <select value={settings.defaultQuality} onChange={(e) => save({ defaultQuality: e.target.value as 'hd' | 'sd' })} className={inputCls}>
            <option value="hd">HD — איכות מלאה</option>
            <option value="sd">SD — רוחב פס נמוך</option>
          </select>
          <p className="mt-1.5 text-xs text-ink-400">ב-C200, go2rtc מגדיר HD כ-1080p ו-SD כ-360p. אפשר להחליף לכל מצלמה בנפרד בפקדי התצוגה.</p>
        </div>
        <div>
          <label className="flex items-center gap-2 text-sm text-ink-200">
            <input type="checkbox" checked={settings.demoMode} onChange={(e) => save({ demoMode: e.target.checked })} className="accent-amber-500" />
            מצב הדגמה (Demo)
          </label>
          <p className="mt-1.5 text-xs text-ink-400">
            מוסיף שתי תצוגות של תבנית בדיקה סינתטית (ffmpeg דרך go2rtc), מסומנות בבירור "DEMO · NOT A CAMERA". שימושי לבדיקת הממשק לפני שהמצלמות מחוברות. דורש ffmpeg מותקן.
          </p>
        </div>
      </div>
    </Card>
  );
}

function SecurityCard({ status, loginRequired }: { status: SystemStatus; loginRequired: boolean }) {
  const logout = async () => {
    await api('/api/auth/logout', { method: 'POST' });
    location.reload();
  };
  return (
    <Card title="אבטחה" icon={<ShieldCheck className="h-4 w-4 text-signal-glow" />} aside={loginRequired ? <Btn onClick={logout}><LogOut className="h-4 w-4" /> יציאה</Btn> : undefined}>
      <ul className="space-y-2 text-sm text-ink-300">
        <li>• go2rtc מאזין רק על 127.0.0.1 ודורש סיסמה גם מהמחשב עצמו. הדפדפן אף פעם לא מקבל את הסיסמה — SENTINEL מתווך.</li>
        <li>• שרתי RTSP/RTMP של go2rtc כבויים. במצב מקומי גם WebRTC כבוי (הווידאו עובר ב-MSE דרך SENTINEL בלבד). אין שרתי STUN ציבוריים — המדיה נשארת ברשת הביתית.</li>
        <li>• טוקן Xiaomi וסודות המערכת נשמרים רק בתיקייה <code dir="ltr">sentinel/data</code> (הרשאות לבעלים בלבד), שמוחרגת מ-Git.</li>
        <li>• לוגים עוברים סינון של מפתחות, טוקנים וכתובות Xiaomi.</li>
        <li>
          • כניסה עם סיסמה: <b className="text-ink-100">{loginRequired ? 'פעילה' : 'כבויה (גישה מהמחשב הזה בלבד)'}</b>. לגישה מהטלפון — ראה "גישה מהטלפון" למעלה. אין לפתוח פורטים בראוטר.
        </li>
        <li className="font-mono text-xs text-ink-400" dir="ltr">
          go2rtc {status.go2rtc.version ?? '?'} · {status.go2rtc.state}
          {status.go2rtc.managed ? ' · managed by SENTINEL' : ' · external'}
        </li>
      </ul>
    </Card>
  );
}

// ------------------------------------------------------------------------------------------
function RecordingCard({ settings, onSaved }: { settings: SettingsT; onSaved: () => void }) {
  const [st, setSt] = useState<RecordingStatus | null>(null);
  const [form, setForm] = useState(settings.recording);
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => setForm(settings.recording), [settings.recording]);

  const load = useCallback(async () => {
    try {
      setSt(await api<RecordingStatus>('/api/recordings/status'));
    } catch {
      /* ignore */
    }
  }, []);
  useEffect(() => {
    void load();
    const t = window.setInterval(load, 5000);
    return () => window.clearInterval(t);
  }, [load]);

  const save = async (patch: Partial<SettingsT['recording']>) => {
    setMsg(null);
    try {
      await api('/api/settings', { method: 'PUT', json: { recording: patch } });
      onSaved();
      void load();
      setMsg('נשמר');
    } catch (e) {
      setMsg((e as Error).message);
    }
  };
  const names: Record<string, string> = { sentinel_demo_1: 'DEMO 1', sentinel_demo_2: 'DEMO 2', ...Object.fromEntries(settings.cameras.map((c) => [c.id, c.name])) };
  const dirty = JSON.stringify(form) !== JSON.stringify(settings.recording);

  return (
    <Card
      title="הקלטה"
      icon={<RecIcon className="h-4 w-4 fill-live text-live" />}
      aside={msg ? <span className="text-xs text-ink-300">{msg}</span> : undefined}
    >
      <div className="grid gap-5 md:grid-cols-2">
        <div className="space-y-3">
          <label className="flex items-center gap-2 text-sm text-ink-100">
            <input type="checkbox" checked={settings.recording.enabled} onChange={(e) => save({ enabled: e.target.checked })} className="h-4 w-4 accent-red-500" />
            הקלטה רציפה למחשב
          </label>
          <div className="flex flex-wrap items-center gap-2 text-sm text-ink-200">
            מצב:
            <select value={settings.recording.mode} onChange={(e) => save({ mode: e.target.value as SettingsT['recording']['mode'] })} className={inputCls} aria-label="מצב הקלטה">
              <option value="continuous">רציף — 24/7</option>
              <option value="motion">רק כשיש תנועה (+30 שנ׳ אחרי)</option>
            </select>
          </div>
          {settings.recording.mode === 'motion' && (
            <p className={cn('text-xs', settings.motion.enabled ? 'text-ink-400' : 'text-warn')}>
              {settings.motion.enabled
                ? 'חוסך מקום רב. ההקלטה מתחילה כשמזוהה תנועה, ולכן 2–5 השניות הראשונות של האירוע עלולות לא להיכלל (זמן החיבור למצלמה).'
                : 'זיהוי התנועה כבוי — במצב הזה לא יוקלט כלום. הפעל את "זיהוי תנועה מקומי" למעלה.'}
            </p>
          )}
          <p className="text-xs text-ink-400">
            מקליט כל מצלמה שמסומנת "מקליטה" ברשימת המצלמות, גם כשהחלון סגור למגש. וידאו בלבד, בלי המרה: הקבצים נשמרים כפי ש-go2rtc מקבל אותם.
          </p>
          <div className="grid grid-cols-3 gap-2 text-xs text-ink-300">
            <label className="space-y-1">
              <span>שמירה (ימים)</span>
              <input type="number" min={1} max={365} value={form.retentionDays} onChange={(e) => setForm({ ...form, retentionDays: Number(e.target.value) })} className={cn(inputCls, 'w-full')} />
            </label>
            <label className="space-y-1">
              <span>מקסימום (GB)</span>
              <input type="number" min={1} max={10000} value={form.maxGb} onChange={(e) => setForm({ ...form, maxGb: Number(e.target.value) })} className={cn(inputCls, 'w-full')} />
            </label>
            <label className="space-y-1">
              <span>אורך קובץ</span>
              <select value={form.segmentMinutes} onChange={(e) => setForm({ ...form, segmentMinutes: Number(e.target.value) as SettingsT['recording']['segmentMinutes'] })} className={cn(inputCls, 'w-full')}>
                {[5, 10, 15, 30, 60].map((m) => (
                  <option key={m} value={m}>
                    {m} דק׳
                  </option>
                ))}
              </select>
            </label>
          </div>
          <Btn variant="primary" disabled={!dirty} onClick={() => save({ retentionDays: form.retentionDays, maxGb: form.maxGb, segmentMinutes: form.segmentMinutes })}>
            <Save className="h-4 w-4" /> שמור מגבלות
          </Btn>
          <p className="text-xs text-ink-400">
            הקלטות ישנות נמחקות אוטומטית לפי מספר הימים, וגם כשהנפח עובר את המקסימום (הישנות קודם). הערכה: מצלמת 1080p תופסת בערך 0.5–1 GB לשעה.
          </p>
        </div>
        <div className="space-y-2 text-sm">
          {st && (
            <>
              <div className="font-mono text-[11px] text-ink-400" dir="ltr">{st.dir}</div>
              <div className="text-ink-200">
                בשימוש: <b className="font-mono" dir="ltr">{formatGb(st.totalBytes)}</b> ({st.files} קבצים)
                {st.freeBytes !== null && (
                  <>
                    {' '}· פנוי בדיסק: <b className="font-mono" dir="ltr">{formatGb(st.freeBytes)}</b>
                  </>
                )}
              </div>
              {st.recorders.length === 0 ? (
                <p className="text-ink-400">אין מצלמות שמוקלטות כרגע.</p>
              ) : (
                <ul className="space-y-1.5">
                  {st.recorders.map((r) => (
                    <li key={r.cameraId} className="flex items-start gap-2">
                      <span className={cn('mt-1.5 h-2 w-2 shrink-0 rounded-full', r.state === 'recording' ? 'bg-live animate-pulseDot' : 'bg-warn')} />
                      <div className="min-w-0">
                        <div className="text-ink-100">
                          {names[r.cameraId] ?? r.cameraId} — {r.state === 'recording' ? 'מקליט' : 'ממתין למצלמה'}
                        </div>
                        {r.lastError && (
                          <div className="break-all font-mono text-[11px] text-red-300/90" dir="ltr">
                            {r.lastError}
                          </div>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>
      </div>
    </Card>
  );
}

// ------------------------------------------------------------------------------------------
function MotionCard({ settings, onSaved }: { settings: SettingsT; onSaved: () => void }) {
  const [st, setSt] = useState<{ enabled: boolean; detectors: Array<{ camera: string; state: string; lastError: string | null; active: unknown }> } | null>(null);
  const [days, setDays] = useState(settings.motion.retentionDays);
  useEffect(() => setDays(settings.motion.retentionDays), [settings.motion.retentionDays]);
  const load = useCallback(async () => {
    try {
      setSt(await api('/api/motion/status'));
    } catch {
      /* ignore */
    }
  }, []);
  useEffect(() => {
    void load();
    const t = window.setInterval(load, 4000);
    return () => window.clearInterval(t);
  }, [load]);
  const save = async (patch: Partial<SettingsT['motion']>) => {
    await api('/api/settings', { method: 'PUT', json: { motion: patch } });
    onSaved();
    void load();
  };
  const names: Record<string, string> = { sentinel_demo_1: 'DEMO 1', sentinel_demo_2: 'DEMO 2', ...Object.fromEntries(settings.cameras.map((c) => [c.id, c.name])) };

  return (
    <Card title="זיהוי תנועה והתראות" icon={<Activity className="h-4 w-4 text-warn" />}>
      <div className="grid gap-5 md:grid-cols-2">
        <div className="space-y-3 text-sm">
          <label className="flex items-center gap-2 text-ink-100">
            <input type="checkbox" checked={settings.motion.enabled} onChange={(e) => save({ enabled: e.target.checked })} className="h-4 w-4 accent-amber-500" />
            זיהוי תנועה מקומי
          </label>
          <p className="text-xs text-ink-400">
            SENTINEL מנתח את זרם ה-SD של כל מצלמה (2 פריימים בשנייה) ומשווה לרקע. שינויי תאורה, כמו מעבר לראיית לילה, מסוננים. בערך 1–3% מעבד לכל מצלמה. הרגישות נקבעת לכל מצלמה ברשימת המצלמות.
          </p>
          <label className="flex items-center gap-2 text-ink-100">
            <input type="checkbox" checked={settings.motion.notify} onChange={(e) => save({ notify: e.target.checked })} className="h-4 w-4 accent-amber-500" />
            התראות כשמתחילה תנועה (התראת מערכת באפליקציה, הודעה בממשק)
          </label>
          <div className="flex items-center gap-2 text-xs text-ink-300">
            שמירת אירועים
            <input type="number" min={1} max={365} value={days} onChange={(e) => setDays(Number(e.target.value))} className={cn(inputCls, 'w-20')} />
            ימים
            <Btn disabled={days === settings.motion.retentionDays} onClick={() => save({ retentionDays: days })}>
              <Save className="h-3.5 w-3.5" />
            </Btn>
          </div>
        </div>
        <div className="space-y-1.5 text-sm">
          {st && st.detectors.length === 0 && <p className="text-ink-400">{settings.motion.enabled ? 'אין מצלמות עם זיהוי תנועה פעיל.' : 'כבוי.'}</p>}
          {st?.detectors.map((d) => (
            <div key={d.camera} className="flex items-start gap-2">
              <span className={cn('mt-1.5 h-2 w-2 shrink-0 rounded-full', d.active ? 'bg-warn animate-pulseDot' : d.state === 'watching' ? 'bg-ok' : 'bg-ink-500')} />
              <div className="min-w-0">
                <div className="text-ink-100">
                  {names[d.camera] ?? d.camera} — {d.active ? 'תנועה עכשיו' : d.state === 'watching' ? 'צופה' : 'ממתין למצלמה'}
                </div>
                {d.lastError && (
                  <div className="break-all font-mono text-[11px] text-red-300/90" dir="ltr">
                    {d.lastError}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </Card>
  );
}
