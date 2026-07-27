/**
 * The ProfilePilot scoring engine.
 *
 * Pure functions only — no I/O, no randomness — so the whole thing is unit
 * testable and produces identical output for identical input. The AI layer
 * supplies per-photo and per-bio analyses; this module turns them into the
 * weighted profile report.
 *
 * Weighting (per product spec):
 *   Photos 50% · Bio 20% · Variety 10% · Authenticity 10% · Conversation 10%
 *
 * IMPORTANT: We never claim objective attractiveness. Every score reflects
 * *profile quality* and *likely first impressions*, and every number is
 * accompanied by an explanation of why it was given.
 */
import type {
  BioAnalysis,
  CategoryScores,
  Flag,
  PhotoAnalysis,
  PhotoTag,
  ProfileReport,
  Recommendation,
} from "./types";

export const CATEGORY_WEIGHTS = {
  photos: 0.5,
  bio: 0.2,
  variety: 0.1,
  authenticity: 0.1,
  conversationPotential: 0.1,
} as const;

const round1 = (n: number) => Math.round(n * 10) / 10;
const clamp = (n: number, lo = 0, hi = 10) => Math.max(lo, Math.min(hi, n));
const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

/** Average of the best `count` photo scores — profiles are judged on strength, not quantity. */
function topPhotoScore(photos: PhotoAnalysis[], count = 6): number {
  const sorted = [...photos].map((p) => p.score).sort((a, b) => b - a);
  return avg(sorted.slice(0, count));
}

/**
 * Variety rewards a spread of *distinct, positive* photo types.
 * A profile of six near-identical mirror selfies scores low here even if each
 * photo is individually fine.
 */
export function computeVariety(photos: PhotoAnalysis[]): number {
  if (photos.length === 0) return 0;

  const positiveTags: PhotoTag[] = [
    "travel",
    "pet",
    "outdoor",
    "activity",
    "professional",
    "portrait",
    "group",
    "night_out",
  ];
  const distinctPositive = new Set<PhotoTag>();
  for (const p of photos) {
    for (const t of p.tags) {
      if (positiveTags.includes(t)) distinctPositive.add(t);
    }
  }

  // Base on the diversity of positive contexts (up to ~5 distinct → full marks).
  let score = Math.min(5, distinctPositive.size) * 2;

  // Penalize over-reliance on low-variety photo types.
  const mirror = photos.filter((p) => p.tags.includes("mirror_selfie")).length;
  const gym = photos.filter((p) => p.tags.includes("gym")).length;
  if (mirror / photos.length > 0.4) score -= 2;
  if (gym / photos.length > 0.4) score -= 1.5;

  // Reward simply having enough photos to tell a story.
  if (photos.length >= 4) score += 0.5;
  if (photos.length >= 6) score += 0.5;

  return round1(clamp(score));
}

export function computeAuthenticity(photos: PhotoAnalysis[]): number {
  if (photos.length === 0) return 0;
  const authenticShare = photos.filter((p) => p.authentic).length / photos.length;
  const overEditedShare = photos.filter((p) => p.overEdited).length / photos.length;
  const faceVisibility = avg(photos.map((p) => p.attributes.faceVisibility.score));
  const score = authenticShare * 6 + (1 - overEditedShare) * 2 + (faceVisibility / 10) * 2;
  return round1(clamp(score));
}

export function computeConversationPotential(
  photos: PhotoAnalysis[],
  bio?: BioAnalysis,
): number {
  // Interesting, context-rich photos give people something to open with.
  const hookTags: PhotoTag[] = ["travel", "pet", "activity", "outdoor", "night_out"];
  const hooks = new Set<PhotoTag>();
  for (const p of photos) for (const t of p.tags) if (hookTags.includes(t)) hooks.add(t);
  let score = Math.min(5, hooks.size) * 1.2;

  if (bio) {
    score += (bio.conversationStarters.score / 10) * 4;
  } else {
    // No bio is a missed conversation opportunity.
    score += 1;
  }
  return round1(clamp(score));
}

