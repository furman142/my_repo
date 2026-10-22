"""LLM providers: local Ollama (default) and opt-in Groq (cloud, OpenAI-compatible API)."""

from __future__ import annotations

import json
import logging
from collections.abc import AsyncIterator
from dataclasses import dataclass, field
from typing import Any, Protocol

import httpx

from ..config import Settings

log = logging.getLogger("jarvis.llm")


@dataclass
class ToolCall:
    name: str
    arguments: Any  # dict from Ollama; JSON string from OpenAI-compatible APIs

    def as_message(self) -> dict[str, Any]:
        args = self.arguments
        if isinstance(args, str):
            try:
                args = json.loads(args or "{}")
            except json.JSONDecodeError:
                args = {"_raw": args}
        return {"function": {"name": self.name, "arguments": args}}


@dataclass
class LLMChunk:
    content: str = ""
    tool_calls: list[ToolCall] = field(default_factory=list)
    done: bool = False
    stats: dict[str, Any] = field(default_factory=dict)


class LLMError(Exception):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code  # unavailable | model_missing | timeout | bad_response | not_configured


@dataclass
class ProviderHealth:
    state: str  # ready | not_configured | unavailable
    detail: str = ""
    extra: dict[str, Any] = field(default_factory=dict)


class LLMProvider(Protocol):
    name: str
    model: str
    cloud: bool

    def chat(self, messages: list[dict[str, Any]], tools: list[dict[str, Any]]) -> AsyncIterator[LLMChunk]: ...

    async def health(self) -> ProviderHealth: ...


class OllamaProvider:
    name = "ollama"
    cloud = False

    def __init__(self, settings: Settings, transport: httpx.AsyncBaseTransport | None = None):
        self.s = settings
        self.model = settings.ollama_model
        self._transport = transport

    def _client(self, read_timeout: float) -> httpx.AsyncClient:
        return httpx.AsyncClient(
            base_url=self.s.ollama_base_url, transport=self._transport,
            timeout=httpx.Timeout(read_timeout, connect=self.s.ollama_connect_timeout),
        )

    async def health(self) -> ProviderHealth:
        try:
            async with self._client(5) as c:
                version = (await c.get("/api/version")).json().get("version", "?")
                tags = (await c.get("/api/tags")).json().get("models", [])
        except (httpx.HTTPError, ValueError) as exc:
            return ProviderHealth("unavailable", f"Ollama not reachable at {self.s.ollama_base_url} "
                                                 f"({type(exc).__name__}). Start Ollama.")
        names = {m.get("name") for m in tags} | {m.get("model") for m in tags}
        if self.model not in names and f"{self.model}:latest" not in names:
            return ProviderHealth("not_configured", f"Model '{self.model}' not pulled. Run: ollama pull {self.model}",
                                  {"version": version})
        return ProviderHealth("ready", f"Ollama {version}, model {self.model}", {"version": version})

    async def chat(self, messages: list[dict[str, Any]], tools: list[dict[str, Any]]) -> AsyncIterator[LLMChunk]:
        body: dict[str, Any] = {
            "model": self.model, "messages": messages, "stream": True, "keep_alive": self.s.ollama_keep_alive,
            "options": {"num_ctx": self.s.ollama_context_length, "temperature": self.s.ollama_temperature},
        }
        if tools:
            body["tools"] = tools
        # Qwen3 is a thinking model; `think` controls whether reasoning is produced (documented chat param).
        body["think"] = self.s.ollama_think
        try:
            async with self._client(self.s.ollama_request_timeout) as c, c.stream("POST", "/api/chat", json=body) as r:
                if r.status_code != 200:
                    text = (await r.aread()).decode(errors="replace")[:300]
                    if r.status_code == 404 or "not found" in text.lower():
                        raise LLMError("model_missing", f"Model '{self.model}' is not available in Ollama. "
                                                        f"Run: ollama pull {self.model}")
                    raise LLMError("bad_response", f"Ollama returned HTTP {r.status_code}: {text}")
                async for line in r.aiter_lines():
                    if not line.strip():
                        continue
                    try:
                        data = json.loads(line)
                    except json.JSONDecodeError:
                        raise LLMError("bad_response", "Ollama sent malformed stream data") from None
                    if "error" in data:
                        raise LLMError("bad_response", f"Ollama error: {str(data['error'])[:300]}")
                    msg = data.get("message") or {}
                    calls = [ToolCall(tc["function"]["name"], tc["function"].get("arguments") or {})
                             for tc in msg.get("tool_calls") or [] if tc.get("function", {}).get("name")]
                    chunk = LLMChunk(content=msg.get("content") or "", tool_calls=calls, done=bool(data.get("done")))
                    if chunk.done:
                        chunk.stats = {k: data.get(k) for k in ("total_duration", "load_duration",
                                       "prompt_eval_count", "eval_count", "eval_duration") if k in data}
                    yield chunk
        except httpx.ConnectError:
            raise LLMError("unavailable", f"Cannot connect to Ollama at {self.s.ollama_base_url}. "
                                          "Is Ollama running? (ollama serve)") from None
        except httpx.TimeoutException:
            raise LLMError("timeout", "Ollama did not respond in time (model loading or overloaded).") from None
        except httpx.HTTPError as exc:
            raise LLMError("unavailable", f"Ollama connection error: {type(exc).__name__}") from None


