/**
 * Try the object detector on JPEG files:  npx tsx src/detect/cli.ts <model.onnx> <image.jpg>...
 * Prints what was found and how long it took. Useful to check the model on a snapshot.
 */
import { readFileSync } from 'node:fs';
import jpeg from 'jpeg-js';
import { ObjectDetector } from './yolox.js';

/** Decode a JPEG into an RGB24 buffer. */
export function jpegToRgb(file: string): { rgb: Uint8Array; width: number; height: number } {
  const j = jpeg.decode(readFileSync(file), { useTArray: true });
  const rgb = new Uint8Array(j.width * j.height * 3);
  for (let i = 0, k = 0; i < j.data.length; i += 4, k += 3) {
    rgb[k] = j.data[i];
    rgb[k + 1] = j.data[i + 1];
    rgb[k + 2] = j.data[i + 2];
  }
  return { rgb, width: j.width, height: j.height };
}

if (process.argv[1]?.replace(/\\/g, '/').endsWith('detect/cli.ts') || process.argv[1]?.replace(/\\/g, '/').endsWith('detect/cli.js')) {
  const [model, ...images] = process.argv.slice(2);
  if (!model || !images.length) {
    console.error('usage: cli <model.onnx> <image.jpg>...');
    process.exit(2);
  }
  const det = await ObjectDetector.load(model);
  for (const f of images) {
    const { rgb, width, height } = jpegToRgb(f);
    await det.detect(rgb, width, height); // warm-up
    const t = Date.now();
    let r = await det.detect(rgb, width, height);
    for (let i = 0; i < 4; i++) r = await det.detect(rgb, width, height);
    console.log(`${f.split(/[\\/]/).pop()} ${width}x${height} — ${(Date.now() - t) / 5} ms per frame`);
    for (const d of r) console.log(`  ${d.label.padEnd(8)} ${d.cls.padEnd(11)} ${d.score.toFixed(2)}  box ${d.box.map((v) => v.toFixed(2)).join(' ')}`);
    if (!r.length) console.log('  (nothing)');
  }
}
