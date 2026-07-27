import { AlertTriangle, CheckCircle2 } from "lucide-react";
import type { Flag } from "@/lib/types";
import { Badge } from "@/components/ui/badge";

function FlagList({ flags, kind }: { flags: Flag[]; kind: "red" | "green" }) {
  const isRed = kind === "red";
  const Icon = isRed ? AlertTriangle : CheckCircle2;
  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <h3 className="mb-3 flex items-center gap-2 font-semibold">
        <Icon className={isRed ? "h-5 w-5 text-destructive" : "h-5 w-5 text-success"} />
        {isRed ? "Red flags" : "Green flags"}
      </h3>
      {flags.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {isRed ? "None detected — nice work!" : "Add travel, pet, or hobby photos to earn some."}
        </p>
      ) : (
        <ul className="space-y-3">
          {flags.map((f, i) => (
            <li key={i} className="flex items-start gap-2">
              <Badge
                variant={isRed ? "destructive" : "success"}
                className="mt-0.5 shrink-0"
              >
                {f.severity}
              </Badge>
              <div>
                <p className="text-sm font-medium">{f.label}</p>
                <p className="text-xs text-muted-foreground">{f.detail}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function Flags({ red, green }: { red: Flag[]; green: Flag[] }) {
  return (
    <div className="grid gap-5 md:grid-cols-2">
      <FlagList flags={green} kind="green" />
      <FlagList flags={red} kind="red" />
    </div>
  );
}
