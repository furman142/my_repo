import { CheckCircle2, HelpCircle, Loader2, Network, ShieldCheck, XCircle } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { api } from '../lib/api';

interface Diag {
  platform: string;
  go2rtcExe: string;
  local: Array<{ iface: string; address: string; netmask: string }>;
  cameras: Array<{ id: string; name: string; ip: string | null; sameSubnet: boolean | null; ping: boolean | null }>;
  firewall: null | {
    rules: Array<{ name: string; direction: string; action: string; enabled: boolean; profile: string }> | null;
    hasInboundAllow: boolean | null;
    hasInboundBlock: boolean | null;
    profiles: Array<{ name: string; category: string; iface: string }> | null;
  };
  findings: string[];
}

const FINDINGS: Record<string, { title: string; body: string }> = {
  'different-subnet': {
    title: 'המחשב והמצלמות ברשתות שונות',
    body: 'כתובות ה-IP של המצלמות לא נמצאות ברשת של המחשב. חבר את המחשב לאותה רשת Wi-Fi כמו המצלמות (לא רשת אורחים, לא נתב נוסף או VPN).',
  },
  'some-different-subnet': {
    title: 'חלק מהמצלמות ברשת אחרת',
    body: 'המצלמות המסומנות ב-✗ ברשת שונה מהמחשב. ייתכן שהן מחוברות לנתב או למגדל נוסף שיוצר רשת נפרדת.',
  },
  'no-ping': {
    title: 'אף מצלמה לא עונה לפינג',
    body: 'ייתכן שהמחשב לא רואה את המצלמות ברשת (בידוד לקוחות או רשת אורחים), או שכתובת ה-IP שהתקבלה מ-Xiaomi לא עדכנית. חלק מהמצלמות פשוט לא עונות לפינג, אז זה לא חד-משמעי.',
  },
  'firewall-block': {
    title: 'חומת האש של Windows חוסמת את go2rtc',
    body: 'קיים כלל חסימה ל-go2rtc.exe — כנראה מחלון "חומת האש חסמה תכונות" שנסגר. זה בדיוק מה שגורם ל-"read udp … i/o timeout".',
  },
  'firewall-no-allow': {
    title: 'ל-go2rtc אין אישור בחומת האש',
    body: 'המצלמה עונה מפורט אחר מזה שאליו go2rtc שלח, ולכן חומת האש של Windows זורקת את התשובה. זו הסיבה הסבירה ל-"read udp … i/o timeout".',
  },
  'network-public': {
    title: 'הרשת מוגדרת "ציבורית"',
    body: 'ברשת ציבורית Windows חוסם תקשורת עם מכשירים ברשת. רשת ביתית צריכה להיות מוגדרת "פרטית".',
  },
  'no-network': { title: 'אין חיבור רשת', body: 'לא נמצאה כתובת IPv4 במחשב.' },
};

function Mark({ v }: { v: boolean | null }) {
  if (v === true) return <CheckCircle2 className="h-4 w-4 text-ok" aria-label="כן" />;
  if (v === false) return <XCircle className="h-4 w-4 text-live" aria-label="לא" />;
  return <HelpCircle className="h-4 w-4 text-ink-400" aria-label="לא ידוע" />;
}

