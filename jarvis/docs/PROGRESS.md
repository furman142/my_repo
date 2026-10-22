# Progress log

## 2026-10-22 — Session 1 (Phases 0–4 implemented; live dependencies pending)

### Environment where this was built
Linux container (no Windows, no GPU, no microphone, no iPhone). Python 3.13, Node 22, FFmpeg, Chromium.
Network: PyPI/npm OK; **Ollama registry, Hugging Face and docs.fish.audio blocked**. Fish Audio's official
OpenAPI spec was read from GitHub (`fishaudio/docs`, `api-reference/openapi.json`); Ollama's API from
`ollama/ollama/docs/api.md`.

### Delivered
- Backend (`backend/app`): config, SQLite + migrations, auth (setup code, Argon2id, sessions, CSRF, rate
  limits), security middleware, orchestrator with bounded tool loop, 12 tools, approval service, Ollama +
  Groq providers, faster-whisper STT, Fish TTS + voice library search, diagnostics, SPA serving.
- Frontend (`frontend/src`): orb renderer + state machine, PTT recorder, reply player with analyser,
  chat/approvals/tasks/memories/settings/diagnostics UI, i18n (en/he, RTL), PWA (manifest, icons, SW).
- Scripts: `setup-windows.ps1`, `start-windows.ps1`, `self-check.ps1`. Docs: this folder.

### Tests actually run (all passing)
| Command | Result |
|---|---|
| `backend: pytest -q` | **74 passed** (auth/CSRF/origin/host/rate-limit/session expiry, approvals deny/expire/replay/cross-session/tamper/supersede, tool validation & budget, Ollama offline & model-missing, persistence across restart, memory FTS incl. Hebrew, URL safety, Fish request shape & error mapping, STT MIME/size/duration, PyAV decode of real WebM/Opus + MP4/AAC files made by ffmpeg) |
| `backend: ruff check app tests` · `mypy app` | clean |
| `frontend: npm run typecheck` · `lint` · `test` · `build` | clean · clean · **25 passed** · built (≈85 kB gzip JS) |
| `frontend: node scripts/screenshots.mjs` (real backend + real UI in Chromium; LLM = test stand-in `backend/tests/e2e/fake_ollama_server.py`) | **13/13 checks**: boot→IDLE, text reply, `list_tasks` returns the real SQLite task, approval sheet, deny ⇒ no task, approve ⇒ exactly one task, mic→LISTENING with Chromium fake mic, no horizontal overflow at 1366/390/320 px, Hebrew → `dir=rtl`, no JS errors. Screenshots in `docs/screenshots/` (curated JPGs committed) |
| Live server with LLM stopped | `/api/health` → `llm: unavailable`; chat returns `llm_unavailable` with "Is Ollama running?" |

### Bugs found by the tests and fixed
- faster-whisper 1.2.1 + PyAV 19 crash on every decode (`metadata_errors` kwarg) → pinned `av<17` (16.1 verified).
- Hebrew memory search missed prefixed words (כלב vs הכלב) → FTS5 trigram tokenizer + prefix stripping.
- Subtitle overlapped the text composer → layout fix (verified by screenshot).

### NOT verified live (be explicit)
- **Ollama + qwen3:8b** real responses / tool-calling quality — no Ollama here. Mock follows the documented protocol.
- **faster-whisper transcription** — model download (Hugging Face) blocked; decoding + plumbing verified only.
- **Fish Audio** synthesis, voice search, English/Hebrew samples — no API key; request shape verified against the official OpenAPI.
- Orb reacting to *Fish* playback (code path is the same analyser used for the mic, which was exercised).
- PowerShell scripts were written for Windows PowerShell 5.1/7 but **not executed** (no Windows here).
- Tailscale Serve, iPhone Safari, GPU telemetry with a real NVIDIA card, Groq.

### Next exact steps (on the Windows PC)
1. `.\scripts\setup-windows.ps1` → `ollama pull qwen3:8b` → `.\scripts\start-windows.ps1`
2. Sign in with the console setup code; Diagnostics → *Load speech model now*; hold mic: "what do I have to do today?"
3. Add `FISH_API_KEY`, pick a voice in Settings → Voice, run both sample tests; record results here.
4. Tailscale Serve + iPhone checklist (docs/SECURITY.md).
