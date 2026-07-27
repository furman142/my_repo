# ProfilePilot ✈️

**AI-powered dating-profile optimizer.** Upload up to 9 photos and your bio, and get
per-photo scores with explanations, your strongest first photo, the ideal ordering,
red/green-flag detection, actionable recommendations, a mock profile preview, and a
personal AI coach — all private by design.

> ProfilePilot never rates objective attractiveness. It evaluates **profile quality**
> and the **likely first impression** your profile makes, and every score comes with
> the reason it was given.

---

## ✨ Features

| | |
|---|---|
| **AI Photo Analysis** | Every photo scored 1–10 across 14 attributes (smile, eye contact, lighting, composition, cropping, authenticity…) — each with a reason. Detects portraits, group shots, mirror selfies, gym/car/travel/pet photos, over-editing, and more. |
| **Weighted Profile Rating** | Overall 0–10 score: Photos 50% · Bio 20% · Variety 10% · Authenticity 10% · Conversation 10%, plus First-Impression & Trustworthiness read-outs. |
| **Best First Photo & Order** | Automatically picks your strongest opener and recommends the ideal ordering. |
| **Remove Bad Photos** | Flags weak photos with the reason they're dragging you down. |
| **Bio Studio** | Generate bios in 10 personalities (funny, confident, flirty, adventure, geek, fitness, luxury, travel…) and score an existing bio on originality, confidence, humor, length, attractiveness, and conversation starters. |
| **Red & Green Flags** | Catches too-many-selfies, no-smile, poor-lighting, low-variety, cropped people — and highlights travel, pets, friends, hobbies, genuine smiles. |
| **AI Recommendations** | Prioritized, concrete steps ("Move Photo #2 to first", "Replace Photo #4 with an outdoor shot"). |
| **Profile Preview** | A mock dating-app card rendered in your recommended order. |
| **AI Coach** | Streaming chat: "Which photo should I delete?", "Is my bio too serious?". |
| **Progress Tracker** | Saves each analysis (locally) and charts your score over time. |
| **Memorability estimate**, **PDF export** (print), **PWA**, **dark mode**, **accessible & responsive**. |

## 🏗️ Tech stack

- **Next.js 15** (App Router) · **React 19** · **TypeScript** (strict)
- **Tailwind CSS** + shadcn-style UI primitives · **Framer Motion** · **Recharts**
- **Anthropic Claude** (vision + text) via `@anthropic-ai/sdk`
- **Vitest** + Testing Library · **Docker** · **GitHub Actions**
- Optional: **Prisma/Postgres**, **Redis**, **Clerk**, **Supabase Storage**, **Stripe**

## 🚀 Quick start

```bash
npm install
cp .env.example .env      # optional — the app runs without any keys
npm run dev               # http://localhost:3000
```

**No API key? No problem.** With `ANTHROPIC_API_KEY` unset, ProfilePilot runs in
**demo mode**: a deterministic heuristic analyzer produces stable, believable results so
you can develop and demo the entire UX offline. Set the key to switch to real Claude
Vision analysis — nothing else changes.

```bash
# .env
ANTHROPIC_API_KEY=sk-ant-...
```

## 🧪 Scripts

```bash
npm run dev          # dev server
npm run build        # production build (standalone output)
npm run start        # serve the production build
npm run lint         # eslint
npm run typecheck    # tsc --noEmit
npm run test         # vitest (unit + integration)
npm run test:coverage
```

## 🐳 Docker

```bash
docker build -t profilepilot .
docker run -p 3000:3000 -e ANTHROPIC_API_KEY=sk-ant-... profilepilot

# or the full stack (app + Postgres + Redis)
docker compose up
```

## 📐 Scoring model

The score is transparent and deterministic given the AI's per-attribute reads — see
[`src/lib/scoring.ts`](src/lib/scoring.ts). When no bio is supplied, its 20% weight is
redistributed across the remaining categories so a photos-only profile isn't unfairly
capped.

## 🔒 Privacy

Photos are compressed **in the browser**, sent to the server only for a single analysis
request, held in memory, and discarded. Nothing is written to disk or a database unless
you explicitly opt in. History lives in your browser's local storage (scores only, never
photos). See [`docs/PRIVACY.md`](docs/PRIVACY.md) and the in-app `/privacy` page.

## 📚 Docs

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — how the pieces fit together
- [`docs/INTEGRATIONS.md`](docs/INTEGRATIONS.md) — wiring up Clerk, Stripe, Postgres, Redis, Supabase
- [`docs/PRIVACY.md`](docs/PRIVACY.md) — data handling

## ⚖️ Disclaimer

ProfilePilot offers automated, subjective feedback on profile *presentation*. It is not a
guarantee of outcomes and does not assess people — only photos and text.

## 📝 License

MIT — see [`LICENSE`](LICENSE).
