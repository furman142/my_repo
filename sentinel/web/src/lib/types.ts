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
  demoMode: boolean;
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
}

export interface Settings {
  version: 1;
  cameras: Camera[];
  defaultQuality: 'hd' | 'sd';
  demoMode: boolean;
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
