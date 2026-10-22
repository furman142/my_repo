"""Dependency container wiring settings, storage, providers and services together."""

from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
from typing import Any

from .agent.orchestrator import Orchestrator
from .config import Settings
from .db import Database
from .memory.repository import Repository
from .providers.llm import GroqProvider, LLMProvider, OllamaProvider
from .providers.stt import WhisperSTT
from .providers.tts import FishTTS
from .security.auth import AuthService, RateLimiter
from .tools.approvals import ApprovalService
from .tools.builtin import build_registry

# Non-secret, user-editable preferences (stored in SQLite). Secrets stay in .env only.
DEFAULT_PREFS: dict[str, Any] = {
    "ui_language": "auto",        # auto | en | he
    "timezone": None,             # None -> APP_TIMEZONE
    "voice_reference_en": "",     # Fish reference_id; empty -> FISH_REFERENCE_ID
    "voice_reference_he": "",     # optional separate Hebrew voice; empty -> FISH_HEBREW_REFERENCE_ID
    "use_hebrew_voice": False,    # explicit opt-in to use the separate Hebrew voice
    "speak_replies": True,
    "llm_provider": "ollama",     # ollama | groq (only honoured when Groq is enabled+configured)
    "stt_language": "auto",       # auto | en | he
    "boot_animation": True,
}


@dataclass
class Services:
    settings: Settings
    db: Database
    repo: Repository
    auth: AuthService
    approvals: ApprovalService
    stt: WhisperSTT
    tts: FishTTS
    orchestrator: Orchestrator
    ollama: OllamaProvider
    groq: GroqProvider
    login_limiter: RateLimiter
    chat_limiter: RateLimiter
    audio_limiter: RateLimiter
    cancels: dict[str, asyncio.Event] = field(default_factory=dict)

    def prefs(self) -> dict[str, Any]:
        stored = self.repo.get_settings()
        return {k: stored.get(k, v) for k, v in DEFAULT_PREFS.items()}

    def timezone(self) -> str:
        return self.prefs().get("timezone") or self.settings.app_timezone

    def llm(self) -> LLMProvider:
        if self.prefs().get("llm_provider") == "groq" and self.settings.groq_configured:
            return self.groq
        return self.ollama

    def voice_for(self, language: str) -> str:
        p = self.prefs()
        en = p.get("voice_reference_en") or self.settings.fish_reference_id
        if language == "he" and p.get("use_hebrew_voice"):
            return p.get("voice_reference_he") or self.settings.fish_hebrew_reference_id or en
        return en


def build_services(settings: Settings, *, llm_transport: Any = None, tts_transport: Any = None) -> Services:
    db = Database(settings.db_path)
    db.migrate()
    repo = Repository(db)
    secret = settings.auth_secret()
    approvals = ApprovalService(db, secret)
    registry = build_registry()
    ollama = OllamaProvider(settings, transport=llm_transport)
    groq = GroqProvider(settings, transport=llm_transport)
    svc_holder: dict[str, Services] = {}

    def llm_factory() -> LLMProvider:
        return svc_holder["s"].llm()

    def tz() -> str:
        return svc_holder["s"].timezone()

    orch = Orchestrator(repo, registry, approvals, llm_factory, tz,
                        max_tool_calls=settings.llm_max_tool_calls_per_turn,
                        history_messages=settings.llm_history_messages,
                        turn_budget_s=settings.llm_turn_budget_seconds)
    svc = Services(
        settings=settings, db=db, repo=repo,
        auth=AuthService(db, settings.app_data_dir, settings.app_session_ttl_hours),
        approvals=approvals, stt=WhisperSTT(settings), tts=FishTTS(settings, transport=tts_transport),
        orchestrator=orch, ollama=ollama, groq=groq,
        login_limiter=RateLimiter(8, 300), chat_limiter=RateLimiter(40, 60), audio_limiter=RateLimiter(30, 60),
    )
    svc_holder["s"] = svc
    return svc
