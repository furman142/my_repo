"""Core MVP tools: time, system status, tasks, memories, open_url."""

from __future__ import annotations

import asyncio
import ipaddress
import re
from datetime import date, datetime, time
from typing import Any, Literal
from urllib.parse import urlsplit
from zoneinfo import ZoneInfo

from pydantic import BaseModel, ConfigDict, Field, field_validator

from ..system.metrics import system_status
from .registry import SideEffect, ToolContext, ToolError, ToolRegistry, ToolSpec


class _Args(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class NoArgs(_Args):
    pass


# ---------------------------------------------------------------- time / system
async def _get_local_time(_: NoArgs, ctx: ToolContext) -> dict[str, Any]:
    now = datetime.now(ZoneInfo(ctx.timezone))
    return {"iso": now.isoformat(timespec="seconds"), "weekday": now.strftime("%A"), "timezone": ctx.timezone}


async def _get_system_status(_: NoArgs, __: ToolContext) -> dict[str, Any]:
    return await asyncio.to_thread(system_status)


# ---------------------------------------------------------------- tasks
_DUE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2})?)?$")


def parse_due(value: str | None, tz: str) -> tuple[datetime | None, bool]:
    """Parse a model-supplied local due string. Returns (aware datetime, all_day).

    Accepts only explicit `YYYY-MM-DD` or `YYYY-MM-DDTHH:MM`. Anything vaguer is rejected so the
    assistant must ask the user instead of inventing a time.
    """
    if value is None or value == "":
        return None, False
    if not _DUE_RE.match(value):
        raise ToolError(
            "Due date must be explicit: YYYY-MM-DD or YYYY-MM-DDTHH:MM in the user's local time. "
            "If the user's time is ambiguous, ask them to clarify."
        )
    zone = ZoneInfo(tz)
    try:
        if "T" in value:
            return datetime.fromisoformat(value).replace(tzinfo=zone), False
        d = date.fromisoformat(value)
    except ValueError as exc:
        raise ToolError(f"Invalid date: {value}") from exc
    return datetime.combine(d, time(23, 59), tzinfo=zone), True


class ListTasksArgs(_Args):
    status: Literal["open", "done", "all"] = "open"
    when: Literal["any", "today", "overdue", "upcoming"] = Field(
        default="any", description="Filter by due date relative to now in the user's timezone."
    )


async def _list_tasks(a: ListTasksArgs, ctx: ToolContext) -> dict[str, Any]:
    tasks = ctx.repo.list_tasks(status=a.status)
    zone = ZoneInfo(ctx.timezone)
    now = datetime.now(zone)
    today = now.date()

    def keep(t: dict[str, Any]) -> bool:
        if a.when == "any":
            return True
        if not t["due_at"]:
            return a.when == "today" and t["status"] == "open"  # undated open tasks are relevant today
        due = datetime.fromisoformat(t["due_at"]).astimezone(zone)
        if a.when == "today":
            return due.date() == today or (due < now and t["status"] == "open")
        if a.when == "overdue":
            return due < now and t["status"] == "open"
        return due >= now

    selected = [t for t in tasks if keep(t)]
    return {"count": len(selected), "tasks": [
        {"id": t["id"], "title": t["title"], "status": t["status"], "priority": t["priority"],
         "due": t["due_at"], "all_day": t["due_all_day"]} for t in selected[:50]
    ]}


class CreateTaskArgs(_Args):
    title: str = Field(min_length=1, max_length=200)
    due: str | None = Field(
        default=None,
        description="Optional local due date 'YYYY-MM-DD' or date-time 'YYYY-MM-DDTHH:MM'. Omit if not given.",
    )
    priority: Literal["low", "normal", "high"] | None = None


async def _create_task(a: CreateTaskArgs, ctx: ToolContext) -> dict[str, Any]:
    due, all_day = parse_due(a.due, ctx.timezone)
    t = ctx.repo.create_task(a.title, ctx.timezone, due, all_day, a.priority)
    return {"created": True, "task": {"id": t["id"], "title": t["title"], "due": t["due_at"]}}


