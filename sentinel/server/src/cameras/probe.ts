/**
 * Real stream verification: pull a few seconds of fragmented MP4 from go2rtc and prove that
 * actual video fragments (moof/mdat boxes) arrived. No frames = no claim of success.
 */
import { go2rtc } from '../go2rtc/client.js';
import { redact } from '../security/redact.js';

export interface ProbeResult {
  stream: string;
  ok: boolean;
  bytes: number;
  fragments: number;
  codec: string | null;
  width: number | null;
  height: number | null;
  elapsedMs: number;
  error?: string;
}

interface Box {
  type: string;
  start: number;
  size: number;
}

function* boxes(buf: Buffer, start = 0, end = buf.length): Generator<Box> {
  let off = start;
  while (off + 8 <= end) {
    let size = buf.readUInt32BE(off);
    const type = buf.toString('latin1', off + 4, off + 8);
    if (size === 1 && off + 16 <= end) size = Number(buf.readBigUInt64BE(off + 8));
    if (size < 8 || off + size > end) {
      // Truncated last box (stream cut at duration): still count it.
      yield { type, start: off, size: end - off };
      return;
    }
    yield { type, start: off, size };
    off += size;
  }
}

export function analyzeFmp4(buf: Buffer) {
  let fragments = 0;
  let codec: string | null = null;
  let width: number | null = null;
  let height: number | null = null;
  const CONTAINERS = new Set(['moov', 'trak', 'mdia', 'minf', 'stbl']);

  const walk = (start: number, end: number) => {
    for (const b of boxes(buf, start, end)) {
      if (b.type === 'moof') fragments++;
      if (CONTAINERS.has(b.type)) walk(b.start + 8, b.start + b.size);
      if (b.type === 'tkhd' && b.size >= 92) {
        const w = buf.readUInt32BE(b.start + b.size - 8) >>> 16;
        const h = buf.readUInt32BE(b.start + b.size - 4) >>> 16;
        if (w > 0 && h > 0 && width === null) {
          width = w;
          height = h;
        }
      }
      if (b.type === 'stsd' && codec === null) {
        // stsd: header(8) + version/flags(4) + entry_count(4) + first sample entry box
        const entryType = buf.toString('latin1', b.start + 20, b.start + 24);
        if (/^(hvc1|hev1|avc1|avc3)$/.test(entryType)) codec = entryType.startsWith('h') ? 'H.265/HEVC' : 'H.264/AVC';
      }
    }
  };
  walk(0, buf.length);
  return { fragments, codec, width, height };
}

export async function probeStream(stream: string, seconds = 6): Promise<ProbeResult> {
  const started = Date.now();
  const base: ProbeResult = { stream, ok: false, bytes: 0, fragments: 0, codec: null, width: null, height: null, elapsedMs: 0 };
  try {
    const q = new URLSearchParams({ src: stream, duration: String(seconds), video: 'all' });
    // Xiaomi needs a cloud round-trip for keys + P2P handshake: allow generous time.
    const res = await go2rtc.raw(`/api/stream.mp4?${q}`, {}, (seconds + 30) * 1000);
    if (!res.ok || !res.body) {
      return { ...base, elapsedMs: Date.now() - started, error: redact((await res.text()).trim() || res.statusText) };
    }
    const chunks: Buffer[] = [];
    for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) chunks.push(Buffer.from(chunk));
    const buf = Buffer.concat(chunks);
    const a = analyzeFmp4(buf);
    return {
      ...base,
      ...a,
      bytes: buf.length,
      ok: a.fragments > 0 && buf.length > 10_000,
      elapsedMs: Date.now() - started,
      error: a.fragments > 0 ? undefined : 'לא התקבלו פריימים של וידאו',
    };
  } catch (err) {
    return { ...base, elapsedMs: Date.now() - started, error: redact(String((err as Error).message ?? err)) };
  }
}
