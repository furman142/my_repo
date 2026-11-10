import { createHash, createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import os from 'node:os';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { config, isLoopback } from '../config.js';
import { loadSecrets } from './secrets.js';

export const SESSION_COOKIE = 'sentinel_session';
const SESSION_TTL_MS = 30 * 24 * 3600 * 1000;

/** Host names the dashboard answers to. Blocks DNS-rebinding attacks from web pages. */
export function allowedHostnames(): Set<string> {
  const hosts = new Set(['localhost', '127.0.0.1', '[::1]', '::1', ...config.extraAllowedHosts]);
  if (!isLoopback(config.host)) {
    hosts.add(os.hostname().toLowerCase());
    hosts.add(`${os.hostname().toLowerCase()}.local`);
    if (config.host !== '0.0.0.0' && config.host !== '::') hosts.add(config.host);
    for (const list of Object.values(os.networkInterfaces())) {
      for (const a of list ?? []) {
        if (a.internal) continue;
        hosts.add(a.family === 'IPv6' ? `[${a.address}]` : a.address);
      }
    }
  }
  return hosts;
}

export function hostnameOf(hostHeader: string | undefined): string {
  if (!hostHeader) return '';
  const h = hostHeader.toLowerCase();
  if (h.startsWith('[')) return h.slice(0, h.indexOf(']') + 1);
  return h.split(':')[0];
}

function sessionKey(): Buffer {
  // Changing SENTINEL_PASSWORD invalidates every existing session.
  return createHash('sha256').update(loadSecrets().cookieSecret).update('\0').update(config.password || config.passwordHash).digest();
}

export function issueSession(now = Date.now()): string {
  const exp = String(now + SESSION_TTL_MS);
  const sig = createHmac('sha256', sessionKey()).update(exp).digest('base64url');
  return `${exp}.${sig}`;
}

export function verifySession(value: string | undefined, now = Date.now()): boolean {
  if (!value) return false;
  const [exp, sig] = value.split('.');
  if (!exp || !sig || !/^\d+$/.test(exp) || Number(exp) < now) return false;
  const expected = createHmac('sha256', sessionKey()).update(exp).digest();
  const given = Buffer.from(sig, 'base64url');
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export function hashPassword(pw: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(pw, salt, 32, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export function verifyHash(pw: string, stored: string): boolean {
  const [kind, saltB64, hashB64] = stored.split('$');
  if (kind !== 'scrypt' || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, 'base64');
  const got = scryptSync(pw, Buffer.from(saltB64, 'base64'), expected.length, { N: 16384, r: 8, p: 1 });
  return timingSafeEqual(got, expected);
}

export function passwordMatches(candidate: string): boolean {
  if (config.password) {
    const a = createHash('sha256').update(candidate).digest();
    const b = createHash('sha256').update(config.password).digest();
    return timingSafeEqual(a, b);
  }
  if (config.passwordHash) return verifyHash(candidate, config.passwordHash);
  return false;
}

export function isAuthenticated(req: FastifyRequest): boolean {
  if (!config.loginRequired) return true;
  return verifySession(req.cookies?.[SESSION_COOKIE]);
}

/** Simple per-IP throttle for the login endpoint. */
const attempts = new Map<string, { count: number; until: number }>();
export function loginThrottled(ip: string): boolean {
  const a = attempts.get(ip);
  return !!a && a.count >= 5 && a.until > Date.now();
}
export function recordLoginFailure(ip: string) {
  const a = attempts.get(ip);
  const now = Date.now();
  if (!a || a.until < now) attempts.set(ip, { count: 1, until: now + 15 * 60_000 });
  else a.count++;
}
export function clearLoginFailures(ip: string) {
  attempts.delete(ip);
}

const PUBLIC_API = new Set(['/api/health', '/api/auth/login', '/api/auth/state']);

export function registerSecurity(app: FastifyInstance) {
  const hosts = allowedHostnames();

  app.addHook('onRequest', async (req: FastifyRequest, reply: FastifyReply) => {
    // 1. Host header allow-list (DNS rebinding).
    const hn = hostnameOf(req.headers.host);
    // Tailscale MagicDNS names only resolve inside your own tailnet.
    const tailnet = !isLoopback(config.host) && hn.endsWith('.ts.net');
    if (!hosts.has(hn) && !tailnet) {
      return reply.code(421).send({ error: 'host not allowed' });
    }

    // 2. Cross-site protection: state-changing requests and WebSocket upgrades must come
    //    from our own origin.
    const origin = req.headers.origin;
    const unsafe = req.method !== 'GET' && req.method !== 'HEAD';
    const upgrade = req.headers.upgrade?.toLowerCase() === 'websocket';
    if ((unsafe || upgrade) && origin) {
      let originHost = '';
      try {
        originHost = new URL(origin).host.toLowerCase();
      } catch {
        /* invalid */
      }
      if (originHost !== (req.headers.host ?? '').toLowerCase()) {
        return reply.code(403).send({ error: 'cross-origin request blocked' });
      }
    }

    // 3. Authentication for everything under /api except the login flow.
    const url = req.url.split('?')[0];
    if (url.startsWith('/api/') && !PUBLIC_API.has(url) && !isAuthenticated(req)) {
      return reply.code(401).send({ error: 'login required' });
    }
  });

  app.addHook('onSend', async (_req, reply, payload) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('X-Frame-Options', 'DENY');
    reply.header('Referrer-Policy', 'no-referrer');
    reply.header('Permissions-Policy', 'camera=(), microphone=(self), geolocation=()');
    reply.header(
      'Content-Security-Policy',
      "default-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; " +
        "connect-src 'self'; style-src 'self' 'unsafe-inline'; " +
        "font-src 'self'; script-src 'self'; frame-ancestors 'none'; base-uri 'none'",
    );
    return payload;
  });
}
