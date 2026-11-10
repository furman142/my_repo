import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const here = path.dirname(fileURLToPath(import.meta.url));
/** sentinel/ project root (works from src/ via tsx and from dist/ via node). */
export const ROOT = path.resolve(here, '..', '..');

// The desktop app points these at its per-user folder (see desktop/main.mjs).
const ENV_FILE = process.env.SENTINEL_ENV_FILE || path.join(ROOT, '.env');
dotenv.config({ path: ENV_FILE, quiet: true } as dotenv.DotenvConfigOptions);

function int(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  if (!Number.isInteger(n) || n < 1 || n > 65535) throw new Error(`${name} must be a port number`);
  return n;
}

function bool(name: string, fallback: boolean): boolean {
  const raw = process.env[name]?.trim().toLowerCase();
  if (!raw) return fallback;
  return raw === '1' || raw === 'true' || raw === 'yes';
}

export function isLoopback(host: string): boolean {
  return host === '127.0.0.1' || host === '::1' || host === 'localhost';
}

const host = process.env.SENTINEL_HOST?.trim() || '127.0.0.1';
const password = process.env.SENTINEL_PASSWORD ?? '';

if (!isLoopback(host) && password.length < 10) {
  // Refuse to expose live home cameras to the network without a real password.
  throw new Error(
    `SENTINEL_HOST=${host} exposes the dashboard to your network. ` +
      `Set SENTINEL_PASSWORD (at least 10 characters) in ${ENV_FILE} first.`,
  );
}

const binName = process.platform === 'win32' ? 'go2rtc.exe' : 'go2rtc';

export const config = {
  host,
  port: int('SENTINEL_PORT', 8080),
  password,
  /** Login is required whenever a password is configured. */
  loginRequired: password.length > 0,
  extraAllowedHosts: (process.env.SENTINEL_ALLOWED_HOSTS ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean),
  envFile: ENV_FILE,
  dataDir: process.env.SENTINEL_DATA_DIR || path.join(ROOT, 'data'),
  webDist: process.env.SENTINEL_WEB_DIST || path.join(ROOT, 'web', 'dist'),
  go2rtc: {
    bin: process.env.GO2RTC_BIN || path.join(ROOT, 'bin', binName),
    apiPort: int('GO2RTC_API_PORT', 1984),
    webrtcPort: int('GO2RTC_WEBRTC_PORT', 8555),
    /**
     * WebRTC needs its own media port (TCP+UDP) on the network interface: browsers do not use
     * loopback ICE candidates. In localhost-only mode it is therefore OFF and the player uses MSE
     * over SENTINEL's authenticated WebSocket (no extra port). It is ON in LAN mode, because
     * iPhone Safari cannot play MSE and needs WebRTC.
     */
    webrtc: bool('GO2RTC_WEBRTC', !isLoopback(host)),
    /** Set to false to manage go2rtc yourself (e.g. Docker); SENTINEL then only connects to it. */
    manage: bool('GO2RTC_MANAGE', true),
  },
};

export const paths = {
  go2rtcConfig: path.join(config.dataDir, 'go2rtc.yaml'),
  secrets: path.join(config.dataDir, 'secrets.json'),
  settings: path.join(config.dataDir, 'settings.json'),
  snapshots: path.join(config.dataDir, 'snapshots'),
};

export function webDistExists(): boolean {
  return existsSync(path.join(config.webDist, 'index.html'));
}
