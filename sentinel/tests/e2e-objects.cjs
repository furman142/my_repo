/**
 * End-to-end test of people / vehicle recognition against a RUNNING SENTINEL.
 *
 * DEMO 1 must be fed a video in which a person walks past a parked vehicle, e.g.
 *   SENTINEL_TEST_DEMO1_INPUT="-stream_loop -1 -i walk.mp4" npm start
 * with demo mode, motion detection and object recognition enabled.
 *
 *   BASE_URL=http://127.0.0.1:8080 OUT_DIR=. node tests/e2e-objects.cjs
 */
const { chromium } = require('playwright');
const path = require('node:path');

const B = process.env.BASE_URL || 'http://127.0.0.1:8080';
const OUT = process.env.OUT_DIR || '.';
let failed = 0;
const check = (n, ok, d = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`);
};
const put = (body) => fetch(B + '/api/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const get = (p) => fetch(B + p).then((r) => r.json());

(async () => {
  const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const p = await b.newPage({ viewport: { width: 1500, height: 950 } });
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));

  // model state
  let st;
  for (let i = 0; i < 30; i++) {
    st = await get('/api/motion/status');
    if (st.objects.state === 'ready' || st.objects.state === 'error') break;
    await new Promise((r) => setTimeout(r, 1000));
  }
  check('recognition model loads', st.objects.state === 'ready', JSON.stringify(st.objects));

  // live chip on the tile
  await p.goto(B + '/');
  const chip = await p.waitForSelector('section[data-camera="sentinel_demo_1"] [data-chip="person"]', { timeout: 60000 }).then(() => true).catch(() => false);
  check('live tile shows "person" while the person walks', chip);
  await p.screenshot({ path: path.join(OUT, 'obj-dashboard.png') });

  // close the running event, start a new one with the page open -> the stored event is checked below
  await put({ motion: { enabled: false } });
  await new Promise((r) => setTimeout(r, 1500));
  const d = new Date();
  const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const { events } = await get(`/api/events?date=${day}`);
  const ev = events.find((e) => e.camera === 'sentinel_demo_1');
  check('event is labelled person', !!ev && ev.labels && ev.labels.person > 0.5, ev ? JSON.stringify(ev.labels) : 'no event');
  check('the parked vehicle is NOT counted (it does not move)', !!ev && ev.labels && ev.labels.vehicle === undefined);
  check('thumbnail marks one moving person', !!ev && Array.isArray(ev.objects) && ev.objects.length === 1 && ev.objects[0].label === 'person', ev ? JSON.stringify(ev.objects) : '');
  await put({ motion: { enabled: true } });

  // events page
  await p.goto(B + '/events');
  await p.waitForSelector('article [data-label="person"]', { timeout: 15000 }).catch(() => {});
  check('events page shows the person badge', (await p.locator('article [data-label="person"]').count()) >= 1);
  const total = await p.locator('article').count();
  await p.locator('button[data-kind="vehicle"]').click();
  const vehicles = await p.locator('article').count();
  await p.locator('button[data-kind="person"]').click();
  const people = await p.locator('article').count();
  check('filter by kind works', people >= 1 && vehicles === 0 && people <= total, `all=${total} people=${people} vehicles=${vehicles}`);
  await p.screenshot({ path: path.join(OUT, 'obj-events.png') });

  // settings + stats
  await p.goto(B + '/settings');
  await p.locator('[role=tab]:has-text("הקלטה ותנועה")').click();
  const ready = await p.waitForSelector('[data-objects-state="ready"]', { timeout: 10000 }).then(() => true).catch(() => false);
  check('settings show recognition as active', ready);
  await p.locator('section', { hasText: 'זיהוי אנשים, רכבים' }).first().screenshot({ path: path.join(OUT, 'obj-settings.png') });
  await p.goto(B + '/stats');
  const line = await p.waitForSelector('[data-testid="by-label"]', { timeout: 10000 }).then((el) => el.innerText()).catch(() => '');
  check('statistics count recognised people', /אנשים\s*[1-9]/.test(line.replace(/\n/g, ' ')), line.replace(/\s+/g, ' '));

  check('no page errors', errs.length === 0, errs.join(' | '));
  await b.close();
  process.exit(failed ? 1 : 0);
})();
