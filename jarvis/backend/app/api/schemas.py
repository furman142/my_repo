"""Request payload schemas (Pydantic v2). Responses are plain JSON dicts built by the services."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator


class _In(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class SetupIn(_In):
    username: str = Field(min_length=2, max_length=40, pattern=r"^[A-Za-z0-9_.\-]+$")
    password: str = Field(min_length=10, max_length=256)
    setup_code: str = Field(min_length=4, max_length=40)


class LoginIn(_In):
    username: str = Field(min_length=1, max_length=40)
    password: str = Field(min_length=1, max_length=256)


class PasswordIn(_In):
    old_password: str = Field(min_length=1, max_length=256)
    new_password: str = Field(min_length=10, max_length=256)


class ChatIn(_In):
    text: str = Field(min_length=1, max_length=4000)
    conversation_id: str | None = Field(default=None, pattern=r"^[a-f0-9]{32}$")


class CancelIn(_In):
    conversation_id: str = Field(pattern=r"^[a-f0-9]{32}$")


class DecisionIn(_In):
    nonce: str = Field(min_length=8, max_length=64)
    approve: bool


class TaskIn(_In):
    title: str = Field(min_length=1, max_length=200)
    due: str | None = Field(default=None, max_length=25)
    priority: Literal["low", "normal", "high"] | None = None


class MemoryIn(_In):
    content: str = Field(min_length=2, max_length=500)
    category: Literal["general", "preference", "person", "project", "routine"] = "general"


class MemoryPatch(_In):
    content: str | None = Field(default=None, min_length=2, max_length=500)
    category: Literal["general", "preference", "person", "project", "routine"] | None = None
    consent_state: Literal["approved", "rejected"] | None = None


class SpeakIn(_In):
    text: str = Field(min_length=1, max_length=2000)
    language: Literal["en", "he"] | None = None
    reference_id: str | None = Field(default=None, max_length=64)
    raw: bool = False  # True = speak exactly (voice test); False = shape Markdown into speech


class PrefsIn(_In):
    ui_language: Literal["auto", "en", "he"] | None = None
    timezone: str | None = Field(default=None, max_length=64)
    voice_reference_en: str | None = Field(default=None, max_length=64)
    voice_reference_he: str | None = Field(default=None, max_length=64)
    use_hebrew_voice: bool | None = None
    speak_replies: bool | None = None
    llm_provider: Literal["ollama", "groq"] | None = None
    stt_language: Literal["auto", "en", "he"] | None = None
    boot_animation: bool | None = None

    @field_validator("voice_reference_en", "voice_reference_he")
    @classmethod
    def _ref(cls, v: str | None) -> str | None:
        if v and not v.replace("-", "").replace("_", "").isalnum():
            raise ValueError("reference_id may contain only letters, digits, '-' and '_'")
        return v