class GroqProvider:
    """Optional cloud provider. Disabled unless ENABLE_GROQ=true with key + model."""

    name = "groq"
    cloud = True

    def __init__(self, settings: Settings, transport: httpx.AsyncBaseTransport | None = None):
        self.s = settings
        self.model = settings.groq_model
        self._transport = transport

    def _headers(self) -> dict[str, str]:
        assert self.s.groq_api_key is not None
        return {"Authorization": f"Bearer {self.s.groq_api_key.get_secret_value()}"}

    async def health(self) -> ProviderHealth:
        if not self.s.groq_configured:
            return ProviderHealth("not_configured", "Groq disabled (ENABLE_GROQ, GROQ_API_KEY, GROQ_MODEL)")
        try:
            async with httpx.AsyncClient(transport=self._transport, timeout=8) as c:
                r = await c.get(f"{self.s.groq_base_url}/models", headers=self._headers())
        except httpx.HTTPError as exc:
            return ProviderHealth("unavailable", f"Groq unreachable ({type(exc).__name__})")
        if r.status_code == 401:
            return ProviderHealth("not_configured", "Groq API key rejected (401)")
        if r.status_code != 200:
            return ProviderHealth("unavailable", f"Groq HTTP {r.status_code}")
        return ProviderHealth("ready", f"Groq model {self.model} (cloud)")

    @staticmethod
    def to_openai(messages: list[dict[str, Any]]) -> list[dict[str, Any]]:
        out: list[dict[str, Any]] = []
        pending_ids: list[str] = []
        n = 0
        for m in messages:
            if m["role"] == "assistant" and m.get("tool_calls"):
                calls = []
                pending_ids = []
                for tc in m["tool_calls"]:
                    n += 1
                    cid = f"call_{n}"
                    pending_ids.append(cid)
                    calls.append({"id": cid, "type": "function", "function": {
                        "name": tc["function"]["name"],
                        "arguments": json.dumps(tc["function"].get("arguments") or {}, ensure_ascii=False)}})
                out.append({"role": "assistant", "content": m.get("content") or None, "tool_calls": calls})
            elif m["role"] == "tool":
                cid = pending_ids.pop(0) if pending_ids else f"call_orphan_{n}"
                out.append({"role": "tool", "tool_call_id": cid, "content": m.get("content", "")})
            else:
                out.append({"role": m["role"], "content": m.get("content", "")})
        return out

    async def chat(self, messages: list[dict[str, Any]], tools: list[dict[str, Any]]) -> AsyncIterator[LLMChunk]:
        if not self.s.groq_configured:
            raise LLMError("not_configured", "Groq is not enabled/configured")
        body: dict[str, Any] = {"model": self.model, "messages": self.to_openai(messages), "stream": True}
        if tools:
            body["tools"] = tools
        acc: dict[int, dict[str, str]] = {}
        try:
            async with httpx.AsyncClient(transport=self._transport, timeout=httpx.Timeout(60, connect=8)) as c, \
                    c.stream("POST", f"{self.s.groq_base_url}/chat/completions", json=body,
                             headers=self._headers()) as r:
                if r.status_code != 200:
                    text = (await r.aread()).decode(errors="replace")[:300]
                    raise LLMError("bad_response", f"Groq HTTP {r.status_code}: {text}")
                async for line in r.aiter_lines():
                    if not line.startswith("data:"):
                        continue
                    payload = line[5:].strip()
                    if payload == "[DONE]":
                        break
                    data = json.loads(payload)
                    choice = (data.get("choices") or [{}])[0]
                    delta = choice.get("delta") or {}
                    for tc in delta.get("tool_calls") or []:
                        slot = acc.setdefault(tc.get("index", 0), {"name": "", "arguments": ""})
                        fn = tc.get("function") or {}
                        slot["name"] += fn.get("name") or ""
                        slot["arguments"] += fn.get("arguments") or ""
                    if delta.get("content"):
                        yield LLMChunk(content=delta["content"])
        except httpx.ConnectError:
            raise LLMError("unavailable", "Cannot reach Groq (internet?)") from None
        except httpx.TimeoutException:
            raise LLMError("timeout", "Groq timed out") from None
        yield LLMChunk(tool_calls=[ToolCall(v["name"], v["arguments"]) for _, v in sorted(acc.items())], done=True)
