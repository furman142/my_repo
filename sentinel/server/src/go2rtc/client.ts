import { config } from '../config.js';
import { redact } from '../security/redact.js';
import { loadSecrets } from '../security/secrets.js';

export const GO2RTC_BASE = () => `http://127.0.0.1:${config.go2rtc.apiPort}`;

export function go2rtcAuthHeader(): string {
  const s = loadSecrets();
  return 'Basic ' + Buffer.from(`${s.go2rtcUser}:${s.go2rtcPassword}`).toString('base64');
}

export class Go2rtcError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(redact(message));
  }
}

/** Shape of one producer in GET /api/streams. Only `url` exists while idle. */
export interface Go2rtcProducer {
  url?: string;
  id?: number;
  format_name?: string;
  protocol?: string;
  remote_addr?: string;
  medias?: string[];
  receivers?: Array<{ codec?: { codec_name?: string; codec_type?: string; level?: number; profile?: string }; packets?: number }>;
  bytes_recv?: number;
  user_agent?: string;
}

export interface Go2rtcStream {
  producers: Go2rtcProducer[] | null;
  consumers: unknown[] | null;
}

async function request(pathAndQuery: string, init: RequestInit = {}, timeoutMs = 8000): Promise<Response> {
  const res = await fetch(GO2RTC_BASE() + pathAndQuery, {
    ...init,
    headers: { Authorization: go2rtcAuthHeader(), ...(init.headers ?? {}) },
    signal: init.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs),
  });
  return res;
}

async function json<T>(pathAndQuery: string, init?: RequestInit, timeoutMs?: number): Promise<T> {
  const res = await request(pathAndQuery, init, timeoutMs);
  const text = await res.text();
  if (!res.ok) throw new Go2rtcError(text || res.statusText, res.status);
  return (text ? JSON.parse(text) : null) as T;
}

export const go2rtc = {
  async ping(): Promise<boolean> {
    try {
      const res = await request('/api', {}, 1500);
      return res.ok;
    } catch {
      return false;
    }
  },

  info: () => json<{ version?: string; config_path?: string }>('/api'),

  streams: () => json<Record<string, Go2rtcStream>>('/api/streams'),

  /** Persists to data/go2rtc.yaml (go2rtc PatchConfig). */
  async putStream(name: string, src: string): Promise<void> {
    const q = new URLSearchParams({ name, src });
    await json(`/api/streams?${q}`, { method: 'PUT' });
  },

  async deleteStream(name: string): Promise<void> {
    const q = new URLSearchParams({ src: name });
    await json(`/api/streams?${q}`, { method: 'DELETE' });
  },

  /** Xiaomi account IDs that have a token in go2rtc.yaml (added through the go2rtc WebUI). */
  xiaomiAccounts: () => json<string[] | null>('/api/xiaomi'),

  /** Camera list of one Xiaomi account in one cloud region (go2rtc asks the Xiaomi cloud). */
  xiaomiDevices: (account: string, region: string) =>
    json<{ sources?: Array<{ name: string; info?: string; url: string }> }>(
      `/api/xiaomi?${new URLSearchParams({ id: account, region })}`,
      undefined,
      20_000,
    ),

  /** Raw fetch for streaming endpoints (fMP4 verification, snapshots). */
  raw: request,
};
