import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import type { FastifyBaseLogger } from 'fastify';
import { config, paths } from '../config.js';
import { redact } from '../security/redact.js';
import { loadSecrets, writePrivate } from '../security/secrets.js';
import { getSettings } from '../settings/store.js';
import { ffmpegPath } from '../system/ffmpeg.js';
import { go2rtc } from './client.js';

type Logger = Record<'info' | 'warn' | 'error', (msg: string) => void>;

export type Go2rtcState = 'missing-binary' | 'starting' | 'running' | 'restarting' | 'stopped' | 'external';

/**
 * Demo streams: a synthetic ffmpeg test pattern piped into go2rtc (exec "pipe flow", MPEG-TS on
 * stdout). They are NOT cameras and are always labelled DEMO in the UI. The pipe flow is used on
 * purpose: go2rtc's RTSP server (needed by ffmpeg:/exec {output} sources) stays disabled, because
 * go2rtc skips RTSP authentication for localhost connections.
 */
const q = (bin: string) => (bin.includes(' ') ? `"${bin}"` : bin);

function demoStreams(ffmpeg: string): Record<string, string[]> {
  const demo = (pattern: string, tone: boolean) =>
    `exec:${q(ffmpeg)} -hide_banner -loglevel error -re -f lavfi -i ${pattern}=size=1280x720:rate=15 ` +
    (tone ? '-f lavfi -i sine=frequency=440:sample_rate=48000 -c:a aac -b:a 64k ' : '') +
    '-c:v libx264 -preset ultrafast -tune zerolatency -profile:v baseline -g 30 -pix_fmt yuv420p -f mpegts -';
  return {
    sentinel_demo_1: [
      demo('testsrc2', true), // with a 440 Hz test tone to exercise the audio path
      // Talk self-test: whatever is "spoken" to DEMO 1 is written to data/demo-talk.alaw (raw 8 kHz A-law)
      // (go2rtc exec backchannel, documented in its exec source).
      `exec:${q(ffmpeg)} -hide_banner -loglevel error -f alaw -ar 8000 -i - -c copy -flush_packets 1 -y -f alaw demo-talk.alaw#backchannel=1#audio=alaw/8000`,
    ],
    sentinel_demo_2: [demo('smptebars', false)],
  };
}

/** WebRTC port needed: LAN mode (phones) or two-way audio (the microphone travels over WebRTC). */
export function webrtcEnabled(): boolean {
  return config.go2rtc.webrtc || getSettings().talk.enabled;
}

const overridePath = () => path.join(config.dataDir, 'go2rtc.sentinel.yaml');

/**
 * Security-relevant go2rtc settings. Written to a private file (not argv, so the
 * password never shows up in `ps`) and loaded AFTER data/go2rtc.yaml, so they
 * always win over anything in the user-editable config.
 */
function writeOverrideConfig(ffmpeg: string): void {
  const s = loadSecrets();
  const override = {
    api: {
      listen: `127.0.0.1:${config.go2rtc.apiPort}`,
      username: s.go2rtcUser,
      password: s.go2rtcPassword,
      local_auth: true, // require the password even for requests from this computer
      origin: '', // no CORS
    },
    // Not needed by SENTINEL: keep every other server closed. (go2rtc's RTSP server does not
    // authenticate localhost clients, so it stays off.)
    rtsp: { listen: '' },
    rtmp: { listen: '' },
    srtp: { listen: '' },
    webrtc: {
      // Off in localhost-only mode unless two-way audio is enabled (see config.ts). Media is only sent to peers that negotiated
      // through the authenticated API (ICE credentials + DTLS fingerprint from the signalling).
      listen: webrtcEnabled() ? `:${config.go2rtc.webrtcPort}` : '',
      // No public STUN: media stays inside the home network.
      ice_servers: [],
    },
    log: { format: 'text', level: 'info' },
    streams: demoStreams(ffmpeg),
  };
  // JSON is valid YAML.
  writePrivate(overridePath(), JSON.stringify(override, null, 2));
}

/**
 * go2rtc edits this file itself (Xiaomi login, PUT /api/streams) with a line-based YAML patcher
 * that cannot add keys under an empty flow mapping such as `streams: {}` — it fails with
 * "yaml: line N: did not find expected key". So the file starts with comments only, and files
 * created by earlier SENTINEL versions are repaired on startup.
 */
export function repairUserConfig(text: string): string {
  return text.replace(/^streams:[ \t]*\{[ \t]*\}[ \t]*\r?\n?/m, '');
}

