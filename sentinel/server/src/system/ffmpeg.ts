/** Path of the ffmpeg binary: bundled with the desktop app, ffmpeg-static in a checkout, else PATH. */
let cached: string | null = null;

export async function ffmpegPath(): Promise<string> {
  if (cached) return cached;
  if (process.env.FFMPEG_BIN) return (cached = process.env.FFMPEG_BIN);
  try {
    const mod = (await import('ffmpeg-static')) as unknown as { default: string | null };
    if (mod.default) return (cached = mod.default);
  } catch {
    /* not installed */
  }
  return (cached = 'ffmpeg');
}
