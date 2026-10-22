"""Durable storage for conversations, tasks, memories and preferences."""

from __future__ import annotations

import json
import logging
import re
import uuid
from datetime import datetime
from typing import Any

from ..db import Database, iso, utcnow

log = logging.getLogger("jarvis.memory")

_FTS_TOKEN = re.compile(r"[\w֐-׿]+", re.UNICODE)

_STOPWORDS = {
    "the", "and", "what", "who", "where", "when", "which", "that", "this", "with", "for", "you", "your", "are",
    "was", "does", "did", "have", "has", "about", "remember", "tell", "know", "name", "jarvis",
    "מה", "מי", "איפה", "מתי", "את", "של", "על", "זה", "זאת", "אני", "אתה", "שלי", "יש", "לי", "תזכור", "זוכר",
}

def _row(r: Any) -> dict[str, Any]:
    return dict(r) if r is not None else {}


class Repository:
    def __init__(self, db: Database):
        self.db = db

    # ------------------------------------------------------------------ conversations
    def create_conversation(self, title: str = "") -> str:
        cid = uuid.uuid4().hex
        now = iso(utcnow())
        with self.db.tx() as c:
            c.execute(
                "INSERT INTO conversations (id, title, created_at, updated_at) VALUES (?,?,?,?)",
                (cid, title[:120], now, now),
            )
        return cid

    def conversation_exists(self, cid: str) -> bool:
        with self.db.tx() as c:
            return c.execute("SELECT 1 FROM conversations WHERE id=?", (cid,)).fetchone() is not None

    def list_conversations(self, limit: int = 30) -> list[dict[str, Any]]:
        with self.db.tx() as c:
            rows = c.execute(
                "SELECT id, title, created_at, updated_at FROM conversations ORDER BY updated_at DESC LIMIT ?",
                (limit,),
            ).fetchall()
        return [_row(r) for r in rows]

    def add_message(
        self,
        cid: str,
        role: str,
        content: str,
        tool_calls: list[dict[str, Any]] | None = None,
        tool_name: str | None = None,
    ) -> int:
        now = iso(utcnow())
        with self.db.tx() as c:
            cur = c.execute(
                "INSERT INTO messages (conversation_id, role, content, tool_calls, tool_name, created_at)"
                " VALUES (?,?,?,?,?,?)",
                (cid, role, content, json.dumps(tool_calls) if tool_calls else None, tool_name, now),
            )
            title_row = c.execute("SELECT title FROM conversations WHERE id=?", (cid,)).fetchone()
            if role == "user" and title_row is not None and not title_row["title"]:
                c.execute("UPDATE conversations SET title=? WHERE id=?", (content[:80], cid))
            c.execute("UPDATE conversations SET updated_at=? WHERE id=?", (now, cid))
            return int(cur.lastrowid or 0)

    def get_messages(self, cid: str, limit: int | None = None) -> list[dict[str, Any]]:
        with self.db.tx() as c:
            if limit:
                rows = c.execute(
                    "SELECT * FROM (SELECT * FROM messages WHERE conversation_id=? ORDER BY id DESC LIMIT ?)"
                    " ORDER BY id ASC",
                    (cid, limit),
                ).fetchall()
            else:
                rows = c.execute(
                    "SELECT * FROM messages WHERE conversation_id=? ORDER BY id ASC", (cid,)
                ).fetchall()
        out = []
        for r in rows:
            d = _row(r)
            d["tool_calls"] = json.loads(d["tool_calls"]) if d["tool_calls"] else None
            out.append(d)
        return out

    def delete_all_conversations(self) -> int:
        with self.db.tx() as c:
            n = c.execute("SELECT COUNT(*) FROM conversations").fetchone()[0]
            c.execute("DELETE FROM conversations")
            c.execute("DELETE FROM assistant_events")
        log.info("Erased %d conversations", n)
        return int(n)

    def log_event(self, cid: str | None, type_: str, data: dict[str, Any] | None = None) -> None:
        with self.db.tx() as c:
            c.execute(
                "INSERT INTO assistant_events (conversation_id, type, data, created_at) VALUES (?,?,?,?)",
                (cid, type_, json.dumps(data or {}, ensure_ascii=False), iso(utcnow())),
            )

    # ------------------------------------------------------------------ tasks
    def create_task(
        self,
        title: str,
        timezone: str,
        due_at: datetime | None = None,
        due_all_day: bool = False,
        priority: str | None = None,
    ) -> dict[str, Any]:
        with self.db.tx() as c:
            cur = c.execute(
                "INSERT INTO tasks (title, status, priority, due_at, due_all_day, timezone, created_at)"
                " VALUES (?, 'open', ?, ?, ?, ?, ?)",
                (title, priority, due_at.isoformat() if due_at else None, int(due_all_day), timezone,
                 iso(utcnow())),
            )
            task_id = cur.lastrowid
            row = c.execute("SELECT * FROM tasks WHERE id=?", (task_id,)).fetchone()
        log.info("Task %s created", task_id)
        return _task(row)

    def get_task(self, task_id: int) -> dict[str, Any] | None:
        with self.db.tx() as c:
            row = c.execute("SELECT * FROM tasks WHERE id=?", (task_id,)).fetchone()
        return _task(row) if row else None

    def list_tasks(self, status: str = "open", limit: int = 100) -> list[dict[str, Any]]:
        q = "SELECT * FROM tasks"
        params: list[Any] = []
        if status in ("open", "done"):
            q += " WHERE status=?"
            params.append(status)
        q += " ORDER BY (due_at IS NULL), due_at, id LIMIT ?"
        params.append(limit)
        with self.db.tx() as c:
            rows = c.execute(q, params).fetchall()
        return [_task(r) for r in rows]

    def complete_task(self, task_id: int) -> dict[str, Any] | None:
        with self.db.tx() as c:
            c.execute(
                "UPDATE tasks SET status='done', completed_at=? WHERE id=? AND status='open'",
                (iso(utcnow()), task_id),
            )
            row = c.execute("SELECT * FROM tasks WHERE id=?", (task_id,)).fetchone()
        log.info("Task %s completion requested -> %s", task_id, "ok" if row else "not found")
        return _task(row) if row else None

    def reopen_task(self, task_id: int) -> dict[str, Any] | None:
        with self.db.tx() as c:
            c.execute("UPDATE tasks SET status='open', completed_at=NULL WHERE id=?", (task_id,))
            row = c.execute("SELECT * FROM tasks WHERE id=?", (task_id,)).fetchone()
        return _task(row) if row else None

    def delete_task(self, task_id: int) -> bool:
        with self.db.tx() as c:
            n = c.execute("DELETE FROM tasks WHERE id=?", (task_id,)).rowcount
        return n > 0

    # ------------------------------------------------------------------ memories
    def add_memory(self, content: str, category: str, source: str, consent_state: str) -> dict[str, Any]:
        now = iso(utcnow())
        with self.db.tx() as c:
            cur = c.execute(
                "INSERT INTO memories (content, category, source, consent_state, created_at, updated_at)"
                " VALUES (?,?,?,?,?,?)",
                (content, category, source, consent_state, now, now),
            )
            row = c.execute("SELECT * FROM memories WHERE id=?", (cur.lastrowid,)).fetchone()
        log.info("Memory %s stored (%s)", row["id"], consent_state)
        return _row(row)

    def get_memory(self, mem_id: int) -> dict[str, Any] | None:
        with self.db.tx() as c:
            row = c.execute("SELECT * FROM memories WHERE id=? AND deleted_at IS NULL", (mem_id,)).fetchone()
        return _row(row) if row else None

    def list_memories(self, consent_state: str | None = "approved", limit: int = 200) -> list[dict[str, Any]]:
        q = "SELECT * FROM memories WHERE deleted_at IS NULL"
        params: list[Any] = []
        if consent_state:
            q += " AND consent_state=?"
            params.append(consent_state)
        q += " ORDER BY updated_at DESC LIMIT ?"
        params.append(limit)
        with self.db.tx() as c:
            return [_row(r) for r in c.execute(q, params).fetchall()]

    def search_memories(self, query: str, limit: int = 8) -> list[dict[str, Any]]:
        tokens = [t for t in _FTS_TOKEN.findall(query.lower()) if len(t) >= 3 and t not in _STOPWORDS]
        # Hebrew: also try the word without a one-letter prefix (ה, ו, ב, ל, מ, ש, כ).
        tokens += [t[1:] for t in tokens if len(t) >= 4 and "\u05d0" <= t[0] <= "\u05ea" and t[0] in "הובלמשכ"]
        tokens = [t for t in dict.fromkeys(t[:-2] if t.endswith("'s") else t for t in tokens) if len(t) >= 3]
        if not tokens:
            return []
        # Trigram substring OR-query built only from word characters: no FTS syntax injection possible.
        fts = " OR ".join(f'"{t}"' for t in tokens[:12])
        with self.db.tx() as c:
            rows = c.execute(
                "SELECT m.* FROM memories_fts f JOIN memories m ON m.id = f.rowid"
                " WHERE memories_fts MATCH ? AND m.deleted_at IS NULL AND m.consent_state='approved'"
                " ORDER BY bm25(memories_fts) LIMIT ?",
                (fts, limit),
            ).fetchall()
        return [_row(r) for r in rows]

    def update_memory(
        self, mem_id: int, content: str | None = None, category: str | None = None,
        consent_state: str | None = None,
    ) -> dict[str, Any] | None:
        with self.db.tx() as c:
            row = c.execute("SELECT * FROM memories WHERE id=? AND deleted_at IS NULL", (mem_id,)).fetchone()
            if row is None:
                return None
            c.execute(
                "UPDATE memories SET content=?, category=?, consent_state=?, updated_at=? WHERE id=?",
                (content if content is not None else row["content"],
                 category if category is not None else row["category"],
                 consent_state if consent_state is not None else row["consent_state"],
                 iso(utcnow()), mem_id),
            )
            row = c.execute("SELECT * FROM memories WHERE id=?", (mem_id,)).fetchone()
        return _row(row)

    def delete_memory(self, mem_id: int) -> bool:
        """Hard-delete: content is removed from the table and the FTS index (not just flagged)."""
        with self.db.tx() as c:
            n = c.execute("DELETE FROM memories WHERE id=?", (mem_id,)).rowcount
        log.info("Memory %s delete -> %s", mem_id, bool(n))
        return n > 0

    def delete_all_memories(self) -> int:
        with self.db.tx() as c:
            n = c.execute("DELETE FROM memories").rowcount
            c.execute("INSERT INTO memories_fts(memories_fts) VALUES ('rebuild')")
        return int(n)

    # ------------------------------------------------------------------ settings
    def get_settings(self) -> dict[str, Any]:
        with self.db.tx() as c:
            rows = c.execute("SELECT key, value FROM settings").fetchall()
        return {r["key"]: json.loads(r["value"]) for r in rows}

    def set_settings(self, values: dict[str, Any]) -> dict[str, Any]:
        now = iso(utcnow())
        with self.db.tx() as c:
            for k, v in values.items():
                c.execute(
                    "INSERT INTO settings (key, value, updated_at) VALUES (?,?,?)"
                    " ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at",
                    (k, json.dumps(v, ensure_ascii=False), now),
                )
        return self.get_settings()

    # ------------------------------------------------------------------ audit
    def audit(
        self, *, request_id: str | None, conversation_id: str | None, tool_name: str, side_effect: str,
        arguments: dict[str, Any], outcome: str, detail: str | None, duration_ms: int | None,
    ) -> None:
        with self.db.tx() as c:
            c.execute(
                "INSERT INTO tool_execution_audit (request_id, conversation_id, tool_name, side_effect,"
                " arguments, outcome, detail, duration_ms, created_at) VALUES (?,?,?,?,?,?,?,?,?)",
                (request_id, conversation_id, tool_name, side_effect,
                 json.dumps(arguments, ensure_ascii=False), outcome, (detail or "")[:500], duration_ms,
                 iso(utcnow())),
            )

    def list_audit(self, limit: int = 50) -> list[dict[str, Any]]:
        with self.db.tx() as c:
            rows = c.execute(
                "SELECT * FROM tool_execution_audit ORDER BY id DESC LIMIT ?", (limit,)
            ).fetchall()
        return [_row(r) for r in rows]


def _task(row: Any) -> dict[str, Any]:
    d = _row(row)
    d["due_all_day"] = bool(d.get("due_all_day"))
    return d
