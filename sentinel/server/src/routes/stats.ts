import type { FastifyInstance } from 'fastify';
import { eventDays, readEvents } from '../motion/events.js';
import { listSegments, localDate } from '../recordings/recorder.js';

/**
 * Activity statistics computed from what is actually on disk: motion events (events/*.jsonl)
 * and recording segments. Nothing estimated, nothing invented.
 */
export function registerStatsRoutes(app: FastifyInstance) {
  app.get<{ Querystring: { days?: string; camera?: string } }>('/api/stats', async (req) => {
    const days = Math.min(90, Math.max(1, Number(req.query.days ?? 14) || 14));
    const cam = req.query.camera && /^[a-z][a-z0-9_]{0,31}$/.test(req.query.camera) ? req.query.camera : null;

    const dates: string[] = [];
    for (let i = days - 1; i >= 0; i--) dates.push(localDate(new Date(Date.now() - i * 86_400_000)));
    const inRange = new Set(dates);

    const eventsPerDay = Object.fromEntries(dates.map((d) => [d, 0]));
    const byHour = new Array(24).fill(0);
    const perCamera: Record<string, { events: number; recordedSeconds: number; lastEvent: string | null; bytes: number }> = {};
    const camRow = (c: string) => (perCamera[c] ??= { events: 0, recordedSeconds: 0, lastEvent: null, bytes: 0 });

    for (const d of eventDays()) {
      if (!inRange.has(d)) continue;
      for (const e of readEvents(d)) {
        const row = camRow(e.camera);
        row.events++;
        if (!row.lastEvent || e.start > row.lastEvent) row.lastEvent = e.start;
        if (cam && e.camera !== cam) continue;
        eventsPerDay[d]++;
        byHour[new Date(e.start).getHours()]++;
      }
    }

    const recordedPerDay = Object.fromEntries(dates.map((d) => [d, 0]));
    let totalBytes = 0;
    for (const s of listSegments()) {
      totalBytes += s.size;
      if (!inRange.has(s.date)) continue;
      const secs = s.seconds ?? (s.inProgress ? Math.max(0, (Date.now() - s.start.getTime()) / 1000) : 0);
      const row = camRow(s.camera);
      row.recordedSeconds += secs;
      row.bytes += s.size;
      if (cam && s.camera !== cam) continue;
      recordedPerDay[s.date] += secs;
    }

    const today = dates[dates.length - 1];
    return {
      days: dates,
      eventsPerDay,
      recordedHoursPerDay: Object.fromEntries(Object.entries(recordedPerDay).map(([d, s]) => [d, Math.round((s / 3600) * 10) / 10])),
      byHour,
      perCamera,
      totals: {
        eventsToday: eventsPerDay[today],
        eventsInRange: Object.values(eventsPerDay).reduce((a, b) => a + b, 0),
        recordedHoursToday: Math.round((recordedPerDay[today] / 3600) * 10) / 10,
        storageBytes: totalBytes,
      },
    };
  });
}
