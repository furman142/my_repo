# Security & privacy

## Threat model
Single owner. Adversaries: other devices on the LAN/tailnet, malicious web pages in the owner's browser
(CSRF / DNS rebinding), prompt injection via tool output or stored memories, accidental key leaks.

## Controls (all enforced server-side, covered by `backend/tests/test_auth_security.py` & `test_chat_and_approvals.py`)
| Control | Implementation |
|---|---|
| Bind loopback | `APP_HOST=127.0.0.1`; warning printed if changed |
| Host allowlist (anti DNS-rebinding) | `127.0.0.1`, `localhost`, `::1` + `APP_ALLOWED_HOSTS`; others → 421 |
| First-run takeover protection | Owner creation requires a one-time setup code printed on the PC console |
| Passwords | Argon2id (`argon2-cffi`), ≥ 10 chars, timing-equalised unknown-user path, rehash on upgrade |
| Sessions | random 256-bit token in `HttpOnly; SameSite=Strict; Secure(on HTTPS)` cookie; DB stores only SHA-256; server-side expiry, logout revocation, password change revokes all |
| CSRF | per-session token required in `X-CSRF-Token` for every unsafe method; plus `Origin` and `Sec-Fetch-Site` checks |
| Rate limits | login/setup 8 per 5 min per IP; chat 40/min; audio 30/min per session |
| Tool approvals | session-bound, HMAC over canonical args + nonce, 180 s expiry, atomic single use, superseded by a new message; denial/expiry/replay/cross-session/tamper all tested |
| Tool surface | allowlisted typed tools only; no shell/eval/files/processes; `open_url` http(s) public hosts only, opened by the user's own click |
| Prompt injection | tool output & memories are labelled data; schemas + approvals are final authority |
| Input limits | Pydantic `extra=forbid`, length caps, 8 MB / 60 s audio, MIME allowlist |
| Headers | CSP `default-src 'self'` (no inline script), `X-Frame-Options: DENY`, `nosniff`, `no-referrer`, `Permissions-Policy` (mic self only, no camera), `Cache-Control: no-store` on `/api` |
| Secrets | `.env` only (git-ignored); never returned by any endpoint (tested); not in the JS bundle |
| Service worker | caches static assets only — never `/api`, conversations or credentials |
| Data | raw microphone audio never stored; memories hard-deleted (row + FTS); one-click erase of memories and history |

## Cloud data flows (disclosed in Settings)
- **Fish Audio** (mandatory for voice): receives the *spoken reply text* only.
- **Groq** (optional, off by default): receives the conversation when selected as provider.
- Hugging Face: one-time Whisper model download. Ollama model download from ollama.com.

## Remote access (iPhone)
Use **Tailscale Serve** (tailnet-only HTTPS). Do **not** use Tailscale Funnel, router port forwarding,
or `APP_HOST=0.0.0.0`.
1. Install Tailscale on the PC and iPhone, sign in to the same tailnet. Enable MagicDNS and HTTPS
   certificates in the Tailscale admin console if prompted.
2. In `jarvis\.env`: `APP_ALLOWED_HOSTS=<pc-name>.<tailnet>.ts.net` and `APP_COOKIE_SECURE=true`. Restart JARVIS.
3. On the PC: `tailscale serve --bg localhost:8787` then `tailscale serve status` shows the HTTPS URL.
   (Tailscale changed the serve CLI in v1.52; check `tailscale serve --help` on your version.)
   Turn off with `tailscale serve reset`.
4. On iPhone Safari open `https://<pc-name>.<tailnet>.ts.net`, sign in, allow the microphone, then
   Share → *Add to Home Screen*.
Notes: the PC must be on and online; iOS does not allow an always-listening background hotword for a
PWA — push-to-talk works only while the app is open in the foreground. Tailscale identity headers are
not used for auth; JARVIS still requires its own login. Official docs:
https://tailscale.com/docs/features/tailscale-serve

## Manual iPhone checklist (not yet executed — requires the real device)
- [ ] Page loads over HTTPS, padlock shown; login works; cookie persists after closing Safari
- [ ] Mic permission prompt appears on first PTT; recording uploads as `audio/mp4` and transcribes
- [ ] Reply audio plays after the tap (user-gesture unlock); orb reacts; Stop/Mute work
- [ ] Add to Home Screen → standalone launch, icon correct, safe-area insets respected
- [ ] PC asleep/offline → "Connection lost — reconnecting…" (no fake answers); recovers when back
