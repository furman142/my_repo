# JARVIS — product specification

Single-user personal assistant for the owner's Windows 11 PC (RTX 5060 Ti 8 GB or 16 GB, 32 GB RAM),
also usable from the owner's iPhone over a private tailnet while the PC is on.

## Acceptance scenario
1. PC on → `start-windows.ps1` → browser shows the animated cyan orb and **real** component status.
2. Hold mic, say "Jarvis, what do I have to do today?" (or Hebrew). Audio is transcribed locally
   (faster-whisper), the local LLM (Ollama `qwen3:8b`) calls `list_tasks`, which reads SQLite.
3. The reply streams as text, is spoken by Fish Audio in the selected voice, and the orb reacts to the
   measured playback amplitude.
4. "Remember that my sister is Noa" → approval sheet → approve → fact survives restarts.
5. Same UI and push-to-talk from an authorised iPhone via Tailscale Serve HTTPS.

## Functional requirements
| Area | Requirement |
|---|---|
| Chat | Streaming text chat; durable conversations; Hebrew/English reply in user's language |
| Voice in | Push-to-talk (hold or tap-toggle, Space key), 30 s cap, cancel, optional transcript review |
| Voice out | Fish Audio REST TTS, mute, stop, replay; separate Hebrew voice only by explicit opt-in |
| Tools | get_local_time, get_system_status, list/create/complete_task, list/search/propose/save/edit/delete_memory, open_url |
| Approvals | All side-effect tools need a server-verified, single-use, session-bound, expiring approval |
| Memory | Opt-in only; list/search/edit/delete/erase in UI; retrieval = FTS over approved memories |
| Tasks | Explicit dates/times only, configured timezone, ambiguous → ask |
| HUD | States BOOTING, IDLE, LISTENING, TRANSCRIBING, THINKING, APPROVAL_REQUIRED, EXECUTING, SPEAKING, OFFLINE, ERROR |
| Diagnostics | Live self-check (ready / not_configured / unavailable), telemetry, tool audit |
| Auth | Owner setup gated by console setup code; Argon2id; HttpOnly SameSite=Strict cookie; CSRF; rate limits |
| PWA | Manifest, icons, SW caching static assets only; iPhone install |
| i18n | English LTR / Hebrew RTL UI, `dir="auto"` for user content |

## Out of scope for MVP (see ROADMAP Phase 5)
Wake word, Windows app control, Google Calendar, Home Assistant, reminders/notifications, social
metrics, screen vision, true streaming TTS, Tauri shell. These are **not implemented** and the UI says so.

## Non-functional
- Local-first; only Fish Audio (always) and Groq (opt-in) are cloud. No telemetry to third parties.
- Bind 127.0.0.1; single origin; no secrets in client.
- Runs CPU-only for everything except the LLM; Whisper defaults to CPU int8.