export function NetDiagCard({ Card }: { Card: (p: { title: string; icon?: ReactNode; children: ReactNode; aside?: ReactNode }) => JSX.Element }) {
  const [diag, setDiag] = useState<Diag | null>(null);
  const [busy, setBusy] = useState(false);
  const [fixing, setFixing] = useState(false);
  const [fixMsg, setFixMsg] = useState<string | null>(null);
  const [makePrivate, setMakePrivate] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const runDiag = async () => {
    setBusy(true);
    setError(null);
    try {
      setDiag(await api<Diag>('/api/system/netdiag'));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const publicIfaces = diag?.firewall?.profiles?.filter((p) => p.category === 'Public').map((p) => p.iface) ?? [];
  // Windows sometimes refuses to let a normal user READ firewall rules: offer the fix anyway.
  const rulesUnknown = !!diag?.firewall && diag.firewall.rules === null;
  const needsFix =
    !!diag?.firewall &&
    (diag.findings.includes('firewall-block') || diag.findings.includes('firewall-no-allow') || publicIfaces.length > 0 || rulesUnknown);

  const fix = async () => {
    setFixing(true);
    setFixMsg(null);
    try {
      const r = await api<{ ok: boolean; error?: string }>('/api/system/firewall/fix', {
        method: 'POST',
        json: { makePrivate: makePrivate ? publicIfaces : [] },
      });
      setFixMsg(r.ok ? 'בוצע. עכשיו לחץ "בדיקת חיבור" שוב.' : r.error === 'cancelled' ? 'בוטל באישור המנהל של Windows.' : 'הפעולה נכשלה.');
      if (r.ok) await runDiag();
    } catch (e) {
      setFixMsg((e as Error).message);
    } finally {
      setFixing(false);
    }
  };

  return (
    <Card
      title="אבחון חיבור למצלמות"
      icon={<Network className="h-4 w-4 text-signal-glow" />}
      aside={
        <button onClick={runDiag} disabled={busy} className="inline-flex items-center gap-1.5 rounded-lg bg-signal px-3 py-1.5 text-sm text-white hover:bg-blue-500 disabled:opacity-50">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Network className="h-4 w-4" />} הרץ אבחון
        </button>
      }
    >
      {!diag && !error && (
        <p className="text-sm text-ink-400">
          בודק אם המחשב והמצלמות באותה רשת, אם המצלמות עונות, ואת הגדרות חומת האש של Windows עבור go2rtc. מומלץ כשמופיעה השגיאה <code dir="ltr">read udp … i/o timeout</code>.
        </p>
      )}
      {error && <p className="text-sm text-red-300">{error}</p>}
      {diag && (
        <div className="space-y-4 text-sm">
          {diag.findings.length === 0 ? (
            <p className="text-ok">לא נמצאה בעיה ברשת או בחומת האש.</p>
          ) : (
            <ul className="space-y-2">
              {diag.findings.map((f) => (
                <li key={f} className="rounded-lg border border-warn/30 bg-warn/5 p-3">
                  <div className="font-medium text-warn">{FINDINGS[f]?.title ?? f}</div>
                  <div className="mt-0.5 text-xs text-ink-300">{FINDINGS[f]?.body}</div>
                </li>
              ))}
            </ul>
          )}

          {needsFix && (
            <div className="rounded-lg border border-signal/40 bg-signal-soft/20 p-3">
              {rulesUnknown && (
                <p className="mb-2 text-xs text-ink-300">
                  Windows לא מאפשר לקרוא את כללי חומת האש בלי הרשאת מנהל, ולכן לא ידוע אם go2rtc מאושר. הכפתור יוודא שיש כלל נכון לנתיב הנוכחי של go2rtc. זה חשוב במיוחד אחרי עדכון, אם ההתקנה עברה לתיקייה אחרת.
                </p>
              )}
              <div className="flex flex-wrap items-center gap-3">
                <button onClick={fix} disabled={fixing} className="inline-flex items-center gap-1.5 rounded-lg bg-signal px-3 py-1.5 text-sm text-white hover:bg-blue-500 disabled:opacity-50">
                  {fixing ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />} תקן את חומת האש עבור go2rtc
                </button>
                {publicIfaces.length > 0 && (
                  <label className="flex items-center gap-1.5 text-xs text-ink-200">
                    <input type="checkbox" checked={makePrivate} onChange={(e) => setMakePrivate(e.target.checked)} className="accent-blue-500" />
                    וגם הגדר את הרשת <b dir="ltr">{publicIfaces.join(', ')}</b> כפרטית
                  </label>
                )}
              </div>
              <p className="mt-2 text-xs text-ink-400">
                Windows יבקש אישור מנהל. הפעולה מסירה כללי חסימה של go2rtc.exe ומוסיפה כלל שמאפשר תשובות UDP למצלמות — רק ברשת פרטית, ורק לתוכנה הזו. שום דבר לא נפתח לאינטרנט.
              </p>
              {fixMsg && <p className="mt-2 text-sm text-ink-100">{fixMsg}</p>}
            </div>
          )}

          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-ink-400">
                <tr className="text-start">
                  <th className="py-1 text-start font-normal">מצלמה</th>
                  <th className="py-1 text-start font-normal">IP</th>
                  <th className="py-1 text-start font-normal">אותה רשת</th>
                  <th className="py-1 text-start font-normal">פינג</th>
                </tr>
              </thead>
              <tbody>
                {diag.cameras.map((c) => (
                  <tr key={c.id} className="border-t border-ink-700">
                    <td className="py-1.5 text-ink-100">{c.name}</td>
                    <td className="py-1.5 text-right font-mono text-ink-300" dir="ltr">{c.ip ?? "?"}</td>
                    <td className="py-1.5"><Mark v={c.sameSubnet} /></td>
                    <td className="py-1.5"><Mark v={c.ping} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="grid gap-1 font-mono text-[11px] text-ink-400" dir="ltr">
            <div>go2rtc: {diag.go2rtcExe}</div>
            <div>this computer: {diag.local.map((l) => `${l.address}/${l.netmask} (${l.iface})`).join(' · ') || 'none'}</div>
            {diag.firewall && (
              <>
                <div>
                  network profile: {diag.firewall.profiles?.map((p) => `${p.name} [${p.iface}] = ${p.category}`).join(' · ') ?? 'unknown'}
                </div>
                <div>
                  go2rtc firewall rules:{' '}
                  {diag.firewall.rules === null
                    ? 'could not read'
                    : diag.firewall.rules.length === 0
                      ? 'none'
                      : diag.firewall.rules.map((r) => `${r.direction} ${r.action}${r.enabled ? '' : ' (disabled)'} [${r.profile}]`).join(' · ')}
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </Card>
  );
}

export const isUdpTimeout = (e?: string | null) => !!e && /read udp .*i\/o timeout/i.test(e);
