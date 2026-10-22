"""HTTP API. Everything except health and auth bootstrap requires an authenticated owner session."""

from __future__ import annotations

import asyncio
import json
import logging
from collections.abc import AsyncIterator
from typing import Annotated, Any
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Request, Response, UploadFile
from fastapi.responses import StreamingResponse

from .. import __version__
from ..agent.orchestrator import Event
from ..providers.stt import STTError
from ..providers.tts import TTSError, detect_language, to_spoken
from ..security.auth import SESSION_COOKIE, SessionInfo
from ..security.web import client_key, is_https, require_session
from ..services import Services
from ..system.metrics import system_status
from ..tools.builtin import parse_due
from ..tools.registry import ToolError
from .schemas import (
    CancelIn,
    ChatIn,
    DecisionIn,
    LoginIn,
    MemoryIn,
    MemoryPatch,
    PasswordIn,
    PrefsIn,
    SetupIn,
    SpeakIn,
    TaskIn,
)

log = logging.getLogger("jarvis.api")
router = APIRouter(prefix="/api")
Session = Annotated[SessionInfo, Depends(require_session)]


def svc_of(request: Request) -> Services:
    return request.app.state.services


Svc = Annotated[Services, Depends(svc_of)]


# ====================================================================== health / diagnostics
async def _components(s: Services) -> dict[str, Any]:
    llm, stt, tts = await asyncio.gather(s.llm().health(), s.stt.health(), s.tts.health())
    try:
        s.repo.get_settings()
        db = {"state": "ready", "detail": "SQLite OK"}
    except Exception as exc:  # noqa: BLE001
        db = {"state": "unavailable", "detail": type(exc).__name__}
    return {
        "llm": {"state": llm.state, "detail": llm.detail, "provider": s.llm().name, "cloud": s.llm().cloud},
        "stt": {"state": stt.state, "detail": stt.detail},
        "tts": {"state": tts.state, "detail": tts.detail, "cloud": True},
        "database": db,
    }


@router.get("/health")
async def health(s: Svc) -> dict[str, Any]:
    comps = await _components(s)
    # Public endpoint: states only, no hostnames/paths/model details.
    return {
        "status": "ok", "version": __version__, "setup_required": not s.auth.owner_exists(),
        "components": {k: {"state": v["state"]} for k, v in comps.items()},
    }


@router.get("/diagnostics")
async def diagnostics(s: Svc, _: Session) -> dict[str, Any]:
    comps = await _components(s)
    st = s.settings
    return {
        "version": __version__, "components": comps,
        "config": {
            "ollama_model": st.ollama_model, "context_length": st.ollama_context_length,
            "vram_profile": st.vram_profile, "stt_model": st.stt_model, "stt_device": st.stt_device,
            "stt_compute_type": st.stt_compute_type, "fish_model": st.fish_model,
            "fish_format": st.fish_output_format, "fish_key_present": st.fish_configured,
            "voice_reference_set": bool(s.voice_for("en")), "groq_enabled": st.enable_groq,
            "groq_configured": st.groq_configured, "timezone": s.timezone(),
            "wake_word": "not implemented", "home_assistant": "not implemented",
        },
        "system": await asyncio.to_thread(system_status),
        "recent_tool_audit": s.repo.list_audit(15),
    }


@router.get("/system/status")
async def sys_status(_: Session) -> dict[str, Any]:
    return await asyncio.to_thread(system_status)


# ====================================================================== auth
def _set_cookie(response: Response, request: Request, s: Services, token: str) -> None:
    response.set_cookie(
        SESSION_COOKIE, token, max_age=s.settings.app_session_ttl_hours * 3600, httponly=True,
        samesite="strict", secure=is_https(request, s.settings), path="/",
    )


@router.get("/auth/state")
async def auth_state(request: Request, s: Svc) -> dict[str, Any]:
    if not s.auth.owner_exists():
        s.auth.ensure_setup_code()
        return {"setup_required": True, "authenticated": False}
    sess = s.auth.resolve(request.cookies.get(SESSION_COOKIE))
    if sess is None:
        return {"setup_required": False, "authenticated": False}
    return {"setup_required": False, "authenticated": True, "username": sess.username,
            "csrf_token": sess.csrf_token}


