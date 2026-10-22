"""Fish Audio adapter (mock transport) and STT input handling. No paid API or model download needed."""

from __future__ import annotations

import io
import json
import math
import shutil
import struct
import subprocess
import wave

import pytest

from app.providers.stt import WhisperSTT
from app.providers.tts import detect_language, to_spoken

from .conftest import setup_owner

REF = "0123456789abcdef0123456789abcdef"


def test_speak_without_key_reports_voice_not_configured(authed):
    client, _, headers = authed
    r = client.post("/api/audio/speak", json={"text": "Hello"}, headers=headers)
    assert r.status_code == 503
    assert r.json()["detail"]["code"] == "not_configured"
    assert "Voice not configured" in r.json()["detail"]["message"]


def test_fish_request_matches_official_api(make_app, fish):
    client, svc = make_app(fish_api_key="fish-test-key", fish_reference_id=REF)
    headers = setup_owner(client, svc)
    text = "Good evening, sir. JARVIS is online. All systems are operational and awaiting your instructions."
    r = client.post("/api/audio/speak", json={"text": text, "raw": True}, headers=headers)
    assert r.status_code == 200 and r.headers["content-type"] == "audio/mpeg"
    assert r.content == fish.audio
    req = fish.requests[-1]
    assert req.method == "POST" and str(req.url) == "https://api.fish.audio/v1/tts"
    assert req.headers["authorization"] == "Bearer fish-test-key"
    assert req.headers["model"] == "s2.1-pro"
    body = json.loads(req.content)
    assert body == {"text": text, "reference_id": REF, "format": "mp3", "latency": "balanced", "normalize": True,
                    "mp3_bitrate": 128, "language": "en"}


def test_fish_hebrew_uses_separate_voice_only_when_opted_in(make_app, fish):
    client, svc = make_app(fish_api_key="k", fish_reference_id=REF, fish_hebrew_reference_id="f" * 32)
    headers = setup_owner(client, svc)
    he = "ערב טוב. כל המערכות פעילות. איך אוכל לעזור לך?"
    client.post("/api/audio/speak", json={"text": he, "raw": True}, headers=headers)
    body = json.loads(fish.requests[-1].content)
    assert body["reference_id"] == REF and body["language"] == "he"
    client.put("/api/settings", json={"use_hebrew_voice": True}, headers=headers)
    client.post("/api/audio/speak", json={"text": he, "raw": True}, headers=headers)
    assert json.loads(fish.requests[-1].content)["reference_id"] == "f" * 32


@pytest.mark.parametrize("status,code", [(401, "auth"), (402, "payment"), (404, "bad_reference"),
                                         (429, "rate_limited"), (500, "unavailable")])
def test_fish_errors_are_mapped(make_app, fish, status, code):
    client, svc = make_app(fish_api_key="k", fish_reference_id=REF)
    headers = setup_owner(client, svc)
    fish.status = status
    r = client.post("/api/audio/speak", json={"text": "hi"}, headers=headers)
    assert r.status_code in (502, 503)
    assert r.json()["detail"]["code"] == code
    assert "k" != r.json()["detail"]["message"]


def test_fish_empty_audio_detected(make_app, fish):
    client, svc = make_app(fish_api_key="k", fish_reference_id=REF)
    headers = setup_owner(client, svc)
    fish.audio = b""
    r = client.post("/api/audio/speak", json={"text": "hi"}, headers=headers)
    assert r.json()["detail"]["code"] == "empty"


def test_fish_missing_reference(make_app):
    client, svc = make_app(fish_api_key="k")
    headers = setup_owner(client, svc)
    r = client.post("/api/audio/speak", json={"text": "hi"}, headers=headers)
    assert r.status_code == 503 and r.json()["detail"]["code"] == "bad_reference"


def test_voice_search_proxies_library(make_app, fish):
    client, svc = make_app(fish_api_key="k")
    headers = setup_owner(client, svc)
    r = client.get("/api/voice/search", params={"q": "british", "language": "en"}, headers=headers)
    assert r.status_code == 200 and r.json()["voices"][0]["title"] == "Calm British Butler"
    assert fish.requests[-1].url.params["title"] == "british"


