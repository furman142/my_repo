"use client";
import * as React from "react";
import { ChevronDown, Star } from "lucide-react";
import { motion } from "framer-motion";
import type { PhotoAnalysis } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { cn, scoreBarClass, scoreColor } from "@/lib/utils";

interface Props {
  analysis: PhotoAnalysis;
  previewUrl?: string;
  rank: number;
  isBestFirst: boolean;
}

const ATTR_LABELS: Record<string, string> = {
  smile: "Smile",
  eyeContact: "Eye contact",
  faceVisibility: "Face visibility",
  lighting: "Lighting",
  imageQuality: "Image quality",
  blur: "Sharpness",
  background: "Background",
  bodyLanguage: "Body language",
  outfit: "Outfit",
  grooming: "Grooming",
  composition: "Composition",
  colorBalance: "Color balance",
  cropping: "Cropping",
  facialExpression: "Expression",
};

export function PhotoCard({ analysis, previewUrl, rank, isBestFirst }: Props) {
  const [open, setOpen] = React.useState(false);

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="flex gap-4 p-4">
        <div className="relative h-28 w-28 shrink-0 overflow-hidden rounded-lg bg-muted">
          {previewUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={previewUrl} alt={`Photo ${rank}`} className="h-full w-full object-cover" />
          ) : null}
          {isBestFirst && (
            <span className="absolute left-1 top-1 flex items-center gap-0.5 rounded bg-primary px-1.5 py-0.5 text-[10px] font-semibold text-primary-foreground">
              <Star className="h-3 w-3" /> Best first
            </span>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Photo #{rank}</span>
            <span className={cn("text-2xl font-bold", scoreColor(analysis.score))}>
              {analysis.score.toFixed(1)}
            </span>
          </div>
          <p className="mt-1 line-clamp-2 text-sm">{analysis.summary}</p>
          <div className="mt-2 flex flex-wrap gap-1">
            {analysis.tags.map((t) => (
              <Badge key={t} variant="outline" className="text-[10px]">
                {t.replace(/_/g, " ")}
              </Badge>
            ))}
            {analysis.overEdited && <Badge variant="warning" className="text-[10px]">over-edited</Badge>}
            {!analysis.authentic && <Badge variant="destructive" className="text-[10px]">low authenticity</Badge>}
          </div>
        </div>
      </div>

      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-center gap-1 border-t border-border py-2 text-xs font-medium text-muted-foreground hover:bg-muted"
        aria-expanded={open}
      >
        {open ? "Hide" : "Show"} full breakdown
        <ChevronDown className={cn("h-4 w-4 transition-transform", open && "rotate-180")} />
      </button>

      {open && (
        <motion.div
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: "auto", opacity: 1 }}
          className="border-t border-border p-4"
        >
          <div className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
            {Object.entries(analysis.attributes).map(([key, attr]) => (
              <div key={key}>
                <div className="mb-0.5 flex items-center justify-between text-xs">
                  <span className="font-medium">{ATTR_LABELS[key] ?? key}</span>
                  <span className={scoreColor(attr.score)}>{attr.score.toFixed(1)}</span>
                </div>
                <Progress value={attr.score * 10} className="h-1.5" barClassName={scoreBarClass(attr.score)} />
                <p className="mt-1 text-[11px] text-muted-foreground">{attr.why}</p>
              </div>
            ))}
          </div>
          {analysis.suggestions.length > 0 && (
            <div className="mt-4">
              <p className="mb-1 text-xs font-semibold">Suggestions</p>
              <ul className="list-inside list-disc space-y-0.5 text-xs text-muted-foreground">
                {analysis.suggestions.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ul>
            </div>
          )}
        </motion.div>
      )}
    </div>
  );
}
