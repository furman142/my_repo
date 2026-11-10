import { go2rtc, type Go2rtcStream } from '../go2rtc/client.js';
import { getSettings, type Camera } from '../settings/store.js';
import { modelInfo } from './models.js';

/**
 * go2rtc only connects to a camera while someone watches it, so "idle" is NOT "offline".
 *  idle       – nobody is watching; go2rtc is not connected to the camera
 *  connecting – a viewer exists, go2rtc has not received media yet
 *  streaming  – go2rtc is receiving media bytes from the camera right now
 */
export type StreamState = 'idle' | 'connecting' | 'streaming' | 'unknown';

export interface StreamStatus {
  name: string;
  state: StreamState;
  viewers: number;
  bytesRecv: number;
  codecs: string[];
  hasAudio: boolean;
  protocol: string | null;
}

export function streamStatus(name: string, s: Go2rtcStream | undefined): StreamStatus {
  const base: StreamStatus = { name, state: 'unknown', viewers: 0, bytesRecv: 0, codecs: [], hasAudio: false, protocol: null };
  if (!s) return base;
  const viewers = s.consumers?.length ?? 0;
  const p = (s.producers ?? []).find((x) => x.bytes_recv !== undefined || x.medias) ?? s.producers?.[0];
  const bytesRecv = p?.bytes_recv ?? 0;
  const codecs = (p?.receivers ?? [])
    .map((r) => r.codec?.codec_name)
    .filter((c): c is string => !!c);
  const medias = p?.medias ?? [];
  const hasAudio = medias.some((m) => m.startsWith('audio') && !m.includes('sendonly')) ||
    (p?.receivers ?? []).some((r) => r.codec?.codec_type === 'audio');
  let state: StreamState = 'idle';
  if (bytesRecv > 0) state = 'streaming';
  else if (viewers > 0 || medias.length > 0) state = 'connecting';
  return { name, state, viewers, bytesRecv, codecs, hasAudio, protocol: p?.protocol ?? p?.format_name ?? null };
}

export interface CameraStatus extends Camera {
  compat: 'confirmed' | 'unverified' | 'demo';
  compatNote: string;
  hd: StreamStatus;
  sd: StreamStatus | null;
  demo: boolean;
}

const DEMO_CAMERAS: Camera[] = [
  { id: 'sentinel_demo_1', name: 'DEMO — תבנית בדיקה 1', model: 'go2rtc virtual', did: '', product: 'ffmpeg testsrc2', location: 'indoor', stream: 'sentinel_demo_1', streamSd: null, enabled: true, transport: 'auto', record: true, motion: 'medium', alerts: true },
  { id: 'sentinel_demo_2', name: 'DEMO — תבנית בדיקה 2', model: 'go2rtc virtual', did: '', product: 'ffmpeg smptebars', location: 'outdoor', stream: 'sentinel_demo_2', streamSd: null, enabled: true, transport: 'auto', record: true, motion: 'medium', alerts: true },
];

export async function cameraStatuses(): Promise<{ go2rtcReachable: boolean; cameras: CameraStatus[] }> {
  const settings = getSettings();
  let streams: Record<string, Go2rtcStream> = {};
  let go2rtcReachable = true;
  try {
    streams = (await go2rtc.streams()) ?? {};
  } catch {
    go2rtcReachable = false;
  }
  const real: CameraStatus[] = settings.cameras
    .filter((c) => c.enabled)
    .map((c) => {
      const info = modelInfo(c.model);
      return {
        ...c,
        product: c.product || info.product,
        compat: info.compat,
        compatNote: info.note,
        hd: streamStatus(c.stream, streams[c.stream]),
        sd: c.streamSd ? streamStatus(c.streamSd, streams[c.streamSd]) : null,
        demo: false,
      };
    });
  const demo: CameraStatus[] = settings.demoMode
    ? DEMO_CAMERAS.map((c) => ({
        ...c,
        compat: 'demo' as const,
        compatNote: 'מצב הדגמה: תבנית בדיקה סינתטית של go2rtc/ffmpeg. זה לא שידור ממצלמה.',
        hd: streamStatus(c.stream, streams[c.stream]),
        sd: null,
        demo: true,
      }))
    : [];
  return { go2rtcReachable, cameras: [...real, ...demo] };
}
