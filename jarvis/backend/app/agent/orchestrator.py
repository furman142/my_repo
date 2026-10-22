"""Assistant request lifecycle: bounded LLM ⇄ tool loop with server-enforced approvals.

Emits structured events (dicts with a `type`) consumed by the SSE endpoint:
request_received, thinking, token, executing, tool_result, approval_required, message,
completed, cancelled, failed.
"""

from __future__ import annotations

import asyncio
import json
import logging
import re
import time
from collections.abc import AsyncIterator, Callable
from typing import Any

from ..memory.repository import Repository
from ..providers.llm import LLMError, LLMProvider, ToolCall
from ..providers.tts import to_spoken
from ..tools.approvals import ApprovalError, ApprovalService
from ..tools.registry import ToolContext, ToolError, ToolRegistry
from .prompt import system_message

log = logging.getLogger("jarvis.agent")

Event = dict[str, Any]
_THINK = re.compile(r"<think>.*?</think>\s*", re.S)


def _tool_content(payload: dict[str, Any]) -> str:
    return json.dumps(payload, ensure_ascii=False, default=str)[:6000]


class Orchestrator:
    def __init__(self, repo: Repository, registry: ToolRegistry, approvals: ApprovalService,
                 llm_factory: Callable[[], LLMProvider], timezone_fn: Callable[[], str], *,
                 max_tool_calls: int = 6, history_messages: int = 16, turn_budget_s: float = 240.0):
        self.repo = repo
        self.registry = registry
        self.approvals = approvals
        self.llm_factory = llm_factory
        self.timezone_fn = timezone_fn
        self.max_tool_calls = max_tool_calls
        self.history_messages = history_messages
        self.turn_budget_s = turn_budget_s
        self._busy: set[str] = set()

    # ------------------------------------------------------------------ public entry points
    async def run_turn(self, *, session_id: str, conversation_id: str, text: str,
                       cancel: asyncio.Event) -> AsyncIterator[Event]:
        if conversation_id in self._busy:
            yield {"type": "failed", "code": "busy", "message": "A request is already running in this conversation."}
            return
        self._busy.add(conversation_id)
        try:
            self._supersede_pending(conversation_id)
            self.repo.add_message(conversation_id, "user", text)
            self.repo.log_event(conversation_id, "request_received", {"chars": len(text)})
            yield {"type": "request_received", "conversation_id": conversation_id}
            async for ev in self._loop(session_id, conversation_id, text, cancel):
                yield ev
        finally:
            self._busy.discard(conversation_id)

    async def decide(self, *, session_id: str, request_id: str, nonce: str, approve: bool,
                     cancel: asyncio.Event) -> AsyncIterator[Event]:
        try:
            req = self.approvals.decide(request_id=request_id, session_id=session_id, nonce=nonce, approve=approve)
        except ApprovalError as exc:
            yield {"type": "failed", "code": f"approval_{exc.code}", "message": str(exc)}
            return
        cid = req.conversation_id
        if cid is None:
            yield {"type": "failed", "code": "approval_orphan", "message": "Approval has no conversation"}
            return
        if cid in self._busy:
            yield {"type": "failed", "code": "busy", "message": "Conversation busy"}
            return
        self._busy.add(cid)
        try:
            ctx = ToolContext(self.repo, self.timezone_fn(), cid)
            if approve:
                spec, args = self.registry.validate(req.tool_name, req.arguments)
                yield {"type": "executing", "tool": spec.name, "title": spec.title, "request_id": req.id}
                try:
                    result = await self.registry.execute(spec, args, ctx, request_id=req.id)
                    ok = True
                except ToolError as exc:
                    result, ok = {"error": str(exc)}, False
                self.approvals.mark_executed(req.id, ok, result)
                self.repo.add_message(cid, "tool", _tool_content(result), tool_name=spec.name)
                self.repo.log_event(cid, "tool_executed", {"tool": spec.name, "ok": ok, "request_id": req.id})
                yield {"type": "tool_result", "tool": spec.name, "ok": ok, "result": result, "request_id": req.id}
            else:
                denied = {"denied": True, "note": "The user denied this action. Do not retry unless asked again."}
                self.repo.add_message(cid, "tool", _tool_content(denied), tool_name=req.tool_name)
                self.repo.log_event(cid, "tool_denied", {"tool": req.tool_name, "request_id": req.id})
                yield {"type": "tool_result", "tool": req.tool_name, "ok": False, "result": denied,
                       "request_id": req.id}
            async for ev in self._loop(session_id, cid, None, cancel):
                yield ev
        finally:
            self._busy.discard(cid)

    # ------------------------------------------------------------------ internals
    def _supersede_pending(self, cid: str) -> None:
        """A new user message cancels any approval still pending in this conversation."""
        with self.repo.db.tx() as c:
            rows = c.execute("SELECT id, tool_name FROM tool_requests WHERE conversation_id=? AND status='pending'",
                             (cid,)).fetchall()
            for r in rows:
                c.execute("UPDATE tool_requests SET status='expired' WHERE id=?", (r["id"],))
        for r in rows:
            self.repo.add_message(cid, "tool", _tool_content({"not_executed": True, "reason": "superseded"}),
                                  tool_name=r["tool_name"])

    def _history(self, cid: str, query: str | None) -> list[dict[str, Any]]:
        rows = self.repo.get_messages(cid, limit=self.history_messages)
        while rows and rows[0]["role"] == "tool":  # never start with an orphaned tool result
            rows.pop(0)
        if query is None:
            query = next((r["content"] for r in reversed(rows) if r["role"] == "user"), "")
        memories = self.repo.search_memories(query, limit=6) if query else []
        msgs: list[dict[str, Any]] = [system_message(self.timezone_fn(), memories)]
        for r in rows:
            m: dict[str, Any] = {"role": r["role"], "content": r["content"]}
            if r["tool_calls"]:
                m["tool_calls"] = r["tool_calls"]
            if r["tool_name"]:
                m["tool_name"] = r["tool_name"]
            msgs.append(m)
        return msgs

    async def _loop(self, session_id: str, cid: str, query: str | None,
                    cancel: asyncio.Event) -> AsyncIterator[Event]:
        llm = self.llm_factory()
        started = time.monotonic()
        calls_used = 0
        ctx = ToolContext(self.repo, self.timezone_fn(), cid)
        tools = self.registry.schemas()
        while True:
            if time.monotonic() - started > self.turn_budget_s:
                yield self._fail(cid, "time_budget", "The request exceeded its time budget.")
                return
            yield {"type": "thinking", "provider": llm.name, "model": llm.model, "cloud": llm.cloud}
            content, calls, stats = "", [], {}
            t0 = time.perf_counter()
            first_token_ms: int | None = None
            try:
                async for chunk in llm.chat(self._history(cid, query), tools):
                    if cancel.is_set():
                        if content.strip():
                            self.repo.add_message(cid, "assistant", _THINK.sub("", content).strip() + " …")
                        self.repo.log_event(cid, "cancelled", {})
                        yield {"type": "cancelled"}
                        return
                    if chunk.content:
                        if first_token_ms is None:
                            first_token_ms = int((time.perf_counter() - t0) * 1000)
                        content += chunk.content
                        yield {"type": "token", "text": chunk.content}
                    calls.extend(chunk.tool_calls)
                    if chunk.done:
                        stats = chunk.stats
            except LLMError as exc:
                yield self._fail(cid, f"llm_{exc.code}", str(exc))
                return
            timing = {"llm_ms": int((time.perf_counter() - t0) * 1000), "first_token_ms": first_token_ms, **stats}
            content = _THINK.sub("", content).strip()

            if not calls:
                if not content:
                    yield self._fail(cid, "llm_empty", "The model returned an empty reply.")
                    return
                self.repo.add_message(cid, "assistant", content)
                self.repo.log_event(cid, "completed", timing)
                yield {"type": "message", "text": content, "spoken": to_spoken(content), "timing": timing}
                yield {"type": "completed"}
                return

            calls_used += len(calls)
            if calls_used > self.max_tool_calls:
                yield self._fail(cid, "tool_budget", "Too many tool calls in one request; stopping.")
                return

            async for ev in self._run_calls(session_id, cid, content, calls, ctx):
                yield ev
                if ev["type"] == "approval_required":
                    return

    async def _run_calls(self, session_id: str, cid: str, content: str, calls: list[ToolCall],
                         ctx: ToolContext) -> AsyncIterator[Event]:
        results: list[tuple[str, dict[str, Any]]] = []
        for idx, call in enumerate(calls):
            try:
                spec, args = self.registry.validate(call.name, call.arguments)
            except ToolError as exc:
                self.repo.audit(request_id=None, conversation_id=cid, tool_name=call.name[:64], side_effect="?",
                                arguments={"raw": str(call.arguments)[:300]}, outcome="rejected",
                                detail=str(exc), duration_ms=0)
                results.append((call.name, {"error": str(exc)}))
                yield {"type": "tool_result", "tool": call.name, "ok": False, "result": {"error": str(exc)}}
                continue

            if spec.requires_approval:
                try:
                    preview = spec.preview(args, ctx)
                except ToolError as exc:
                    results.append((spec.name, {"error": str(exc)}))
                    yield {"type": "tool_result", "tool": spec.name, "ok": False, "result": {"error": str(exc)}}
                    continue
                req = self.approvals.create(session_id=session_id, conversation_id=cid, tool_name=spec.name,
                                            arguments=args.model_dump(mode="json"), preview=preview)
                # Persist only the calls handled so far plus this one; later calls are dropped.
                self._persist(cid, content, calls[: idx + 1], results)
                self.repo.log_event(cid, "approval_required", {"tool": spec.name, "request_id": req.id})
                yield {"type": "approval_required", "request": req.public(), "title": spec.title,
                       "side_effect": spec.side_effect.value}
                return

            yield {"type": "executing", "tool": spec.name, "title": spec.title}
            try:
                result = await self.registry.execute(spec, args, ctx)
                ok = True
            except ToolError as exc:
                result, ok = {"error": str(exc)}, False
            results.append((spec.name, result))
            yield {"type": "tool_result", "tool": spec.name, "ok": ok, "result": result}
        self._persist(cid, content, calls, results)

    def _persist(self, cid: str, content: str, calls: list[ToolCall], results: list[tuple[str, dict[str, Any]]]):
        self.repo.add_message(cid, "assistant", content, tool_calls=[c.as_message() for c in calls])
        for name, payload in results:
            self.repo.add_message(cid, "tool", _tool_content(payload), tool_name=name)

    def _fail(self, cid: str, code: str, message: str) -> Event:
        self.repo.log_event(cid, "failed", {"code": code})
        log.warning("turn failed: %s — %s", code, message)
        return {"type": "failed", "code": code, "message": message}
