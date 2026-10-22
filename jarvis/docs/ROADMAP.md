# Roadmap

Legend: ✅ done & verified in CI-like environment · 🟡 implemented, needs live verification on the owner's PC/keys/phone · ⬜ not implemented

## Phase 0 — Foundation ✅
Repo layout under `jarvis/`, CLAUDE.md, docs, `.env.example`, config validation, FastAPI + React/Vite
skeletons, SQLite migrations, `/api/health`, PowerShell scripts (🟡 not executed: no Windows here).
**Acceptance:** `pytest`, `npm run build`, server serves UI on :8787, health reports component states.

## Phase 1 — Local text assistant + real data ✅ / 🟡
Ollama streaming chat with tools (🟡 verified only against a protocol-accurate mock; live Ollama not
available in the build environment), durable conversations, tasks/time/system/memory tools, approvals.
**Acceptance:** tool approval deny/expire/replay/cross-session/tamper tests; restart persistence test;
Ollama offline → actionable error (live-verified against the real server).

## Phase 2 — Cinematic HUD ✅
Canvas orb, 10-state machine, approval sheet, drawers (transcript, tasks, memories, settings,
diagnostics), RTL, reduced motion, responsive (1920×1080, 1366×768, 390×844, 320×640 screenshots).

## Phase 3 — Real voice round trip 🟡
MediaRecorder PTT (✅ in Chromium with fake device), PyAV decode of WebM/Opus and MP4/AAC (✅),
faster-whisper transcription (🟡 model download blocked here), Fish Audio REST TTS conforming to the
official OpenAPI (🟡 no key here), Web Audio playback analyser driving the orb (✅ code path; 🟡 with real
Fish audio), interrupt/mute/replay.
**Next:** live test with `FISH_API_KEY` + chosen `reference_id`, English & Hebrew samples.

## Phase 4 — iPhone PWA + secure remote 🟡
Auth (✅), single-origin static serving (✅), manifest/icons/SW (✅), Tailscale Serve guide (🟡 not set up),
manual iPhone checklist in SECURITY.md (⬜ needs the device).

## Phase 5 — Optional extras ⬜
In rough priority order, each disabled until configured and verified:
1. Fish Audio true streaming (`/v1/tts/stream/with-timestamp` or live WebSocket) with ordered chunk playback
2. Scheduled reminders + browser notifications (only while the PC is on)
3. Desktop wake word "Hey Jarvis" (opt-in, visible always-on indicator, kill switch; local model e.g. openWakeWord)
4. Windows app launcher with explicit allowlist + approval
5. Google Calendar (OAuth, read + approved event creation)
6. Home Assistant lights (user token, whitelisted `entity_id`s, approval for writes)
7. Optional Groq provider — adapter exists (🟡 not live-tested); needs `ENABLE_GROQ`, key, model
8. Local file search in a user-selected folder (read-only)
9. Screen/vision with an actual vision model; social metrics via official APIs only
10. Tauri desktop shell
