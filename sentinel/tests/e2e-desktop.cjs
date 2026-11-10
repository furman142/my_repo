const { _electron: electron } = require('playwright');
// Usage (after npm run dist in sentinel/desktop):  xvfb-run -a node tests/e2e-desktop.cjs   (Linux)
// Drives the PACKAGED app. Env: APP_EXE (default release/linux-unpacked/sentinel-desktop), OUT_DIR.
const out = (f) => require('path').join(process.env.OUT_DIR || '.', f);
const check = (n, ok, d = '') => console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`);
(async () => {
  const appExe = process.env.APP_EXE || require('path').join(__dirname, '..', 'desktop', 'release', 'linux-unpacked', 'sentinel-desktop');
  const app = await electron.launch({ executablePath: appExe, args: ['--no-sandbox'], timeout: 60000 });
  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  const url = win.url();
  check('window opens on the local dashboard', /^http:\/\/127\.0\.0\.1:\d+\/$/.test(url), url);
  await win.waitForSelector('text=SENTINEL', { timeout: 20000 });

  // enable demo mode through the API (same as the Settings checkbox)
  const base = new URL(url).origin;
  await win.evaluate(async () => fetch('/api/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ demoMode: true }) }));
  await win.reload();
  const live = await win.waitForFunction(() => [...document.querySelectorAll('section[aria-label] > header > span:last-child')].filter((b) => b.textContent.trim() === 'DEMO').length >= 2, null, { timeout: 45000 }).then(() => true).catch(() => false);
  await win.waitForTimeout(2500);
  const tiles = await win.evaluate(() => [...document.querySelectorAll('sentinel-video')].map((p) => ({ t: p.transport, res: `${p.video.videoWidth}x${p.video.videoHeight}`, cur: +p.video.currentTime.toFixed(1), audio: p.hasAudioTrack })));
  check('both streams play inside the desktop app', live && tiles.every((x) => x.cur > 1), JSON.stringify(tiles));
  await win.screenshot({ path: out('desktop-app.png') });

  // motion detection with the bundled ffmpeg
  await win.evaluate(async () => fetch('/api/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ motion: { enabled: true } }) }));
  let ms = null;
  for (let i = 0; i < 20; i++) {
    ms = await win.evaluate(async () => (await fetch('/api/motion/status')).json());
    if (ms.detectors.some((d) => d.active)) break;
    await new Promise((r) => setTimeout(r, 1000));
  }
  check('motion detection runs with the bundled ffmpeg', ms.detectors.length === 2 && ms.detectors.some((d) => d.active) && ms.detectors.every((d) => d.state === 'watching'), JSON.stringify(ms.detectors.map((d) => [d.camera, d.state, !!d.active, d.lastError])));

  // go2rtc window with automatic login
  await win.goto(base + '/settings');
  await win.waitForSelector('a:has-text("פתח את go2rtc")');
  const [g2] = await Promise.all([app.waitForEvent('window', { timeout: 15000 }), win.click('a:has-text("פתח את go2rtc")')]);
  await g2.waitForLoadState('load');
  await g2.waitForTimeout(1500);
  const g2text = await g2.evaluate(() => document.body.innerText.slice(0, 200));
  check('go2rtc WebUI opens in-app, logged in automatically', /stream|Add|Config|Links/i.test(g2text), g2.url() + ' | ' + g2text.replace(/\s+/g, ' ').slice(0, 80));
  await g2.screenshot({ path: out('desktop-go2rtc.png') });

  // close main window -> keeps running in tray, server still up
  const winCount = (await app.windows()).length;
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach((w) => w.close()));
  await new Promise((r) => setTimeout(r, 1500));
  const stillUp = await fetch(base + '/api/health').then((r) => r.ok).catch(() => false);
  const hidden = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map((w) => ({ visible: w.isVisible(), url: w.webContents.getURL() })));
  check('closing the window keeps SENTINEL running (tray)', stillUp, JSON.stringify(hidden));

  // quit stops server and go2rtc
  await app.evaluate(({ app }) => app.quit());
  await new Promise((r) => setTimeout(r, 4000));
  const down = await fetch(base + '/api/health').then(() => false).catch(() => true);
  const { execSync } = require('child_process');
  const g2left = execSync('pgrep -f "resources/bin/go2rt[c]" || true').toString().trim();
  check('quit stops the server and go2rtc', down && !g2left, `go2rtc pids: ${g2left || 'none'}`);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