def _preview_create_task(a: CreateTaskArgs, ctx: ToolContext) -> str:
    due, all_day = parse_due(a.due, ctx.timezone)
    when = "" if not due else (f" — due {due.date().isoformat()}" if all_day
                               else f" — due {due.strftime('%Y-%m-%d %H:%M')}")
    return f"Create task “{a.title}”{when}" + (f" [{a.priority}]" if a.priority else "")


class TaskIdArgs(_Args):
    task_id: int = Field(ge=1)


async def _complete_task(a: TaskIdArgs, ctx: ToolContext) -> dict[str, Any]:
    t = ctx.repo.complete_task(a.task_id)
    if t is None:
        raise ToolError(f"Task {a.task_id} not found")
    return {"completed": True, "task": {"id": t["id"], "title": t["title"], "status": t["status"]}}


def _preview_complete_task(a: TaskIdArgs, ctx: ToolContext) -> str:
    t = ctx.repo.get_task(a.task_id)
    if t is None:
        raise ToolError(f"Task {a.task_id} not found")
    return f"Mark task #{t['id']} “{t['title']}” as done"


# ---------------------------------------------------------------- memories
def _mem_out(m: dict[str, Any]) -> dict[str, Any]:
    return {"id": m["id"], "content": m["content"], "category": m["category"]}


async def _list_memories(_: NoArgs, ctx: ToolContext) -> dict[str, Any]:
    mems = ctx.repo.list_memories("approved", limit=40)
    return {"count": len(mems), "memories": [_mem_out(m) for m in mems]}


class SearchMemArgs(_Args):
    query: str = Field(min_length=1, max_length=200)


async def _search_memories(a: SearchMemArgs, ctx: ToolContext) -> dict[str, Any]:
    mems = ctx.repo.search_memories(a.query)
    return {"count": len(mems), "memories": [_mem_out(m) for m in mems]}


class MemoryArgs(_Args):
    content: str = Field(min_length=2, max_length=500, description="The fact, phrased in third person.")
    category: Literal["general", "preference", "person", "project", "routine"] = "general"


async def _propose_memory(a: MemoryArgs, ctx: ToolContext) -> dict[str, Any]:
    m = ctx.repo.add_memory(a.content, a.category, "assistant_proposed", "proposed")
    return {"proposed": True, "id": m["id"],
            "note": "Stored as a PROPOSAL only. It is not remembered until the user confirms it in Memories."}


async def _save_memory(a: MemoryArgs, ctx: ToolContext) -> dict[str, Any]:
    m = ctx.repo.add_memory(a.content, a.category, "assistant_approved", "approved")
    return {"saved": True, "memory": _mem_out(m)}


class EditMemArgs(_Args):
    memory_id: int = Field(ge=1)
    content: str = Field(min_length=2, max_length=500)


async def _edit_memory(a: EditMemArgs, ctx: ToolContext) -> dict[str, Any]:
    m = ctx.repo.update_memory(a.memory_id, content=a.content)
    if m is None:
        raise ToolError(f"Memory {a.memory_id} not found")
    return {"updated": True, "memory": _mem_out(m)}


class MemIdArgs(_Args):
    memory_id: int = Field(ge=1)


async def _delete_memory(a: MemIdArgs, ctx: ToolContext) -> dict[str, Any]:
    if not ctx.repo.delete_memory(a.memory_id):
        raise ToolError(f"Memory {a.memory_id} not found")
    return {"deleted": True, "id": a.memory_id}


def _mem_label(ctx: ToolContext, mem_id: int) -> str:
    m = ctx.repo.get_memory(mem_id)
    if m is None:
        raise ToolError(f"Memory {mem_id} not found")
    return f"#{m['id']} “{m['content']}”"


# ---------------------------------------------------------------- open_url
class OpenUrlArgs(_Args):
    url: str = Field(min_length=8, max_length=2048)

    @field_validator("url")
    @classmethod
    def _safe(cls, v: str) -> str:
        return validate_public_url(v)


