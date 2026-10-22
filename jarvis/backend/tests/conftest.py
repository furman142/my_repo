"""Test fixtures. LLM / TTS network calls are served by in-process httpx MockTransports (tests only)."""

from __future__ import annotations

import json
from collections.abc import Callable
from pathlib import Path
from typing import Any

import httpx
import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app
from app.services import Services, build_services

BASE = "http://127.0.0.1:8787"
PASSWORD = "correct horse battery"


class FakeOllama:
    """Scripted stand-in for Ollama's /api/chat NDJSON stream. Each script entry is one model turn."""

    def __init__(self) -> None:
        self.turns: list[dict[str, Any]] = []
        self.requests: list[dict[str, Any]] = []
        self.offline = False
        self.models = ["qwen3:8b"]

    def reply(self, text: str) -> FakeOllama:
        self.turns.append({"content": text})
        return self

    def call(self, name: str, **arguments: Any) -> FakeOllama:
        self.turns.append({"tool_calls": [{"function": {"name": name, "arguments": arguments}}]})
        return self

    def handler(self, request: httpx.Request) -> httpx.Response:
        if self.offline:
            raise httpx.ConnectError("connection refused", request=request)
        if request.url.path == "/api/version":
            return httpx.Response(200, json={"version": "0.test"})
        if request.url.path == "/api/tags":
            return httpx.Response(200, json={"models": [{"name": m, "model": m} for m in self.models]})
        if request.url.path == "/api/chat":
            body = json.loads(request.content)
            self.requests.append(body)
            if not self.turns:
                return httpx.Response(500, json={"error": "no scripted turn"})
            turn = self.turns.pop(0)
            lines = []
            if "content" in turn:
                words = turn["content"].split(" ")
                for i, w in enumerate(words):
                    lines.append({"message": {"role": "assistant", "content": w + (" " if i < len(words) - 1 else "")},
                                  "done": False})
            else:
                lines.append({"message": {"role": "assistant", "content": "", "tool_calls": turn["tool_calls"]},
                              "done": False})
            lines.append({"message": {"role": "assistant", "content": ""}, "done": True, "done_reason": "stop",
                          "eval_count": 7, "total_duration": 1000})
            return httpx.Response(200, content="\n".join(json.dumps(x) for x in lines).encode())
        return httpx.Response(404)


class FakeFish:
    def __init__(self) -> None:
        self.requests: list[httpx.Request] = []
        self.status = 200
        self.audio = b"ID3\x04fake-mp3-bytes"

    def handler(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        if self.status != 200:
            return httpx.Response(self.status, json={"status": self.status, "message": "nope"})
        if request.url.path == "/v1/tts":
            return httpx.Response(200, content=self.audio, headers={"content-type": "audio/mpeg"})
        if request.url.path == "/model":
            return httpx.Response(200, json={"total": 1, "items": [
                {"_id": "a" * 32, "title": "Calm British Butler", "languages": ["en"], "tags": ["male"],
                 "author": {"nickname": "someone"}}]})
        if request.url.path.startswith("/model/"):
            return httpx.Response(200, json={"_id": request.url.path.split("/")[-1], "title": "Voice"})
        return httpx.Response(404, json={"status": 404, "message": "not found"})


def make_settings(tmp: Path, **kw: Any) -> Settings:
    base: dict[str, Any] = dict(app_env="test", app_data_dir=tmp, app_frontend_dist=tmp / "dist",
                                app_auth_secret="test-secret-not-for-production", fish_api_key=None,
                                fish_reference_id="")
    base.update(kw)
    return Settings(_env_file=None, **base)  # type: ignore[call-arg]


@pytest.fixture
def ollama() -> FakeOllama:
    return FakeOllama()


@pytest.fixture
def fish() -> FakeFish:
    return FakeFish()


@pytest.fixture
def make_app(tmp_path: Path, ollama: FakeOllama, fish: FakeFish) -> Callable[..., tuple[TestClient, Services]]:
    def _make(**kw: Any) -> tuple[TestClient, Services]:
        settings = make_settings(tmp_path, **kw)
        svc = build_services(settings, llm_transport=httpx.MockTransport(ollama.handler),
                             tts_transport=httpx.MockTransport(fish.handler))
        app = create_app(settings, services=svc, test_hosts={"testserver"})
        return TestClient(app, base_url=BASE), svc

    return _make


def setup_owner(client: TestClient, svc: Services) -> dict[str, str]:
    code = svc.auth.ensure_setup_code()
    r = client.post("/api/auth/setup", json={"username": "tony", "password": PASSWORD, "setup_code": code})
    assert r.status_code == 200, r.text
    return {"x-csrf-token": r.json()["csrf_token"]}


@pytest.fixture
def authed(make_app: Callable[..., tuple[TestClient, Services]]) -> tuple[TestClient, Services, dict[str, str]]:
    client, svc = make_app()
    headers = setup_owner(client, svc)
    return client, svc, headers


def sse_events(response: httpx.Response) -> list[dict[str, Any]]:
    out = []
    for block in response.text.split("\n\n"):
        block = block.strip()
        if block.startswith("data:"):
            out.append(json.loads(block[5:]))
    return out