function ensureUserConfig(): void {
  if (existsSync(paths.go2rtcConfig)) {
    const text = readFileSync(paths.go2rtcConfig, 'utf8');
    const fixed = repairUserConfig(text);
    if (fixed !== text) writePrivate(paths.go2rtcConfig, fixed);
    return;
  }
  writePrivate(
    paths.go2rtcConfig,
    [
      '# go2rtc configuration owned by you and by the go2rtc WebUI.',
      '# The Xiaomi login (Add > Xiaomi) stores its token here. NEVER commit this file.',
      '# Security settings (api/webrtc/rtsp) are enforced by SENTINEL in go2rtc.sentinel.yaml.',
      '',
    ].join('\n'),
  );
}

class Go2rtcManager {
  state: Go2rtcState = 'stopped';
  private child: ChildProcess | null = null;
  private backoffMs = 1000;
  private stopping = false;
  private restartTimer: NodeJS.Timeout | null = null;
  lastExit: { code: number | null; at: string } | null = null;
  startedAt: string | null = null;

  private log: Logger = { info: (m) => console.log(m), warn: (m) => console.warn(m), error: (m) => console.error(m) };

  setLogger(log: FastifyBaseLogger) {
    this.log = { info: (m) => log.info(m), warn: (m) => log.warn(m), error: (m) => log.error(m) };
  }

  async start(): Promise<void> {
    if (!config.go2rtc.manage) {
      this.state = 'external';
      return;
    }
    if (!existsSync(config.go2rtc.bin)) {
      this.state = 'missing-binary';
      this.log.error(`go2rtc binary not found at ${config.go2rtc.bin}. Run: npm run install:go2rtc`);
      return;
    }
    if (await go2rtc.ping()) {
      // Something already answers with OUR credentials (e.g. a previous SENTINEL left it running).
      this.log.warn('go2rtc already running on the API port; reusing it');
      this.state = 'running';
      return;
    }
    ensureUserConfig();
    writeOverrideConfig(await ffmpegPath());
    this.spawnChild();
  }

  private spawnChild() {
    this.stopping = false;
    this.state = this.lastExit ? 'restarting' : 'starting';
    const child = spawn(
      config.go2rtc.bin,
      ['-config', paths.go2rtcConfig, '-config', overridePath()],
      { cwd: config.dataDir, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true },
    );
    this.child = child;
    const onLine = (line: string) => {
      const clean = redact(line.trim());
      if (!clean) return;
      if (/\b(ERR|FTL|error)\b/.test(clean)) this.log.warn(`[go2rtc] ${clean}`);
      else this.log.info(`[go2rtc] ${clean}`);
    };
    readline.createInterface({ input: child.stdout! }).on('line', onLine);
    readline.createInterface({ input: child.stderr! }).on('line', onLine);

    child.on('error', (err) => this.log.error(`go2rtc failed to start: ${redact(String(err))}`));
    child.on('exit', (code) => {
      this.child = null;
      this.lastExit = { code, at: new Date().toISOString() };
      if (this.stopping) {
        this.state = 'stopped';
        return;
      }
      this.state = 'restarting';
      this.log.warn(`go2rtc exited (code ${code}); restarting in ${this.backoffMs} ms`);
      this.restartTimer = setTimeout(() => this.spawnChild(), this.backoffMs);
      this.backoffMs = Math.min(this.backoffMs * 2, 30_000);
    });

    void this.waitReady();
  }

  private async waitReady() {
    for (let i = 0; i < 50; i++) {
      if (!this.child) return;
      if (await go2rtc.ping()) {
        this.state = 'running';
        this.startedAt = new Date().toISOString();
        this.backoffMs = 1000;
        return;
      }
      await new Promise((r) => setTimeout(r, 200));
    }
  }

  async stop(): Promise<void> {
    this.stopping = true;
    if (this.restartTimer) clearTimeout(this.restartTimer);
    const child = this.child;
    if (!child) return;
    await new Promise<void>((resolve) => {
      const t = setTimeout(() => {
        child.kill('SIGKILL');
        resolve();
      }, 3000);
      child.once('exit', () => {
        clearTimeout(t);
        resolve();
      });
      child.kill('SIGTERM');
    });
  }

  /** Restart go2rtc (e.g. after the Xiaomi login changed the config). */
  async restart(): Promise<void> {
    if (!config.go2rtc.manage) return;
    await this.stop();
    this.lastExit = null;
    await this.start();
  }
}

export const manager = new Go2rtcManager();
