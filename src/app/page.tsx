import Link from "next/link";
import {
  Camera,
  Sparkles,
  MessageSquare,
  TrendingUp,
  ShieldCheck,
  Flag,
  ListOrdered,
  Wand2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

const features = [
  { icon: Camera, title: "AI Photo Analysis", desc: "Every photo scored 1–10 across 14 attributes — smile, lighting, composition, and more — with the reason for each score." },
  { icon: ListOrdered, title: "Best First Photo & Order", desc: "We pick your strongest opener and recommend the ideal ordering to maximize right-swipes." },
  { icon: Flag, title: "Red & Green Flags", desc: "Too many mirror selfies? No genuine smile? We catch what hurts — and highlight what helps." },
  { icon: Wand2, title: "Bio Studio", desc: "Generate bios in 10 personalities and get your existing bio scored on originality, humor, and hooks." },
  { icon: MessageSquare, title: "AI Coach", desc: "Ask anything: “Which photo should I delete?” “Is my bio too serious?” Get straight answers." },
  { icon: TrendingUp, title: "Progress Tracker", desc: "Save analyses and watch your score climb over time with clear charts." },
];

export default function HomePage() {
  return (
    <div>
      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="pointer-events-none absolute inset-0 -z-10">
          <div className="absolute left-1/2 top-0 h-[500px] w-[500px] -translate-x-1/2 rounded-full bg-primary/20 blur-[120px]" />
          <div className="absolute right-0 top-40 h-[400px] w-[400px] rounded-full bg-secondary/20 blur-[120px]" />
        </div>
        <div className="mx-auto max-w-4xl px-4 py-24 text-center sm:py-32">
          <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-border bg-muted/50 px-4 py-1.5 text-sm">
            <Sparkles className="h-4 w-4 text-primary" />
            Powered by Claude Vision
          </div>
          <h1 className="text-balance text-5xl font-extrabold tracking-tight sm:text-7xl">
            Your dating profile,
            <br />
            <span className="gradient-text">optimized by AI.</span>
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-balance text-lg text-muted-foreground">
            Upload up to 9 photos and your bio. Get per-photo scores, the strongest first
            photo, your ideal ordering, red-flag detection, and a personal coach — in seconds.
          </p>
          <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Link href="/analyze">
              <Button size="lg" variant="gradient" className="w-full sm:w-auto">
                Analyze my profile
              </Button>
            </Link>
            <Link href="/bio">
              <Button size="lg" variant="outline" className="w-full sm:w-auto">
                Generate a bio
              </Button>
            </Link>
          </div>
          <p className="mt-6 flex items-center justify-center gap-2 text-sm text-muted-foreground">
            <ShieldCheck className="h-4 w-4 text-success" />
            Private by design — photos are analyzed in memory and never stored.
          </p>
        </div>
      </section>

      {/* Features */}
      <section className="mx-auto max-w-6xl px-4 pb-24">
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {features.map((f) => (
            <Card key={f.title} className="transition-transform hover:-translate-y-1">
              <CardContent className="pt-6">
                <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-primary/20 to-secondary/20">
                  <f.icon className="h-5 w-5 text-primary" />
                </div>
                <h3 className="mb-1.5 font-semibold">{f.title}</h3>
                <p className="text-sm text-muted-foreground">{f.desc}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      {/* Scoring explainer */}
      <section className="border-t border-border bg-muted/30">
        <div className="mx-auto max-w-4xl px-4 py-16 text-center">
          <h2 className="text-3xl font-bold">How your score is built</h2>
          <p className="mx-auto mt-3 max-w-2xl text-muted-foreground">
            A transparent, weighted model. We never rate objective attractiveness — only how
            strong your profile is and the first impression it creates.
          </p>
          <div className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-5">
            {[
              ["Photos", "50%"],
              ["Bio", "20%"],
              ["Variety", "10%"],
              ["Authenticity", "10%"],
              ["Conversation", "10%"],
            ].map(([label, weight]) => (
              <div key={label} className="rounded-xl border border-border bg-card p-4">
                <div className="text-2xl font-bold gradient-text">{weight}</div>
                <div className="mt-1 text-sm text-muted-foreground">{label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
