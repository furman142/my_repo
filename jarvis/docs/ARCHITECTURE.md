# Architecture

```
 Browser / iPhone PWA  ──HTTPS (Tailscale Serve)──┐
 Desktop browser ──────────http://127.0.0.1:8787──┤
                                                  ▼
                       FastAPI (uvicorn, one origin, loopback)
   ┌──────────────── SecurityMiddleware: Host allowlist · Origin/Sec-Fetch-Site · CSP & headers
   │   /api/auth/*  /api/chat (SSE)  /api/approvals/{id} (SSE)  /api/tasks  /api/memories
   │   /api/audio/transcribe  /api/audio/speak  /api/voice/*  /api/settings  /api/diagnostics
   │   /*  → frontend/dist (SPA fallback, immutable /assets)
   ▼
 Services (DI container, app/services.py)
   AuthService ─ sessions (sha256 token ids), Argon2id, setup code
   Orchestrator ─ bounded LLM⇄tool loop, events, cancellation, time & tool budgets
      ├─ LLMProvider: OllamaProvider (/api/chat NDJSON, tools, think=false) | GroqProvider (opt-in)
      ├─ ToolRegistry ─ typed ToolSpec (pydantic args, side effect, timeout, preview, audit)
      └─ ApprovalService ─ HMAC(session,tool,args,nonce), expiry, atomic single-use decision
   WhisperSTT (faster-whisper, PyAV in-memory decode)   FishTTS (POST /v1/tts, GET /model)
   Repository (SQLite WAL, migrations, FTS5 trigram for memories)
```

## Request lifecycle (text or voice)
1. `POST /api/audio/transcribe` (voice only): MIME allowlist → size cap → PyAV decode to 16 kHz →
   duration cap → Whisper (VAD) → transcript. Raw audio is discarded.
2. `POST /api/chat` returns an SSE stream. Orchestrator stores the user message, supersedes stale
   approvals, builds history (last N messages + top FTS memory hits in the system prompt).
3. LLM streams tokens (`token` events). If it returns `tool_calls`:
   - read-only tool → validate → execute with timeout → audit → `tool_result` → loop.
   - side-effect tool → validate → preview → `ApprovalService.create` → `approval_required` → stream ends.
4. `POST /api/approvals/{id}` `{nonce, approve}` → verify (session, nonce, HMAC, expiry, pending) →
   execute exactly once (or record denial) → append tool message → continue the loop (SSE).
5. Final `message` event carries `text` and a speech-shaped `spoken` string. The client calls
   `POST /api/audio/speak`, decodes the MP3 with Web Audio and plays it through an `AnalyserNode`
   that drives the orb.

## Frontend
- `app/stateMachine.ts` — explicit transition table; every HUD change is an event. Invalid events are ignored.
- `features/chat/useAssistant.ts` — controller: SSE handling, PTT, approvals, playback, health polling (10 s).
- `hud/orbRenderer.ts` — pure Canvas drawing function of (time, state, level, spectrum, boot).
  `OrbCanvas` pauses on `visibilitychange`, caps DPR at 2, drops to ~10 fps with reduced motion/offline.
- `hud/audio.ts` — single AudioContext unlocked on user gesture; `ReplyPlayer` uses a generation
  counter so a new reply/stop deterministically interrupts the old one.
- `public/sw.js` — caches only `/assets/*`, `/icons/*` and the shell; `/api/*` is never cached.

## Data model (SQLite, `data/jarvis.sqlite3`)
`users, sessions, conversations, messages, assistant_events, tasks, memories (+memories_fts),
tool_requests, tool_approvals, tool_execution_audit, settings`. Migrations: `db.py::MIGRATIONS`,
version in `PRAGMA user_version`.

## GPU / VRAM profiles
| Profile | Ollama | Whisper |
|---|---|---|
| 8 GB (RTX 5060 Ti 8 GB) | `qwen3:8b` (Q4_K_M ≈ 5.2 GB) + `OLLAMA_CONTEXT_LENGTH=4096…8192`; one request at a time (orchestrator rejects concurrent turns per conversation) | `STT_DEVICE=cpu`, `int8`, `small` |
| 16 GB | `OLLAMA_CONTEXT_LENGTH=8192…16384` | optionally `STT_DEVICE=cuda`, `float16` (needs CUDA 12 + cuDNN 9) |
| cpu | works but slow; consider a smaller model | cpu int8 |
Check memory pressure in Diagnostics (VRAM used/total from `nvidia-smi`). If both LLM and Whisper run
on the GPU with 8 GB, expect swapping/slowdowns — keep Whisper on CPU.
