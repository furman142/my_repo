# Privacy

Privacy is a design constraint in ProfilePilot, not a policy bolted on afterward.

## What happens to a photo

1. **Compressed in your browser.** `src/lib/image.ts` resizes and re-encodes each image to
   a bounded JPEG on the client. The original file never leaves your device unmodified.
2. **Sent for one request.** The compressed base64 is POSTed to `/api/analyze`.
3. **Held in memory only.** The server passes it to the analyzer and never writes it to
   disk, a database, or object storage.
4. **Discarded.** When the request completes, the payload is gone. The service worker is
   explicitly configured to **never cache `/api/*` requests** (`public/sw.js`).

## What is stored

- **Nothing, by default, on the server.**
- **In your browser only:** the Progress tracker (`src/lib/history.ts`) keeps the last 50
  runs' **scores and metadata** — never the images — in `localStorage`. Clear it any time
  from the Progress page or by clearing site data.

## What the AI is instructed to do

Every prompt (`src/lib/ai/prompts.ts`) carries a guardrail: evaluate photo *quality* and
*likely first impression* only; never rate objective attractiveness; never comment on
protected characteristics; always explain each score.

## Opt-in only

Saving photos to cloud storage, cross-device history, and accounts are all **off unless
you configure them** (see `INTEGRATIONS.md`). If you add photo saving, keep it behind an
explicit, default-off opt-in to preserve the guarantee above.
