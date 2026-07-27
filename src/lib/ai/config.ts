/**
 * AI configuration and client factory.
 *
 * The whole app degrades gracefully: if ANTHROPIC_API_KEY is not set,
 * `isAiEnabled()` returns false and callers fall back to the deterministic
 * mock analyzer. This keeps local development and CI fully functional with
 * zero external dependencies.
 */
import Anthropic from "@anthropic-ai/sdk";

export const VISION_MODEL = process.env.PROFILEPILOT_VISION_MODEL || "claude-opus-5";
export const TEXT_MODEL = process.env.PROFILEPILOT_TEXT_MODEL || "claude-opus-5";

export function isAiEnabled(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

let client: Anthropic | null = null;

export function getClient(): Anthropic {
  if (!client) {
    client = new Anthropic();
  }
  return client;
}
