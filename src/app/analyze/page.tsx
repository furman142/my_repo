"use client";
import * as React from "react";
import { Loader2, Wand2, ShieldCheck } from "lucide-react";
import { PhotoUploader } from "@/components/photo-uploader";
import { ReportView } from "@/components/report/report-view";
import { ReportSkeleton } from "@/components/report/report-skeleton";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import type { PreparedImage } from "@/lib/image";
import type { ProfileReport } from "@/lib/types";
import { requestReport } from "@/lib/client-api";
import { saveToHistory } from "@/lib/history";

type Phase = "input" | "loading" | "done" | "error";

export default function AnalyzePage() {
  const [photos, setPhotos] = React.useState<PreparedImage[]>([]);
  const [bio, setBio] = React.useState("");
  const [phase, setPhase] = React.useState<Phase>("input");
  const [report, setReport] = React.useState<ProfileReport | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const previews = React.useMemo(
    () => Object.fromEntries(photos.map((p) => [p.id, p.previewUrl])),
    [photos],
  );

  async function analyze() {
    if (photos.length === 0) return;
    setPhase("loading");
    setError(null);
    try {
      const r = await requestReport(photos, bio);
      setReport(r);
      saveToHistory(r);
      setPhase("done");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
      setPhase("error");
    }
  }

  function reset() {
    setPhotos([]);
    setBio("");
    setReport(null);
    setPhase("input");
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-10">
      {phase === "input" || phase === "error" ? (
        <>
          <div className="mb-8 text-center">
            <h1 className="text-3xl font-bold sm:text-4xl">Analyze your profile</h1>
            <p className="mt-2 text-muted-foreground">
              Add up to 9 photos and (optionally) your bio. We&apos;ll score everything and tell you exactly what to change.
            </p>
          </div>

          <div className="grid gap-6 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>1 · Your photos</CardTitle>
              </CardHeader>
              <CardContent>
                <PhotoUploader photos={photos} onChange={setPhotos} />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>2 · Your bio (optional)</CardTitle>
              </CardHeader>
              <CardContent>
                <Textarea
                  value={bio}
                  onChange={(e) => setBio(e.target.value)}
                  placeholder="Paste your current bio here to score it, or leave blank."
                  className="min-h-[160px]"
                  maxLength={2000}
                />
                <p className="mt-2 text-xs text-muted-foreground">{bio.length}/2000</p>
              </CardContent>
            </Card>
          </div>

          {error && (
            <p className="mt-4 rounded-md bg-destructive/10 px-4 py-2 text-sm text-destructive">{error}</p>
          )}

          <div className="mt-8 flex flex-col items-center gap-3">
            <Button
              size="lg"
              variant="gradient"
              disabled={photos.length === 0}
              onClick={analyze}
              className="w-full sm:w-auto"
            >
              <Wand2 className="h-5 w-5" />
              Analyze {photos.length > 0 ? `${photos.length} photo${photos.length > 1 ? "s" : ""}` : "my profile"}
            </Button>
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <ShieldCheck className="h-3.5 w-3.5 text-success" />
              Photos are compressed in your browser and never stored on our servers.
            </p>
          </div>
        </>
      ) : null}

      {phase === "loading" && (
        <div>
          <div className="mb-8 flex items-center justify-center gap-2 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
            Analyzing {photos.length} photo{photos.length > 1 ? "s" : ""}…
          </div>
          <ReportSkeleton />
        </div>
      )}

      {phase === "done" && report && (
        <ReportView
          report={report}
          previews={previews}
          bio={bio || undefined}
          onReset={reset}
          onExport={() => window.print()}
        />
      )}
    </div>
  );
}