def validate_public_url(v: str) -> str:
    if any(ord(ch) < 0x20 or ch in " \\\"<>`" for ch in v):
        raise ValueError("URL contains forbidden characters")
    parts = urlsplit(v)
    if parts.scheme not in ("http", "https"):
        raise ValueError("Only http and https URLs are allowed")
    if not parts.hostname:
        raise ValueError("URL must have a host")
    if parts.username or parts.password:
        raise ValueError("URLs with embedded credentials are not allowed")
    host = parts.hostname
    try:
        ip = ipaddress.ip_address(host)
        if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved or ip.is_unspecified:
            raise ValueError("Private/loopback addresses are not allowed")
    except ValueError as exc:
        if "not allowed" in str(exc):
            raise
        if host in ("localhost",) or host.endswith((".local", ".localhost", ".internal")):
            raise ValueError("Local hostnames are not allowed") from None
    return v


async def _open_url(a: OpenUrlArgs, _: ToolContext) -> dict[str, Any]:
    # The URL is opened by the user's own client (an explicit link in the UI), never by the server.
    return {"approved_url": a.url, "action": "client_open",
            "note": "The user's screen now shows the link to open."}


def build_registry() -> ToolRegistry:
    r = ToolRegistry()
    r.register(ToolSpec("get_local_time", "Local time", "Get the current date and time in the user's timezone.",
                        NoArgs, SideEffect.READ, False, _get_local_time, lambda a, c: "Read local time"))
    r.register(ToolSpec("get_system_status", "System status",
                        "Get real CPU, RAM, disk and NVIDIA GPU usage of the host PC.",
                        NoArgs, SideEffect.READ, False, _get_system_status,
                        lambda a, c: "Read system telemetry", timeout=8))
    r.register(ToolSpec("list_tasks", "List tasks", "List the user's saved tasks (to-dos).",
                        ListTasksArgs, SideEffect.READ, False, _list_tasks, lambda a, c: "Read tasks"))
    r.register(ToolSpec("create_task", "Create task",
                        "Create a to-do task. Requires user approval. Never invent a due time.",
                        CreateTaskArgs, SideEffect.WRITE, True, _create_task, _preview_create_task))
    r.register(ToolSpec("complete_task", "Complete task", "Mark a task as done by id. Requires user approval.",
                        TaskIdArgs, SideEffect.WRITE, True, _complete_task, _preview_complete_task))
    r.register(ToolSpec("list_memories", "List memories", "List long-term facts the user approved.",
                        NoArgs, SideEffect.READ, False, _list_memories, lambda a, c: "Read memories"))
    r.register(ToolSpec("search_memories", "Search memories", "Search approved long-term memories by keywords.",
                        SearchMemArgs, SideEffect.READ, False, _search_memories, lambda a, c: "Search memories"))
    r.register(ToolSpec("propose_memory", "Propose memory",
                        "Suggest a fact worth remembering. It is stored only as an inactive proposal "
                        "until the user confirms it.",
                        MemoryArgs, SideEffect.WRITE, False, _propose_memory,
                        lambda a, c: f"Propose memory “{a.content}”"))
    r.register(ToolSpec("save_memory", "Save memory",
                        "Save a fact to long-term memory when the user explicitly asks you to remember it. "
                        "Requires user approval.",
                        MemoryArgs, SideEffect.WRITE, True, _save_memory,
                        lambda a, c: f"Remember: “{a.content}” ({a.category})"))
    r.register(ToolSpec("edit_memory", "Edit memory", "Change an existing memory. Requires user approval.",
                        EditMemArgs, SideEffect.WRITE, True, _edit_memory,
                        lambda a, c: f"Change memory {_mem_label(c, a.memory_id)} → “{a.content}”"))
    r.register(ToolSpec("delete_memory", "Delete memory", "Permanently delete a memory. Requires user approval.",
                        MemIdArgs, SideEffect.WRITE, True, _delete_memory,
                        lambda a, c: f"Permanently forget memory {_mem_label(c, a.memory_id)}"))
    r.register(ToolSpec("open_url", "Open link",
                        "Offer a public http(s) link for the user to open. Requires user approval.",
                        OpenUrlArgs, SideEffect.EXTERNAL, True, _open_url,
                        lambda a, c: f"Open {a.url}"))
    return r


__all__ = ["build_registry", "parse_due", "validate_public_url"]
