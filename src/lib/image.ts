/**
 * Client-side image utilities.
 *
 * Privacy by design: photos are compressed and converted to base64 IN THE
 * BROWSER, sent to the server only for the duration of a single analysis
 * request, and never written to disk on the server. Nothing is persisted
 * unless the user explicitly opts in (see docs/PRIVACY.md).
 */

export interface PreparedImage {
  id: string;
  /** base64 without the data: prefix — ready for the Anthropic API. */
  data: string;
  /** data URL for previews. */
  previewUrl: string;
  mediaType: "image/jpeg";
  width: number;
  height: number;
  originalName: string;
}

const MAX_DIMENSION = 1568; // Matches a good balance of detail vs. payload size.
const JPEG_QUALITY = 0.82;

let counter = 0;
function nextId(): string {
  counter += 1;
  return `photo-${Date.now().toString(36)}-${counter}`;
}

/**
 * Compress + resize an image File to a bounded JPEG using an offscreen canvas.
 * Reduces upload size dramatically and normalizes the media type.
 */
export async function prepareImage(file: File): Promise<PreparedImage> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_DIMENSION / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context unavailable");
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  const dataUrl = canvas.toDataURL("image/jpeg", JPEG_QUALITY);
  const data = dataUrl.split(",")[1] ?? "";

  return {
    id: nextId(),
    data,
    previewUrl: dataUrl,
    mediaType: "image/jpeg",
    width,
    height,
    originalName: file.name,
  };
}

export async function prepareImages(files: File[]): Promise<PreparedImage[]> {
  const images: PreparedImage[] = [];
  for (const file of files) {
    if (!file.type.startsWith("image/")) continue;
    images.push(await prepareImage(file));
  }
  return images;
}
