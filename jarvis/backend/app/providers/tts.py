"""Fish Audio text-to-speech (cloud). Conforms to the official OpenAPI spec (fishaudio/docs,
api-reference/openapi.json): `POST https://api.fish.audio/v1/tts`, `Authorization: Bearer`,
`model` header (s1 | s2-pro | s2.1-pro | s2.1-pro-free | drama-3), JSON body with `text`,
`reference_id`, `format` (wav|pcm|mp3|opus), `latency` (normal|balanced|low), `normalize`, `language`.
The response is raw audio bytes. Voice library: `GET /model` and `GET /model/{id}`.

Only the spoken reply text is sent to Fish Audio — never microphone audio or conversation history."""

from __future__ import annotations

import re
import time
from dataclasses import dataclass
from typing import Any

import httpx

from ..config import Settings
from .llm import ProviderHealth

CONTENT_TYPES = {"mp3": "audio/mpeg", "wav": "audio/wav", "opus": "audio/ogg"}
_REF_RE = re.compile(r"^[A-Za-z0-9_-]{8,64}$")


class TTSError(Exception):
    def __init__(self, code: str, message: str, status: int = 502):
        super().__init__(message)
        # not_configured | bad_reference | auth | payment | rate_limited | unavailable | timeout | empty
        self.code = code
        self.status = status


@dataclass
class SpeechAudio:
    data: bytes
    content_type: str
    reference_id: str
    model: str
    elapsed_ms: int


def valid_reference_id(ref: str) -> bool:
    return bool(_REF_RE.match(ref))


class FishTTS:
    name = "fish"
    cloud = True

    def __init__(self, settings: Settings, transport: httpx.AsyncBaseTransport | None = None):
        self.s = settings
        self._transport = transport
        self._health_cache: tuple[float, ProviderHealth] | None = None

    def _headers(self) -> dict[str, str]:
        if not self.s.fish_configured:
            raise TTSError("not_configured", "Voice not configured: set FISH_API_KEY in .env", 503)
        assert self.s.fish_api_key is not None
        return {"Authorization": f"Bearer {self.s.fish_api_key.get_secret_value()}"}

    def _client(self, timeout: float) -> httpx.AsyncClient:
        return httpx.AsyncClient(base_url=self.s.fish_base_url, transport=self._transport,
                                 timeout=httpx.Timeout(timeout, connect=8))

    @staticmethod
    def _raise_for(r: httpx.Response, what: str) -> None:
        if r.status_code == 200:
            return
        try:
            msg = str(r.json().get("message", ""))[:200]
        except (ValueError, AttributeError):
            msg = ""
        mapping = {
            401: ("auth", "Fish Audio rejected the API key (401)"),
            402: ("payment", "Fish Audio account has insufficient credit (402)"),
            404: ("bad_reference", f"Fish Audio: {what} not found (404) — check the voice reference_id"),
            422: ("bad_reference", "Fish Audio rejected the request parameters (422)"),
            429: ("rate_limited", "Fish Audio rate limit / quota reached (429)"),
        }
        code, text = mapping.get(r.status_code, ("unavailable", f"Fish Audio HTTP {r.status_code}"))
        raise TTSError(code, f"{text}{': ' + msg if msg and r.status_code != 401 else ''}",
                       503 if code in ("auth", "payment") else 502)

    async def health(self, force: bool = False) -> ProviderHealth:
        if self.s.tts_provider == "none":
            return ProviderHealth("not_configured", "TTS disabled (TTS_PROVIDER=none)")
        if not self.s.fish_configured:
            return ProviderHealth("not_configured", "Voice not configured: FISH_API_KEY missing")
        if self._health_cache and not force and time.monotonic() - self._health_cache[0] < 300:
            return self._health_cache[1]
        try:
            async with self._client(8) as c:
                r = await c.get("/model", params={"self": "true", "page_size": 1}, headers=self._headers())
            if r.status_code == 401:
                h = ProviderHealth("not_configured", "FISH_API_KEY rejected (401)")
            elif r.status_code != 200:
                h = ProviderHealth("unavailable", f"Fish Audio HTTP {r.status_code}")
            else:
                h = ProviderHealth("ready", f"Fish Audio key accepted; model header {self.s.fish_model}")
        except httpx.HTTPError as exc:
            h = ProviderHealth("unavailable", f"Fish Audio unreachable ({type(exc).__name__})")
        self._health_cache = (time.monotonic(), h)
        return h

    async def synthesize(self, text: str, reference_id: str, language: str | None = None) -> SpeechAudio:
        headers = self._headers()
        text = text.strip()
        if not text:
            raise TTSError("empty", "Nothing to say", 400)
        if not reference_id:
            raise TTSError("bad_reference", "No Fish Audio voice selected (FISH_REFERENCE_ID / Settings → Voice)",
                           503)
        if not valid_reference_id(reference_id):
            raise TTSError("bad_reference", "Voice reference_id has an invalid format", 400)
        fmt = self.s.fish_output_format
        body: dict[str, Any] = {
            "text": text[: self.s.tts_max_chars], "reference_id": reference_id, "format": fmt,
            "latency": self.s.fish_latency, "normalize": True,
        }
        if fmt == "mp3":
            body["mp3_bitrate"] = 128
        if language:
            body["language"] = language
        t0 = time.perf_counter()
        try:
            async with self._client(self.s.fish_timeout) as c:
                r = await c.post("/v1/tts", json=body, headers={**headers, "model": self.s.fish_model})
        except httpx.TimeoutException:
            raise TTSError("timeout", "Fish Audio timed out", 504) from None
        except httpx.HTTPError as exc:
            raise TTSError("unavailable", f"Fish Audio unreachable ({type(exc).__name__}) — internet?") from None
        self._raise_for(r, "voice")
        ctype = r.headers.get("content-type", "")
        if not r.content or ctype.startswith(("application/json", "text/")):
            raise TTSError("empty", "Fish Audio returned no audio")
        return SpeechAudio(r.content, CONTENT_TYPES.get(fmt, "application/octet-stream"), reference_id,
                           self.s.fish_model, int((time.perf_counter() - t0) * 1000))

    async def search_voices(self, query: str, language: str | None, page_size: int = 12) -> list[dict[str, Any]]:
        params: dict[str, Any] = {"page_size": page_size, "sort_by": "score"}
        if query:
            params["title"] = query
        if language:
            params["language"] = language
        try:
            async with self._client(12) as c:
                r = await c.get("/model", params=params, headers=self._headers())
        except httpx.HTTPError as exc:
            raise TTSError("unavailable", f"Fish Audio unreachable ({type(exc).__name__})") from None
        self._raise_for(r, "voices")
        return [_voice(v) for v in (r.json().get("items") or [])]

    async def get_voice(self, reference_id: str) -> dict[str, Any]:
        if not valid_reference_id(reference_id):
            raise TTSError("bad_reference", "Invalid reference_id format", 400)
        try:
            async with self._client(12) as c:
                r = await c.get(f"/model/{reference_id}", headers=self._headers())
        except httpx.HTTPError as exc:
            raise TTSError("unavailable", f"Fish Audio unreachable ({type(exc).__name__})") from None
        self._raise_for(r, "voice")
        return _voice(r.json())


