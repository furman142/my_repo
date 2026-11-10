import { Bell } from 'lucide-react';
import { PageHeader } from '../components/PageHeader';

export function Events() {
  return (
    <>
      <PageHeader title="אירועים" subtitle="שלב 2 — אין עדיין מקור אירועים אמין" />
      <Notice icon={Bell} title="התראות תנועה יוצגו רק ממקור מאומת">
        <p>
          ל-go2rtc אין כרגע ערוץ אירועי תנועה של Xiaomi — הוא מעביר וידאו ואודיו בלבד. התראות התנועה של המצלמות מגיעות דרך ענן Xiaomi Home,
          ואין להן ממשק מקומי מתועד ש-SENTINEL יכול להסתמך עליו.
        </p>
        <p>
          האפשרויות לשלב 2: זיהוי תנועה מקומי על הווידאו עצמו (ניתוח פריימים במחשב), או אינטגרציה מתועדת אחרת אם תימצא.
          לא יוצגו כאן אירועים מומצאים.
        </p>
      </Notice>
    </>
  );
}

function Notice({ icon: Icon, title, children }: { icon: typeof Bell; title: string; children: React.ReactNode }) {
  return (
    <div className="max-w-3xl rounded-xl border border-ink-700 bg-ink-900 p-6">
      <div className="mb-3 flex items-center gap-3">
        <span className="rounded-lg border border-ink-600 bg-ink-800 p-2">
          <Icon className="h-5 w-5 text-signal-glow" />
        </span>
        <h2 className="font-semibold text-ink-100">{title}</h2>
      </div>
      <div className="space-y-3 text-sm leading-relaxed text-ink-300">{children}</div>
    </div>
  );
}
