import { rmSync, statfsSync } from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { RECORDINGS_DIR, enforceRetention, listSegments, recordings } from '../recordings/recorder.js';

const CAM = /^[a-z][a-z0-9_]{0,31}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const FILE = /^\d{2}-\d{2}-\d{2}(?:_\d+)?(?:\.part)?\.mp4$/;

/** Validate every path component; recordings are only ever served from RECORDINGS_DIR. */
function safePath(camera: string, date: string, file: string): string | null {
  if (!CAM.test(camera) || !DAY.test(date) || !FILE.test(file)) return null;
  const root = path.resolve(RECORDINGS_DIR());
  const full = path.resolve(root, camera, date, file);
  return full.startsWith(root + path.sep) ? full : null;
}

export function registerRecordingRoutes(app: FastifyInstance) {
  app.get('/api/recordings/status', async () => {
    const segs = listSegments();
    let freeBytes: number | null = null;
    try {
      const fs = statfsSync(RECORDINGS_DIR());
      freeBytes = fs.bavail * fs.bsize;
    } catch {
      /* unsupported */
    }
    return {
      dir: RECORDINGS_DIR(),
      totalBytes: segs.reduce((a, s) => a + s.size, 0),
      files: segs.length,
      freeBytes,
      recorders: recordings.status(),
    };
  });

  /** { cameraId: ["2026-11-10", …] } — newest first. */
  app.get('/api/recordings/days', async () => {
    const out: Record<string, string[]> = {};
    for (const s of listSegments()) (out[s.camera] ??= []).includes(s.date) || out[s.camera].push(s.date);
    for (const k of Object.keys(out)) out[k].sort().reverse();
    return out;
  });

  app.get<{ Querystring: { camera?: string; date?: string } }>('/api/recordings/list', async (req, reply) => {
    const { camera = '', date = '' } = req.query;
    if (!CAM.test(camera) || !DAY.test(date)) return reply.code(400).send({ error: 'bad request' });
    return listSegments(camera, date).map((s) => ({
      file: s.file,
      start: s.start.toISOString(),
      seconds: s.seconds,
      size: s.size,
      inProgress: s.inProgress,
    }));
  });

  app.get<{ Params: { camera: string; date: string; file: string }; Querystring: { download?: string } }>(
    '/api/recordings/file/:camera/:date/:file',
    async (req, reply) => {
      const { camera, date, file } = req.params;
      const full = safePath(camera, date, file);
      if (!full) return reply.code(400).send({ error: 'bad path' });
      if (req.query.download) {
        reply.header('Content-Disposition', `attachment; filename="sentinel-${camera}-${date}-${file.replace('.part', '')}"`);
      }
      reply.header('Cache-Control', 'no-store');
      // @fastify/static: Range requests (seeking) supported.
      return reply.sendFile(path.basename(full), path.dirname(full));
    },
  );

  app.delete<{ Params: { camera: string; date: string; file: string } }>('/api/recordings/file/:camera/:date/:file', async (req, reply) => {
    const { camera, date, file } = req.params;
    const full = safePath(camera, date, file);
    if (!full || file.includes('.part')) return reply.code(400).send({ error: 'bad path' });
    rmSync(full, { force: true });
    return { ok: true };
  });

  app.post('/api/recordings/cleanup', async () => enforceRetention());
}
