"use client";
import * as React from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ImagePlus, Loader2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { prepareImages, type PreparedImage } from "@/lib/image";

interface PhotoUploaderProps {
  photos: PreparedImage[];
  onChange: (photos: PreparedImage[]) => void;
  max?: number;
}

export function PhotoUploader({ photos, onChange, max = 9 }: PhotoUploaderProps) {
  const [dragging, setDragging] = React.useState(false);
  const [processing, setProcessing] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);

  const addFiles = React.useCallback(
    async (files: FileList | File[]) => {
      const remaining = max - photos.length;
      if (remaining <= 0) return;
      setProcessing(true);
      try {
        const prepared = await prepareImages(Array.from(files).slice(0, remaining));
        onChange([...photos, ...prepared]);
      } finally {
        setProcessing(false);
      }
    },
    [max, photos, onChange],
  );

  const remove = (id: string) => onChange(photos.filter((p) => p.id !== id));

  return (
    <div>
      <div
        role="button"
        tabIndex={0}
        aria-label="Upload photos"
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          void addFiles(e.dataTransfer.files);
        }}
        className={cn(
          "flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed p-10 text-center transition-colors focus-ring",
          dragging ? "border-primary bg-primary/5" : "border-border hover:border-primary/60",
          photos.length >= max && "pointer-events-none opacity-50",
        )}
      >
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(e) => e.target.files && addFiles(e.target.files)}
        />
        {processing ? (
          <Loader2 className="mb-3 h-8 w-8 animate-spin text-primary" />
        ) : (
          <ImagePlus className="mb-3 h-8 w-8 text-muted-foreground" />
        )}
        <p className="font-medium">
          {photos.length >= max ? "Maximum reached" : "Drag & drop photos, or click to browse"}
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          {photos.length}/{max} · JPG, PNG, WebP · compressed in your browser
        </p>
      </div>

      {photos.length > 0 && (
        <div className="mt-4 grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-5">
          <AnimatePresence>
            {photos.map((p, i) => (
              <motion.div
                key={p.id}
                layout
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.8 }}
                className="group relative aspect-square overflow-hidden rounded-lg border border-border"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={p.previewUrl} alt={`Upload ${i + 1}`} className="h-full w-full object-cover" />
                <span className="absolute left-1.5 top-1.5 rounded bg-black/60 px-1.5 py-0.5 text-xs font-medium text-white">
                  #{i + 1}
                </span>
                <button
                  onClick={() => remove(p.id)}
                  aria-label={`Remove photo ${i + 1}`}
                  className="absolute right-1.5 top-1.5 rounded-full bg-black/60 p-1 text-white opacity-0 transition-opacity hover:bg-destructive group-hover:opacity-100"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}
