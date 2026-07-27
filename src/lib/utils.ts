import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** Tailwind-aware className combiner used by every UI component. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Map a 0–10 score to a semantic color token. */
export function scoreColor(score: number): string {
  if (score >= 8) return "text-success";
  if (score >= 6) return "text-warning";
  return "text-destructive";
}

/** Map a 0–10 score to a Tailwind gradient for progress bars. */
export function scoreBarClass(score: number): string {
  if (score >= 8) return "bg-success";
  if (score >= 6) return "bg-warning";
  return "bg-destructive";
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
