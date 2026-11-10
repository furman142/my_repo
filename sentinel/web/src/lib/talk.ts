import { streamWsUrl } from './api';

export type TalkState = 'idle' | 'starting' | 'talking' | 'error';

/** The browser can capture a microphone here (needs a secure context: this computer or HTTPS). */
export const micAvailable = () => typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia && window.isSecureContext;

/**
 * Two-way audio: sends the microphone to the camera's speaker.
 *
 * A WebRTC connection to go2rtc (signalled over SENTINEL's authenticated WebSocket bridge) with a
 * single send-only audio track. go2rtc attaches it to the camera's backchannel on the stream that
 * is already open — no additional camera session.
 */
export class TalkSession {
  private ws: WebSocket | null = null;
  private pc: RTCPeerConnection | null = null;
  private mic: MediaStream | null = null;
  private timer = 0;

  constructor(
    private stream: string,
    private onState: (s: TalkState, error?: string) => void,
    private maxMs = 120_000,
  ) {}

  async start(): Promise<void> {
    this.onState('starting');
    try {
      this.mic = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
      });
    } catch (e) {
      const name = (e as DOMException).name;
      this.fail(name === 'NotAllowedError' ? 'אין הרשאה למיקרופון' : name === 'NotFoundError' ? 'לא נמצא מיקרופון' : 'שגיאת מיקרופון');
      return;
    }

    const pc = new RTCPeerConnection({ bundlePolicy: 'max-bundle', iceServers: [] });
    this.pc = pc;
    for (const track of this.mic.getAudioTracks()) pc.addTransceiver(track, { direction: 'sendonly' });

    const url = streamWsUrl(this.stream);
    const ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + url);
    this.ws = ws;

    pc.addEventListener('icecandidate', (ev) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'webrtc/candidate', value: ev.candidate ? ev.candidate.candidate : '' }));
    });
    pc.addEventListener('connectionstatechange', () => {
      if (pc.connectionState === 'connected') {
        this.onState('talking');
        this.timer = window.setTimeout(() => this.stop(), this.maxMs); // never leave a hot mic
      } else if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
        this.fail('החיבור נותק');
      }
    });

    ws.addEventListener('open', async () => {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      ws.send(JSON.stringify({ type: 'webrtc/offer', value: offer.sdp }));
    });
    ws.addEventListener('message', (ev) => {
      if (typeof ev.data !== 'string') return;
      const msg = JSON.parse(ev.data) as { type: string; value: string };
      if (msg.type === 'webrtc/answer') {
        void pc.setRemoteDescription({ type: 'answer', sdp: msg.value }).catch(() => this.fail('תשובה לא תקינה מהשרת'));
      } else if (msg.type === 'webrtc/candidate') {
        void pc.addIceCandidate({ candidate: msg.value, sdpMid: '0' }).catch(() => {});
      } else if (msg.type === 'error') {
        // go2rtc could not attach the microphone to this stream.
        this.fail(/codec|match|track/i.test(msg.value) ? 'המצלמה לא תומכת בדיבור (אין התאמת קודק)' : msg.value);
      }
    });
    ws.addEventListener('error', () => this.fail('אין חיבור לשרת'));
    window.setTimeout(() => {
      if (this.pc === pc && pc.connectionState !== 'connected') this.fail('המצלמה לא ענתה');
    }, 15_000);
  }

  private fail(message: string) {
    if (!this.pc && !this.mic) return;
    this.cleanup();
    this.onState('error', message);
  }

  stop() {
    this.cleanup();
    this.onState('idle');
  }

  private cleanup() {
    window.clearTimeout(this.timer);
    this.mic?.getTracks().forEach((t) => t.stop());
    this.mic = null;
    this.pc?.close();
    this.pc = null;
    if (this.ws && this.ws.readyState <= WebSocket.OPEN) this.ws.close();
    this.ws = null;
  }
}