def test_spoken_text_shaping():
    md = "Here you go:\n```python\nprint('x')\n```\n**Bold** and [a link](https://x.com)."
    s = to_spoken(md)
    assert "print" not in s and "```" not in s and "**" not in s and "https" not in s
    assert "code on screen" in s
    assert detect_language("שלום, מה שלומך היום?") == "he"
    assert detect_language("Hello there") == "en"
    assert len(to_spoken("word. " * 400, max_chars=100)) <= 101


# ------------------------------------------------------------------ STT input validation
def _wav(seconds: float, freq: float = 440.0) -> bytes:
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(16000)
        n = int(seconds * 16000)
        w.writeframes(b"".join(struct.pack("<h", int(8000 * math.sin(2 * math.pi * freq * i / 16000)))
                               for i in range(n)))
    return buf.getvalue()


def test_transcribe_rejects_bad_mime(authed):
    client, _, headers = authed
    r = client.post("/api/audio/transcribe", files={"audio": ("x.txt", b"hello", "text/plain")}, headers=headers)
    assert r.status_code in (415, 503)


def test_transcribe_rejects_oversized(make_app):
    client, svc = make_app(stt_max_upload_bytes=1000)
    headers = setup_owner(client, svc)
    r = client.post("/api/audio/transcribe", files={"audio": ("a.wav", b"0" * 5000, "audio/wav")}, headers=headers)
    assert r.status_code == 413


needs_whisper = pytest.mark.skipif(not WhisperSTT.installed(), reason="faster-whisper not installed")


@needs_whisper
def test_transcribe_rejects_corrupt_audio(authed):
    client, _, headers = authed
    r = client.post("/api/audio/transcribe", files={"audio": ("a.webm", b"\x1a\x45garbage" * 50, "audio/webm")},
                    headers=headers)
    assert r.status_code == 415 and r.json()["detail"]["code"] == "invalid_audio"


@needs_whisper
def test_decode_wav_and_too_long(make_app):
    client, svc = make_app(stt_max_seconds=1.0)
    headers = setup_owner(client, svc)
    audio = svc.stt.decode(_wav(0.5))
    assert abs(len(audio) / 16000 - 0.5) < 0.05
    r = client.post("/api/audio/transcribe", files={"audio": ("a.wav", _wav(2.0), "audio/wav")}, headers=headers)
    assert r.status_code == 413 and r.json()["detail"]["code"] == "too_long"


@needs_whisper
@pytest.mark.skipif(shutil.which("ffmpeg") is None, reason="ffmpeg not available to create browser formats")
@pytest.mark.parametrize("fmt,args,mime", [
    ("webm", ["-c:a", "libopus"], "audio/webm;codecs=opus"),   # Chrome / Edge MediaRecorder
    ("mp4", ["-c:a", "aac"], "audio/mp4"),                     # iOS Safari MediaRecorder
])
def test_decode_browser_formats(make_app, tmp_path, fmt, args, mime):
    _, svc = make_app()
    src = tmp_path / "in.wav"
    src.write_bytes(_wav(1.0))
    out = tmp_path / f"out.{fmt}"
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(src), *args, str(out)], check=True)  # noqa: S603,S607
    audio = svc.stt.decode(out.read_bytes())
    assert 0.9 < len(audio) / 16000 < 1.2


@needs_whisper
def test_transcribe_pipeline_with_stub_model(make_app, monkeypatch):
    """Exercises decode -> model -> response plumbing. The model object is a test stub; real
    transcription quality is only verified by the live check in docs/PROGRESS.md."""
    client, svc = make_app()
    headers = setup_owner(client, svc)

    class Seg:
        text, avg_logprob, no_speech_prob = " Jarvis, what do I have to do today?", -0.2, 0.01

    class Info:
        language, language_probability = "en", 0.98

    class StubModel:
        def transcribe(self, audio, **kw):
            assert len(audio) > 0
            return iter([Seg()]), Info()

    monkeypatch.setattr(svc.stt, "_ensure_model", lambda: StubModel())
    r = client.post("/api/audio/transcribe", files={"audio": ("a.wav", _wav(1.0), "audio/wav")}, headers=headers)
    assert r.status_code == 200
    assert r.json()["text"] == "Jarvis, what do I have to do today?" and r.json()["language"] == "en"