def _voice(v: dict[str, Any]) -> dict[str, Any]:
    author = v.get("author") or {}
    return {
        "id": v.get("_id") or v.get("id"), "title": v.get("title"), "description": (v.get("description") or "")[:300],
        "languages": v.get("languages") or [], "tags": v.get("tags") or [],
        "author": author.get("nickname") if isinstance(author, dict) else None,
        "state": v.get("state"), "visibility": v.get("visibility"),
    }


# ------------------------------------------------------------------ spoken-text shaping
_CODE_BLOCK = re.compile(r"```.*?```", re.S)
_INLINE_CODE = re.compile(r"`([^`]*)`")
_LINK = re.compile(r"\[([^\]]+)\]\((?:[^)]+)\)")
_URL = re.compile(r"https?://\S+")
_MD = re.compile(r"(^|\s)[#>*\-]+\s|[*_~]{1,3}", re.M)
_HEBREW = re.compile(r"[֐-׿]")


def detect_language(text: str) -> str:
    return "he" if len(_HEBREW.findall(text)) > max(3, len(text) * 0.15) else "en"


def to_spoken(text: str, max_chars: int = 600) -> str:
    """Turn a Markdown answer into concise speakable text."""
    lang = detect_language(text)
    code_note = " (הקוד מוצג על המסך.) " if lang == "he" else " (I've put the code on screen.) "
    link_note = "הקישור על המסך" if lang == "he" else "the link on screen"
    out = _CODE_BLOCK.sub(code_note, text)
    out = _LINK.sub(r"\1", out)
    out = _URL.sub(link_note, out)
    out = _INLINE_CODE.sub(r"\1", out)
    out = _MD.sub(" ", out)
    out = re.sub(r"\s+", " ", out).strip()
    if len(out) > max_chars:
        cut = out[:max_chars]
        end = max(cut.rfind(". "), cut.rfind("? "), cut.rfind("! "), cut.rfind("׃ "))
        out = cut[: end + 1] if end > max_chars * 0.4 else cut.rsplit(" ", 1)[0] + "…"
    return out
