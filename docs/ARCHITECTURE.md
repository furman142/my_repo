# Architecture

ProfilePilot is a Next.js App Router application with a clean separation between the
**pure domain logic** (deterministic, unit-tested), the **AI layer** (swappable, with an
offline fallback), and the **UI**.

```
Browser                          Server (Next API routes)          AI layer
──────────────────────────────   ──────────────────────────────   ────────────────────────
PhotoUploader                     /api/analyze  ─► report.ts ─────► analyzer.ts ─► Claude
 └ image.ts (compress in-browser)                  └ scoring.ts        └ mock-analyzer.ts
ReportView / charts                /api/bio      ─► bio.ts ──────────► (fallback when no key)
CoachChat  ◄── stream ──           /api/coach    ─► coach.ts (SSE-ish stream)
history.ts (localStorage)          /api/health
```

## Layers

### 1. Domain (`src/lib`)

- **`types.ts`** — the single source of truth for every shape (photo attributes, report,
  flags, recommendations).
- **`scoring.ts`** — **pure functions only.** Given per-photo and per-bio analyses, it
  computes category scores, the weighted overall score, ordering, flags, recommendations,
  and memorability. No I/O, no randomness → fully unit-testable and reproducible.
- **`schemas.ts`** — Zod request validation + JSON schemas that constrain the AI output.
- **`rate-limit.ts`** — a tiny fixed-window limiter (in-memory; Redis-swappable).
- **`history.ts`** / **`image.ts`** — browser-side persistence and image compression.

### 2. AI (`src/lib/ai`)

Every entry point degrades gracefully. `config.isAiEnabled()` gates on
`ANTHROPIC_API_KEY`; when it's absent, callers use **`mock-analyzer.ts`**, a deterministic
hash-seeded analyzer. This is what lets the whole product run — and its tests pass — with
zero external services.

- **`analyzer.ts`** — photo + bio analysis. Photos run with a concurrency cap; each photo
  falls back to the mock independently so one failure never sinks the whole report.
- **`bio.ts`** — bio generation (3 options per tone).
- **`coach.ts`** — a streamed chat reply.
- **`prompts.ts`** — system prompts, all carrying the safety guardrail (no attractiveness
  ratings, no protected characteristics, always explain the score).

### 3. API routes (`src/app/api`)

Thin, validated, rate-limited handlers. They own request parsing and error shaping; all
real work is delegated to the domain/AI layers. Photos are processed in memory and never
persisted.

### 4. UI (`src/app`, `src/components`)

- shadcn-style primitives in `components/ui`.
- Feature components (`photo-uploader`, `coach-chat`) and the composed report view in
  `components/report`.
- Dark mode via a class-based `ThemeProvider` with a no-flash inline script.

## Why the mock analyzer matters

It's not just for demos. It:

1. Makes local dev and CI **hermetic** (no API key, no flakiness, no cost).
2. Provides a **graceful degradation** path in production for transient failures/refusals.
3. Keeps the scoring engine's tests **deterministic**.

## Testing strategy

- **Unit** — the scoring engine (the highest-value logic), the rate limiter, and the mock
  analyzer's determinism.
- **Integration** — `report.ts` end-to-end through the mock analyzer (`report.test.ts`).
- **Component** — rendering of report pieces with Testing Library.

## Extending

Swap the AI provider by reimplementing `src/lib/ai/analyzer.ts` against the same `types.ts`
contract — the scoring engine and UI don't change. Swap the rate-limit or history store by
reimplementing the small interfaces in `rate-limit.ts` / `history.ts`.