function computeFirstImpression(photos: PhotoAnalysis[]): number {
  const best = [...photos].sort((a, b) => b.score - a.score)[0];
  if (!best) return 0;
  const smile = best.attributes.smile.score;
  const eye = best.attributes.eyeContact.score;
  const quality = best.attributes.imageQuality.score;
  return round1(clamp(best.score * 0.5 + smile * 0.2 + eye * 0.15 + quality * 0.15));
}

function computeTrustworthiness(photos: PhotoAnalysis[]): number {
  if (photos.length === 0) return 0;
  const authentic = photos.filter((p) => p.authentic).length / photos.length;
  const faceVisible = avg(photos.map((p) => p.attributes.faceVisibility.score));
  const notOverEdited = 1 - photos.filter((p) => p.overEdited).length / photos.length;
  return round1(clamp(authentic * 5 + (faceVisible / 10) * 3 + notOverEdited * 2));
}

export function computeCategoryScores(
  photos: PhotoAnalysis[],
  bio?: BioAnalysis,
): CategoryScores {
  const photosScore = round1(topPhotoScore(photos));
  const bioScore = bio
    ? round1(
        avg([
          bio.originality.score,
          bio.confidence.score,
          bio.humor.score,
          bio.length.score,
          bio.attractiveness.score,
          bio.conversationStarters.score,
        ]),
      )
    : 0;

  return {
    photos: photosScore,
    bio: bioScore,
    variety: computeVariety(photos),
    authenticity: computeAuthenticity(photos),
    conversationPotential: computeConversationPotential(photos, bio),
    firstImpression: computeFirstImpression(photos),
    trustworthiness: computeTrustworthiness(photos),
  };
}

/**
 * Roll the weighted categories into a single 0–10 score.
 * When there's no bio, its 20% weight is redistributed proportionally across
 * the remaining categories so a photos-only profile isn't unfairly capped at 8.
 */
export function computeOverallScore(categories: CategoryScores, hasBio: boolean): number {
  const weights = { ...CATEGORY_WEIGHTS } as Record<keyof typeof CATEGORY_WEIGHTS, number>;
  if (!hasBio) {
    const redistribute = weights.bio;
    weights.bio = 0;
    const remaining = redistribute / 4;
    weights.photos += remaining;
    weights.variety += remaining;
    weights.authenticity += remaining;
    weights.conversationPotential += remaining;
  }
  const total =
    categories.photos * weights.photos +
    categories.bio * weights.bio +
    categories.variety * weights.variety +
    categories.authenticity * weights.authenticity +
    categories.conversationPotential * weights.conversationPotential;
  return round1(clamp(total));
}

/** Best-first ordering: opener is the single strongest photo, then descending. */
export function recommendOrder(photos: PhotoAnalysis[]): string[] {
  return [...photos]
    .sort((a, b) => {
      // Prefer explicit strong-opener photos for the first slot.
      if (b.strongFirstPhoto !== a.strongFirstPhoto) {
        return Number(b.strongFirstPhoto) - Number(a.strongFirstPhoto);
      }
      return b.score - a.score;
    })
    .map((p) => p.id);
}

export function pickBestFirstPhoto(photos: PhotoAnalysis[]): string | null {
  const order = recommendOrder(photos);
  return order[0] ?? null;
}

/** Photos scoring below 5.0, or that are clearly redundant, are flagged for removal. */
export function photosToRemove(
  photos: PhotoAnalysis[],
): { photoId: string; reason: string }[] {
  const out: { photoId: string; reason: string }[] = [];
  for (const p of photos) {
    if (p.score < 5) {
      out.push({
        photoId: p.id,
        reason: `Scores ${p.score.toFixed(1)}/10 — ${p.summary}`,
      });
    } else if (p.attributes.imageQuality.score < 4 || p.attributes.blur.score < 4) {
      out.push({ photoId: p.id, reason: "Low image quality / noticeably blurry." });
    }
  }
  return out;
}

