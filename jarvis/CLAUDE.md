# JARVIS — project rules for Claude Code

Personal, single-user voice assistant: local FastAPI backend + React/Vite PWA, served from ONE loopback
origin (`http://127.0.0.1:8787`), reached from iPhone only via Tailscale Serve HTTPS.

Detailed docs: `docs/SPEC.md` (what), `docs/ARCHITECTURE.md` (how), `docs/ROADMAP.md` (phases),
`docs/PROGRESS.md` (what is actually done/verified — update after every phase), `docs/SECURITY.md`,
`docs/VOICE_DESIGN.md`, `docs/API.md`.

## Layout
- `backend/app/` — `api/` routes+schemas · `agent/` orchestrator+prompt · `providers/` llm (Ollama, Groq),
  stt (faster-whisper), tts (Fish) · `tools/` registry, builtin tools, approvals · `memory/` repository ·
  `security/` auth, middleware · `system/` metrics · `db.py` migrations · `services.py` DI container.
- `frontend/src/` — `app/` (App, **stateMachine.ts** = single HUD state machine) · `hud/` (orb renderer,
  audio analysers) · `features/{chat,voice,tasks,memory,settings,approvals,diagnostics}` · `lib/` api, i18n.
- `scripts/*.ps1` — Windows setup/start/self-check.

## Commands (run from `jarvis/`)
```bash
# backend
cd backend && python -m venv .venv && .venv/bin/pip install -e ".[stt,dev]"   # Windows: .venv\Scripts\
.venv/bin/python -m pytest -q          # unit + integration (mock LLM/TTS transports, no keys needed)
.venv/bin/ruff check app tests && .venv/bin/mypy app
.venv/bin/python -m app                # serves API + frontend/dist on 127.0.0.1:8787
# frontend
cd frontend && npm ci && npm run typecheck && npm run lint && npm test && npm run build
npm run dev                            # Vite on :5173, proxies /api to :8787
# browser E2E + screenshots (needs running backend; tests/e2e/fake_ollama_server.py if no Ollama)
node scripts/screenshots.mjs
```

## Non-negotiable rules
- **Never fake success.** No simulated transcripts, replies, telemetry, voice IDs or "connected" states in
  runtime code. Missing dependency ⇒ `not_configured` / `unavailable` with an actionable message.
  Mocks live only in `backend/tests/` (httpx MockTransport, `tests/e2e/fake_ollama_server.py`).
- **Approvals are server-side.** Any tool with side effects has `requires_approval=True`; the
  `ApprovalService` binds session + tool + canonical args (HMAC) + nonce + expiry, and decisions are
  single-use. The LLM never approves itself. Do not add bypasses "for the demo".
- **New tools** go through `tools/registry.py` `ToolSpec` with a Pydantic args model (`extra="forbid"`),
  side-effect category, timeout, preview text and audit. No shell, eval, arbitrary file or process access.
- **Secrets** (`FISH_API_KEY`, `GROQ_API_KEY`) stay in `.env` on the server. Never return them from an
  endpoint, log them, put them in the frontend bundle or localStorage. Tests assert this.
- **Network exposure:** bind `127.0.0.1`. Never expose Ollama or a second port. No Funnel / port forwarding.
- **Memory is opt-in.** The assistant may only *propose*; saving needs user approval or the Memories UI.
  Deletion is a hard delete (row + FTS index).
- **Times:** tasks accept only explicit `YYYY-MM-DD` / `YYYY-MM-DDTHH:MM` in the configured timezone;
  ambiguous input must lead to a clarification question, never an invented time.
- **HUD:** all visible state changes go through `stateMachine.ts`. Audio-reactive visuals must read real
  `AnalyserNode` data (mic or reply playback), never random values.
- **Honest docs:** update `docs/PROGRESS.md` with what was run and what was *not* verified live.
- Keep the existing ProfilePilot app in the repo root untouched; JARVIS lives entirely under `jarvis/`.

## Conventions
- Python 3.12+, Pydantic v2, ruff (line 120), mypy clean. Frontend: strict TS, no UI library.
- DB schema changes: append a new entry to `MIGRATIONS` in `db.py` (never edit released ones).
- Hebrew/English: replies follow the user's language; UI strings in `lib/i18n.ts`; use `dir="auto"` on user text.
