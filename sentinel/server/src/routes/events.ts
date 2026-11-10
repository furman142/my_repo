import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { eventDays, readEvents, thumbPath, type MotionEvent } from '../motion/events.js';
import { motion, type ActiveMotion } from '../motion/service.js';
import { getSettings } from '../settings/store.js';

export interface Alert {
  seq: number;
  id: string;
  camera: string;
  name: string;
  start: string;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const alerts: Alert[] = [];
let seq = 0;
const listeners = new Set<(a: Alert) => void>();

/** Desktop app subscribes here to show native notifications. */
export function onAlert(fn: (a: Alert) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function cameraName(id: string): string {
  if (id === 'sentinel_demo_1') return 'DEMO 1';
  if (id === 'sentinel_demo_2') return 'DEMO 2';
  return getSettings().cameras.find((c) => c.id === id)?.name ?? id;
}

motion.on('motion-start', (a: ActiveMotion) => {
  const s = getSettings();
  const cam = s.cameras.find((c) => c.id === a.camera);
  if (!s.motion.notify || (cam && !cam.alerts)) return;
  const alert: Alert = { seq: ++seq, id: a.id, camera: a.camera, name: cameraName(a.camera), start: a.start };
  alerts.push(alert);
  if (alerts.length > 100) alerts.shift();
  for (const fn of listeners) fn(alert);
});

export function registerEventRoutes(app: FastifyInstance) {
  app.get('/api/events/days', async () => eventDays().map((d) => ({ date: d, count: readEvents(d).length })));

  app.get<{ Querystring: { date?: string; camera?: string } }>('/api/events', async (req, reply) => {
    const date = req.query.date ?? '';
    if (!DAY.test(date)) return reply.code(400).send({ error: 'bad date' });
    let list: MotionEvent[] = readEvents(date);
    if (req.query.camera) list = list.filter((e) => e.camera === req.query.camera);
    return { events: list.reverse(), active: motion.activeMotion() };
  });

  app.get<{ Params: { id: string } }>('/api/events/thumb/:id', async (req, reply) => {
    const p = thumbPath(req.params.id.replace(/\.jpg$/, ''));
    if (!p) return reply.code(404).send({ error: 'not found' });
    reply.header('Cache-Control', 'private, max-age=86400');
    return reply.sendFile(path.basename(p), path.dirname(p));
  });

  /** Alerts after `since` (poll every few seconds). */
  app.get<{ Querystring: { since?: string } }>('/api/events/alerts', async (req) => {
    const since = Number(req.query.since ?? 0) || 0;
    return { seq, alerts: alerts.filter((a) => a.seq > since) };
  });

  app.get('/api/motion/status', async () => ({ enabled: getSettings().motion.enabled, detectors: motion.status() }));
}