export function detectRedFlags(photos: PhotoAnalysis[]): Flag[] {
  const flags: Flag[] = [];
  const n = photos.length || 1;
  const share = (tag: PhotoTag) => photos.filter((p) => p.tags.includes(tag)).length / n;

  if (share("mirror_selfie") > 0.4)
    flags.push({
      label: "Too many mirror selfies",
      detail: "Over 40% of your photos are mirror selfies. Swap some for shots taken by others.",
      severity: "high",
    });
  if (share("gym") > 0.4)
    flags.push({
      label: "Gym-heavy",
      detail: "Fitness shots are fine in moderation, but they dominate your lineup.",
      severity: "medium",
    });
  if (photos.every((p) => p.attributes.smile.score < 5))
    flags.push({
      label: "No genuine smile",
      detail: "None of your photos show a warm smile. A real smile is the single biggest boost.",
      severity: "high",
    });
  if (avg(photos.map((p) => p.attributes.lighting.score)) < 5)
    flags.push({
      label: "Poor lighting",
      detail: "Lighting is consistently weak. Natural daylight near a window transforms photos.",
      severity: "medium",
    });
  if (avg(photos.map((p) => p.attributes.imageQuality.score)) < 5)
    flags.push({
      label: "Low image quality",
      detail: "Several photos look low-resolution or compressed.",
      severity: "medium",
    });
  if (photos.some((p) => p.attributes.cropping.score < 4))
    flags.push({
      label: "Cropped-out people",
      detail: "Some photos look cropped from group shots — clean, intentional framing reads better.",
      severity: "low",
    });
  // Low variety across distinct positive contexts.
  const distinct = new Set<PhotoTag>();
  for (const p of photos) for (const t of p.tags) distinct.add(t);
  if (distinct.size <= 2 && photos.length >= 3)
    flags.push({
      label: "Low variety / repetitive poses",
      detail: "Your photos feel same-y. Mix locations, outfits, and activities.",
      severity: "medium",
    });
  return flags;
}

export function detectGreenFlags(photos: PhotoAnalysis[]): Flag[] {
  const flags: Flag[] = [];
  const has = (tag: PhotoTag) => photos.some((p) => p.tags.includes(tag));

  if (has("travel"))
    flags.push({ label: "Travel", detail: "Travel shots signal an adventurous, interesting life.", severity: "high" });
  if (has("pet"))
    flags.push({ label: "Pets", detail: "A pet photo is warm, approachable, and a natural conversation starter.", severity: "high" });
  if (has("group"))
    flags.push({ label: "Friends", detail: "Being with friends signals social proof and warmth.", severity: "medium" });
  if (has("activity") || has("outdoor"))
    flags.push({ label: "Hobbies & the outdoors", detail: "Active, outdoor shots show a full life beyond the phone.", severity: "medium" });
  if (photos.some((p) => p.attributes.smile.score >= 7))
    flags.push({ label: "Genuine smile", detail: "At least one photo shows a warm, authentic smile — keep it near the front.", severity: "high" });
  return flags;
}

