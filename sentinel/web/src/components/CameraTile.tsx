import {
  Camera as CameraIcon,
  Home,
  Loader2,
  Maximize2,
  Minimize2,
  RefreshCw,
  Trees,
  Volume2,
  VolumeX,
  WifiOff,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useLiveStates } from '../hooks/liveStates';
import { useLocalPref } from '../hooks/useLocalPref';
import { streamWsUrl } from '../lib/api';
// Side-effect import registers the <sentinel-video> custom element.
import '../lib/sentinel-video';
import type { SentinelVideo, Transport } from '../lib/sentinel-video';
import type { CameraStatus, TileState } from '../lib/types';
import { cn, formatTime } from '../lib/util';

const LIVE_WINDOW_MS = 3000; // a frame within the last 3 s = LIVE
const STALL_RECONNECT_MS = 10_000; // no frames for 10 s = force a fresh connection
const OFFLINE_AFTER_MS = 20_000; // no frames for 20 s = OFFLINE

type Quality = 'hd' | 'sd';

interface Props {
  camera: CameraStatus;
  defaultQuality: Quality;
  /** go2rtc player modes allowed by the server, e.g. "mse,hls" or "webrtc,mse,hls". */
  transports: string;
}

export function CameraTile({ camera, defaultQuality, transports }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<SentinelVideo | null>(null);
  const { report } = useLiveStates();

  const [quality, setQuality] = useLocalPref<Quality>(`quality:${camera.id}`, defaultQuality);
  const effectiveQuality: Quality = quality === 'sd' && camera.streamSd ? 'sd' : 'hd';
  const stream = effectiveQuality === 'sd' && camera.streamSd ? camera.streamSd : camera.stream;

  const [state, setState] = useState<TileState>('connecting');
  const [error, setError] = useState<string | null>(null);
  const [muted, setMuted] = useState(true);
  const [hasAudio, setHasAudio] = useState(false);
  const [transport, setTransport] = useState<Transport>('none');
  const [resolution, setResolution] = useState<string | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [now, setNow] = useState(() => new Date());
  const [flash, setFlash] = useState(false);

  // ---- player lifecycle -------------------------------------------------------------
  useEffect(() => {
    const host = hostRef.current!;
    const player = document.createElement('sentinel-video') as SentinelVideo;
    player.className = 'block h-full w-full';
    player.mode = transports;
    host.appendChild(player); // connectedCallback creates the <video>
    player.src = streamWsUrl(stream);
    playerRef.current = player;

    let startedAt = Date.now();
    let lastFrameAt = 0;
    let lastVideoTime = -1;
    let lastReconnect = Date.now();
    let everLive = false;
    let rvfcHandle = 0;
    let disposed = false;

    const onErr = (e: Event) => setError((e as CustomEvent<string>).detail);
    const onOpen = () => setError((prev) => (prev === 'go2rtc unavailable' ? null : prev));
    player.addEventListener('stream-error', onErr);
    player.addEventListener('stream-open', onOpen);

    // Precise frame detection where supported (Chrome, Edge, Safari).
    const video = player.video!;
    const hasRvfc = 'requestVideoFrameCallback' in HTMLVideoElement.prototype;
    const onFrame = () => {
      lastFrameAt = Date.now();
      if (!disposed) rvfcHandle = video.requestVideoFrameCallback(onFrame);
    };
    if (hasRvfc) rvfcHandle = video.requestVideoFrameCallback(onFrame);

    const tick = window.setInterval(() => {
      const t = Date.now();
      setNow(new Date(t));
      const v = player.video;
      if (!v) return;
      // Fallback frame detection: currentTime advancing.
      if (!hasRvfc || v.srcObject !== null) {
        if (v.currentTime !== lastVideoTime && v.readyState >= 2) {
          lastVideoTime = v.currentTime;
          lastFrameAt = t;
        }
      }
      // A <video> may swap srcObject when WebRTC takes over from MSE; re-arm rVFC.
      if (hasRvfc && t - lastFrameAt > 1500) {
        try {
          v.cancelVideoFrameCallback(rvfcHandle);
          rvfcHandle = v.requestVideoFrameCallback(onFrame);
        } catch {
          /* ignore */
        }
      }

      let next: TileState;
      const sinceFrame = lastFrameAt ? t - lastFrameAt : Infinity;
      if (sinceFrame < LIVE_WINDOW_MS) {
        next = 'live';
        everLive = true;
        startedAt = t;
        setError(null);
      } else if (!everLive && t - startedAt < OFFLINE_AFTER_MS) {
        next = 'connecting';
      } else if (everLive && sinceFrame < OFFLINE_AFTER_MS) {
        next = 'stalled';
      } else {
        next = 'offline';
      }

      if (next !== 'live' && t - lastReconnect > STALL_RECONNECT_MS && (everLive ? sinceFrame : t - startedAt) > STALL_RECONNECT_MS) {
        lastReconnect = t;
        player.reconnect();
      }

      setState(next);
      setTransport(player.transport);
      setHasAudio(player.hasAudioTrack);
      setResolution(v.videoWidth ? `${v.videoWidth}×${v.videoHeight}` : null);
    }, 1000);

    return () => {
      disposed = true;
      window.clearInterval(tick);
      player.removeEventListener('stream-error', onErr);
      player.removeEventListener('stream-open', onOpen);
      try {
        video.cancelVideoFrameCallback?.(rvfcHandle);
      } catch {
        /* ignore */
      }
      player.ondisconnect();
      player.remove();
      playerRef.current = null;
    };
  }, [stream, transports]);

  useEffect(() => {
    report(camera.id, state);
  }, [camera.id, state, report]);
  useEffect(() => () => report(camera.id, null), [camera.id, report]);

  useEffect(() => {
    const onFs = () => setFullscreen(document.fullscreenElement === wrapRef.current);
    document.addEventListener('fullscreenchange', onFs);
    return () => document.removeEventListener('fullscreenchange', onFs);
  }, []);

  // ---- actions -----------------------------------------------------------------------
  const toggleMute = useCallback(() => {
    const v = playerRef.current?.video;
    if (!v) return;
    v.muted = !v.muted;
    if (!v.muted) void v.play().catch(() => {});
    setMuted(v.muted);
  }, []);

  const toggleFullscreen = useCallback(async () => {
    const el = wrapRef.current;
    if (!el) return;
    if (document.fullscreenElement) {
      await document.exitFullscreen();
      return;
    }
    if (el.requestFullscreen) {
      await el.requestFullscreen().catch(() => {});
    } else {
      // iPhone Safari: only the <video> element itself can go fullscreen.
      const v = playerRef.current?.video as (HTMLVideoElement & { webkitEnterFullscreen?: () => void }) | null;
      v?.webkitEnterFullscreen?.();
    }
  }, []);

  const snapshot = useCallback(() => {
    const v = playerRef.current?.video;
    if (!v || !v.videoWidth) return;
    const c = document.createElement('canvas');
    c.width = v.videoWidth;
    c.height = v.videoHeight;
    c.getContext('2d')!.drawImage(v, 0, 0);
    c.toBlob(
      (blob) => {
        if (!blob) return;
        const a = document.createElement('a');
        const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        a.href = URL.createObjectURL(blob);
        a.download = `sentinel-${camera.id}-${stamp}.jpg`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 5000);
        setFlash(true);
        setTimeout(() => setFlash(false), 180);
      },
      'image/jpeg',
      0.92,
    );
  }, [camera.id]);

  const retry = useCallback(() => {
    setError(null);
    playerRef.current?.reconnect();
  }, []);

  // ---- render ------------------------------------------------------------------------
  const LocationIcon = camera.location === 'outdoor' ? Trees : Home;
  const isLive = state === 'live';

  return (
    <section
      ref={wrapRef}
      className={cn(
        'group relative flex flex-col overflow-hidden rounded-xl border bg-ink-900 animate-fadeIn',
        isLive ? 'border-ink-600' : 'border-ink-700',
        fullscreen && 'rounded-none border-0',
      )}
      aria-label={camera.name}
    >
      {/* header */}
      <header className={cn('flex items-center gap-3 border-b border-ink-700 px-4 py-2.5', fullscreen && 'hidden')}>
        <LocationIcon className="h-4 w-4 shrink-0 text-ink-300" aria-hidden />
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-sm font-semibold text-ink-100">{camera.name}</h2>
          <p className="truncate font-mono text-[11px] text-ink-400" dir="ltr">
            {camera.product || camera.model}
            {camera.compat === 'unverified' && ' · unverified model'}
          </p>
        </div>
        <StateBadge state={state} demo={camera.demo} />
      </header>

      {/* video */}
      <div className={cn('relative bg-black', fullscreen ? 'flex-1' : 'aspect-video')}>
        <div ref={hostRef} className="absolute inset-0" />

        {camera.demo && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <span className="rounded-md border-2 border-warn/80 bg-black/60 px-4 py-1.5 font-mono text-lg font-bold tracking-[0.3em] text-warn">
              DEMO · NOT A CAMERA
            </span>
          </div>
        )}

        {/* top overlay */}
        <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between p-3" dir="ltr">
          {isLive ? (
            <span className="flex items-center gap-1.5 rounded bg-black/65 px-2 py-0.5 font-mono text-[11px] font-semibold tracking-wider text-white">
              <span className="h-2 w-2 rounded-full bg-live animate-pulseDot" />
              LIVE
            </span>
          ) : (
            <span />
          )}
          <span className="rounded bg-black/65 px-2 py-0.5 font-mono text-[11px] text-ink-200">
            {formatTime(now)}
          </span>
        </div>

        {/* connecting / offline overlays */}
        {state === 'connecting' && (
          <Overlay>
            <Loader2 className="h-7 w-7 animate-spin text-signal-glow" aria-hidden />
            <p className="text-sm text-ink-200">מתחבר למצלמה…</p>
            <p className="max-w-xs text-center text-xs text-ink-400">
              חיבור Xiaomi דורש קבלת מפתחות מהענן ולחיצת יד P2P מקומית — זה יכול לקחת עד כחצי דקה.
            </p>
            {error && <ErrorText text={error} />}
          </Overlay>
        )}
        {state === 'stalled' && (
          <Overlay subtle>
            <Loader2 className="h-6 w-6 animate-spin text-warn" aria-hidden />
            <p className="text-sm text-ink-200">השידור נעצר — מתחבר מחדש…</p>
          </Overlay>
        )}
        {state === 'offline' && (
          <Overlay>
            <WifiOff className="h-7 w-7 text-ink-300" aria-hidden />
            <p className="font-mono text-sm font-semibold tracking-widest text-ink-200">OFFLINE</p>
            <p className="text-xs text-ink-400">לא מתקבלים פריימים מהמצלמה. מנסה שוב אוטומטית.</p>
            {error && <ErrorText text={error} />}
            <button
              onClick={retry}
              className="pointer-events-auto mt-1 flex items-center gap-1.5 rounded-md border border-ink-500 px-3 py-1.5 text-xs text-ink-100 hover:border-signal hover:text-white"
            >
              <RefreshCw className="h-3.5 w-3.5" /> נסה עכשיו
            </button>
          </Overlay>
        )}

        {flash && <div className="pointer-events-none absolute inset-0 bg-white/40" />}

        {/* controls */}
        <div
          className={cn(
            'absolute inset-x-0 bottom-0 flex items-center gap-1 bg-black/70 px-2 py-1.5 transition-opacity duration-200',
            'opacity-100 md:opacity-0 md:group-hover:opacity-100 md:focus-within:opacity-100',
          )}
        >
          <CtrlButton
            label={!hasAudio ? 'אין ערוץ אודיו בשידור' : muted ? 'הפעל אודיו' : 'השתק'}
            onClick={toggleMute}
            disabled={!hasAudio}
          >
            {muted || !hasAudio ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
          </CtrlButton>

          {camera.streamSd && (
            <div className="mx-1 flex overflow-hidden rounded border border-ink-500 font-mono text-[11px]" role="group" aria-label="איכות שידור" dir="ltr">
              {(['hd', 'sd'] as const).map((q) => (
                <button
                  key={q}
                  onClick={() => setQuality(q)}
                  className={cn(
                    'px-2 py-0.5 uppercase',
                    effectiveQuality === q ? 'bg-signal text-white' : 'text-ink-200 hover:bg-ink-700',
                  )}
                  aria-pressed={effectiveQuality === q}
                >
                  {q}
                </button>
              ))}
            </div>
          )}

          <span className="flex-1 truncate px-1 text-left font-mono text-[10px] text-ink-300" dir="ltr">
            {transport !== 'none' && transport.toUpperCase()}
            {resolution && ` · ${resolution}`}
          </span>

          <CtrlButton label="צילום תמונה" onClick={snapshot} disabled={!isLive}>
            <CameraIcon className="h-4 w-4" />
          </CtrlButton>
          <CtrlButton label="חיבור מחדש" onClick={retry}>
            <RefreshCw className="h-4 w-4" />
          </CtrlButton>
          <CtrlButton label={fullscreen ? 'יציאה ממסך מלא' : 'מסך מלא'} onClick={toggleFullscreen}>
            {fullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
          </CtrlButton>
        </div>
      </div>
    </section>
  );
}

