/**
 * Core domain types for ProfilePilot.
 *
 * These types are the contract between the AI layer, the scoring engine,
 * the API routes, and the UI. Everything the analyzer produces flows through
 * here, so the shapes are intentionally explicit and self-documenting.
 */

/** The personas the bio generator can write in. */
export const BIO_TONES = [
  "funny",
  "confident",
  "minimal",
  "flirty",
  "adventure",
  "professional",
  "geek",
  "fitness",
  "luxury",
  "travel",
] as const;
export type BioTone = (typeof BIO_TONES)[number];

/** Photo category tags the vision model detects. */
export const PHOTO_TAGS = [
  "portrait",
  "group",
  "mirror_selfie",
  "gym",
  "car",
  "travel",
  "pet",
  "outdoor",
  "activity",
  "professional",
  "night_out",
] as const;
export type PhotoTag = (typeof PHOTO_TAGS)[number];

/**
 * A single 0–10 attribute score with the reasoning behind it.
 * The `why` field is mandatory — ProfilePilot never returns a bare number.
 */
export interface AttributeScore {
  score: number; // 0–10
  why: string;
}

/** The full set of per-photo detected attributes. */
export interface PhotoAttributes {
  smile: AttributeScore;
  eyeContact: AttributeScore;
  faceVisibility: AttributeScore;
  lighting: AttributeScore;
  imageQuality: AttributeScore;
  blur: AttributeScore; // higher = sharper (less blur)
  background: AttributeScore;
  bodyLanguage: AttributeScore;
  outfit: AttributeScore;
  grooming: AttributeScore;
  composition: AttributeScore;
  colorBalance: AttributeScore;
  cropping: AttributeScore;
  facialExpression: AttributeScore;
}

/** Analysis of one uploaded photo. */
export interface PhotoAnalysis {
  id: string;
  /** 1–10 overall score for the photo. */
  score: number;
  /** Plain-language summary of why this score was given. */
  summary: string;
  attributes: PhotoAttributes;
  tags: PhotoTag[];
  /** Authenticity signals — never a judgment of the person, only the image. */
  authentic: boolean;
  overEdited: boolean;
  /** Whether this photo would make a strong opening (first) image. */
  strongFirstPhoto: boolean;
  /** Actionable, photo-specific advice. */
  suggestions: string[];
}

export interface Flag {
  label: string;
  detail: string;
  /** For red flags: how much it hurts. For green flags: how much it helps. */
  severity: "low" | "medium" | "high";
}

export interface BioAnalysis {
  originality: AttributeScore;
  confidence: AttributeScore;
  humor: AttributeScore;
  length: AttributeScore;
  attractiveness: AttributeScore;
  conversationStarters: AttributeScore;
  suggestions: string[];
}

/** Weighted category scores that roll up into the overall profile score. */
export interface CategoryScores {
  photos: number; // 0–10
  bio: number; // 0–10
  variety: number; // 0–10
  authenticity: number; // 0–10
  conversationPotential: number; // 0–10
  /** Not weighted into the total but surfaced in the breakdown UI. */
  firstImpression: number;
  trustworthiness: number;
}

export interface Recommendation {
  id: string;
  action: string;
  reason: string;
  priority: "high" | "medium" | "low";
  /** Optional reference to a photo id this recommendation concerns. */
  photoId?: string;
}

export interface ProfileReport {
  overallScore: number; // 0–10, one decimal
  categories: CategoryScores;
  categoryExplanations: Record<keyof CategoryScores, string>;
  photos: PhotoAnalysis[];
  bestFirstPhotoId: string | null;
  recommendedOrder: string[]; // photo ids, best-first
  photosToRemove: { photoId: string; reason: string }[];
  bio?: BioAnalysis;
  redFlags: Flag[];
  greenFlags: Flag[];
  recommendations: Recommendation[];
  /** 0–100 estimate of how memorable the profile is likely to be. */
  memorability: number;
  /** ISO timestamp — used by the improvement tracker. */
  createdAt: string;
}

/** Input payload for an analysis request. */
export interface AnalyzePhotoInput {
  id: string;
  /** base64-encoded image data (no data: prefix). */
  data: string;
  mediaType: "image/jpeg" | "image/png" | "image/webp";
}

export interface AnalyzeRequest {
  photos: AnalyzePhotoInput[];
  bio?: string;
}

export interface CoachMessage {
  role: "user" | "assistant";
  content: string;
}
