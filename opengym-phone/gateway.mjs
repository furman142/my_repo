// openGym phone gateway: replaces the nginx container from docker-compose.
// Serves the built frontend + exercise media and proxies /api to the openGym API,
// all on one origin (http://localhost:8080) so passkeys and the service worker work.
// Zero dependencies — runs on Termux's Node.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const APP = process.env.OPENGYM_DIR || path.join(process.env.HOME, 'openGym');
const DIST = path.join(APP, 'frontend', 'dist');
const MEDIA = path.join(APP, 'catalogue', 'media');
const WEB_PORT = Number(process.env.WEB_PORT || 8080);
const API_PORT = Number(process.env.PORT || 3000);
const HOST = process.env.BIND || '127.0.0.1';

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.webp': 'image/webp', '.avif': 'image/avif', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.woff2': 'font/woff2', '.woff': 'font/woff',
  '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml',
};

function proxy(req, res) {
  const up = http.request({
    host: '127.0.0.1', port: API_PORT, method: req.method, path: req.url,
    headers: { ...req.headers, 'x-real-ip': req.socket.remoteAddress, 'x-forwarded-for': req.socket.remoteAddress, 'x-forwarded-proto': 'http' },
  }, (r) => { res.writeHead(r.statusCode, r.headers); r.pipe(res); });
  up.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end('API not running'); });
  req.pipe(up);
}

function send(res, file, stat, cache) {
  res.writeHead(200, {
    'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream',
    'Content-Length': stat.size, 'Cache-Control': cache,
    'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin',
  });
  fs.createReadStream(file).pipe(res);
}

function serveFrom(root, rel, res, cache) {
  const file = path.join(root, rel);
  if (!file.startsWith(root + path.sep) && file !== root) return false;
  try { const st = fs.statSync(file); if (st.isFile()) { send(res, file, st, cache); return true; } } catch {}
  return false;
}

http.createServer((req, res) => {
  let p;
  try { p = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch { res.writeHead(400); return res.end(); }
  if (p.startsWith('/api/')) return proxy(req, res);
  if (p.startsWith('/exercise-media/')) {
    if (serveFrom(MEDIA, p.slice('/exercise-media/'.length), res, 'public, max-age=2592000, immutable')) return;
    res.writeHead(404); return res.end();
  }
  const immutable = /\/assets\/[^/]+-[A-Za-z0-9_-]+\.(js|css)$/.test(p);
  if (p !== '/' && serveFrom(DIST, p.slice(1), res, immutable ? 'public, max-age=31536000, immutable' : 'no-cache')) return;
  // SPA fallback
  serveFrom(DIST, 'index.html', res, 'no-cache') || (res.writeHead(500), res.end('frontend not built'));
}).listen(WEB_PORT, HOST, () => console.log(`openGym on http://localhost:${WEB_PORT}`));