@router.post("/auth/setup")
async def auth_setup(body: SetupIn, request: Request, response: Response, s: Svc) -> dict[str, Any]:
    if not s.login_limiter.allow("setup:" + client_key(request)):
        raise HTTPException(429, "Too many attempts; wait a few minutes")
    try:
        uid = await asyncio.to_thread(s.auth.create_owner, body.username, body.password, body.setup_code)
    except PermissionError as exc:
        raise HTTPException(403, str(exc)) from None
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from None
    token, sess = s.auth.create_session(uid, request.headers.get("user-agent"))
    _set_cookie(response, request, s, token)
    return {"authenticated": True, "username": sess.username, "csrf_token": sess.csrf_token}


@router.post("/auth/login")
async def auth_login(body: LoginIn, request: Request, response: Response, s: Svc) -> dict[str, Any]:
    if not s.login_limiter.allow("login:" + client_key(request)):
        raise HTTPException(429, "Too many login attempts; wait a few minutes")
    uid = await asyncio.to_thread(s.auth.verify_credentials, body.username, body.password)
    if uid is None:
        raise HTTPException(401, "Invalid username or password")
    token, sess = s.auth.create_session(uid, request.headers.get("user-agent"))
    _set_cookie(response, request, s, token)
    return {"authenticated": True, "username": sess.username, "csrf_token": sess.csrf_token}


@router.post("/auth/logout")
async def auth_logout(response: Response, s: Svc, sess: Session) -> dict[str, Any]:
    s.auth.revoke(sess.session_id)
    response.delete_cookie(SESSION_COOKIE, path="/")
    return {"authenticated": False}


@router.post("/auth/password")
async def auth_password(body: PasswordIn, response: Response, s: Svc, sess: Session) -> dict[str, Any]:
    try:
        ok = await asyncio.to_thread(s.auth.change_password, sess.user_id, body.old_password, body.new_password)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from None
    if not ok:
        raise HTTPException(403, "Current password incorrect")
    response.delete_cookie(SESSION_COOKIE, path="/")
    return {"changed": True, "note": "All sessions were signed out."}


# ====================================================================== settings
@router.get("/settings")
async def get_prefs(s: Svc, _: Session) -> dict[str, Any]:
    return {"prefs": s.prefs(), "effective_timezone": s.timezone(),
            "groq_available": s.settings.groq_configured, "fish_key_present": s.settings.fish_configured,
            "env_voice_reference_set": bool(s.settings.fish_reference_id)}


@router.put("/settings")
async def put_prefs(body: PrefsIn, s: Svc, _: Session) -> dict[str, Any]:
    values = body.model_dump(exclude_none=True)
    if "timezone" in values:
        try:
            ZoneInfo(values["timezone"])
        except (ZoneInfoNotFoundError, ValueError):
            raise HTTPException(422, "Unknown timezone") from None
    if values.get("llm_provider") == "groq" and not s.settings.groq_configured:
        raise HTTPException(409, "Groq is not enabled/configured on the server")
    s.repo.set_settings(values)
    return await get_prefs(s, _)


