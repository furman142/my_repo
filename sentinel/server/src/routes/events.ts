import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { eventDays, readEvents, thumbPath, type MotionEvent } from '../motion/events.js';
import { objects } from '../detect/service.js';
import type { Label } from '../detect/yolox.js';
import { motion, type ActiveMotion, type ObjectSeen } from '../motion/service.js';
import { getSettings } from '../settings/store.js';

export interface Alert {
  seq: number;
  id: string;
  camera: string;
  name: string;
  start: string;
  /** What was recognised (absent = plain motion). */
  label?: Label;
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

function push(a: { id: string; camera: string; start: string }, label?: Label) {
  const alert: Alert = { seq: ++seq, id: a.id, camera: a.camera, name: cameraName(a.camera), start: a.start, ...(label ? { label } : {}) };
  alerts.push(alert);
  if (alerts.length > 100) alerts.shift();
  for (const fn of listeners) fn(alert);
}

/**
 * What triggers an alert for a camera. "objects"/"person" need the recognition model; when it is
 * off or failed to load they fall back to plain motion, so alerts never silently stop.
 */
export function alertPolicy(cameraId: string): 'off' | 'motion' | 'objects' | 'person' {
  const s = getSettings();
  if (!s.motion.notify) return 'off';
  const cam = s.cameras.find((c) => c.id === cameraId);
  if (cam && !cam.alerts) return 'off';
  const wanted = cam?.alertOn ?? 'motion';
  if (wanted !== 'motion' && !(s.motion.objects && objects.ready)) return 'motion';
  return wanted;
}

/** Does a recognised object trigger an alert under this policy? ("motion" alerts at motion start instead.) */
export function alertMatches(policy: ReturnType<typeof alertPolicy>, label: Label): boolean {
  if (policy === 'person') return label === 'person';
  if (policy === 'objects') return label === 'person' || label === 'vehicle';
  return false;
}

const alerted = new Set<string>(); // event ids that already produced an alert

motion.on('motion-start', (a: ActiveMotion) => {
  if (alertPolicy(a.camera) !== 'motion') return;
  alerted.add(a.id);
  push(a);
});

motion.on('motion-object', (o: ObjectSeen) => {
  if (!alertMatches(alertPolicy(o.camera), o.label) || alerted.has(o.id)) return;
  alerted.add(o.id);
  push(o, o.label);
});

motion.on('motion-end', (e: { id: string }) => alerted.delete(e.id));

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

  app.get('/api/motion/status', async () => ({
    enabled: getSettings().motion.enabled,
    objects: { enabled: getSettings().motion.objects, state: objects.state, error: objects.error },
    detectors: motion.status(),
  }));
}
