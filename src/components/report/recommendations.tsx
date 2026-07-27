import { ArrowRight } from "lucide-react";
import type { Recommendation } from "@/lib/types";
import { Badge } from "@/components/ui/badge";

const priorityVariant = {
  high: "destructive",
  medium: "warning",
  low: "secondary",
} as const;

export function Recommendations({ items }: { items: Recommendation[] }) {
  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <h3 className="mb-4 font-semibold">AI recommendations</h3>
      <ol className="space-y-3">
        {items.map((r) => (
          <li key={r.id} className="flex items-start gap-3">
            <ArrowRight className="mt-1 h-4 w-4 shrink-0 text-primary" />
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <p className="text-sm font-medium">{r.action}</p>
                <Badge variant={priorityVariant[r.priority]} className="text-[10px]">
                  {r.priority}
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground">{r.reason}</p>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