# ====================================================================== conversations & chat
def _sse(events: AsyncIterator[Event], on_close: Any = None) -> StreamingResponse:
    async def gen() -> AsyncIterator[bytes]:
        try:
            async for ev in events:
                yield f"data: {json.dumps(ev, ensure_ascii=False, default=str)}\n\n".encode()
        except Exception:  # noqa: BLE001
            log.exception("stream crashed")
            err = {"type": "failed", "code": "internal", "message": "Internal error"}
            yield f"data: {json.dumps(err)}\n\n".encode()
        finally:
            if on_close:
                on_close()

    return StreamingResponse(gen(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-store", "X-Accel-Buffering": "no"})


@router.get("/conversations")
async def list_conversations(s: Svc, _: Session) -> dict[str, Any]:
    return {"conversations": s.repo.list_conversations()}


@router.post("/conversations")
async def new_conversation(s: Svc, _: Session) -> dict[str, Any]:
    return {"id": s.repo.create_conversation()}


@router.get("/conversations/{cid}/messages")
async def conversation_messages(cid: str, s: Svc, _: Session) -> dict[str, Any]:
    if not s.repo.conversation_exists(cid):
        raise HTTPException(404, "Conversation not found")
    msgs = [m for m in s.repo.get_messages(cid) if m["role"] in ("user", "assistant") and m["content"]]
    return {"messages": [{"id": m["id"], "role": m["role"], "content": m["content"],
                          "created_at": m["created_at"]} for m in msgs]}


@router.delete("/conversations")
async def erase_conversations(s: Svc, _: Session) -> dict[str, Any]:
    return {"deleted": s.repo.delete_all_conversations()}


@router.post("/chat")
async def chat(body: ChatIn, request: Request, s: Svc, sess: Session) -> StreamingResponse:
    if not s.chat_limiter.allow(sess.session_id):
        raise HTTPException(429, "Too many requests")
    cid = body.conversation_id
    if cid is None or not s.repo.conversation_exists(cid):
        cid = s.repo.create_conversation()
    cancel = asyncio.Event()
    s.cancels[cid] = cancel
    return _sse(s.orchestrator.run_turn(session_id=sess.session_id, conversation_id=cid, text=body.text,
                                        cancel=cancel), on_close=lambda: s.cancels.pop(cid, None))


@router.post("/chat/cancel")
async def chat_cancel(body: CancelIn, s: Svc, _: Session) -> dict[str, Any]:
    ev = s.cancels.get(body.conversation_id)
    if ev:
        ev.set()
    return {"cancelled": bool(ev)}


@router.get("/approvals/pending")
async def approvals_pending(s: Svc, sess: Session) -> dict[str, Any]:
    return {"pending": [r.public() for r in s.approvals.pending_for_session(sess.session_id)]}


@router.post("/approvals/{request_id}")
async def approvals_decide(request_id: str, body: DecisionIn, s: Svc, sess: Session) -> StreamingResponse:
    req = s.approvals.get(request_id)
    cancel = asyncio.Event()
    if req and req.conversation_id:
        s.cancels[req.conversation_id] = cancel
    cid = req.conversation_id if req else None
    return _sse(s.orchestrator.decide(session_id=sess.session_id, request_id=request_id, nonce=body.nonce,
                                      approve=body.approve, cancel=cancel),
                on_close=lambda: s.cancels.pop(cid, None) if cid else None)


# ====================================================================== tasks
@router.get("/tasks")
async def tasks_list(s: Svc, _: Session, status: str = Query("all", pattern="^(open|done|all)$")) -> dict[str, Any]:
    return {"tasks": s.repo.list_tasks(status=status), "timezone": s.timezone()}


@router.post("/tasks")
async def tasks_create(body: TaskIn, s: Svc, _: Session) -> dict[str, Any]:
    try:
        due, all_day = parse_due(body.due, s.timezone())
    except ToolError as exc:
        raise HTTPException(422, str(exc)) from None
    return {"task": s.repo.create_task(body.title, s.timezone(), due, all_day, body.priority)}


@router.post("/tasks/{task_id}/complete")
async def tasks_complete(task_id: int, s: Svc, _: Session) -> dict[str, Any]:
    t = s.repo.complete_task(task_id)
    if t is None:
        raise HTTPException(404, "Task not found")
    return {"task": t}


@router.post("/tasks/{task_id}/reopen")
async def tasks_reopen(task_id: int, s: Svc, _: Session) -> dict[str, Any]:
    t = s.repo.reopen_task(task_id)
    if t is None:
        raise HTTPException(404, "Task not found")
    return {"task": t}


@router.delete("/tasks/{task_id}")
async def tasks_delete(task_id: int, s: Svc, _: Session) -> dict[str, Any]:
    if not s.repo.delete_task(task_id):
        raise HTTPException(404, "Task not found")
    return {"deleted": True}


# ====================================================================== memories
@router.get("/memories")
async def memories_list(s: Svc, _: Session, q: str = Query("", max_length=200),
                        state: str = Query("all", pattern="^(approved|proposed|all)$")) -> dict[str, Any]:
    if q:
        return {"memories": s.repo.search_memories(q, limit=50)}
    if state == "all":
        return {"memories": s.repo.list_memories("approved") + s.repo.list_memories("proposed")}
    return {"memories": s.repo.list_memories(state)}


@router.post("/memories")
async def memories_create(body: MemoryIn, s: Svc, _: Session) -> dict[str, Any]:
    return {"memory": s.repo.add_memory(body.content, body.category, "user_ui", "approved")}


@router.patch("/memories/{mem_id}")
async def memories_patch(mem_id: int, body: MemoryPatch, s: Svc, _: Session) -> dict[str, Any]:
    m = s.repo.update_memory(mem_id, body.content, body.category, body.consent_state)
    if m is None:
        raise HTTPException(404, "Memory not found")
    if m["consent_state"] == "rejected":
        s.repo.delete_memory(mem_id)  # rejected proposals are not kept
        return {"memory": None, "deleted": True}
    return {"memory": m}


@router.delete("/memories/{mem_id}")
async def memories_delete(mem_id: int, s: Svc, _: Session) -> dict[str, Any]:
    if not s.repo.delete_memory(mem_id):
        raise HTTPException(404, "Memory not found")
    return {"deleted": True}


@router.delete("/memories")
async def memories_erase(s: Svc, _: Session) -> dict[str, Any]:
    return {"deleted": s.repo.delete_all_memories()}


# ====================================================================== audio
@router.post("/audio/transcribe")
async def transcribe(
    s: Svc, sess: Session, audio: UploadFile = File(...),
    language: str = Form("auto", pattern="^(auto|en|he)$"),
) -> dict[str, Any]:
    if not s.audio_limiter.allow("stt:" + sess.session_id):
        raise HTTPException(429, "Too many recordings")
    data = await audio.read(s.settings.stt_max_upload_bytes + 1)
    if len(data) > s.settings.stt_max_upload_bytes:
        raise HTTPException(413, "Recording too large")
    pref = s.prefs().get("stt_language", "auto")
    lang = language if language != "auto" else (pref if pref != "auto" else None)
    try:
        t = await s.stt.transcribe(data, audio.content_type or "", lang)
    except STTError as exc:
        status = {"not_configured": 503, "too_long": 413, "no_speech": 422, "invalid_audio": 415}.get(exc.code, 500)
        raise HTTPException(status, {"code": exc.code, "message": str(exc)}) from None
    finally:
        del data  # do not retain raw audio
    return t.public()


@router.post("/audio/stt/warmup")
async def stt_warmup(s: Svc, _: Session) -> dict[str, Any]:
    try:
        await s.stt.warmup()
    except STTError as exc:
        raise HTTPException(503, {"code": exc.code, "message": str(exc)}) from None
    return {"loaded": True}


@router.post("/audio/speak")
async def speak(body: SpeakIn, s: Svc, sess: Session) -> Response:
    if not s.audio_limiter.allow("tts:" + sess.session_id):
        raise HTTPException(429, "Too many speech requests")
    text = body.text if body.raw else to_spoken(body.text, s.settings.tts_max_chars)
    lang = body.language or detect_language(text)
    ref = body.reference_id or s.voice_for(lang)
    try:
        audio = await s.tts.synthesize(text, ref, lang)
    except TTSError as exc:
        raise HTTPException(exc.status, {"code": exc.code, "message": str(exc)}) from None
    return Response(audio.data, media_type=audio.content_type, headers={
        "Cache-Control": "no-store", "X-TTS-Elapsed-Ms": str(audio.elapsed_ms), "X-TTS-Model": audio.model,
        "X-TTS-Language": lang,
    })


@router.get("/voice/search")
async def voice_search(s: Svc, _: Session, q: str = Query("", max_length=80),
                       language: str = Query("", pattern="^(|en|he)$")) -> dict[str, Any]:
    try:
        return {"voices": await s.tts.search_voices(q, language or None)}
    except TTSError as exc:
        raise HTTPException(exc.status, {"code": exc.code, "message": str(exc)}) from None


@router.get("/voice/{reference_id}")
async def voice_get(reference_id: str, s: Svc, _: Session) -> dict[str, Any]:
    try:
        return {"voice": await s.tts.get_voice(reference_id)}
    except TTSError as exc:
        raise HTTPException(exc.status, {"code": exc.code, "message": str(exc)}) from None
