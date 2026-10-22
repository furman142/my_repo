"""Single-owner authentication: Argon2id passwords, server-side sessions, CSRF tokens.

Setup is gated by a one-time setup code printed to the server console, so nobody else on the
tailnet can claim the instance before the owner does.
"""

from __future__ import annotations

import hashlib
import hmac
import logging
import secrets
import time
from collections import defaultdict, deque
from dataclasses import dataclass
from datetime import datetime, timedelta
from pathlib import Path

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError, VerifyMismatchError

from ..db import Database, iso, utcnow

log = logging.getLogger("jarvis.auth")

SESSION_COOKIE = "jarvis_session"
CSRF_HEADER = "x-csrf-token"

_hasher = PasswordHasher()  # argon2id, library defaults (RFC 9106 low-memory profile)


def _sha256(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


@dataclass(frozen=True)
class SessionInfo:
    session_id: str  # hashed id (never the raw cookie)
    user_id: int
    username: str
    csrf_token: str
    expires_at: datetime


class AuthService:
    def __init__(self, db: Database, data_dir: Path, session_ttl_hours: int):
        self.db = db
        self.data_dir = data_dir
        self.ttl = timedelta(hours=session_ttl_hours)
        self._setup_code: str | None = None

    # ------------------------------------------------------------------ setup
    def owner_exists(self) -> bool:
        with self.db.tx() as c:
            return c.execute("SELECT 1 FROM users LIMIT 1").fetchone() is not None

    def ensure_setup_code(self) -> str | None:
        """Generate (once per process) a setup code when no owner exists yet."""
        if self.owner_exists():
            return None
        if self._setup_code is None:
            self._setup_code = "-".join(secrets.token_hex(2).upper() for _ in range(3))
            self.data_dir.mkdir(parents=True, exist_ok=True)
            path = self.data_dir / "setup-code.txt"
            path.write_text(self._setup_code + "\n", encoding="utf-8")
            log.warning("JARVIS first-run setup code: %s (also written to %s)", self._setup_code, path)
        return self._setup_code

    def create_owner(self, username: str, password: str, setup_code: str) -> int:
        expected = self.ensure_setup_code()
        if expected is None:
            raise PermissionError("Owner already exists")
        if not hmac.compare_digest(setup_code.strip().upper(), expected):
            raise PermissionError("Invalid setup code")
        validate_password(password)
        with self.db.tx() as c:
            if c.execute("SELECT 1 FROM users LIMIT 1").fetchone() is not None:
                raise PermissionError("Owner already exists")
            cur = c.execute(
                "INSERT INTO users (username, password_hash, created_at) VALUES (?,?,?)",
                (username, _hasher.hash(password), iso(utcnow())),
            )
        self._setup_code = None
        try:
            (self.data_dir / "setup-code.txt").unlink(missing_ok=True)
        except OSError:
            pass
        return int(cur.lastrowid or 0)

    # ------------------------------------------------------------------ login / sessions
    def verify_credentials(self, username: str, password: str) -> int | None:
        with self.db.tx() as c:
            row = c.execute("SELECT id, password_hash FROM users WHERE username=?", (username,)).fetchone()
        if row is None:
            # Equalise timing for unknown users.
            try:
                _hasher.verify(_DUMMY_HASH, password)
            except (VerificationError, InvalidHashError):
                pass
            return None
        try:
            _hasher.verify(row["password_hash"], password)
        except (VerifyMismatchError, VerificationError, InvalidHashError):
            return None
        if _hasher.check_needs_rehash(row["password_hash"]):
            with self.db.tx() as c:
                c.execute("UPDATE users SET password_hash=? WHERE id=?", (_hasher.hash(password), row["id"]))
        return int(row["id"])

    def create_session(self, user_id: int, user_agent: str | None) -> tuple[str, SessionInfo]:
        token = secrets.token_urlsafe(32)
        csrf = secrets.token_urlsafe(24)
        now = utcnow()
        sid = _sha256(token)
        with self.db.tx() as c:
            c.execute(
                "INSERT INTO sessions (id, user_id, csrf_token, created_at, expires_at, last_seen_at, user_agent)"
                " VALUES (?,?,?,?,?,?,?)",
                (sid, user_id, csrf, iso(now), iso(now + self.ttl), iso(now), (user_agent or "")[:200]),
            )
            username = c.execute("SELECT username FROM users WHERE id=?", (user_id,)).fetchone()["username"]
        return token, SessionInfo(sid, user_id, username, csrf, now + self.ttl)

    def resolve(self, token: str | None) -> SessionInfo | None:
        if not token or len(token) > 128:
            return None
        sid = _sha256(token)
        with self.db.tx() as c:
            row = c.execute(
                "SELECT s.id, s.user_id, s.csrf_token, s.expires_at, s.revoked, u.username"
                " FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id=?",
                (sid,),
            ).fetchone()
            if row is None or row["revoked"]:
                return None
            expires = datetime.fromisoformat(row["expires_at"])
            if expires <= utcnow():
                return None
            c.execute("UPDATE sessions SET last_seen_at=? WHERE id=?", (iso(utcnow()), sid))
        return SessionInfo(row["id"], row["user_id"], row["username"], row["csrf_token"], expires)

    def revoke(self, session_id: str) -> None:
        with self.db.tx() as c:
            c.execute("UPDATE sessions SET revoked=1 WHERE id=?", (session_id,))

    def revoke_all(self, user_id: int) -> None:
        with self.db.tx() as c:
            c.execute("UPDATE sessions SET revoked=1 WHERE user_id=?", (user_id,))

    def change_password(self, user_id: int, old: str, new: str) -> bool:
        with self.db.tx() as c:
            row = c.execute("SELECT username FROM users WHERE id=?", (user_id,)).fetchone()
        if row is None or self.verify_credentials(row["username"], old) is None:
            return False
        validate_password(new)
        with self.db.tx() as c:
            c.execute("UPDATE users SET password_hash=? WHERE id=?", (_hasher.hash(new), user_id))
        self.revoke_all(user_id)
        return True


def validate_password(password: str) -> None:
    if len(password) < 10:
        raise ValueError("Password must be at least 10 characters")
    if len(password) > 256:
        raise ValueError("Password too long")


_DUMMY_HASH = _hasher.hash("jarvis-timing-equaliser")


class RateLimiter:
    """In-memory sliding-window limiter (single process, single user — sufficient here)."""

    def __init__(self, limit: int, window_seconds: float):
        self.limit = limit
        self.window = window_seconds
        self._hits: dict[str, deque[float]] = defaultdict(deque)

    def allow(self, key: str) -> bool:
        now = time.monotonic()
        q = self._hits[key]
        while q and now - q[0] > self.window:
            q.popleft()
        if len(q) >= self.limit:
            return False
        q.append(now)
        return True

    def reset(self) -> None:
        self._hits.clear()
