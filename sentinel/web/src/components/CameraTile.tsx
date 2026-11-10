import {
  Activity,
  Camera as CameraIcon,
  Home,
  LayoutGrid,
  Loader2,
  Maximize2,
  Mic,
  Minimize2,
  RefreshCw,
  Scan,
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
import { TalkSession, micAvailable, type TalkState } from '../lib/talk';
import type { CameraStatus, TileState } from '../lib/types';
import { cn, formatTime } from '../lib/util';

const LIVE_WINDOW_MS = 3000; // a frame within the last 3 s = LIVE
const SOFT_RECOVER_MS = 2000; // playback stuck but data buffered ahead: jump to the live edge
const STALL_RECONNECT_MS = 8000; // no frames for 8 s = force a fresh connection
const OFFLINE_AFTER_MS = 20_000; // no frames for 20 s = OFFLINE

type Quality = 'hd' | 'sd';

interface Props {
  camera: CameraStatus;
  defaultQuality: Quality;
  /** go2rtc player modes allowed by the server, e.g. "mse,hls" or "webrtc,mse,hls". */
  transports: string;
  /** The recorder is writing this camera to disk right now. */
  recording?: boolean;
  /** Local motion detection reports movement right now. */
  motion?: boolean;
  /** Two-way audio is enabled in Settings. */
  talkEnabled?: boolean;
  /** Small tile (side strip in focus layout): name + essential buttons only. */
  compact?: boolean;
  focused?: boolean;
  /** Toggle the focus (spotlight) layout for this camera. */
  onFocus?: () => void;
}

export function CameraTile({ camera, defaultQuality, transports, recording, motion, talkEnabled, compact, focused, onFocus }: Props) {
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
  const [drops, setDrops] = useState(0); // times a live stream was lost and re-established
  const [talk, setTalk] = useState<TalkState>('idle');
  const [talkError, setTalkError] = useState<string | null>(null);
  const talkRef = useRef<TalkSession | null>(null);

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
    let lastSoftRecover = 0;
    let reconnectDelay = STALL_RECONNECT_MS;
    let wasLost = false;
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

      // Soft recovery (MSE): when a camera pans/tilts or re-keys, its timestamps can jump and
      // leave a gap in the buffer. Video keeps arriving but playback sits in front of the gap.
      // Jump to the newest buffered data instead of tearing the connection down.
      if (everLive && sinceFrame > SOFT_RECOVER_MS && t - lastSoftRecover > SOFT_RECOVER_MS && v.buffered.length) {
        const end = v.buffered.end(v.buffered.length - 1);
        if (end - v.currentTime > 0.5) {
          lastSoftRecover = t;
          v.currentTime = Math.max(v.buffered.start(v.buffered.length - 1), end - 0.3);
          void v.play().catch(() => {});
        }
      }
      if (sinceFrame < LIVE_WINDOW_MS) {
        if (wasLost) {
          wasLost = false;
          setDrops((d) => d + 1);
        }
        next = 'live';
        everLive = true;
        startedAt = t;
        setError(null);
      } else if (!everLive && t - startedAt < OFFLINE_AFTER_MS) {
        next = 'connecting';
      } else if (everLive && sinceFrame < OFFLINE_AFTER_MS) {
        next = 'stalled';
        if (sinceFrame > STALL_RECONNECT_MS) wasLost = true;
      } else {
        next = 'offline';
        if (everLive) wasLost = true;
      }

      // Reconnect with a growing delay (8 s → 16 → 32 → 60 s). Every attempt makes go2rtc ask the
      // Xiaomi cloud for keys, so an unreachable camera must not be retried every few seconds.
      if (next === 'live') reconnectDelay = STALL_RECONNECT_MS;
      else if (t - lastReconnect > reconnectDelay && (everLive ? sinceFrame : t - startedAt) > STALL_RECONNECT_MS) {
        lastReconnect = t;
        reconnectDelay = Math.min(reconnectDelay * 2, 60_000);
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

  // Two-way audio always uses the main stream (the camera session that is already open).
  const toggleTalk = useCallback(() => {
    if (talkRef.current) {
      talkRef.current.stop();
      talkRef.current = null;
      return;
    }
    setTalkError(null);
    const session = new TalkSession(camera.stream, (st, err) => {
      setTalk(st === 'error' ? 'idle' : st);
      if (st === 'error') setTalkError(err ?? 'שגיאה');
      if (st === 'idle' || st === 'error') talkRef.current = null;
    });
    talkRef.current = session;
    void session.start();
  }, [camera.stream]);
  useEffect(() => () => talkRef.current?.stop(), []);
  useEffect(() => {
    if (!talkError) return;
    const t = window.setTimeout(() => setTalkError(null), 8000);
    return () => window.clearTimeout(t);
  }, [talkError]);

  const retry = useCallback(() => {
    setError(null);
    playerRef.current?.reconnect();
  }, []);

  // ---- render ------------------------------------------------------------------------
  const LocationIcon = camera.location === 'outdoor' ? Trees : Home;
  const isLive = state === 'live';
  const canTalk = !!talkEnabled && micAvailable();
  const talking = talk === 'talking';

  return (
    <section
      ref={wrapRef}
      data-camera={camera.id}
      data-state={state}
      data-demo={camera.demo ? 'true' : undefined}
      className={cn(
        'group relative flex min-w-0 flex-col overflow-hidden rounded-2xl border bg-ink-900 transition-colors animate-fadeIn',
        talking ? 'border-live/70' : motion ? 'border-warn/60' : isLive ? 'border-ink-600' : 'border-ink-700',
        fullscreen && 'rounded-none border-0',
      )}
      aria-label={camera.name}
    >
      {/* video */}
      <div className={cn('relative bg-black', fullscreen ? 'min-h-0 flex-1' : 'aspect-video')} onDoubleClick={onFocus}>
        <div ref={hostRef} className="absolute inset-0" />

        {camera.demo && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <span className={cn('rounded-md border-2 border-warn/80 bg-black/60 font-mono font-bold text-warn', compact ? 'px-2 py-0.5 text-[10px] tracking-widest' : 'px-4 py-1.5 text-lg tracking-[0.3em]')}>
              DEMO · NOT A CAMERA
            </span>
          </div>
        )}

        {/* status chips */}
        <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start gap-1.5 p-2.5" dir="ltr">
          {isLive && (
            <Chip data-chip="live" className="text-white">
              <span className="h-2 w-2 rounded-full bg-live animate-pulseDot" />
              LIVE
            </Chip>
          )}
          {recording && (
            <Chip data-chip="rec" className="text-red-200" title="מוקלטת עכשיו למחשב">
              <span className="h-2 w-2 rounded-sm bg-live" />
              REC
            </Chip>
          )}
          {motion && (
            <Chip data-chip="motion" className="bg-warn/90 text-black" title="זוהתה תנועה עכשיו">
              <Activity className="h-3 w-3" />
              <span dir="rtl">תנועה</span>
            </Chip>
          )}
          <span className="flex-1" />
          <Chip className="font-normal text-ink-100">{formatTime(now)}</Chip>
        </div>

        {talking && (
          <div className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center">
            <span className="flex items-center gap-2 rounded-full bg-live px-3 py-1 text-xs font-semibold text-white shadow-lg">
              <Mic className="h-3.5 w-3.5 animate-pulseDot" /> המיקרופון פתוח — מדברים אל המצלמה
            </span>
          </div>
        )}

        {/* connecting / offline overlays */}
        {state === 'connecting' && (
          <Overlay>
            <Loader2 className="h-7 w-7 animate-spin text-signal-glow" aria-hidden />
            <p className="text-sm text-ink-200">מתחבר למצלמה…</p>
            {!compact && (
              <p className="max-w-xs text-center text-xs text-ink-400">
                חיבור Xiaomi דורש קבלת מפתחות מהענן ולחיצת יד מקומית. זה יכול לקחת עד כחצי דקה.
              </p>
            )}
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
            <WifiOff className="h-7 w-7 text-ink-400" aria-hidden />
            <p className="font-mono text-sm font-semibold tracking-widest text-ink-200">OFFLINE</p>
            {!compact && <p className="text-xs text-ink-400">לא מתקבלים פריימים מהמצלמה. מנסה שוב אוטומטית.</p>}
            {error && !compact && <ErrorText text={error} />}
            <button
              onClick={retry}
              className="pointer-events-auto mt-1 flex items-center gap-1.5 rounded-lg border border-ink-500 px-3 py-1.5 text-xs text-ink-100 hover:border-signal hover:text-white"
            >
              <RefreshCw className="h-3.5 w-3.5" /> נסה עכשיו
            </button>
          </Overlay>
        )}

        {flash && <div className="pointer-events-none absolute inset-0 bg-white/40" />}
      </div>

      {/* info + controls: always visible, never hidden behind hover */}
      <footer className={cn('flex items-center gap-x-1 gap-y-1 border-t border-ink-700/80 bg-ink-900 sm:gap-x-2', compact ? 'px-2.5 py-1.5' : 'flex-wrap px-3 py-2 sm:flex-nowrap')}>
        <LocationIcon className="h-4 w-4 shrink-0 text-ink-400" aria-hidden />
        <div className={cn('min-w-0 flex-1', !compact && 'basis-[calc(100%-2rem)] sm:basis-0')}>
          <h2 className={cn('truncate font-semibold text-ink-100', compact ? 'text-xs' : 'text-sm')}>{camera.name}</h2>
          {!compact && (
            <p className="truncate text-[11px] text-ink-400">
              <span className="font-mono" dir="ltr">
                {resolution ?? (camera.product || camera.model)}
              </span>
              <span className={cn('ms-2', drops > 0 && 'text-warn')} title="כמה פעמים השידור נפל וחזר מאז שהמסך נפתח" data-drops={drops}>
                {drops} ניתוקים
              </span>
              {camera.compat === 'unverified' && <span className="ms-2">דגם לא מאומת</span>}
              {talkError && <span className="ms-2 text-red-300">{talkError}</span>}
            </p>
          )}
        </div>

        {!compact && (
          <>
            <CtrlButton label={!hasAudio ? 'אין ערוץ אודיו בשידור' : muted ? 'הפעל אודיו' : 'השתק'} onClick={toggleMute} disabled={!hasAudio} active={hasAudio && !muted}>
              {muted || !hasAudio ? <VolumeX className="h-[18px] w-[18px]" /> : <Volume2 className="h-[18px] w-[18px]" />}
            </CtrlButton>

            {canTalk && (
              <CtrlButton
                label={talking ? 'סיים דיבור' : talk === 'starting' ? 'מתחבר למיקרופון…' : 'דבר אל המצלמה'}
                onClick={toggleTalk}
                disabled={!isLive && !talking}
                danger={talking}
              >
                {talk === 'starting' ? <Loader2 className="h-[18px] w-[18px] animate-spin" /> : <Mic className="h-[18px] w-[18px]" />}
              </CtrlButton>
            )}

            {camera.streamSd && (
              <div className="mx-0.5 flex overflow-hidden rounded-lg border border-ink-600 font-mono text-[11px]" role="group" aria-label="איכות שידור" dir="ltr">
                {(['hd', 'sd'] as const).map((q) => (
                  <button
                    key={q}
                    onClick={() => setQuality(q)}
                    className={cn('px-2 py-1.5 uppercase', effectiveQuality === q ? 'bg-signal text-white' : 'text-ink-300 hover:bg-ink-700')}
                    aria-pressed={effectiveQuality === q}
                  >
                    {q}
                  </button>
                ))}
              </div>
            )}

            <CtrlButton label="צילום תמונה" onClick={snapshot} disabled={!isLive}>
              <CameraIcon className="h-[18px] w-[18px]" />
            </CtrlButton>
            <CtrlButton label="חיבור מחדש" onClick={retry}>
              <RefreshCw className="h-[18px] w-[18px]" />
            </CtrlButton>
          </>
        )}
        {onFocus && !fullscreen && (
          <CtrlButton label={focused ? 'חזרה לתצוגת רשת' : 'מיקוד במצלמה הזו'} onClick={onFocus} active={focused}>
            {focused ? <LayoutGrid className="h-[18px] w-[18px]" /> : <Scan className="h-[18px] w-[18px]" />}
          </CtrlButton>
        )}
        <CtrlButton label={fullscreen ? 'יציאה ממסך מלא' : 'מסך מלא'} onClick={toggleFullscreen}>
          {fullscreen ? <Minimize2 className="h-[18px] w-[18px]" /> : <Maximize2 className="h-[18px] w-[18px]" />}
        </CtrlButton>
      </footer>
    </section>
  );
}

function Chip({ className, children, ...rest }: React.HTMLAttributes<HTMLSpanElement>) {
  return (
    <span className={cn('flex items-center gap-1.5 rounded-md bg-black/65 px-2 py-1 font-mono text-[11px] font-semibold leading-none tracking-wider backdrop-blur-sm', className)} {...rest}>
      {children}
    </span>
  );
}

function Overlay({ children, subtle }: { children: React.ReactNode; subtle?: boolean }) {
  return (
    <div className={cn('pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2 p-4', subtle ? 'bg-black/35' : 'bg-ink-950/85')}>
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
  active,
  danger,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      aria-pressed={active || danger || undefined}
      className={cn(
        'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg transition-colors disabled:cursor-not-allowed disabled:opacity-30',
        danger ? 'bg-live text-white hover:bg-red-500' : active ? 'bg-signal-soft/60 text-signal-glow' : 'text-ink-300 hover:bg-ink-700 hover:text-white',
      )}
    >
      {children}
    </button>
  );
}
