"""Local speech-to-text with faster-whisper (CTranslate2). Audio is decoded in memory with PyAV
(bundled with faster-whisper), so browser formats (WebM/Opus from Chrome, MP4/AAC from iOS Safari)
work without a separate FFmpeg binary. Raw audio is never written to disk or retained."""

from __future__ import annotations

import asyncio
import importlib.util
import io
import logging
import threading
import time
from dataclasses import dataclass
from typing import Any

from ..config import Settings
from .llm import ProviderHealth

log = logging.getLogger("jarvis.stt")

ALLOWED_AUDIO_MIME = {
    "audio/webm", "audio/ogg", "audio/mp4", "audio/mpeg", "audio/wav", "audio/x-wav", "audio/wave",
    "audio/aac", "audio/x-m4a", "audio/m4a", "video/webm", "video/mp4",
}
SAMPLE_RATE = 16000


class STTError(Exception):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code  # not_configured | invalid_audio | too_long | no_speech | failed


@dataclass
class Transcript:
    text: str
    language: str | None
    language_probability: float | None
    duration_s: float
    processing_ms: int
    avg_logprob: float | None
    no_speech_prob: float | None

    def public(self) -> dict[str, Any]:
        return self.__dict__.copy()


def base_mime(mime: str) -> str:
    return (mime or "").split(";")[0].strip().lower()


class WhisperSTT:
    name = "faster-whisper"

    def __init__(self, settings: Settings):
        self.s = settings
        self._model: Any = None
        self._lock = threading.Lock()
        self._load_error: str | None = None

    @staticmethod
    def installed() -> bool:
        return importlib.util.find_spec("faster_whisper") is not None

    async def health(self) -> ProviderHealth:
        if self.s.stt_provider == "none":
            return ProviderHealth("not_configured", "STT disabled (STT_PROVIDER=none)")
        if not self.installed():
            return ProviderHealth("not_configured", "faster-whisper not installed: pip install -e .[stt]")
        if self._load_error:
            return ProviderHealth("unavailable", f"Model load failed: {self._load_error}")
        loaded = self._model is not None
        return ProviderHealth("ready", f"model {self.s.stt_model} on {self.s.stt_device}/{self.s.stt_compute_type}"
                              + ("" if loaded else " (loads on first use; first run downloads the model)"),
                              {"loaded": loaded})

    def _ensure_model(self) -> Any:
        with self._lock:
            if self._model is None:
                if not self.installed():
                    raise STTError("not_configured", "faster-whisper is not installed")
                from faster_whisper import WhisperModel  # heavy import, lazy

                t0 = time.perf_counter()
                try:
                    self._model = WhisperModel(self.s.stt_model, device=self.s.stt_device,
                                               compute_type=self.s.stt_compute_type)
                except Exception as exc:  # noqa: BLE001
                    self._load_error = f"{type(exc).__name__}: {str(exc)[:200]}"
                    raise STTError("not_configured", f"Could not load Whisper model '{self.s.stt_model}': "
                                                     f"{self._load_error}") from exc
                self._load_error = None
                log.info("Whisper model %s loaded in %.1fs", self.s.stt_model, time.perf_counter() - t0)
            return self._model

    def decode(self, data: bytes) -> Any:
        from faster_whisper import decode_audio

        try:
            audio = decode_audio(io.BytesIO(data), sampling_rate=SAMPLE_RATE)
        except Exception as exc:  # noqa: BLE001 — PyAV raises many types for bad input
            raise STTError("invalid_audio", "Could not decode the recording (unsupported or corrupt audio)") from exc
        return audio

    def _transcribe_sync(self, data: bytes, language: str | None) -> Transcript:
        audio = self.decode(data)
        duration = len(audio) / SAMPLE_RATE
        if duration < 0.3:
            raise STTError("no_speech", "Recording too short")
        if duration > self.s.stt_max_seconds:
            raise STTError("too_long", f"Recording longer than {int(self.s.stt_max_seconds)} s")
        model = self._ensure_model()
        t0 = time.perf_counter()
        segments, info = model.transcribe(audio, language=language or None, beam_size=5, vad_filter=True,
                                          condition_on_previous_text=False)
        segs = list(segments)
        text = " ".join(s.text.strip() for s in segs).strip()
        ms = int((time.perf_counter() - t0) * 1000)
        if not text:
            raise STTError("no_speech", "No speech detected")
        return Transcript(
            text=text, language=getattr(info, "language", None),
            language_probability=round(float(getattr(info, "language_probability", 0) or 0), 3),
            duration_s=round(duration, 2), processing_ms=ms,
            avg_logprob=round(sum(s.avg_logprob for s in segs) / len(segs), 3) if segs else None,
            no_speech_prob=round(max(s.no_speech_prob for s in segs), 3) if segs else None,
        )

    async def transcribe(self, data: bytes, mime: str, language: str | None = None) -> Transcript:
        if self.s.stt_provider == "none":
            raise STTError("not_configured", "Speech-to-text is disabled")
        if not self.installed():
            raise STTError("not_configured", "faster-whisper is not installed on the server")
        if base_mime(mime) not in ALLOWED_AUDIO_MIME:
            raise STTError("invalid_audio", f"Unsupported audio type '{base_mime(mime)}'")
        if not data:
            raise STTError("invalid_audio", "Empty recording")
        if len(data) > self.s.stt_max_upload_bytes:
            raise STTError("too_long", "Recording too large")
        lang = language or self.s.stt_language or None
        return await asyncio.to_thread(self._transcribe_sync, data, lang)

    async def warmup(self) -> None:
        await asyncio.to_thread(self._ensure_model)
