"""Allowlisted, typed tool registry. The LLM can only call what is registered here."""

from __future__ import annotations

import asyncio
import json
import logging
import time
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from enum import StrEnum
from typing import Any

from pydantic import BaseModel, ValidationError

from ..memory.repository import Repository

log = logging.getLogger("jarvis.tools")


class SideEffect(StrEnum):
    READ = "read"
    WRITE = "write"
    EXTERNAL = "external"


@dataclass
class ToolContext:
    repo: Repository
    timezone: str
    conversation_id: str | None


Handler = Callable[[Any, ToolContext], Awaitable[dict[str, Any]]]


@dataclass
class ToolSpec:
    name: str
    title: str
    description: str
    params: type[BaseModel]
    side_effect: SideEffect
    requires_approval: bool
    handler: Handler
    preview: Callable[[Any, ToolContext], str]
    timeout: float = 10.0

    def schema(self) -> dict[str, Any]:
        return {
            "type": "function",
            "function": {
                "name": self.name,
                "description": self.description,
                "parameters": _clean_schema(self.params.model_json_schema()),
            },
        }


class ToolError(Exception):
    """Error that is safe to show to the user and the model."""


def _clean_schema(schema: dict[str, Any]) -> dict[str, Any]:
    """Drop pydantic noise (titles) to keep the prompt small; inline simple Optional types."""
    def walk(node: Any) -> Any:
        if isinstance(node, dict):
            node = {k: walk(v) for k, v in node.items() if k != "title"}
            any_of = node.get("anyOf")
            if isinstance(any_of, list) and len(any_of) == 2 and {"type": "null"} in any_of:
                other = next(x for x in any_of if x != {"type": "null"})
                node.pop("anyOf")
                node.update(other)
            return node
        if isinstance(node, list):
            return [walk(x) for x in node]
        return node

    cleaned = walk(schema)
    cleaned.setdefault("properties", {})
    return cleaned


class ToolRegistry:
    def __init__(self) -> None:
        self._tools: dict[str, ToolSpec] = {}

    def register(self, spec: ToolSpec) -> None:
        if spec.name in self._tools:
            raise ValueError(f"duplicate tool {spec.name}")
        self._tools[spec.name] = spec

    def get(self, name: str) -> ToolSpec | None:
        return self._tools.get(name)

    def all(self) -> list[ToolSpec]:
        return list(self._tools.values())

    def schemas(self) -> list[dict[str, Any]]:
        return [t.schema() for t in self._tools.values()]

    def validate(self, name: str, raw_args: Any) -> tuple[ToolSpec, BaseModel]:
        spec = self.get(name)
        if spec is None:
            raise ToolError(f"Unknown tool '{name}'")
        if isinstance(raw_args, str):
            try:
                raw_args = json.loads(raw_args) if raw_args.strip() else {}
            except json.JSONDecodeError as exc:
                raise ToolError("Tool arguments were not valid JSON") from exc
        if raw_args is None:
            raw_args = {}
        if not isinstance(raw_args, dict):
            raise ToolError("Tool arguments must be an object")
        try:
            return spec, spec.params.model_validate(raw_args)
        except ValidationError as exc:
            msgs = "; ".join(f"{'.'.join(map(str, e['loc'])) or 'args'}: {e['msg']}" for e in exc.errors()[:4])
            raise ToolError(f"Invalid arguments for {name}: {msgs}") from exc

    async def execute(
        self, spec: ToolSpec, args: BaseModel, ctx: ToolContext, request_id: str | None = None
    ) -> dict[str, Any]:
        """Run a validated tool with timeout and audit. Approval must already be enforced by caller."""
        started = time.perf_counter()
        dumped = args.model_dump(mode="json")
        try:
            result = await asyncio.wait_for(spec.handler(args, ctx), timeout=spec.timeout)
        except TimeoutError:
            self._audit(ctx, spec, dumped, request_id, "error", "timeout", started)
            raise ToolError(f"{spec.name} timed out") from None
        except ToolError as exc:
            self._audit(ctx, spec, dumped, request_id, "error", str(exc), started)
            raise
        except Exception as exc:  # noqa: BLE001 — never leak internals to the model
            log.exception("tool %s crashed", spec.name)
            self._audit(ctx, spec, dumped, request_id, "error", type(exc).__name__, started)
            raise ToolError(f"{spec.name} failed internally") from exc
        self._audit(ctx, spec, dumped, request_id, "ok", None, started)
        return result

    @staticmethod
    def _audit(ctx: ToolContext, spec: ToolSpec, args: dict[str, Any], request_id: str | None,
               outcome: str, detail: str | None, started: float) -> None:
        ctx.repo.audit(
            request_id=request_id, conversation_id=ctx.conversation_id, tool_name=spec.name,
            side_effect=spec.side_effect.value, arguments=args, outcome=outcome, detail=detail,
            duration_ms=int((time.perf_counter() - started) * 1000),
        )
