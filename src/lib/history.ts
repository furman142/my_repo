/**
 * Improvement Tracker storage.
 *
 * Privacy-first default: analysis history is stored in the browser's
 * localStorage, NOT on the server. We persist only the scores and metadata
 * needed to chart progress over time — never the photos themselves.
 *
 * A server-backed implementation (Prisma/Postgres) is provided behind the
 * optional DATABASE_URL integration; see docs/INTEGRATIONS.md.
 */
import type { ProfileReport } from "./types";

const KEY = "profilepilot:history:v1";

export interface HistoryEntry {
  id: string;
  createdAt: string;
  overallScore: number;
  photos: number;
  categories: ProfileReport["categories"];
  memorability: number;
}

export function loadHistory(): HistoryEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as HistoryEntry[]) : [];
  } catch {
    return [];
  }
}

export function saveToHistory(report: ProfileReport): HistoryEntry {
  const entry: HistoryEntry = {
    id: `run-${Date.now().toString(36)}`,
    createdAt: report.createdAt,
    overallScore: report.overallScore,
    photos: report.photos.length,
    categories: report.categories,
    memorability: report.memorability,
  };
  if (typeof window === "undefined") return entry;
  const history = loadHistory();
  history.push(entry);
  // Keep the last 50 runs.
  const trimmed = history.slice(-50);
  window.localStorage.setItem(KEY, JSON.stringify(trimmed));
  return entry;
}

export function clearHistory() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(KEY);
}
