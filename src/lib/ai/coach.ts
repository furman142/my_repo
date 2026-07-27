/**
 * AI Coach — a streaming chat endpoint helper.
 *
 * Returns a ReadableStream of text chunks the API route forwards to the client.
 * When the API is disabled, yields a helpful canned response so the chat UI is
 * still demoable offline.
 */
import { getClient, isAiEnabled, TEXT_MODEL } from "./config";
import { COACH_SYSTEM_PROMPT } from "./prompts";
import type { CoachMessage } from "../types";

const encoder = new TextEncoder();

function mockCoachReply(messages: CoachMessage[]): string {
  const last = messages[messages.length - 1]?.content.toLowerCase() ?? "";
  if (last.includes("delete") || last.includes("remove"))
    return "Delete whichever photo scores lowest and adds the least variety — usually a blurry shot or a third mirror selfie. Keep your strongest, clearest, smiling photo first.";
  if (last.includes("bio"))
    return "A good bio is short, specific, and ends with an easy hook. If yours reads a little serious, add one light or playful line — but keep it authentic.";
  if (last.includes("gym"))
    return "One gym photo can work if it's well-lit and not a mirror selfie. More than one starts to crowd out variety, so cap it at one.";
  return "Focus on three things: lead with your strongest smiling photo, cover 4–5 distinct positive contexts (travel, friends, hobbies, outdoors), and write a short bio with one conversation hook. (Set ANTHROPIC_API_KEY to chat with the full AI coach.)";
}

export async function coachStream(
  messages: CoachMessage[],
  reportSummary?: string,
): Promise<ReadableStream<Uint8Array>> {
  if (!isAiEnabled()) {
    const reply = mockCoachReply(messages);
    return new ReadableStream({
      start(controller) {
        // Emit in small chunks to mimic streaming for the UI.
        const words = reply.split(" ");
        let i = 0;
        const timer = setInterval(() => {
          if (i >= words.length) {
            clearInterval(timer);
            controller.close();
            return;
          }
          controller.enqueue(encoder.encode(words[i] + " "));
          i++;
        }, 20);
      },
    });
  }

  const client = getClient();
  const system = reportSummary
    ? `${COACH_SYSTEM_PROMPT}\n\nThe user's current profile report:\n${reportSummary}`
    : COACH_SYSTEM_PROMPT;

  return new ReadableStream({
    async start(controller) {
      try {
        const stream = client.messages.stream({
          model: TEXT_MODEL,
          max_tokens: 1024,
          system,
          messages: messages.map((m) => ({ role: m.role, content: m.content })),
        });
        for await (const event of stream) {
          if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
            controller.enqueue(encoder.encode(event.delta.text));
          }
        }
        controller.close();
      } catch (err) {
        console.error("[coach] stream failed:", err);
        controller.enqueue(encoder.encode("Sorry — I hit an error. Please try again."));
        controller.close();
      }
    },
  });
}
