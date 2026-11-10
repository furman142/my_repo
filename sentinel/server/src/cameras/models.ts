/**
 * Compatibility knowledge, taken ONLY from go2rtc's own sources (v1.9.15):
 *  - pkg/xiaomi/miss/client.go names ModelC200 = "chuangmi.camera.046c04" and gives it a
 *    model-specific default quality (3 = 1080p).
 *  - The "Known Xiaomi cameras" list (github.com/AlexxIT/go2rtc/issues/1982) reports the
 *    C200 (2023, chuangmi.camera.046c04) as working: cs2+tcp, HEVC + Opus, 1920x1080 / 640x360.
 *  - The Xiaomi Outdoor Camera CW300 is NOT on that list (CW100, CW400, CW500, CW700S and AW300
 *    are). Its model id is not documented by go2rtc, so we never guess it: SENTINEL reads the
 *    real model id from your Xiaomi account during discovery.
 */
export type Compat = 'confirmed' | 'unverified';

export interface ModelInfo {
  product: string;
  compat: Compat;
  note: string;
}

const KNOWN: Record<string, ModelInfo> = {
  'chuangmi.camera.046c04': {
    product: 'Xiaomi Smart Camera C200',
    compat: 'confirmed',
    note: 'מאושר ברשימת המצלמות של go2rtc: פרוטוקול cs2+tcp, וידאו HEVC (H.265) ואודיו Opus, 1080p / 360p.',
  },
};

export function modelInfo(model: string): ModelInfo {
  return (
    KNOWN[model] ?? {
      product: '',
      compat: 'unverified',
      note:
        'הדגם לא מופיע ברשימת המצלמות המאושרות של go2rtc. לפי go2rtc, רוב המצלמות שיוצרו אחרי 2020 (פרוטוקול miss) עובדות — ' +
        'אבל רק בדיקת חיבור אמיתית תוכיח זאת.',
    }
  );
}

export const XIAOMI_REGIONS = ['cn', 'de', 'i2', 'ru', 'sg', 'us'] as const;
export type XiaomiRegion = (typeof XIAOMI_REGIONS)[number];

/**
 * Exactly the URL shape go2rtc's own device list produces:
 * xiaomi://<userId>:<region>@<ip>?did=<did>&model=<model>
 * Anything else (exec:, ffmpeg:, rtsp: ...) is rejected so the dashboard can never be used
 * to make go2rtc run arbitrary sources.
 */
export const XIAOMI_SOURCE =
  /^xiaomi:\/\/(\d{1,20}):(cn|de|i2|ru|sg|us)@((?:\d{1,3}\.){3}\d{1,3})\?did=([A-Za-z0-9._-]{1,40})&model=([a-z0-9._-]{3,64})$/;

export function parseXiaomiSource(src: string) {
  const m = XIAOMI_SOURCE.exec(src);
  if (!m) return null;
  return { account: m[1], region: m[2] as XiaomiRegion, ip: m[3], did: m[4], model: m[5] };
}