export function buildRecommendations(
  photos: PhotoAnalysis[],
  order: string[],
  toRemove: { photoId: string; reason: string }[],
  redFlags: Flag[],
  hasBio: boolean,
): Recommendation[] {
  const recs: Recommendation[] = [];
  const indexOf = (id: string) => photos.findIndex((p) => p.id === id) + 1;

  // Reorder suggestion if the current order isn't already best-first.
  const best = order[0];
  if (best && indexOf(best) !== 1) {
    recs.push({
      id: `move-${best}`,
      action: `Move Photo #${indexOf(best)} to first`,
      reason: "It's your strongest opener — it should be the first thing people see.",
      priority: "high",
      photoId: best,
    });
  }

  for (const r of toRemove) {
    recs.push({
      id: `remove-${r.photoId}`,
      action: `Replace Photo #${indexOf(r.photoId)}`,
      reason: r.reason,
      priority: "high",
      photoId: r.photoId,
    });
  }

  // Turn each red flag into an actionable step.
  for (const f of redFlags) {
    recs.push({
      id: `fix-${f.label.toLowerCase().replace(/\s+/g, "-")}`,
      action: f.label.startsWith("Too many") ? `Diversify: ${f.label.toLowerCase()}` : `Address: ${f.label}`,
      reason: f.detail,
      priority: f.severity === "high" ? "high" : "medium",
    });
  }

  // Per-photo suggestions, deduped and capped.
  for (const p of photos) {
    for (const s of p.suggestions.slice(0, 1)) {
      recs.push({
        id: `photo-${p.id}-tip`,
        action: `Photo #${indexOf(p.id)}: ${s}`,
        reason: p.summary,
        priority: "low",
        photoId: p.id,
      });
    }
  }

  if (!hasBio) {
    recs.push({
      id: "add-bio",
      action: "Add a bio",
      reason: "A good bio is 20% of your score and gives people a reason to message you.",
      priority: "high",
    });
  }

  // Stable sort by priority.
  const rank = { high: 0, medium: 1, low: 2 } as const;
  return recs.sort((a, b) => rank[a.priority] - rank[b.priority]).slice(0, 12);
}

/** 0–100 estimate of how memorable the profile is likely to be. */
export function estimateMemorability(photos: PhotoAnalysis[], categories: CategoryScores): number {
  const distinct = new Set<PhotoTag>();
  for (const p of photos) for (const t of p.tags) distinct.add(t);
  const varietyPart = Math.min(1, distinct.size / 5) * 40;
  const strengthPart = (topPhotoScore(photos, 3) / 10) * 40;
  const hookPart = (categories.conversationPotential / 10) * 20;
  return Math.round(clamp(varietyPart + strengthPart + hookPart, 0, 100));
}

export interface AssembleInput {
  photos: PhotoAnalysis[];
  bio?: BioAnalysis;
  hasBio: boolean;
  now?: string;
}

/** Assemble the complete profile report from analyzed parts. */
export function assembleReport({ photos, bio, hasBio, now }: AssembleInput): ProfileReport {
  const categories = computeCategoryScores(photos, bio);
  const overallScore = computeOverallScore(categories, hasBio);
  const order = recommendOrder(photos);
  const toRemove = photosToRemove(photos);
  const redFlags = detectRedFlags(photos);
  const greenFlags = detectGreenFlags(photos);
  const recommendations = buildRecommendations(photos, order, toRemove, redFlags, hasBio);

  const categoryExplanations: ProfileReport["categoryExplanations"] = {
    photos: `Average of your strongest photos (weighted 50% of the total).`,
    bio: hasBio
      ? `Based on originality, confidence, humor, length, and conversation hooks (20%).`
      : `No bio provided — its 20% weight was redistributed to your other categories.`,
    variety: `How many distinct, positive contexts your photos cover (10%).`,
    authenticity: `How genuine and un-over-edited your photos read (10%). This is about the images, not you.`,
    conversationPotential: `How much your profile gives people to open a conversation with (10%).`,
    firstImpression: `The likely gut reaction to your strongest (opening) photo.`,
    trustworthiness: `How credible and genuine the overall set of images appears.`,
  };

  return {
    overallScore,
    categories,
    categoryExplanations,
    photos,
    bestFirstPhotoId: order[0] ?? null,
    recommendedOrder: order,
    photosToRemove: toRemove,
    bio,
    redFlags,
    greenFlags,
    recommendations,
    memorability: estimateMemorability(photos, categories),
    createdAt: now ?? new Date().toISOString(),
  };
}
