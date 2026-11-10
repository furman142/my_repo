import cookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import websocket from '@fastify/websocket';
import Fastify from 'fastify';
import { config, isLoopback, webDistExists } from './config.js';
import { manager } from './go2rtc/manager.js';
import { registerApiRoutes } from './routes/api.js';
import { registerStreamRoutes } from './routes/stream.js';
import { registerSecurity } from './security/auth.js';
import { redact } from './security/redact.js';
import { ensureDataDir, loadSecrets } from './security/secrets.js';
import { getSettings } from './settings/store.js';

ensureDataDir();
loadSecrets();
getSettings();

const app = Fastify({
  logger: {
    level: process.env.LOG_LEVEL ?? 'info',
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

if (webDistExists()) {
  await app.register(fastifyStatic, { root: config.webDist, maxAge: '1h' });
  // SPA fallback
  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith('/api/') || req.url.startsWith('/assets/')) return reply.code(404).send({ error: 'not found' });
    return reply.header('Cache-Control', 'no-cache').sendFile('index.html');
  });
} else {
  app.get('/', async (_req, reply) =>
    reply.type('text/plain; charset=utf-8').send('SENTINEL: frontend not built. Run "npm run build" in sentinel/ (or use "npm run dev").'),
  );
}

const shutdown = async (signal: string) => {
  app.log.info(`${signal} received, shutting down`);
  await manager.stop();
  await app.close();
  process.exit(0);
};
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

await manager.start();
await app.listen({ host: config.host, port: config.port });

const shown = isLoopback(config.host) ? `http://127.0.0.1:${config.port}` : `http://<this-computer-ip>:${config.port}`;
app.log.info(`SENTINEL ready at ${shown}  (go2rtc: ${manager.state}, login: ${config.loginRequired ? 'on' : 'off'})`);
if (!isLoopback(config.host)) {
  app.log.warn('Dashboard is reachable from your LAN over plain HTTP. Do NOT port-forward it on your router.');
}
