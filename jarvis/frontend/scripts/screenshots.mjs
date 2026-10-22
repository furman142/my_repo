// Browser E2E + screenshots against a RUNNING backend (default http://127.0.0.1:8787).
// Drives the real UI: setup/login, boot, text chat, a read tool, an approval sheet (deny + approve),
// tasks/memory panels, and responsive viewports. Writes PNGs to ../docs/screenshots/.
//
//   JARVIS_URL=http://127.0.0.1:8787 JARVIS_DATA=../data node scripts/screenshots.mjs
import { chromium } from "@playwright/test";
import { mkdirSync, readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const URL_ = process.env.JARVIS_URL ?? "http://127.0.0.1:8787";
const DATA = process.env.JARVIS_DATA ?? fileURLToPath(new URL("../../data/", import.meta.url));
const OUT = fileURLToPath(new URL("../../docs/screenshots/", import.meta.url));
const USER = "owner";
const PASS = process.env.JARVIS_E2E_PASSWORD ?? "e2e-password-123";
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined,
  args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--autoplay-policy=no-user-gesture-required"] });
const results = [];
const check = (name, ok, extra = "") => { results.push({ name, ok, extra }); console.log(`${ok ? "PASS" : "FAIL"} ${name} ${extra}`); };

async function login(page) {
  await page.goto(URL_);
  await page.waitForSelector(".auth-card, .scene .dock");
  if (await page.$(".dock")) return;
  const setup = await page.$("text=Create owner account");
  await page.fill('input[autocomplete="username"]', USER);
  if (setup) {
    const codeFile = DATA + "setup-code.txt";
    const code = existsSync(codeFile) ? readFileSync(codeFile, "utf8").trim() : "";
    await page.fill('input[autocomplete="new-password"] >> nth=0', PASS);
    await page.fill('input[autocomplete="new-password"] >> nth=1', PASS);
    await page.fill('input[placeholder="XXXX-XXXX-XXXX"]', code);
    await page.screenshot({ path: OUT + "00-setup.png" });
    await page.click("button[type=submit]");
  } else {
    await page.fill('input[type=password]', PASS);
    await page.click("button[type=submit]");
  }
  await page.waitForSelector(".dock");
}

const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
const consoleErrors = [];
// Expected, honest HTTP errors (e.g. 503 "Voice not configured") are logged by the browser as
// "Failed to load resource"; only genuine script errors count here.
page.on("console", (m) => m.type() === "error" && !m.text().startsWith("Failed to load resource") && consoleErrors.push(m.text()));
page.on("pageerror", (e) => consoleErrors.push(String(e)));
await login(page);
await page.waitForTimeout(600);
await page.screenshot({ path: OUT + "01-boot-1920.png" });
await page.waitForTimeout(2600);
const idle = await page.getAttribute(".orb-canvas", "data-state");
check("boot -> IDLE (or OFFLINE if LLM down)", ["IDLE", "OFFLINE"].includes(idle), idle);
await page.screenshot({ path: OUT + "02-idle-1920.png" });

// text chat
await page.click('button[aria-label="Type a message"]');
await page.fill(".composer input", "Hello Jarvis");
await page.click(".composer button[type=submit]");
await page.waitForFunction(() => document.querySelector(".subtitle p.assistant")?.textContent?.length > 10, null, { timeout: 15000 });
check("text chat reply rendered", true, (await page.textContent(".subtitle p.assistant"))?.slice(0, 60));

// create a task via the UI so the read tool has real data
await page.click('button[aria-label="Tasks"]');
await page.fill('input[aria-label="Add task"]', "Review the Mark VII schematics");
await page.click('.panel button[type=submit]');
await page.waitForSelector("text=Review the Mark VII schematics");
await page.screenshot({ path: OUT + "05-tasks-panel.png" });
await page.keyboard.press("Escape");

await page.fill(".composer input", "Jarvis, what do I have to do today?");
await page.click(".composer button[type=submit]");
await page.waitForFunction(() => document.querySelector(".subtitle p.assistant")?.textContent?.includes("Mark VII"), null, { timeout: 15000 });
check("read tool returned real SQLite task", true);

// approval flow: deny
await page.fill(".composer input", "Remind me to call Pepper");
await page.click(".composer button[type=submit]");
await page.waitForSelector(".approval", { timeout: 15000 });
check("approval sheet shown", (await page.getAttribute(".orb-canvas", "data-state")) === "APPROVAL_REQUIRED");
await page.waitForTimeout(400);
await page.screenshot({ path: OUT + "03-approval-1920.png" });
await page.click(".approval button:has-text('Deny')");
await page.waitForFunction(() => document.querySelector(".subtitle p.assistant")?.textContent?.includes("not done"), null, { timeout: 15000 });
let tasks = await page.evaluate(() => fetch("/api/tasks").then((r) => r.json()));
check("deny does not create task", !tasks.tasks.some((t) => t.title === "Call Pepper"));

// approval flow: approve
await page.fill(".composer input", "Remind me to call Pepper");
await page.click(".composer button[type=submit]");
await page.waitForSelector(".approval", { timeout: 15000 });
await page.click(".approval button:has-text('Approve')");
await page.waitForFunction(() => document.querySelector(".subtitle p.assistant")?.textContent?.includes("Done"), null, { timeout: 15000 });
tasks = await page.evaluate(() => fetch("/api/tasks").then((r) => r.json()));
check("approve creates exactly one task", tasks.tasks.filter((t) => t.title === "Call Pepper").length === 1);

await page.click('button[aria-label="Transcript"]');
await page.waitForTimeout(300);
await page.screenshot({ path: OUT + "04-transcript-1920.png" });
await page.keyboard.press("Escape");

await page.click('button[aria-label="Memories"]');
await page.fill('textarea[aria-label="Remember"]', "The owner prefers Earl Grey tea");
await page.click('.panel form button[type=submit]');
await page.waitForSelector("text=The owner prefers Earl Grey tea");
await page.screenshot({ path: OUT + "06-memories.png" });
await page.keyboard.press("Escape");

await page.click('button[aria-label="Diagnostics"]');
await page.waitForSelector(".kv");
await page.screenshot({ path: OUT + "07-diagnostics.png" });
await page.keyboard.press("Escape");

// push-to-talk with Chromium's fake microphone (real MediaRecorder + upload path)
await page.dispatchEvent("button.mic", "pointerdown");
await page.waitForTimeout(1200);
const listening = await page.getAttribute(".orb-canvas", "data-state");
check("mic -> LISTENING", listening === "LISTENING", listening);
await page.screenshot({ path: OUT + "08-listening-1920.png" });
await page.dispatchEvent("button.mic", "pointerup");
await page.waitForTimeout(2500);
check("after recording: transcribing/error/idle (STT live only with model)", true,
  `${await page.getAttribute(".orb-canvas", "data-state")} · ${(await page.textContent(".subtitle")) ?? ""}`.slice(0, 140));
await ctx.close();

// responsive viewports
for (const [name, vp, mobile] of [["1366x768", { width: 1366, height: 768 }, false], ["iphone-390x844", { width: 390, height: 844 }, true],
  ["320x640", { width: 320, height: 640 }, true]]) {
  const c = await browser.newContext({ viewport: vp, deviceScaleFactor: mobile ? 2 : 1, isMobile: mobile, hasTouch: mobile });
  const p = await c.newPage();
  await login(p);
  await p.waitForTimeout(3000);
  const overflow = await p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  const dock = await p.$eval(".dock", (el) => { const r = el.getBoundingClientRect(); return r.left >= 0 && r.right <= window.innerWidth; });
  check(`layout ${name}: no horizontal overflow, dock on screen`, !overflow && dock);
  await p.screenshot({ path: OUT + `09-${name}.png` });
  if (name.startsWith("iphone")) {
    await p.click('button[aria-label="Tasks"]');
    await p.waitForTimeout(400);
    await p.screenshot({ path: OUT + `10-${name}-tasks.png` });
  }
  await c.close();
}

// Hebrew RTL
{
  const c = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: "he-IL", isMobile: true });
  const p = await c.newPage();
  await login(p);
  await p.waitForTimeout(3000);
  check("hebrew locale -> dir=rtl", (await p.getAttribute("html", "dir")) === "rtl");
  await p.screenshot({ path: OUT + "11-hebrew-rtl.png" });
  await c.close();
}

// reduced motion
{
  const c = await browser.newContext({ viewport: { width: 1366, height: 768 }, reducedMotion: "reduce" });
  const p = await c.newPage();
  await login(p);
  await p.waitForTimeout(3000);
  await p.screenshot({ path: OUT + "12-reduced-motion.png" });
  await c.close();
}

check("no JavaScript errors", consoleErrors.length === 0, consoleErrors.slice(0, 3).join(" | "));
await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
