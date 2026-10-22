"""Runtime configuration, loaded from environment / `.env`.

Secrets (Fish, Groq) are server-side only and never serialised to clients.
"""

from __future__ import annotations

import secrets
from functools import lru_cache
from pathlib import Path
from typing import Literal
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from pydantic import Field, SecretStr, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parent.parent
PROJECT_DIR = BACKEND_DIR.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(str(PROJECT_DIR / ".env"), ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    app_env: Literal["development", "production", "test"] = "development"
    app_host: str = "127.0.0.1"
    app_port: int = 8787
    app_timezone: str = "Asia/Jerusalem"
    app_auth_secret: SecretStr | None = None
    app_data_dir: Path = PROJECT_DIR / "data"
    app_frontend_dist: Path = PROJECT_DIR / "frontend" / "dist"
    # Extra Host names allowed (e.g. your-pc.your-tailnet.ts.net). Comma separated.
    app_allowed_hosts: str = ""
    # Force Secure cookies. Auto-enabled when the request arrives over HTTPS (Tailscale Serve).
    app_cookie_secure: bool = False
    app_session_ttl_hours: int = 24 * 7
    app_trust_proxy_headers: bool = True

    ollama_base_url: str = "http://127.0.0.1:11434"
    ollama_model: str = "qwen3:8b"
    ollama_context_length: int = 4096
    ollama_temperature: float = 0.6
    ollama_think: bool = False
    ollama_connect_timeout: float = 5.0
    ollama_request_timeout: float = 180.0
    ollama_keep_alive: str = "10m"

    llm_max_tool_calls_per_turn: int = 6
    llm_history_messages: int = 16
    llm_turn_budget_seconds: float = 240.0

    enable_groq: bool = False
    groq_api_key: SecretStr | None = None
    groq_model: str = ""
    groq_base_url: str = "https://api.groq.com/openai/v1"

    stt_provider: Literal["faster-whisper", "none"] = "faster-whisper"
    stt_model: str = "small"
    stt_device: str = "cpu"
    stt_compute_type: str = "int8"
    stt_language: str = ""  # empty = auto-detect
    stt_max_upload_bytes: int = 8 * 1024 * 1024
    stt_max_seconds: float = 60.0

    tts_provider: Literal["fish", "none"] = "fish"
    fish_api_key: SecretStr | None = None
    fish_base_url: str = "https://api.fish.audio"
    fish_model: str = "s2.1-pro"
    fish_reference_id: str = ""
    fish_hebrew_reference_id: str = ""
    fish_output_format: Literal["mp3", "wav", "opus"] = "mp3"
    fish_latency: Literal["normal", "balanced", "low"] = "balanced"
    fish_timeout: float = 60.0
    tts_max_chars: int = 1200

    vram_profile: Literal["8gb", "16gb", "cpu"] = "8gb"

    enable_wake_word: bool = Field(default=False)
    enable_home_assistant: bool = Field(default=False)

    @field_validator("app_timezone")
    @classmethod
    def _valid_tz(cls, v: str) -> str:
        try:
            ZoneInfo(v)
        except (ZoneInfoNotFoundError, ValueError) as exc:
            raise ValueError(f"Unknown timezone {v!r}") from exc
        return v

    @field_validator("ollama_base_url", "fish_base_url", "groq_base_url")
    @classmethod
    def _strip_slash(cls, v: str) -> str:
        return v.rstrip("/")

    @property
    def db_path(self) -> Path:
        return self.app_data_dir / "jarvis.sqlite3"

    @property
    def extra_hosts(self) -> list[str]:
        return [h.strip().lower() for h in self.app_allowed_hosts.split(",") if h.strip()]

    @property
    def fish_configured(self) -> bool:
        return bool(self.fish_api_key and self.fish_api_key.get_secret_value().strip())

    @property
    def groq_configured(self) -> bool:
        return bool(
            self.enable_groq and self.groq_api_key and self.groq_api_key.get_secret_value() and self.groq_model
        )

    def auth_secret(self) -> bytes:
        """Server HMAC secret. Uses APP_AUTH_SECRET or a generated key persisted in the data dir."""
        if self.app_auth_secret and self.app_auth_secret.get_secret_value():
            return self.app_auth_secret.get_secret_value().encode()
        self.app_data_dir.mkdir(parents=True, exist_ok=True)
        key_file = self.app_data_dir / "secret.key"
        if not key_file.exists():
            key_file.write_text(secrets.token_urlsafe(48), encoding="utf-8")
            try:
                key_file.chmod(0o600)
            except OSError:
                pass
        return key_file.read_text(encoding="utf-8").strip().encode()


@lru_cache
def get_settings() -> Settings:
    return Settings()
