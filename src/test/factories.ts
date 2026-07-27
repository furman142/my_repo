/** Test factories for building PhotoAnalysis / BioAnalysis fixtures. */
import type {
  AttributeScore,
  BioAnalysis,
  PhotoAnalysis,
  PhotoAttributes,
  PhotoTag,
} from "@/lib/types";

function a(score: number): AttributeScore {
  return { score, why: "test" };
}

export function makeAttributes(base = 7): PhotoAttributes {
  return {
    smile: a(base),
    eyeContact: a(base),
    faceVisibility: a(base),
    lighting: a(base),
    imageQuality: a(base),
    blur: a(base),
    background: a(base),
    bodyLanguage: a(base),
    outfit: a(base),
    grooming: a(base),
    composition: a(base),
    colorBalance: a(base),
    cropping: a(base),
    facialExpression: a(base),
  };
}

export function makePhoto(overrides: Partial<PhotoAnalysis> = {}): PhotoAnalysis {
  const base = overrides.attributes ? undefined : 7;
  return {
    id: overrides.id ?? Math.random().toString(36).slice(2),
    score: overrides.score ?? 7,
    summary: overrides.summary ?? "A solid photo.",
    attributes: overrides.attributes ?? makeAttributes(base),
    tags: overrides.tags ?? (["portrait"] as PhotoTag[]),
    authentic: overrides.authentic ?? true,
    overEdited: overrides.overEdited ?? false,
    strongFirstPhoto: overrides.strongFirstPhoto ?? false,
    suggestions: overrides.suggestions ?? ["Try natural light."],
  };
}

export function makeBio(base = 7): BioAnalysis {
  return {
    originality: a(base),
    confidence: a(base),
    humor: a(base),
    length: a(base),
    attractiveness: a(base),
    conversationStarters: a(base),
    suggestions: ["Add a hook."],
  };
}
