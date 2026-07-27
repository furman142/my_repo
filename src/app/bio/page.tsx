"use client";
import * as React from "react";
import { Copy, Loader2, Sparkles, Check } from "lucide-react";
import { BIO_TONES, type BioAnalysis, type BioTone } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import { cn, scoreBarClass, scoreColor } from "@/lib/utils";
import { analyzeBioRequest, generateBiosRequest } from "@/lib/client-api";

const TONE_LABELS: Record<BioTone, string> = {
  funny: "😂 Funny",
  confident: "💪 Confident",
  minimal: "◽ Minimal",
  flirty: "😏 Flirty",
  adventure: "🏔️ Adventure",
  professional: "💼 Professional",
  geek: "🤓 Geek",
  fitness: "🏋️ Fitness",
  luxury: "✨ Luxury",
  travel: "✈️ Travel",
};

export default function BioStudioPage() {
  const [tone, setTone] = React.useState<BioTone>("confident");
  const [about, setAbout] = React.useState("");
  const [generated, setGenerated] = React.useState<string[]>([]);
  const [genLoading, setGenLoading] = React.useState(false);
  const [copied, setCopied] = React.useState<number | null>(null);

  const [bio, setBio] = React.useState("");
  const [analysis, setAnalysis] = React.useState<BioAnalysis | null>(null);
  const [anaLoading, setAnaLoading] = React.useState(false);

  async function generate() {
    setGenLoading(true);
    try {
      setGenerated(await generateBiosRequest(tone, about || undefined));
    } finally {
      setGenLoading(false);
    }
  }

  async function analyze() {
    if (!bio.trim()) return;
    setAnaLoading(true);
    try {
      setAnalysis(await analyzeBioRequest(bio));
    } finally {
      setAnaLoading(false);
    }
  }

  function copy(text: string, i: number) {
    void navigator.clipboard.writeText(text);
    setCopied(i);
    setTimeout(() => setCopied(null), 1500);
  }

  const analysisRows: { key: keyof BioAnalysis; label: string }[] = [
    { key: "originality", label: "Originality" },
    { key: "confidence", label: "Confidence" },
    { key: "humor", label: "Humor" },
    { key: "length", label: "Length" },
    { key: "attractiveness", label: "Attractiveness" },
    { key: "conversationStarters", label: "Conversation starters" },
  ];

  return (
    <div className="mx-auto max-w-5xl px-4 py-10">
      <div className="mb-8 text-center">
        <h1 className="text-3xl font-bold sm:text-4xl">Bio Studio</h1>
        <p className="mt-2 text-muted-foreground">Generate a bio in any personality — or score the one you have.</p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Generator */}
        <Card>
          <CardHeader>
            <CardTitle>Generate a bio</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <p className="mb-2 text-sm font-medium">Personality</p>
              <div className="flex flex-wrap gap-2">
                {BIO_TONES.map((t) => (
                  <button
                    key={t}
                    onClick={() => setTone(t)}
                    className={cn(
                      "rounded-full border px-3 py-1 text-sm transition-colors",
                      tone === t ? "border-primary bg-primary/10 text-primary" : "border-border hover:bg-muted",
                    )}
                  >
                    {TONE_LABELS[t]}
                  </button>
                ))}
              </div>
            </div>
            <Textarea
              value={about}
              onChange={(e) => setAbout(e.target.value)}
              placeholder="Optional: a few things about you (hobbies, job, what you're looking for)…"
              className="min-h-[80px]"
            />
            <Button onClick={generate} disabled={genLoading} variant="gradient" className="w-full">
              {genLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              Generate 3 options
            </Button>

            <div className="space-y-3">
              {generated.map((b, i) => (
                <div key={i} className="rounded-lg border border-border p-3">
                  <p className="text-sm">{b}</p>
                  <Button variant="ghost" size="sm" className="mt-2" onClick={() => copy(b, i)}>
                    {copied === i ? <Check className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5" />}
                    {copied === i ? "Copied" : "Copy"}
                  </Button>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Analyzer */}
        <Card>
          <CardHeader>
            <CardTitle>Analyze your bio</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Textarea
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              placeholder="Paste your current bio…"
              className="min-h-[120px]"
              maxLength={2000}
            />
            <Button onClick={analyze} disabled={anaLoading || !bio.trim()} className="w-full">
              {anaLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Score my bio
            </Button>

            {analysis && (
              <div className="space-y-3">
                {analysisRows.map(({ key, label }) => {
                  const attr = analysis[key] as { score: number; why: string };
                  return (
                    <div key={key}>
                      <div className="mb-0.5 flex items-center justify-between text-sm">
                        <span className="font-medium">{label}</span>
                        <span className={scoreColor(attr.score)}>{attr.score.toFixed(1)}</span>
                      </div>
                      <Progress value={attr.score * 10} className="h-1.5" barClassName={scoreBarClass(attr.score)} />
                      <p className="mt-1 text-xs text-muted-foreground">{attr.why}</p>
                    </div>
                  );
                })}
                <div className="rounded-lg bg-muted/50 p-3">
                  <p className="mb-1 text-sm font-semibold">Suggestions</p>
                  <ul className="list-inside list-disc space-y-0.5 text-xs text-muted-foreground">
                    {analysis.suggestions.map((s, i) => (
                      <li key={i}>{s}</li>
                    ))}
                  </ul>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
