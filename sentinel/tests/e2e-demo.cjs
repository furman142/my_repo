/**
 * End-to-end browser test against a RUNNING SENTINEL in demo mode.
 *
 *   npm start                      # in another terminal, with Demo mode enabled in Settings
 *   node tests/e2e-demo.cjs        # needs `playwright` resolvable (npx playwright / global)
 *
 * It exercises the real pipeline: go2rtc -> SENTINEL WebSocket bridge -> go2rtc's player in
 * Chromium. Demo streams are synthetic ffmpeg test patterns, NOT cameras.
 * Options: BASE_URL (default http://127.0.0.1:8080), OUT_DIR for screenshots,
 *          KILL_GO2RTC=1 to also test crash recovery (kills the go2rtc process).
 */
const { chromium, devices } = require('playwright');
const { execSync } = require('node:child_process');
const path = require('node:path');

const BASE = process.env.BASE_URL || 'http://127.0.0.1:8080';
const OUT = process.env.OUT_DIR || '.';
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
};

const tiles = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll('sentinel-video')].map((p) => ({
      transport: p.transport,
      w: p.video.videoWidth,
      h: p.video.videoHeight,
      t: p.video.currentTime,
      audio: p.hasAudioTrack,
      state: p.closest('section').dataset.state,
    })),
  );

/** Wait until at least n tiles report the given state (data-state is set from real frames). */
const waitState = (page, state, n, timeout) =>
  page
    .waitForFunction(([state, n]) => document.querySelectorAll(`section[data-camera][data-state="${state}"]`).length >= n, [state, n], { timeout })
    .then(() => true)
    .catch(() => false);

(async () => {
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });

  // ---------- desktop ----------
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

  await page.goto(BASE + '/');
  const t0 = Date.now();
  const bothLive = await waitState(page, 'live', 2, 45_000);
  check('two streams render frames simultaneously', bothLive, `${Date.now() - t0} ms`);
  await page.waitForTimeout(2500);
  const a = await tiles(page);
  await page.waitForTimeout(2000);
  const b = await tiles(page);
  check(
    'video time advances on both tiles',
    a.length === 2 && b.every((x, i) => x.t > a[i].t + 1),
    JSON.stringify(b.map((x) => ({ transport: x.transport, res: `${x.w}x${x.h}`, t: +x.t.toFixed(1) }))),
  );
  check('header shows real-camera count separately (demo not counted)', (await page.locator('header').first().innerText()).includes('0/0'));
  await page.screenshot({ path: path.join(OUT, 'e2e-desktop.png') });

  // audio: demo 1 carries a 440 Hz tone, demo 2 has no audio track
  const mute = page.locator('section[aria-label] button[aria-label="הפעל אודיו"]');
  check('audio button enabled only where the stream has an audio track', b[0].audio === true && b[1].audio === false && (await mute.count()) === 1,
    `tile1 audio=${b[0].audio} tile2 audio=${b[1].audio}`);
  if ((await mute.count()) === 1) {
    await page.locator('section[aria-label]').first().hover();
    await mute.click();
    const unmuted = await page.evaluate(() => document.querySelector('sentinel-video').video.muted === false);
    check('unmute toggles the <video> audio', unmuted);
  }

  // fullscreen
  const first = page.locator('section[aria-label]').first();
  await first.hover();
  await first.locator('button[aria-label="מסך מלא"]').click();
  await page.waitForTimeout(500);
  const fs = await page.evaluate(() => document.fullscreenElement?.getAttribute('aria-label') ?? null);
  check('fullscreen on a single camera', !!fs, fs ?? 'no fullscreen element');
  await page.screenshot({ path: path.join(OUT, 'e2e-fullscreen.png') });
  await page.evaluate(() => document.exitFullscreen());
  await page.waitForTimeout(300);

  // snapshot
  await first.hover();
  const [dl] = await Promise.all([
    page.waitForEvent('download', { timeout: 5000 }).catch(() => null),
    first.locator('button[aria-label="צילום תמונה"]').click(),
  ]);
  check('snapshot downloads a JPEG from the live frame', !!dl && /\.jpg$/.test(dl.suggestedFilename()), dl?.suggestedFilename() ?? '');

  // crash recovery
  if (process.env.KILL_GO2RTC === '1') {
    execSync('pkill -f "bin/go2rt[c]" || true'); // [c] so pkill does not match its own shell
    const wentDown = await page
      .waitForFunction(() => [...document.querySelectorAll('section[data-camera]')].some((t) => t.dataset.state !== 'live'), null, { timeout: 15_000 })
      .then(() => true)
      .catch(() => false);
    check('tiles stop showing LIVE when the stream dies', wentDown);
    const t1 = Date.now();
    const back = await waitState(page, 'live', 2, 60_000);
    check('automatic reconnect after go2rtc restart', back, `${Date.now() - t1} ms`);
  }

  // ---------- phone ----------
  const phone = await browser.newContext({ ...devices['iPhone 13'] });
  const p2 = await phone.newPage();
  await p2.goto(BASE + '/');
  await waitState(p2, 'live', 1, 30_000);
  await p2.waitForTimeout(1500);
  const overflow = await p2.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check('phone layout has no horizontal overflow', overflow <= 0, `overflow=${overflow}px`);
  check('phone bottom navigation visible', await p2.locator('nav[aria-label="ניווט ראשי"]').last().isVisible());
  await p2.screenshot({ path: path.join(OUT, 'e2e-phone.png'), fullPage: true });

  check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  await browser.close();
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exit(failed ? 1 : 0);
})();
