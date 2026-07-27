/**
 * Claude-backed analysis with automatic fallback to the deterministic mock.
 *
 * Photos are analyzed concurrently. If a single photo fails (transient API
 * error, refusal, malformed output) we fall back to the mock for that photo
 * rather than failing the whole request — the user always gets a full report.
 *
 * We ask the model for JSON matching our schema and parse the first text
 * block. This keeps the code robust across SDK versions; `normalize*` repairs
 * anything the model gets slightly wrong so downstream code can trust the shape.
 */
import type Anthropic from "@anthropic-ai/sdk";
import { getClient, isAiEnabled, TEXT_MODEL, VISION_MODEL } from "./config";
import { BIO_ANALYSIS_PROMPT, PHOTO_ANALYSIS_PROMPT } from "./prompts";
import { bioAnalysisJsonSchema, photoAnalysisJsonSchema } from "../schemas";
import { mockAnalyzeBio, mockAnalyzePhoto } from "./mock-analyzer";
import type { AnalyzePhotoInput, BioAnalysis, PhotoAnalysis } from "../types";

/** Concatenate the text blocks of a response. */
function textOf(content: Anthropic.ContentBlock[]): string {
  return content.map((b) => (b.type === "text" ? b.text : "")).join("");
}

/** Extract and parse a JSON object from a model response (tolerates prose around it). */
function parseJson(content: Anthropic.ContentBlock[]): unknown {
  const text = textOf(content).trim();
  try {
    return JSON.parse(text);
  } catch {
    // Fall back to the first {...} block if the model wrapped it in prose.
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(text.slice(start, end + 1));
    throw new Error("No parseable JSON in response");
  }
}

function jsonInstruction(schema: object): string {
  return `\n\nReturn ONLY a JSON object matching this schema (no markdown, no prose):\n${JSON.stringify(schema)}`;
}

/** Clamp/repair a model-produced analysis so downstream code can trust it. */
function normalizePhoto(raw: unknown, input: AnalyzePhotoInput): PhotoAnalysis {
  const r = (raw ?? {}) as Partial<PhotoAnalysis> & {
    attributes?: Record<string, { score?: number; why?: string }>;
  };
  const clamp = (n: unknown) =>
    Math.max(0, Math.min(10, typeof n === "number" && Number.isFinite(n) ? n : 5));
  const attrs: Record<string, { score?: number; why?: string }> = r.attributes ?? {};
  const fix = (key: string, fallbackWhy: string) => ({
    score: clamp(attrs[key]?.score),
    why: attrs[key]?.why || fallbackWhy,
  });

  return {
    id: input.id,
    score: clamp(r.score),
    summary: r.summary || "Analyzed.",
    attributes: {
      smile: fix("smile", "Expression assessed."),
      eyeContact: fix("eyeContact", "Camera engagement assessed."),
      faceVisibility: fix("faceVisibility", "Face visibility assessed."),
      lighting: fix("lighting", "Lighting assessed."),
      imageQuality: fix("imageQuality", "Image quality assessed."),
      blur: fix("blur", "Sharpness assessed."),
      background: fix("background", "Background assessed."),
      bodyLanguage: fix("bodyLanguage", "Body language assessed."),
      outfit: fix("outfit", "Outfit assessed."),
      grooming: fix("grooming", "Grooming assessed."),
      composition: fix("composition", "Composition assessed."),
      colorBalance: fix("colorBalance", "Color balance assessed."),
      cropping: fix("cropping", "Cropping assessed."),
      facialExpression: fix("facialExpression", "Expression assessed."),
    },
    tags: Array.isArray(r.tags) ? (r.tags as PhotoAnalysis["tags"]) : [],
    authentic: Boolean(r.authentic ?? true),
    overEdited: Boolean(r.overEdited ?? false),
    strongFirstPhoto: Boolean(r.strongFirstPhoto ?? false),
    suggestions: Array.isArray(r.suggestions) ? r.suggestions.slice(0, 3) : [],
  };
}

export async function analyzePhoto(input: AnalyzePhotoInput): Promise<PhotoAnalysis> {
  if (!isAiEnabled()) return mockAnalyzePhoto(input);

  try {
    const client = getClient();
    const response = await client.messages.create({
      model: VISION_MODEL,
      max_tokens: 2048,
      messages: [
        {
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: input.mediaType, data: input.data } },
            { type: "text", text: PHOTO_ANALYSIS_PROMPT + jsonInstruction(photoAnalysisJsonSchema) },
          ],
        },
      ],
    });

    if (response.stop_reason === "refusal") return mockAnalyzePhoto(input);
    return normalizePhoto(parseJson(response.content), input);
  } catch (err) {
    console.error(`[analyzer] photo ${input.id} failed, using fallback:`, err);
    return mockAnalyzePhoto(input);
  }
}

export async function analyzePhotos(inputs: AnalyzePhotoInput[]): Promise<PhotoAnalysis[]> {
  // Concurrency cap so a 9-photo upload doesn't fan out to 9 simultaneous calls.
  const CONCURRENCY = 4;
  const out: PhotoAnalysis[] = new Array(inputs.length);
  let cursor = 0;
  async function worker() {
    while (cursor < inputs.length) {
      const i = cursor++;
      out[i] = await analyzePhoto(inputs[i]!);
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, inputs.length) }, worker));
  return out;
}

export async function analyzeBio(bio: string): Promise<BioAnalysis> {
  if (!isAiEnabled()) return mockAnalyzeBio(bio);
  try {
    const client = getClient();
    const response = await client.messages.create({
      model: TEXT_MODEL,
      max_tokens: 1500,
      messages: [
        {
          role: "user",
          content: `${BIO_ANALYSIS_PROMPT}${jsonInstruction(bioAnalysisJsonSchema)}\n\nBio:\n"""${bio}"""`,
        },
      ],
    });
    if (response.stop_reason === "refusal") return mockAnalyzeBio(bio);
    return parseJson(response.content) as BioAnalysis;
  } catch (err) {
    console.error("[analyzer] bio analysis failed, using fallback:", err);
    return mockAnalyzeBio(bio);
  }
}
