"""SQLite access with versioned, forward-only migrations."""

from __future__ import annotations

import logging
import sqlite3
import threading
from collections.abc import Iterator
from contextlib import contextmanager
from datetime import UTC, datetime
from pathlib import Path

log = logging.getLogger("jarvis.db")

MIGRATIONS: list[str] = [
    # 1 — initial schema
    """
    CREATE TABLE users (
        id INTEGER PRIMARY KEY,
        username TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        created_at TEXT NOT NULL
    );
    CREATE TABLE sessions (
        id TEXT PRIMARY KEY,               -- sha256 of the cookie token
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        csrf_token TEXT NOT NULL,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL,
        user_agent TEXT,
        revoked INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE conversations (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
    );
    CREATE TABLE messages (
        id INTEGER PRIMARY KEY,
        conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        role TEXT NOT NULL CHECK (role IN ('user','assistant','tool','system')),
        content TEXT NOT NULL DEFAULT '',
        tool_calls TEXT,                   -- JSON list as sent to the LLM
        tool_name TEXT,
        created_at TEXT NOT NULL
    );
    CREATE INDEX idx_messages_conv ON messages(conversation_id, id);
    CREATE TABLE assistant_events (
        id INTEGER PRIMARY KEY,
        conversation_id TEXT REFERENCES conversations(id) ON DELETE CASCADE,
        type TEXT NOT NULL,
        data TEXT,
        created_at TEXT NOT NULL
    );
    CREATE TABLE tasks (
        id INTEGER PRIMARY KEY,
        title TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','done')),
        priority TEXT CHECK (priority IN ('low','normal','high')),
        due_at TEXT,                       -- ISO-8601 with offset, or NULL
        due_all_day INTEGER NOT NULL DEFAULT 0,
        timezone TEXT NOT NULL,
        created_at TEXT NOT NULL,
        completed_at TEXT
    );
    CREATE TABLE memories (
        id INTEGER PRIMARY KEY,
        content TEXT NOT NULL,
        category TEXT NOT NULL DEFAULT 'general',
        source TEXT NOT NULL,              -- 'user_ui' | 'assistant_approved' | 'assistant_proposed'
        consent_state TEXT NOT NULL CHECK (consent_state IN ('proposed','approved','rejected')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        deleted_at TEXT
    );
    CREATE VIRTUAL TABLE memories_fts USING fts5(content, category, content='memories', content_rowid='id',
        tokenize = 'trigram');  -- substring matching: handles Hebrew prefixes (ה/ו/ב/ל...) and inflections
    CREATE TRIGGER memories_ai AFTER INSERT ON memories BEGIN
        INSERT INTO memories_fts(rowid, content, category) VALUES (new.id, new.content, new.category);
    END;
    CREATE TRIGGER memories_ad AFTER DELETE ON memories BEGIN
        INSERT INTO memories_fts(memories_fts, rowid, content, category)
        VALUES ('delete', old.id, old.content, old.category);
    END;
    CREATE TRIGGER memories_au AFTER UPDATE ON memories BEGIN
        INSERT INTO memories_fts(memories_fts, rowid, content, category)
        VALUES ('delete', old.id, old.content, old.category);
        INSERT INTO memories_fts(rowid, content, category) VALUES (new.id, new.content, new.category);
    END;
    CREATE TABLE tool_requests (
        id TEXT PRIMARY KEY,
        conversation_id TEXT REFERENCES conversations(id) ON DELETE CASCADE,
        session_id TEXT NOT NULL,
        tool_name TEXT NOT NULL,
        arguments TEXT NOT NULL,           -- validated JSON
        args_hash TEXT NOT NULL,           -- HMAC(tool_name + canonical args + nonce)
        nonce TEXT NOT NULL,
        preview TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('pending','approved','denied','expired','executed','failed')),
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        result TEXT
    );
    CREATE TABLE tool_approvals (
        id INTEGER PRIMARY KEY,
        request_id TEXT NOT NULL REFERENCES tool_requests(id) ON DELETE CASCADE,
        session_id TEXT NOT NULL,
        decision TEXT NOT NULL CHECK (decision IN ('approve','deny')),
        decided_at TEXT NOT NULL
    );
    CREATE TABLE tool_execution_audit (
        id INTEGER PRIMARY KEY,
        request_id TEXT,
        conversation_id TEXT,
        tool_name TEXT NOT NULL,
        side_effect TEXT NOT NULL,
        arguments TEXT NOT NULL,
        outcome TEXT NOT NULL CHECK (outcome IN ('ok','error','rejected')),
        detail TEXT,
        duration_ms INTEGER,
        created_at TEXT NOT NULL
    );
    CREATE TABLE settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL
    );
    """,
]


def utcnow() -> datetime:
    return datetime.now(UTC)


def iso(dt: datetime) -> str:
    return dt.isoformat(timespec="seconds")


class Database:
    """Thread-safe-ish SQLite wrapper: one connection per call, WAL mode, FK enforcement."""

    def __init__(self, path: Path | str):
        self.path = str(path)
        self._lock = threading.Lock()
        if self.path != ":memory:":
            Path(self.path).parent.mkdir(parents=True, exist_ok=True)
        self._memory_conn: sqlite3.Connection | None = None

    def _connect(self) -> sqlite3.Connection:
        if self.path == ":memory:":
            if self._memory_conn is None:
                self._memory_conn = sqlite3.connect(":memory:", check_same_thread=False)
                self._memory_conn.row_factory = sqlite3.Row
                self._memory_conn.execute("PRAGMA foreign_keys = ON")
            return self._memory_conn
        conn = sqlite3.connect(self.path, timeout=10, check_same_thread=False)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys = ON")
        conn.execute("PRAGMA journal_mode = WAL")
        conn.execute("PRAGMA busy_timeout = 5000")
        return conn

    @contextmanager
    def tx(self) -> Iterator[sqlite3.Connection]:
        """Run statements in a single transaction; commits on success, rolls back on error."""
        with self._lock:
            conn = self._connect()
            try:
                conn.execute("BEGIN")
                yield conn
                conn.execute("COMMIT")
            except BaseException:
                conn.execute("ROLLBACK")
                raise
            finally:
                if self.path != ":memory:":
                    conn.close()

    def migrate(self) -> int:
        with self._lock:
            conn = self._connect()
            try:
                version = conn.execute("PRAGMA user_version").fetchone()[0]
                for idx, script in enumerate(MIGRATIONS[version:], start=version + 1):
                    log.info("Applying database migration %d", idx)
                    conn.executescript(f"BEGIN;\n{script}\nPRAGMA user_version = {idx};\nCOMMIT;")
                return int(conn.execute("PRAGMA user_version").fetchone()[0])
            finally:
                if self.path != ":memory:":
                    conn.close()
