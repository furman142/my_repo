# Optional integrations

ProfilePilot works with **zero** external services. Everything below is opt-in and
activates only when the corresponding environment variables are set. The core code is
written so each is a small, localized change.

## AI — Anthropic Claude (recommended)

```bash
ANTHROPIC_API_KEY=sk-ant-...
PROFILEPILOT_VISION_MODEL=claude-opus-5   # optional override
PROFILEPILOT_TEXT_MODEL=claude-opus-5     # optional override
```

Without a key, `src/lib/ai/config.ts` reports `isAiEnabled() === false` and every analyzer
falls back to the deterministic mock in `src/lib/ai/mock-analyzer.ts`.

## Database — Prisma + Postgres

Powers the server-backed Improvement Tracker and the admin/analytics dashboards.

```bash
DATABASE_URL=postgresql://user:pass@host:5432/profilepilot
npm run prisma:generate
npm run prisma:migrate
```

The schema (`prisma/schema.prisma`) stores **scores and metadata only — never photos**.
To persist a run server-side, add a thin repository that writes an `Analysis` row in
`/api/analyze` after `generateReport`. The browser-local tracker in `src/lib/history.ts`
remains the default.

## Redis — cache + distributed rate limiting

```bash
REDIS_URL=redis://localhost:6379
```

`src/lib/rate-limit.ts` uses an in-memory store by default. For multi-instance deploys,
replace `rateLimit()` with a Redis `INCR`/`EXPIRE` implementation behind the same
`RateLimitResult` interface — no caller changes required.

## Auth — Clerk

```bash
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_...
CLERK_SECRET_KEY=sk_...
```

Wrap the app in `<ClerkProvider>` in `src/app/layout.tsx`, add `middleware.ts`, and read
the user id in API routes to attach analyses to a `User`. The app is fully usable
anonymously, so auth is additive.

## Storage — Supabase (only if the user opts in to saving photos)

```bash
NEXT_PUBLIC_SUPABASE_URL=https://xyz.supabase.co
SUPABASE_SERVICE_ROLE_KEY=...
```

By default photos are never stored. If you add an explicit "save my photos" opt-in, upload
the prepared image blobs to a private Supabase bucket and store the returned paths on the
`Analysis` row. Keep the opt-in **off by default** to preserve the privacy guarantee.

## Payments — Stripe (Pro tier)

```bash
STRIPE_SECRET_KEY=sk_...
STRIPE_WEBHOOK_SECRET=whsec_...
NEXT_PUBLIC_STRIPE_PRICE_ID=price_...
```

Add a `/api/stripe/checkout` route to create a Checkout Session and a
`/api/stripe/webhook` route to flip `User.plan` to `PRO` on `checkout.session.completed`.
Gate premium features (A/B testing, unlimited runs) on `plan === "PRO"`.

## Error monitoring

Add Sentry (or similar) by wrapping the app and API routes. The `console.error` calls in
the AI layer already log request context you can forward.

## Deployment — Vercel

The app deploys to Vercel with no changes; set `ANTHROPIC_API_KEY` (and any optional vars)
in the project settings. For a container platform, use the provided `Dockerfile`
(`output: "standalone"`).
