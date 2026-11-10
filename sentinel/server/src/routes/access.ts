import { writeFileSync } from 'node:fs';
import os from 'node:os';
import type { FastifyInstance } from 'fastify';
import QRCode from 'qrcode';
import { ACCESS_FILE, config, isLoopback, type AccessFile } from '../config.js';
import { hashPassword } from '../security/auth.js';
import { readFileSync } from 'node:fs';

const isLoopbackIp = (ip: string) => ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';

function readAccess(): AccessFile {
  try {
    return JSON.parse(readFileSync(ACCESS_FILE, 'utf8')) as AccessFile;
  } catch {
    return {};
  }
}

/** Tailscale assigns addresses in 100.64.0.0/10 (CGNAT range). */
export function isTailscaleIp(ip: string): boolean {
  const [a, b] = ip.split('.').map(Number);
  return a === 100 && b >= 64 && b <= 127;
}

function addresses() {
  const lan: string[] = [];
  const tailscale: string[] = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list ?? []) {
      if (a.family !== 'IPv4' || a.internal) continue;
      (isTailscaleIp(a.address) ? tailscale : lan).push(a.address);
    }
  }
  return { lan, tailscale };
}

export function registerAccessRoutes(app: FastifyInstance, opts: { restart?: () => void }) {
  const urlsFor = (port: number) => {
    const { lan, tailscale } = addresses();
    return { lan: lan.map((ip) => `http://${ip}:${port}`), tailscale: tailscale.map((ip) => `http://${ip}:${port}`) };
  };

  app.get('/api/access', async (req) => {
    const file = readAccess();
    const running = !isLoopback(config.host);
    const port = (app.server.address() as { port?: number } | null)?.port ?? config.port;
    return {
      running, // dashboard currently reachable from the network
      configured: !!file.lanEnabled && !!file.passwordHash,
      hasPassword: !!file.passwordHash || !!config.password,
      fromEnv: config.accessFromEnv,
      restartRequired: !config.accessFromEnv && running !== (!!file.lanEnabled && !!file.passwordHash),
      canRestart: !!opts.restart,
      fromThisComputer: isLoopbackIp(req.ip),
      webrtc: config.go2rtc.webrtc,
      urls: urlsFor(port),
    };
  });

  app.put<{ Body: { lanEnabled?: unknown; password?: unknown } }>('/api/access', async (req, reply) => {
    if (!isLoopbackIp(req.ip)) return reply.code(403).send({ error: 'אפשר לשנות רק מהמחשב שמריץ את SENTINEL' });
    if (config.accessFromEnv) return reply.code(409).send({ error: 'הגישה מוגדרת בקובץ ההגדרות המתקדמות (SENTINEL_HOST / SENTINEL_PASSWORD)' });
    const cur = readAccess();
    const lanEnabled = req.body?.lanEnabled === true;
    const pw = typeof req.body?.password === 'string' ? req.body.password : '';
    if (pw && pw.length < 10) return reply.code(400).send({ error: 'הסיסמה חייבת להכיל לפחות 10 תווים' });
    const next: AccessFile = { lanEnabled, passwordHash: pw ? hashPassword(pw) : cur.passwordHash };
    if (lanEnabled && !next.passwordHash) return reply.code(400).send({ error: 'צריך סיסמה כדי לפתוח גישה מהרשת' });
    writeFileSync(ACCESS_FILE, JSON.stringify(next, null, 2), { mode: 0o600 });
    return { ok: true, restartRequired: true };
  });

  app.get<{ Querystring: { url?: string } }>('/api/access/qr', async (req, reply) => {
    const port = (app.server.address() as { port?: number } | null)?.port ?? config.port;
    const { lan, tailscale } = urlsFor(port);
    const url = String(req.query.url ?? '');
    if (![...lan, ...tailscale].includes(url)) return reply.code(400).send({ error: 'unknown url' });
    const svg = await QRCode.toString(url, { type: 'svg', margin: 1, color: { dark: '#000000', light: '#ffffff' } });
    return reply.type('image/svg+xml').header('Cache-Control', 'no-store').send(svg);
  });

  app.post('/api/system/restart', async (req, reply) => {
    if (!isLoopbackIp(req.ip)) return reply.code(403).send({ error: 'אפשר רק מהמחשב שמריץ את SENTINEL' });
    if (!opts.restart) return reply.code(501).send({ error: 'הפעל מחדש את SENTINEL ידנית' });
    setTimeout(() => opts.restart!(), 300);
    return { ok: true };
  });
}
