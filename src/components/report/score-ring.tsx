"use client";
import { motion } from "framer-motion";

interface ScoreRingProps {
  /** 0–10 */
  score: number;
  size?: number;
  label?: string;
}

/** Animated circular gauge for the overall 0–10 score. */
export function ScoreRing({ score, size = 180, label = "Overall" }: ScoreRingProps) {
  const stroke = 14;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const pct = Math.max(0, Math.min(10, score)) / 10;

  const color =
    score >= 8 ? "hsl(var(--success))" : score >= 6 ? "hsl(var(--warning))" : "hsl(var(--destructive))";

  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="hsl(var(--muted))" strokeWidth={stroke} />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          initial={{ strokeDashoffset: circumference }}
          animate={{ strokeDashoffset: circumference * (1 - pct) }}
          transition={{ duration: 1.1, ease: "easeOut" }}
        />
      </svg>
      <div className="absolute flex flex-col items-center">
        <motion.span
          className="text-4xl font-extrabold"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
        >
          {score.toFixed(1)}
        </motion.span>
        <span className="text-xs uppercase tracking-wide text-muted-foreground">{label} · /10</span>
      </div>
    </div>
  );
}
