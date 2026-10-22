# HTTP API (`/api`, same origin)

Auth: cookie `jarvis_session` (HttpOnly). Unsafe methods need header `X-CSRF-Token` (from
`/api/auth/state` or login/setup response). In development the OpenAPI UI is at `/api/docs`.

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/health` | public | `{status, version, setup_required, components:{llm,stt,tts,database:{state}}}` |
| GET | `/auth/state` | public | `{setup_required, authenticated, username?, csrf_token?}` |
| POST | `/auth/setup` | setup code | `{username, password, setup_code}` → session |
| POST | `/auth/login` | public | `{username, password}` → session (rate-limited) |
| POST | `/auth/logout` · `/auth/password` | ✔ | revoke session · change password (revokes all) |
| GET | `/diagnostics` · `/system/status` | ✔ | component details + config (non-secret) + telemetry + audit · telemetry |
| GET/PUT | `/settings` | ✔ | non-secret preferences (language, timezone, voice ids, provider, …) |
| GET/POST/DELETE | `/conversations` | ✔ | list · create · erase all |
| GET | `/conversations/{id}/messages` | ✔ | user/assistant messages |
| POST | `/chat` | ✔ | `{text, conversation_id?}` → **SSE** events |
| POST | `/chat/cancel` | ✔ | `{conversation_id}` |
| GET | `/approvals/pending` | ✔ | pending approvals of this session |
| POST | `/approvals/{id}` | ✔ | `{nonce, approve}` → **SSE** continuation |
| GET/POST | `/tasks` | ✔ | list (`?status=open|done|all`) · create `{title, due?, priority?}` |
| POST/DELETE | `/tasks/{id}/complete` · `/reopen` · `/tasks/{id}` | ✔ | |
| GET/POST/DELETE | `/memories` | ✔ | list/search (`?q=`) · create (approved) · erase all |
| PATCH/DELETE | `/memories/{id}` | ✔ | edit / confirm / reject proposal · delete |
| POST | `/audio/transcribe` | ✔ | multipart `audio`, `language=auto|en|he` → transcript |
| POST | `/audio/stt/warmup` | ✔ | load the Whisper model now |
| POST | `/audio/speak` | ✔ | `{text, language?, reference_id?, raw?}` → `audio/mpeg` |
| GET | `/voice/search?q=&language=` · `/voice/{id}` | ✔ | Fish Audio library proxy |

## SSE events (`data: {json}\n\n`)
`request_received{conversation_id}` · `thinking{provider,model,cloud}` · `token{text}` ·
`executing{tool,title}` · `tool_result{tool,ok,result}` · `approval_required{request{id,nonce,preview,
arguments,expires_at},title,side_effect}` · `message{text,spoken,timing}` · `completed` · `cancelled` ·
`failed{code,message}` (codes: `llm_unavailable`, `llm_model_missing`, `llm_timeout`, `tool_budget`,
`time_budget`, `busy`, `approval_expired|bad_nonce|wrong_session|tampered|already_decided|not_found`, …).
