import { VideoRTC } from '../vendor/video-rtc.js';

export type Transport = 'webrtc' | 'mse' | 'none';

/**
 * go2rtc's official player, tuned for SENTINEL:
 *  - no public STUN servers (everything stays on the home network)
 *  - no native controls (the dashboard draws its own), always starts muted (autoplay policy)
 *  - faster reconnect (5 s instead of 15 s)
 *  - go2rtc "error" messages are re-emitted as a DOM event so the UI can show the real cause
 */
export class SentinelVideo extends VideoRTC {
  constructor() {
    super();
    this.mode = 'webrtc,mse,hls';
    this.media = 'video,audio';
    this.RECONNECT_TIMEOUT = 5000;
    this.visibilityCheck = false; // command-center screens keep streaming when the tab is in background
    this.pcConfig = { bundlePolicy: 'max-bundle', iceServers: [] };
  }

  oninit() {
    super.oninit();
    const v = this.video!;
    v.controls = false;
    v.muted = true;
    v.autoplay = true;
    v.style.objectFit = 'contain';
    v.style.background = '#000';
  }

  onopen() {
    const modes = super.onopen();
    if (this.onmessage) {
      this.onmessage['sentinel'] = (msg) => {
        if (msg.type === 'error') {
          this.dispatchEvent(new CustomEvent('stream-error', { detail: String(msg.value) }));
        }
      };
    }
    this.dispatchEvent(new CustomEvent('stream-open'));
    return modes;
  }

  onclose() {
    const r = super.onclose();
    this.dispatchEvent(new CustomEvent('stream-close'));
    return r;
  }

  /** Which path currently feeds the <video>. */
  get transport(): Transport {
    if (this.pcState === WebSocket.OPEN) return 'webrtc';
    if (this.video?.src || this.mseCodecs) return 'mse';
    return 'none';
  }

  /** True when the live media actually contains an audio track. */
  get hasAudioTrack(): boolean {
    const so = this.video?.srcObject;
    if (so instanceof MediaStream) return so.getAudioTracks().length > 0;
    return /mp4a|opus|flac/.test(this.mseCodecs);
  }

  /** Hard reconnect (used by the stall watchdog and the manual retry button). */
  reconnect() {
    this.ondisconnect();
    this.onconnect();
  }
}

if (!customElements.get('sentinel-video')) {
  customElements.define('sentinel-video', SentinelVideo);
}

