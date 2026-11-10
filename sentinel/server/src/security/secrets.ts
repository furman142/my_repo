import { randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { config, paths } from '../config.js';

export interface Secrets {
  /** Basic-auth credentials protecting the go2rtc API / WebUI on 127.0.0.1. */
  go2rtcUser: string;
  go2rtcPassword: string;
  /** HMAC key for the dashboard session cookie. */
  cookieSecret: string;
}

/** Make sure data/ exists and is readable only by the current user. */
export function ensureDataDir(): void {
  mkdirSync(config.dataDir, { recursive: true });
  try {
    chmodSync(config.dataDir, 0o700);
  } catch {
    /* Windows: ACLs are inherited from the user profile */
  }
}

export function writePrivate(file: string, content: string): void {
  writeFileSync(file, content, { mode: 0o600 });
  try {
    chmodSync(file, 0o600);
  } catch {
    /* Windows */
  }
}

let cached: Secrets | null = null;

export function loadSecrets(): Secrets {
  if (cached) return cached;
  ensureDataDir();
  if (existsSync(paths.secrets)) {
    const parsed = JSON.parse(readFileSync(paths.secrets, 'utf8')) as Partial<Secrets>;
    if (parsed.go2rtcUser && parsed.go2rtcPassword && parsed.cookieSecret) {
      cached = parsed as Secrets;
      return cached;
    }
  }
  cached = {
    go2rtcUser: 'sentinel',
    go2rtcPassword: randomBytes(18).toString('base64url'),
    cookieSecret: randomBytes(32).toString('base64url'),
  };
  writePrivate(paths.secrets, JSON.stringify(cached, null, 2));
  return cached;
}
