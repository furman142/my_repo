"use client";
import * as React from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Trash2, TrendingUp } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { clearHistory, loadHistory, type HistoryEntry } from "@/lib/history";
import { formatDate } from "@/lib/utils";

export default function TrackerPage() {
  const [history, setHistory] = React.useState<HistoryEntry[]>([]);

  React.useEffect(() => setHistory(loadHistory()), []);

  const data = history.map((h, i) => ({
    run: `#${i + 1}`,
    date: formatDate(h.createdAt),
    overall: h.overallScore,
    photos: h.categories.photos,
    memorability: h.memorability / 10,
  }));

  const latest = history[history.length - 1];
  const first = history[0];
  const delta =
    latest && first && history.length > 1 ? latest.overallScore - first.overallScore : 0;

  return (
    <div className="mx-auto max-w-4xl px-4 py-10">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold sm:text-4xl">Progress</h1>
          <p className="mt-2 text-muted-foreground">Every analysis you run is saved locally to chart your improvement.</p>
        </div>
        {history.length > 0 && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              clearHistory();
              setHistory([]);
            }}
          >
            <Trash2 className="h-4 w-4" /> Clear
          </Button>
        )}
      </div>

      {history.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
            <TrendingUp className="h-10 w-10 text-muted-foreground" />
            <p className="font-medium">No history yet</p>
            <p className="max-w-sm text-sm text-muted-foreground">
              Run an analysis and it&apos;ll appear here so you can track your score over time.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Stat label="Runs" value={String(history.length)} />
            <Stat label="Latest score" value={latest ? latest.overallScore.toFixed(1) : "–"} />
            <Stat
              label="Change"
              value={`${delta >= 0 ? "+" : ""}${delta.toFixed(1)}`}
              highlight={delta > 0}
            />
            <Stat label="Best" value={Math.max(...history.map((h) => h.overallScore)).toFixed(1)} />
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Score over time</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={data} margin={{ top: 8, right: 16, bottom: 8, left: -16 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="run" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }} />
                    <YAxis domain={[0, 10]} tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }} />
                    <Tooltip
                      contentStyle={{
                        background: "hsl(var(--card))",
                        border: "1px solid hsl(var(--border))",
                        borderRadius: 8,
                        fontSize: 12,
                      }}
                    />
                    <Line type="monotone" dataKey="overall" name="Overall" stroke="hsl(var(--primary))" strokeWidth={2.5} dot={{ r: 3 }} />
                    <Line type="monotone" dataKey="photos" name="Photos" stroke="hsl(var(--secondary))" strokeWidth={2} dot={{ r: 2 }} />
                    <Line type="monotone" dataKey="memorability" name="Memorability" stroke="hsl(var(--accent))" strokeWidth={2} strokeDasharray="4 4" dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className={`text-2xl font-bold ${highlight ? "text-success" : ""}`}>{value}</div>
      <div className="mt-1 text-xs text-muted-foreground">{label}</div>
    </div>
  );
}
