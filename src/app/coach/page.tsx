import { CoachChat } from "@/components/coach-chat";

export const metadata = { title: "AI Coach — ProfilePilot" };

export default function CoachPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <div className="mb-6 text-center">
        <h1 className="text-3xl font-bold sm:text-4xl">AI Coach</h1>
        <p className="mt-2 text-muted-foreground">
          Your personal dating-profile strategist. Ask anything.
        </p>
      </div>
      <CoachChat />
    </div>
  );
}
