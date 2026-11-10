import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { config } from '../config.js';
import { cameraStatuses } from '../cameras/service.js';
import { XIAOMI_REGIONS, modelInfo, parseXiaomiSource } from '../cameras/models.js';
import { probeStream } from '../cameras/probe.js';
import { applyStreams, readBaseSource } from '../cameras/streams.js';
import { recordings } from '../recordings/recorder.js';
import { motion } from '../motion/service.js';
import { fixWindowsFirewall, runNetDiag } from '../system/netdiag.js';
import { go2rtc, Go2rtcError } from '../go2rtc/client.js';
import { manager, webrtcEnabled } from '../go2rtc/manager.js';
import {
  SESSION_COOKIE,
  clearLoginFailures,
  isAuthenticated,
  issueSession,
  loginThrottled,
  passwordMatches,
  recordLoginFailure,
} from '../security/auth.js';
import { redact } from '../security/redact.js';
import { loadSecrets } from '../security/secrets.js';
import { CAMERA_ID, getSettings, saveSettings, type Camera } from '../settings/store.js';

const isLoopbackIp = (ip: string) => ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';

function errMsg(err: unknown): string {
  if (err instanceof Go2rtcError) return err.message;
  return redact(String((err as Error)?.message ?? err));
}

export function registerApiRoutes(app: FastifyInstance) {
  // ---------- health & auth ----------
  app.get('/api/health', async () => ({ ok: true }));

  app.get('/api/auth/state', async (req) => ({
    loginRequired: config.loginRequired,
    authenticated: isAuthenticated(req),
  }));

  app.post<{ Body: { password?: string } }>('/api/auth/login', async (req, reply) => {
    if (!config.loginRequired) return { ok: true };
    if (loginThrottled(req.ip)) return reply.code(429).send({ error: 'יותר מדי ניסיונות. נסה שוב בעוד 15 דקות.' });
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    if (!passwordMatches(password)) {
      recordLoginFailure(req.ip);
      return reply.code(401).send({ error: 'סיסמה שגויה' });
    }
    clearLoginFailures(req.ip);
    reply.setCookie(SESSION_COOKIE, issueSession(), {
      httpOnly: true,
      sameSite: 'strict',
      path: '/',
      secure: req.protocol === 'https',
      maxAge: 30 * 24 * 3600,
    });
    return { ok: true };
  });

  app.post('/api/auth/logout', async (_req, reply) => {
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  });

  // ---------- status ----------
  app.get('/api/status', async () => {
    const { go2rtcReachable, cameras } = await cameraStatuses();
    let version: string | null = null;
    if (go2rtcReachable) {
      try {
        version = (await go2rtc.info()).version ?? null;
      } catch {
        /* ignore */
      }
    }
    return {
      time: new Date().toISOString(),
      go2rtc: {
        state: go2rtcReachable ? 'running' : manager.state,
        managed: config.go2rtc.manage,
        version,
        lastExit: manager.lastExit,
      },
      /** Which browser transports the player may use. */
      transports: config.go2rtc.webrtc ? 'webrtc,mse,hls' : 'mse,hls',
      /** Two-way audio is switched on and go2rtc's WebRTC port is up. */
      talk: getSettings().talk.enabled && webrtcEnabled(),
      demoMode: getSettings().demoMode,
      recording: Object.fromEntries(recordings.status().map((r) => [r.cameraId, r.state])),
      motion: Object.fromEntries(motion.activeMotion().map((m) => [m.camera, m.start])),
      defaultQuality: getSettings().defaultQuality,
      cameras,
    };
  });

  // ---------- settings (names, order, quality, demo) ----------
  app.get('/api/settings', async () => getSettings());

  const settingsPatch = z.object({
    cameras: z
      .array(
        z.object({
          id: z.string().regex(CAMERA_ID),
          name: z.string().trim().min(1).max(40),
          location: z.enum(['indoor', 'outdoor']),
          enabled: z.boolean(),
          transport: z.enum(['auto', 'tcp']).optional(),
          record: z.boolean().optional(),
          motion: z.enum(['off', 'low', 'medium', 'high']).optional(),
          alerts: z.boolean().optional(),
        }),
      )
      .optional(),
    defaultQuality: z.enum(['hd', 'sd']).optional(),
    demoMode: z.boolean().optional(),
    recording: z
      .object({
        enabled: z.boolean().optional(),
        retentionDays: z.number().int().min(1).max(365).optional(),
        maxGb: z.number().min(1).max(10_000).optional(),
        segmentMinutes: z.union([z.literal(5), z.literal(10), z.literal(15), z.literal(30), z.literal(60)]).optional(),
        mode: z.enum(['continuous', 'motion']).optional(),
      })
      .optional(),
    talk: z.object({ enabled: z.boolean() }).optional(),
    motion: z
      .object({
        enabled: z.boolean().optional(),
        notify: z.boolean().optional(),
        retentionDays: z.number().int().min(1).max(365).optional(),
      })
      .optional(),
  });

  app.put('/api/settings', async (req, reply) => {
    const parsed = settingsPatch.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'הגדרות לא תקינות', details: parsed.error.issues });
    const cur = getSettings();
    const next = { ...cur };
    if (parsed.data.cameras) {
      // Only display fields are editable here; stream wiring comes from setup.
      const byId = new Map(cur.cameras.map((c) => [c.id, c]));
      const reordered: Camera[] = [];
      for (const patch of parsed.data.cameras) {
        const existing = byId.get(patch.id);
        if (!existing) return reply.code(400).send({ error: `מצלמה לא קיימת: ${patch.id}` });
        const transport = patch.transport ?? existing.transport;
        if (transport !== existing.transport) {
          const base = readBaseSource(existing.stream);
          if (!base) return reply.code(409).send({ error: `לא נמצא מקור go2rtc עבור ${existing.name}` });
          try {
            await applyStreams({ ...existing, transport }, base);
          } catch (err) {
            return reply.code(502).send({ error: `go2rtc דחה את השינוי: ${errMsg(err)}` });
          }
        }
        reordered.push({ ...existing, name: patch.name, location: patch.location, enabled: patch.enabled, transport, record: patch.record ?? existing.record, motion: patch.motion ?? existing.motion, alerts: patch.alerts ?? existing.alerts });
        byId.delete(patch.id);
      }
      next.cameras = [...reordered, ...byId.values()];
    }
    if (parsed.data.defaultQuality) next.defaultQuality = parsed.data.defaultQuality;
    if (parsed.data.demoMode !== undefined) next.demoMode = parsed.data.demoMode;
    if (parsed.data.recording) next.recording = { ...cur.recording, ...parsed.data.recording };
    if (parsed.data.motion) next.motion = { ...cur.motion, ...parsed.data.motion };
    const webrtcBefore = webrtcEnabled();
    if (parsed.data.talk) next.talk = parsed.data.talk;
    const saved = saveSettings(next);
    // Two-way audio toggles go2rtc's WebRTC listener: restart go2rtc (streams reconnect by themselves).
    if (webrtcEnabled() !== webrtcBefore) await manager.restart();
    recordings.reconcile();
    motion.reconcile();
    return saved;
  });

  // ---------- setup: Xiaomi discovery through go2rtc ----------
  app.get('/api/setup/state', async (req) => {
    let accounts: string[] = [];
    let reachable = false;
    try {
      accounts = (await go2rtc.xiaomiAccounts()) ?? [];
      reachable = true;
    } catch {
      /* go2rtc down */
    }
    return {
      go2rtcState: reachable ? 'running' : manager.state,
      go2rtcBinary: config.go2rtc.bin,
      xiaomiAccounts: accounts.length,
      go2rtcWebUi: `http://127.0.0.1:${config.go2rtc.apiPort}/`,
      fromThisComputer: isLoopbackIp(req.ip),
      cameras: getSettings().cameras.length,
    };
  });

  /** go2rtc WebUI credentials — only revealed to a browser on this very computer. */
  app.get('/api/setup/go2rtc-credentials', async (req, reply) => {
    if (!isLoopbackIp(req.ip)) return reply.code(403).send({ error: 'זמין רק מהמחשב שמריץ את SENTINEL' });
    const s = loadSecrets();
    return { url: `http://127.0.0.1:${config.go2rtc.apiPort}/`, username: s.go2rtcUser, password: s.go2rtcPassword };
  });

  app.get<{ Querystring: { region?: string } }>('/api/setup/xiaomi/devices', async (req, reply) => {
    const region = req.query.region ?? 'all';
    const regions = region === 'all' ? [...XIAOMI_REGIONS] : XIAOMI_REGIONS.filter((r) => r === region);
    if (!regions.length) return reply.code(400).send({ error: 'אזור לא תקין' });
    let accounts: string[];
    try {
      accounts = (await go2rtc.xiaomiAccounts()) ?? [];
    } catch (err) {
      return reply.code(502).send({ error: `go2rtc לא זמין: ${errMsg(err)}` });
    }
    if (!accounts.length) return reply.code(409).send({ error: 'אין עדיין חשבון Xiaomi מחובר ב-go2rtc' });

    const configured = getSettings().cameras;
    const devices: unknown[] = [];
    const errors: string[] = [];
    await Promise.all(
      accounts.flatMap((account) =>
        regions.map(async (r) => {
          try {
            const res = await go2rtc.xiaomiDevices(account, r);
            for (const s of res?.sources ?? []) {
              const p = parseXiaomiSource(s.url);
              if (!p) continue;
              const info = modelInfo(p.model);
              devices.push({
                name: s.name,
                region: r,
                ip: p.ip,
                model: p.model,
                product: info.product,
                compat: info.compat,
                compatNote: info.note,
                source: s.url,
                added: configured.some((c) => c.did === p.did),
              });
            }
          } catch (err) {
            // 404 "no sources" just means: no cameras in that region.
            if (!(err instanceof Go2rtcError && err.status === 404)) errors.push(`${r}: ${errMsg(err)}`);
          }
        }),
      ),
    );
    return { devices, errors };
  });

  const addCamera = z.object({
    source: z.string().max(300),
    name: z.string().trim().min(1).max(40),
    id: z.string().regex(CAMERA_ID).optional(),
    location: z.enum(['indoor', 'outdoor']).default('indoor'),
  });

  app.post('/api/setup/cameras', async (req, reply) => {
    const parsed = addCamera.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'נתונים לא תקינים' });
    const src = parseXiaomiSource(parsed.data.source);
    if (!src) return reply.code(400).send({ error: 'מקור לא תקין: מותרים רק מקורות xiaomi:// שהתקבלו מ-go2rtc' });

    const settings = getSettings();
    const id = parsed.data.id ?? uniqueId(parsed.data.location === 'outdoor' ? 'outdoor' : 'indoor', settings.cameras);
    if (settings.cameras.some((c) => c.id === id)) return reply.code(409).send({ error: 'מזהה המצלמה כבר קיים' });
    if (settings.cameras.some((c) => c.did === src.did)) return reply.code(409).send({ error: 'המצלמה הזו כבר נוספה' });
    const info = modelInfo(src.model);

    const camera: Camera = {
      id,
      name: parsed.data.name,
      model: src.model,
      did: src.did,
      product: info.product,
      location: parsed.data.location,
      stream: id,
      streamSd: `${id}_sd`,
      enabled: true,
      transport: 'auto',
      record: true,
      motion: 'medium',
      alerts: true,
    };
    try {
      await applyStreams(camera, parsed.data.source);
    } catch (err) {
      return reply.code(502).send({ error: `go2rtc דחה את המקור: ${errMsg(err)}` });
    }
    saveSettings({ ...settings, cameras: [...settings.cameras, camera] });
    recordings.reconcile();
    motion.reconcile();
    return camera;
  });

  app.delete<{ Params: { id: string } }>('/api/setup/cameras/:id', async (req, reply) => {
    const settings = getSettings();
    const cam = settings.cameras.find((c) => c.id === req.params.id);
    if (!cam) return reply.code(404).send({ error: 'לא נמצא' });
    for (const s of [cam.stream, cam.streamSd]) {
      if (!s) continue;
      try {
        await go2rtc.deleteStream(s);
      } catch {
        /* already gone */
      }
    }
    saveSettings({ ...settings, cameras: settings.cameras.filter((c) => c.id !== cam.id) });
    recordings.reconcile();
    motion.reconcile();
    return { ok: true };
  });

  // ---------- real connection test ----------
  app.post<{ Params: { id: string }; Querystring: { quality?: string } }>('/api/cameras/:id/probe', async (req, reply) => {
    const cam = getSettings().cameras.find((c) => c.id === req.params.id);
    const demo = getSettings().demoMode && req.params.id.startsWith('sentinel_demo_');
    if (!cam && !demo) return reply.code(404).send({ error: 'לא נמצא' });
    const stream = demo ? req.params.id : req.query.quality === 'sd' && cam!.streamSd ? cam!.streamSd : cam!.stream;
    return probeStream(stream);
  });

  // ---------- network diagnostics (camera P2P connection) ----------
  app.get('/api/system/netdiag', async (req, reply) => {
    if (!isLoopbackIp(req.ip)) return reply.code(403).send({ error: 'זמין רק מהמחשב שמריץ את SENTINEL' });
    return runNetDiag();
  });

  app.post<{ Body: { makePrivate?: unknown; lan?: unknown } }>('/api/system/firewall/fix', async (req, reply) => {
    if (!isLoopbackIp(req.ip)) return reply.code(403).send({ error: 'זמין רק מהמחשב שמריץ את SENTINEL' });
    if (process.platform !== 'win32') return reply.code(400).send({ error: 'Windows only' });
    // Only interfaces that Windows currently reports as Public may be switched to Private.
    const wanted = Array.isArray(req.body?.makePrivate) ? req.body.makePrivate.filter((x): x is string => typeof x === 'string') : [];
    let allowed: string[] = [];
    if (wanted.length) {
      const diag = await runNetDiag();
      const publicIfaces = new Set((diag.firewall?.profiles ?? []).filter((p) => p.category === 'Public').map((p) => p.iface));
      allowed = wanted.filter((w) => publicIfaces.has(w));
    }
    return fixWindowsFirewall(allowed, req.body?.lan === true);
  });

  app.post('/api/system/go2rtc/restart', async () => {
    await manager.restart();
    return { state: manager.state };
  });
}

function uniqueId(base: string, cams: Camera[]): string {
  if (!cams.some((c) => c.id === base)) return base;
  for (let i = 2; i < 100; i++) if (!cams.some((c) => c.id === `${base}${i}`)) return `${base}${i}`;
  return `${base}_${Date.now() % 100000}`;
}

