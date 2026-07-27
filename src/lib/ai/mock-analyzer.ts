/**
 * Deterministic, offline photo/bio analyzer.
 *
 * Used whenever ANTHROPIC_API_KEY is not configured (local dev, CI, demos).
 * It derives stable pseudo-scores from a hash of the input so the same photo
 * always produces the same analysis — which keeps the UX believable and the
 * tests deterministic — without ever calling an external service.
 */
import type {
  AnalyzePhotoInput,
  AttributeScore,
  BioAnalysis,
  PhotoAnalysis,
  PhotoAttributes,
  PhotoTag,
} from "../types";

/** Small, stable string hash (FNV-1a). */
function hash(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** A seeded PRNG so a given seed yields a repeatable sequence. */
function seeded(seed: number): () => number {
  let s = seed || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}

function attr(score: number, why: string): AttributeScore {
  return { score: Math.round(score * 10) / 10, why };
}

const TAG_POOL: PhotoTag[] = [
  "portrait",
  "outdoor",
  "travel",
  "activity",
  "group",
  "pet",
  "night_out",
  "professional",
  "gym",
  "mirror_selfie",
  "car",
];

export function mockAnalyzePhoto(input: AnalyzePhotoInput): PhotoAnalysis {
  // Seed from a prefix of the data so we don't hash multi-MB payloads.
  const rnd = seeded(hash(input.id + input.data.slice(0, 512)));
  const s = (base: number, spread = 3) => Math.max(1, Math.min(10, base + (rnd() - 0.5) * spread));

  const attributes: PhotoAttributes = {
    smile: attr(s(7), "Expression reads as warm and approachable."),
    eyeContact: attr(s(6.5), "Good engagement with the camera."),
    faceVisibility: attr(s(7.5), "Face is clearly visible and well-framed."),
    lighting: attr(s(6), "Lighting is decent; softer, natural light would help."),
    imageQuality: attr(s(7), "Sharp and reasonably high-resolution."),
    blur: attr(s(7.5), "Image is crisp with minimal blur."),
    background: attr(s(6), "Background is acceptable but slightly busy."),
    bodyLanguage: attr(s(6.5), "Relaxed, open posture."),
    outfit: attr(s(6.5), "Outfit suits the setting."),
    grooming: attr(s(7), "Put-together and tidy."),
    composition: attr(s(6), "Framing is fine; try the rule of thirds."),
    colorBalance: attr(s(6.5), "Colors look natural."),
    cropping: attr(s(7.5), "Clean, intentional crop."),
    facialExpression: attr(s(7), "Friendly, inviting expression."),
  };

  // Pick 1–2 stable tags for this photo.
  const tagCount = 1 + Math.floor(rnd() * 2);
  const tags: PhotoTag[] = [];
  for (let i = 0; i < tagCount; i++) {
    const t = TAG_POOL[Math.floor(rnd() * TAG_POOL.length)]!;
    if (!tags.includes(t)) tags.push(t);
  }

  const attrVals = Object.values(attributes).map((a) => a.score);
  const score = Math.round((attrVals.reduce((a, b) => a + b, 0) / attrVals.length) * 10) / 10;

  const overEdited = attributes.colorBalance.score > 9 && rnd() > 0.7;
  const authentic = !overEdited && attributes.faceVisibility.score > 5;

  return {
    id: input.id,
    score,
    summary: `Solid photo (${score.toFixed(1)}/10): clear face and friendly expression; lighting and background have the most upside.`,
    attributes,
    tags,
    authentic,
    overEdited,
    strongFirstPhoto: score >= 7 && attributes.smile.score >= 6 && attributes.faceVisibility.score >= 6,
    suggestions: [
      attributes.lighting.score < 6.5 ? "Reshoot in soft natural daylight." : "Keep the natural lighting — it works.",
      attributes.background.score < 6.5 ? "Choose a cleaner or more interesting background." : "Nice backdrop.",
    ],
  };
}

export function mockAnalyzeBio(bio: string): BioAnalysis {
  const rnd = seeded(hash(bio));
  const s = (base: number, spread = 3) => Math.max(1, Math.min(10, base + (rnd() - 0.5) * spread));
  const len = bio.trim().length;
  const lengthScore = len < 40 ? 4 : len > 400 ? 5 : 8;

  return {
    originality: attr(s(6), "Some personality shows through; push for more specificity."),
    confidence: attr(s(6.5), "Reads as reasonably self-assured."),
    humor: attr(s(6), "A light, playful note lands well."),
    length: attr(lengthScore, len < 40 ? "A bit short — add one more hook." : len > 400 ? "Trim it; dating apps reward brevity." : "Good length."),
    attractiveness: attr(s(6.5), "The overall vibe is appealing."),
    conversationStarters: attr(s(6), "There's a hook or two to reply to."),
    suggestions: [
      "Swap one generic line for a concrete detail (a specific hobby, place, or opinion).",
      "End with a light question or invitation to make replying easy.",
      "Cut any cliché like 'love to laugh' or 'fluent in sarcasm'.",
    ],
  };
}

export function mockGenerateBios(tone: string): string[] {
  const byTone: Record<string, string[]> = {
    funny: [
      "Professional overthinker, amateur chef. I will judge your pizza topping choices (lovingly).",
      "My hobbies include hiking, bad puns, and pretending I'll wake up at 6am to run.",
      "Looking for someone to split appetizers with and blame when we order too many.",
    ],
    confident: [
      "Building things by day, chasing sunsets by weekend. I know what I want — let's see if it's you.",
      "Direct, curious, and a great time. Bring your best story and I'll bring mine.",
      "I make excellent coffee and better decisions. Usually.",
    ],
    adventure: [
      "42 countries and counting. Next trip's undecided — pitch me somewhere.",
      "Weekends are for summits, waves, or getting pleasantly lost. Come along.",
      "If it involves altitude, a passport, or a questionable map, I'm in.",
    ],
    minimal: ["Coffee. Mountains. Good conversation.", "Say hi. I don't bite.", "Let's skip the small talk."],
  };
  return byTone[tone] ?? byTone.confident!;
}
