import Link from "next/link";
import { Shield } from "lucide-react";

export function SiteFooter() {
  return (
    <footer className="border-t border-border">
      <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 px-4 py-6 text-sm text-muted-foreground sm:flex-row">
        <p>© {new Date().getFullYear()} ProfilePilot. Built for better first impressions.</p>
        <div className="flex items-center gap-4">
          <span className="flex items-center gap-1.5">
            <Shield className="h-4 w-4 text-success" />
            Photos never stored by default
          </span>
          <Link href="/privacy" className="hover:text-foreground">
            Privacy
          </Link>
        </div>
      </div>
    </footer>
  );
}
