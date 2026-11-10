// Minimal typings for the vendored go2rtc VideoRTC custom element.
export class VideoRTC extends HTMLElement {
  DISCONNECT_TIMEOUT: number;
  RECONNECT_TIMEOUT: number;
  CODECS: string[];
  mode: string;
  media: string;
  background: boolean;
  visibilityThreshold: number;
  visibilityCheck: boolean;
  pcConfig: RTCConfiguration;
  wsState: number;
  pcState: number;
  video: HTMLVideoElement | null;
  ws: WebSocket | null;
  wsURL: string;
  pc: RTCPeerConnection | null;
  connectTS: number;
  mseCodecs: string;
  onmessage: Record<string, (msg: { type: string; value: unknown }) => void> | null;
  set src(value: string | URL);
  play(): void;
  send(value: unknown): void;
  connectedCallback(): void;
  disconnectedCallback(): void;
  oninit(): void;
  onconnect(): boolean;
  ondisconnect(): void;
  onopen(): string[];
  onclose(): boolean;
}
