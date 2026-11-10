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

export interface CameraStatus {
  id: string;
  name: string;
  model: string;
  did: string;
  product: string;
  location: 'indoor' | 'outdoor';
  stream: string;
  streamSd: string | null;
  enabled: boolean;
  compat: 'confirmed' | 'unverified' | 'demo';
  compatNote: string;
  hd: StreamStatus;
  sd: StreamStatus | null;
  demo: boolean;
}

export interface SystemStatus {
  time: string;
  go2rtc: { state: string; managed: boolean; version: string | null; lastExit: { code: number | null; at: string } | null };
  transports: string;
  /** Two-way audio available. */
  talk: boolean;
  demoMode: boolean;
  /** cameraId -> recorder state */
  recording: Record<string, 'recording' | 'waiting' | 'stopped'>;
  /** cameraId -> ISO start of motion happening right now */
  motion: Record<string, string>;
  defaultQuality: 'hd' | 'sd';
  cameras: CameraStatus[];
}

export interface Camera {
  id: string;
  name: string;
  model: string;
  did: string;
  product: string;
  location: 'indoor' | 'outdoor';
  stream: string;
  streamSd: string | null;
  enabled: boolean;
  transport: 'auto' | 'tcp';
  record: boolean;
  motion: 'off' | 'low' | 'medium' | 'high';
  alerts: boolean;
}

export interface Settings {
  version: 1;
  cameras: Camera[];
  defaultQuality: 'hd' | 'sd';
  demoMode: boolean;
  recording: RecordingSettings;
  motion: { enabled: boolean; notify: boolean; retentionDays: number };
  talk: { enabled: boolean };
}

export interface RecordingSettings {
  enabled: boolean;
  retentionDays: number;
  maxGb: number;
  segmentMinutes: 5 | 10 | 15 | 30 | 60;
  mode: 'continuous' | 'motion';
}

export interface RecordingStatus {
  dir: string;
  totalBytes: number;
  files: number;
  freeBytes: number | null;
  recorders: Array<{ cameraId: string; stream: string; state: 'recording' | 'waiting' | 'stopped'; since: string | null; lastError: string | null; currentFile: string | null }>;
}

export interface Segment {
  file: string;
  start: string;
  seconds: number | null;
  size: number;
  inProgress: boolean;
}

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

export interface SetupState {
  go2rtcState: string;
  go2rtcBinary: string;
  xiaomiAccounts: number;
  go2rtcWebUi: string;
  fromThisComputer: boolean;
  cameras: number;
}

export interface XiaomiDevice {
  name: string;
  region: string;
  ip: string;
  model: string;
  product: string;
  compat: 'confirmed' | 'unverified';
  compatNote: string;
  source: string;
  added: boolean;
}

/** What the browser itself observes for a tile — the only source of truth for "LIVE". */
export type TileState = 'connecting' | 'live' | 'stalled' | 'offline';

export interface MotionEvent {
  id: string;
  camera: string;
  start: string;
  end: string;
  peak: number;
  box: [number, number, number, number] | null;
  thumb: boolean;
}

export interface Alert {
  seq: number;
  id: string;
  camera: string;
  name: string;
  start: string;
}
