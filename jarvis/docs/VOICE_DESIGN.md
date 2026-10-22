# Voice design (Fish Audio)

## Target voice
Adult masculine, **British (Southern English / RP-adjacent)**, mid-low register, calm, precise, dry wit,
restrained pacing — the *personality* of a fictional AI butler. **Not** a clone of any actor's voice.
Use a licensed Fish Audio library voice, or your own voice / a voice you have written permission to use.

## API conformance (verified against the official OpenAPI spec, `fishaudio/docs` repo, `api-reference/openapi.json`)
- `POST https://api.fish.audio/v1/tts`, header `Authorization: Bearer <FISH_API_KEY>`
- header `model`: one of `s1`, `s2-pro`, `s2.1-pro` (default), `s2.1-pro-free`, `drama-3`
- JSON body: `text`, `reference_id`, `format` (`mp3`|`wav`|`pcm`|`opus`), `mp3_bitrate` (64|128|192),
  `latency` (`normal`|`balanced`|`low`), `normalize` (bool), `language` (BCP-47; affects text
  normalisation only — it does **not** change the voice or accent)
- Response: raw audio bytes (chunked transfer). Errors: 401 key, 402 credit, 404/422 bad reference/params, 429 quota.
- Voice library: `GET /model?title=…&language=…&page_size=…` and `GET /model/{id}`.
JARVIS currently uses the **REST endpoint and plays the reply after the full download**. True streaming
(`/v1/tts/stream/with-timestamp` SSE or the live WebSocket) is **not implemented** yet (ROADMAP Phase 5).

## Choosing the voice
1. Put `FISH_API_KEY` in `jarvis\.env`, restart.
2. Settings → Voice → *Find a voice*: try queries such as `british male`, `butler`, `british narrator`,
   `calm british`. Previously discussed names (e.g. "HISHAM", "CHOSEN") may or may not still exist —
   search for them, never assume an ID.
3. ▶ each candidate (plays the English sample through the orb). Prefer: low-mid pitch, clean consonants,
   no radio-announcer energy, no heavy breathing/music bed.
4. Click **Use** (or paste the `reference_id` from the voice page URL on fish.audio). Saved in SQLite
   settings; `FISH_REFERENCE_ID` in `.env` is the fallback.

## Test samples
- English: *Good evening, sir. JARVIS is online. All systems are operational and awaiting your instructions.*
- Hebrew: *ערב טוב. כל המערכות פעילות. איך אוכל לעזור לך?*

Run both with **▶ Test English** / **▶ בדיקת עברית**. An English-accented voice often pronounces Hebrew
poorly. If so, pick a Hebrew-capable voice, paste it as *Hebrew voice reference_id*, and tick
*Use the separate Hebrew voice* (explicit opt-in; off by default).

## Spoken-text shaping
`providers/tts.py::to_spoken` removes Markdown, replaces code blocks with "(I've put the code on screen.)",
replaces URLs with "the link on screen", and trims to sentence boundaries (`TTS_MAX_CHARS`).

## Failure behaviour
Missing key → "Voice not configured" (text reply still shown). Invalid key / no credit / bad reference /
quota / offline / timeout → specific message in the subtitle; nothing is claimed as spoken.
