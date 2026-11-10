import cookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import websocket from '@fastify/websocket';
import Fastify from 'fastify';
import type { AddressInfo } from 'node:net';
import { config, isLoopback, webDistExists } from './config.js';
import { manager } from './go2rtc/manager.js';
import { registerApiRoutes } from './routes/api.js';
import { registerStreamRoutes } from './routes/stream.js';
import { registerRecordingRoutes } from './routes/recordings.js';
import { recordings } from './recordings/recorder.js';
import { registerEventRoutes, onAlert, type Alert } from './routes/events.js';
import { registerStatsRoutes } from './routes/stats.js';
import { registerAccessRoutes } from './routes/access.js';
import { motion } from './motion/service.js';
import { registerSecurity } from './security/auth.js';
import { redact } from './security/redact.js';
import { ensureDataDir, loadSecrets } from './security/secrets.js';
import { getSettings } from './settings/store.js';

export interface StartOptions {
  /** If the configured port is taken, listen on a free port instead of failing (desktop app). */
  fallbackToFreePort?: boolean;
  /** Pino log destination file (desktop app); stdout when omitted. */
  logFile?: string;
  /** Called when the user asks to restart (e.g. after changing phone access). */
  restart?: () => void;
}

export interface RunningServer {
  url: string;
  port: number;
  go2rtc: { url: string; username: string; password: string };
  /** Subscribe to motion alerts (desktop notifications). Returns an unsubscribe function. */
  onAlert: (fn: (a: Alert) => void) => () => void;
  stop: () => Promise<void>;
}

/** Start go2rtc (supervised) and the SENTINEL HTTP/WebSocket server. */
export async function startServer(opts: StartOptions = {}): Promise<RunningServer> {
  ensureDataDir();
  loadSecrets();
  getSettings();

  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? 'info',
      ...(opts.logFile ? { file: opts.logFile } : {}),
      // Never log headers/cookies; redact URLs (query strings may carry stream names only, but be safe).
      serializers: {
        req: (req) => ({ method: req.method, url: redact(req.url.split('?')[0]) }),
        res: (res) => ({ statusCode: res.statusCode }),
      },
    },
    trustProxy: false,
    bodyLimit: 64 * 1024,
  });
  manager.setLogger(app.log);

  await app.register(cookie);
  await app.register(websocket, { options: { maxPayload: 1024 * 1024 } });
  registerSecurity(app);
  registerApiRoutes(app);
  registerStreamRoutes(app);
  registerRecordingRoutes(app);
  registerEventRoutes(app);
  registerStatsRoutes(app);
  registerAccessRoutes(app, { restart: opts.restart });

  if (webDistExists()) {
    await app.register(fastifyStatic, { root: config.webDist, maxAge: '1h' });
    // SPA fallback
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api/') || req.url.startsWith('/assets/')) return reply.code(404).send({ error: 'not found' });
      return reply.header('Cache-Control', 'no-cache').sendFile('index.html');
    });
  } else {
    // reply.sendFile is still needed for recordings.
    await app.register(fastifyStatic, { root: config.dataDir, serve: false });
    app.get('/', async (_req, reply) =>
      reply.type('text/plain; charset=utf-8').send('SENTINEL: frontend not built. Run "npm run build" in sentinel/ (or use "npm run dev").'),
    );
  }


  await manager.start();
  try {
    await app.listen({ host: config.host, port: config.port });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EADDRINUSE' || !opts.fallbackToFreePort) {
      await manager.stop();
      throw err;
    }
    app.log.warn(`port ${config.port} is busy, using a free port`);
    await app.listen({ host: config.host, port: 0 });
  }
  const port = (app.server.address() as AddressInfo).port;
  recordings.attachMotion(motion);
  void recordings.start();
  motion.start();

  const shown = isLoopback(config.host) ? `http://127.0.0.1:${port}` : `http://<this-computer-ip>:${port}`;
  app.log.info(`SENTINEL ready at ${shown}  (go2rtc: ${manager.state}, login: ${config.loginRequired ? 'on' : 'off'})`);
  if (!isLoopback(config.host)) {
    app.log.warn('Dashboard is reachable from your LAN over plain HTTP. Do NOT port-forward it on your router.');
  }

  const secrets = loadSecrets();
  return {
    url: `http://127.0.0.1:${port}`,
    port,
    go2rtc: { url: `http://127.0.0.1:${config.go2rtc.apiPort}`, username: secrets.go2rtcUser, password: secrets.go2rtcPassword },
    onAlert,
    async stop() {
      motion.stop();
      await recordings.stop();
      await manager.stop();
      await app.close();
    },
  };
}
