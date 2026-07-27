"use client";
import {
  PolarAngleAxis,
  PolarGrid,
  Radar,
  RadarChart,
  ResponsiveContainer,
} from "recharts";
import type { CategoryScores } from "@/lib/types";
import { Progress } from "@/components/ui/progress";
import { scoreBarClass, scoreColor } from "@/lib/utils";

interface Props {
  categories: CategoryScores;
  explanations: Record<string, string>;
}

const ORDER: { key: keyof CategoryScores; label: string }[] = [
  { key: "photos", label: "Photos" },
  { key: "bio", label: "Bio" },
  { key: "variety", label: "Variety" },
  { key: "authenticity", label: "Authenticity" },
  { key: "conversationPotential", label: "Conversation" },
  { key: "firstImpression", label: "First Impression" },
  { key: "trustworthiness", label: "Trustworthiness" },
];

export function CategoryBreakdown({ categories, explanations }: Props) {
  const radarData = ORDER.map(({ key, label }) => ({ subject: label, value: categories[key] }));

  return (
    <div className="grid gap-6 md:grid-cols-2">
      <div className="h-72">
        <ResponsiveContainer width="100%" height="100%">
          <RadarChart data={radarData} outerRadius="72%">
            <PolarGrid stroke="hsl(var(--border))" />
            <PolarAngleAxis dataKey="subject" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} />
            <Radar
              dataKey="value"
              stroke="hsl(var(--primary))"
              fill="hsl(var(--primary))"
              fillOpacity={0.35}
            />
          </RadarChart>
        </ResponsiveContainer>
      </div>

      <ul className="space-y-4">
        {ORDER.map(({ key, label }) => (
          <li key={key}>
            <div className="mb-1 flex items-center justify-between">
              <span className="text-sm font-medium">{label}</span>
              <span className={`text-sm font-semibold ${scoreColor(categories[key])}`}>
                {categories[key].toFixed(1)}
              </span>
            </div>
            <Progress value={categories[key] * 10} barClassName={scoreBarClass(categories[key])} />
            <p className="mt-1 text-xs text-muted-foreground">{explanations[key]}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}
