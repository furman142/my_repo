/**
 * Bio generation. Returns three distinct options in the requested tone.
 * Falls back to curated examples when the API is disabled.
 */
import { getClient, isAiEnabled, TEXT_MODEL } from "./config";
import { bioGenerationPrompt } from "./prompts";
import { mockGenerateBios } from "./mock-analyzer";
import type { BioTone } from "../types";

function parseNumberedList(text: string): string[] {
  const lines = text
    .split("\n")
    .map((l) => l.replace(/^\s*\d+[.)]\s*/, "").trim())
    .filter((l) => l.length > 0);
  return lines.slice(0, 3);
}

export async function generateBios(
  tone: BioTone,
  about?: string,
  interests?: string[],
): Promise<string[]> {
  if (!isAiEnabled()) return mockGenerateBios(tone);

  try {
    const client = getClient();
    const context = [
      about ? `About the user: ${about}` : "",
      interests?.length ? `Interests: ${interests.join(", ")}` : "",
    ]
      .filter(Boolean)
      .join("\n");

    const response = await client.messages.create({
      model: TEXT_MODEL,
      max_tokens: 800,
      messages: [
        {
          role: "user",
          content: `${bioGenerationPrompt(tone)}${context ? `\n\n${context}` : ""}`,
        },
      ],
    });

    if (response.stop_reason === "refusal") return mockGenerateBios(tone);
    const text = response.content.map((b) => (b.type === "text" ? b.text : "")).join("\n");
    const bios = parseNumberedList(text);
    return bios.length ? bios : mockGenerateBios(tone);
  } catch (err) {
    console.error("[bio] generation failed, using fallback:", err);
    return mockGenerateBios(tone);
  }
}
