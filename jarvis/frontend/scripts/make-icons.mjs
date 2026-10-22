// Rasterises public/icons/icon.svg into the PNG sizes iOS / Android need, using the local Chromium.
import { chromium } from "@playwright/test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const dir = fileURLToPath(new URL("../public/icons/", import.meta.url));
const svg = readFileSync(dir + "icon.svg", "utf8");
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const page = await browser.newPage();
for (const [name, size, pad] of [["icon-192.png", 192, 0], ["icon-512.png", 512, 0], ["apple-touch-icon.png", 180, 0],
  ["icon-maskable-512.png", 512, 0.1]]) {
  await page.setViewportSize({ width: size, height: size });
  const inner = Math.round(size * (1 - pad * 2));
  await page.setContent(`<html><body style="margin:0;background:#01060b;display:grid;place-items:center;height:${size}px">
    <div style="width:${inner}px;height:${inner}px">${svg.replace("<svg ", '<svg width="100%" height="100%" ')}</div></body></html>`);
  await page.screenshot({ path: dir + name, omitBackground: false });
  console.log("wrote", name);
}
await browser.close();