function StateBadge({ state, demo }: { state: TileState; demo: boolean }) {
  if (demo && state === 'live') {
    return <Badge className="border-warn/50 text-warn">DEMO</Badge>;
  }
  switch (state) {
    case 'live':
      return (
        <Badge className="border-live/40 text-red-300">
          <span className="h-1.5 w-1.5 rounded-full bg-live animate-pulseDot" /> LIVE
        </Badge>
      );
    case 'connecting':
      return <Badge className="border-signal/40 text-signal-glow">CONNECTING</Badge>;
    case 'stalled':
      return <Badge className="border-warn/40 text-warn">RECONNECTING</Badge>;
    default:
      return <Badge className="border-ink-500 text-ink-300">OFFLINE</Badge>;
  }
}

function Badge({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <span className={cn('flex shrink-0 items-center gap-1.5 rounded border px-2 py-0.5 font-mono text-[10px] font-semibold tracking-wider', className)} dir="ltr">
      {children}
    </span>
  );
}

function Overlay({ children, subtle }: { children: React.ReactNode; subtle?: boolean }) {
  return (
    <div className={cn('pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2 p-6', subtle ? 'bg-black/35' : 'bg-ink-950/85')}>
      {children}
    </div>
  );
}

function ErrorText({ text }: { text: string }) {
  return (
    <p className="max-w-sm break-words text-center font-mono text-[11px] text-red-300/90" dir="ltr">
      {text}
    </p>
  );
}

function CtrlButton({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      className="rounded p-1.5 text-ink-100 hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:bg-transparent"
    >
      {children}
    </button>
  );
}
