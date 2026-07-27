/**
 * Zod schemas for request validation and for constraining the AI's
 * structured output. The `photoAnalysisJsonSchema` object mirrors
 * `PhotoAnalysis` and is passed to the Messages API via
 * `output_config.format` so the model returns valid, parseable JSON.
 */
import { z } from "zod";
import { BIO_TONES, PHOTO_TAGS } from "./types";

export const analyzePhotoInputSchema = z.object({
  id: z.string().min(1),
  data: z.string().min(1),
  mediaType: z.enum(["image/jpeg", "image/png", "image/webp"]),
});

export const analyzeRequestSchema = z.object({
  photos: z.array(analyzePhotoInputSchema).min(1).max(9),
  bio: z.string().max(2000).optional(),
});

export const bioGenerateSchema = z.object({
  tone: z.enum(BIO_TONES),
  about: z.string().max(1000).optional(),
  interests: z.array(z.string().max(60)).max(15).optional(),
});

export const bioAnalyzeSchema = z.object({
  bio: z.string().min(1).max(2000),
});

export const coachSchema = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().min(1).max(4000),
      }),
    )
    .min(1)
    .max(40),
  /** Optional report context so the coach can reference the user's actual profile. */
  reportSummary: z.string().max(6000).optional(),
});

/**
 * JSON Schema handed to Claude for per-photo analysis.
 * Kept in a plain object (not derived from Zod) because the Messages API
 * structured-output validator has its own supported-subset rules.
 */
const attribute = {
  type: "object",
  properties: {
    score: { type: "number" },
    why: { type: "string" },
  },
  required: ["score", "why"],
  additionalProperties: false,
} as const;

export const photoAnalysisJsonSchema = {
  type: "object",
  properties: {
    score: { type: "number" },
    summary: { type: "string" },
    attributes: {
      type: "object",
      properties: {
        smile: attribute,
        eyeContact: attribute,
        faceVisibility: attribute,
        lighting: attribute,
        imageQuality: attribute,
        blur: attribute,
        background: attribute,
        bodyLanguage: attribute,
        outfit: attribute,
        grooming: attribute,
        composition: attribute,
        colorBalance: attribute,
        cropping: attribute,
        facialExpression: attribute,
      },
      required: [
        "smile",
        "eyeContact",
        "faceVisibility",
        "lighting",
        "imageQuality",
        "blur",
        "background",
        "bodyLanguage",
        "outfit",
        "grooming",
        "composition",
        "colorBalance",
        "cropping",
        "facialExpression",
      ],
      additionalProperties: false,
    },
    tags: { type: "array", items: { type: "string", enum: [...PHOTO_TAGS] } },
    authentic: { type: "boolean" },
    overEdited: { type: "boolean" },
    strongFirstPhoto: { type: "boolean" },
    suggestions: { type: "array", items: { type: "string" } },
  },
  required: [
    "score",
    "summary",
    "attributes",
    "tags",
    "authentic",
    "overEdited",
    "strongFirstPhoto",
    "suggestions",
  ],
  additionalProperties: false,
} as const;

export const bioAnalysisJsonSchema = {
  type: "object",
  properties: {
    originality: attribute,
    confidence: attribute,
    humor: attribute,
    length: attribute,
    attractiveness: attribute,
    conversationStarters: attribute,
    suggestions: { type: "array", items: { type: "string" } },
  },
  required: [
    "originality",
    "confidence",
    "humor",
    "length",
    "attractiveness",
    "conversationStarters",
    "suggestions",
  ],
  additionalProperties: false,
} as const;
