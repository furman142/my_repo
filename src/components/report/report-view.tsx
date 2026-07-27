"use client";
import * as React from "react";
import { Sparkles, Download, RefreshCw } from "lucide-react";
import { motion } from "framer-motion";
import type { ProfileReport } from "@/lib/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScoreRing } from "./score-ring";
import { CategoryBreakdown } from "./category-breakdown";
import { PhotoCard } from "./photo-card";
import { Flags } from "./flags";
import { Recommendations } from "./recommendations";
import { ProfilePreview } from "./profile-preview";

interface Props {
  report: ProfileReport;
  /** Map of photo id -> preview data URL, for rendering thumbnails. */
  previews: Record<string, string>;
  bio?: string;
  onReset?: () => void;
  onExport?: () => void;
}

const Section = ({ children }: { children: React.ReactNode }) => (
  <motion.section
    initial={{ opacity: 0, y: 16 }}
    whileInView={{ opacity: 1, y: 0 }}
    viewport={{ once: true, margin: "-60px" }}
    transition={{ duration: 0.4 }}
  >
    {children}
  </motion.section>
);

export function ReportView({ report, previews, bio, onReset, onExport }: Props) {
  const orderedPreviews = report.recommendedOrder
    .map((id) => previews[id])
    .filter((x): x is string => Boolean(x));

  const rankOf = (id: string) => report.photos.findIndex((p) => p.id === id) + 1;

  return (
    <div className="space-y-8">
      {/* Hero score */}
      <Card className="overflow-hidden">
        <CardContent className="flex flex-col items-center gap-6 p-8 sm:flex-row sm:justify-between">
          <div className="flex items-center gap-6">
            <ScoreRing score={report.overallScore} />
            <div>
              <div className="mb-2 flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-primary" />
                <span className="text-sm text-muted-foreground">Overall profile score</span>
              </div>
              <p className="max-w-md text-sm text-muted-foreground">
                A weighted read on your profile&apos;s strength and the first impression it makes —
                never a judgment of you.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Badge variant="secondary">Memorability {report.memorability}/100</Badge>
                <Badge variant="outline">{report.photos.length} photos</Badge>
                {bio && <Badge variant="outline">bio included</Badge>}
              </div>
            </div>
          </div>
          <div className="flex gap-2">
            {onExport && (
              <Button variant="outline" size="sm" onClick={onExport}>
                <Download className="h-4 w-4" /> Export
              </Button>
            )}
            {onReset && (
              <Button variant="ghost" size="sm" onClick={onReset}>
                <RefreshCw className="h-4 w-4" /> New
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      <Section>
        <Card>
          <CardHeader>
            <CardTitle>Category breakdown</CardTitle>
          </CardHeader>
          <CardContent>
            <CategoryBreakdown categories={report.categories} explanations={report.categoryExplanations} />
          </CardContent>
        </Card>
      </Section>

      <Section>
        <Recommendations items={report.recommendations} />
      </Section>

      <Section>
        <Flags red={report.redFlags} green={report.greenFlags} />
      </Section>

      <div className="grid gap-8 lg:grid-cols-[1fr_auto]">
        <Section>
          <div>
            <h2 className="mb-4 text-xl font-semibold">Per-photo analysis</h2>
            <div className="space-y-4">
              {report.recommendedOrder.map((id) => {
                const analysis = report.photos.find((p) => p.id === id);
                if (!analysis) return null;
                return (
                  <PhotoCard
                    key={id}
                    analysis={analysis}
                    previewUrl={previews[id]}
                    rank={rankOf(id)}
                    isBestFirst={report.bestFirstPhotoId === id}
                  />
                );
              })}
            </div>
          </div>
        </Section>

        <Section>
          <div className="lg:sticky lg:top-20">
            <h2 className="mb-4 text-xl font-semibold">Profile preview</h2>
            <ProfilePreview orderedPreviews={orderedPreviews} bio={bio} />
          </div>
        </Section>
      </div>
    </div>
  );
}
