import type { FastifyInstance } from 'fastify';
import WebSocket from 'ws';
import { config } from '../config.js';
import { go2rtcAuthHeader } from '../go2rtc/client.js';
import { redact } from '../security/redact.js';
import { allowedStreams } from '../settings/store.js';

/**
 * WebSocket bridge: browser <-> SENTINEL <-> go2rtc /api/ws.
 *
 * The browser never talks to go2rtc directly and never sees its password. Only stream
 * names configured in SENTINEL settings can be opened. go2rtc's ws protocol carries
 * WebRTC signalling (SDP/ICE as JSON text) and MSE/MP4 media (binary); both are relayed
 * unchanged, except go2rtc error texts which are redacted.
 */
export function registerStreamRoutes(app: FastifyInstance) {
  app.get<{ Querystring: { src?: string } }>('/api/ws', { websocket: true }, (client, req) => {
    const src = String(req.query.src ?? '');
    if (!allowedStreams().has(src)) {
      client.close(4404, 'unknown stream');
      return;
    }

    const upstream = new WebSocket(
      `ws://127.0.0.1:${config.go2rtc.apiPort}/api/ws?${new URLSearchParams({ src })}`,
      { headers: { Authorization: go2rtcAuthHeader() }, perMessageDeflate: false },
    );

    const pending: Array<{ data: WebSocket.RawData; binary: boolean }> = [];

    client.on('message', (data, isBinary) => {
      if (upstream.readyState === WebSocket.OPEN) upstream.send(data, { binary: isBinary });
      else if (upstream.readyState === WebSocket.CONNECTING) pending.push({ data, binary: isBinary });
    });

    upstream.on('open', () => {
      for (const m of pending.splice(0)) upstream.send(m.data, { binary: m.binary });
    });

    upstream.on('message', (data, isBinary) => {
      if (client.readyState !== WebSocket.OPEN) return;
      if (!isBinary) {
        const text = data.toString();
        if (text.includes('"error"')) {
          client.send(redact(text));
          return;
        }
        client.send(text);
        return;
      }
      client.send(data, { binary: true });
    });

    const closeBoth = () => {
      if (client.readyState === WebSocket.OPEN || client.readyState === WebSocket.CONNECTING) client.close();
      if (upstream.readyState === WebSocket.OPEN || upstream.readyState === WebSocket.CONNECTING) upstream.terminate();
    };
    upstream.on('close', closeBoth);
    upstream.on('error', (err) => {
      req.log.warn(`stream ${src}: go2rtc websocket error: ${redact(err.message)}`);
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify({ type: 'error', value: 'go2rtc unavailable' }));
      }
      closeBoth();
    });
    client.on('close', closeBoth);
    client.on('error', closeBoth);
  });
}
