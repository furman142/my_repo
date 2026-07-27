import { ShieldCheck } from "lucide-react";

export const metadata = { title: "Privacy — ProfilePilot" };

export default function PrivacyPage() {
  return (
    <div className="mx-auto max-w-2xl px-4 py-12">
      <div className="mb-6 flex items-center gap-3">
        <ShieldCheck className="h-8 w-8 text-success" />
        <h1 className="text-3xl font-bold">Privacy by design</h1>
      </div>
      <div className="space-y-5 text-sm leading-relaxed text-muted-foreground">
        <p>
          ProfilePilot is built so your photos stay yours. Here is exactly how your data is handled.
        </p>
        <Section title="Photos are never stored by default">
          Images are compressed <strong>in your browser</strong> before upload, sent to the server
          only for the single analysis request, held in memory while the AI evaluates them, and then
          discarded. Nothing is written to disk or to any database unless you explicitly opt in.
        </Section>
        <Section title="Analysis history stays on your device">
          The Progress tracker saves only your <em>scores</em> (never the photos) to your browser&apos;s
          local storage. Clearing your browser data — or the “Clear” button on the Progress page —
          removes it completely.
        </Section>
        <Section title="No objective attractiveness ratings">
          The AI evaluates <strong>photo quality</strong> and the <strong>likely first impression</strong> a
          photo creates. It never rates a person&apos;s looks and never comments on protected
          characteristics.
        </Section>
        <Section title="Optional integrations are opt-in">
          Saving photos to cloud storage, syncing history across devices, and payments are all disabled
          unless you configure them. See <code>docs/INTEGRATIONS.md</code> in the repository.
        </Section>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h2 className="mb-1 font-semibold text-foreground">{title}</h2>
      <p>{children}</p>
    </div>
  );
}
