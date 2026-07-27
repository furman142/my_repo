"use client";
import * as React from "react";
import { ChevronLeft, ChevronRight, Heart, X } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

interface Props {
  /** Photo preview URLs already in recommended (best-first) order. */
  orderedPreviews: string[];
  bio?: string;
  name?: string;
  age?: number;
}

/** A mock dating-app profile card showing the recommended photo order. */
export function ProfilePreview({ orderedPreviews, bio, name = "You", age = 27 }: Props) {
  const [index, setIndex] = React.useState(0);
  const total = orderedPreviews.length;
  const next = () => setIndex((i) => (i + 1) % total);
  const prev = () => setIndex((i) => (i - 1 + total) % total);

  if (total === 0) return null;

  return (
    <div className="mx-auto w-full max-w-sm">
      <div className="relative aspect-[3/4] overflow-hidden rounded-2xl border border-border bg-black shadow-2xl">
        <AnimatePresence mode="popLayout">
          <motion.img
            key={index}
            src={orderedPreviews[index]}
            alt={`Preview ${index + 1}`}
            className="absolute inset-0 h-full w-full object-cover"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
          />
        </AnimatePresence>

        {/* Segment indicators */}
        <div className="absolute left-0 right-0 top-2 flex gap-1 px-3">
          {orderedPreviews.map((_, i) => (
            <div
              key={i}
              className={`h-1 flex-1 rounded-full ${i === index ? "bg-white" : "bg-white/30"}`}
            />
          ))}
        </div>

        {/* Tap zones */}
        <button className="absolute inset-y-0 left-0 w-1/3" onClick={prev} aria-label="Previous photo">
          <ChevronLeft className="ml-2 h-6 w-6 text-white/0 transition-colors hover:text-white/80" />
        </button>
        <button className="absolute inset-y-0 right-0 w-1/3" onClick={next} aria-label="Next photo">
          <ChevronRight className="ml-auto mr-2 h-6 w-6 text-white/0 transition-colors hover:text-white/80" />
        </button>

        {/* Info overlay */}
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 via-black/40 to-transparent p-4 pt-16 text-white">
          <p className="text-2xl font-bold">
            {name} <span className="font-normal">{age}</span>
          </p>
          {bio && <p className="mt-1 line-clamp-3 text-sm text-white/90">{bio}</p>}
        </div>
      </div>

      <div className="mt-4 flex items-center justify-center gap-6">
        <button className="flex h-12 w-12 items-center justify-center rounded-full border-2 border-destructive text-destructive" aria-label="Nope (demo)">
          <X className="h-6 w-6" />
        </button>
        <button className="flex h-14 w-14 items-center justify-center rounded-full border-2 border-success text-success" aria-label="Like (demo)">
          <Heart className="h-7 w-7" />
        </button>
      </div>
      <p className="mt-2 text-center text-xs text-muted-foreground">
        Preview in your recommended order
      </p>
    </div>
  );
}
