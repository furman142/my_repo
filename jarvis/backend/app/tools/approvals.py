"""Server-side approval service. The model can request; only the authenticated owner can grant.

Each request is bound to: the session that created it, the exact tool name, the canonical validated
arguments and a random nonce (HMAC'd with the server secret), and a short expiry. A decision is
accepted exactly once (atomic `pending -> approved/denied` transition), so replays fail.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import secrets
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any

from ..db import Database, iso, utcnow


class ApprovalError(Exception):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


@dataclass
class ApprovalRequest:
    id: str
    conversation_id: str | None
    session_id: str
    tool_name: str
    arguments: dict[str, Any]
    nonce: str
    preview: str
    status: str
    expires_at: datetime
    result: dict[str, Any] | None = None

    def public(self) -> dict[str, Any]:
        return {
            "id": self.id, "tool_name": self.tool_name, "arguments": self.arguments, "nonce": self.nonce,
            "preview": self.preview, "status": self.status, "expires_at": iso(self.expires_at),
            "conversation_id": self.conversation_id,
        }


def canonical(args: dict[str, Any]) -> str:
    return json.dumps(args, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


class ApprovalService:
    def __init__(self, db: Database, secret: bytes, ttl_seconds: int = 180):
        self.db = db
        self.secret = secret
        self.ttl = timedelta(seconds=ttl_seconds)

    def _hash(self, session_id: str, tool: str, args: dict[str, Any], nonce: str) -> str:
        msg = f"{session_id}\n{tool}\n{canonical(args)}\n{nonce}".encode()
        return hmac.new(self.secret, msg, hashlib.sha256).hexdigest()

    def create(self, *, session_id: str, conversation_id: str | None, tool_name: str,
               arguments: dict[str, Any], preview: str) -> ApprovalRequest:
        rid = uuid.uuid4().hex
        nonce = secrets.token_urlsafe(16)
        now = utcnow()
        req = ApprovalRequest(rid, conversation_id, session_id, tool_name, arguments, nonce, preview,
                              "pending", now + self.ttl)
        with self.db.tx() as c:
            c.execute(
                "INSERT INTO tool_requests (id, conversation_id, session_id, tool_name, arguments, args_hash,"
                " nonce, preview, status, created_at, expires_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
                (rid, conversation_id, session_id, tool_name, canonical(arguments),
                 self._hash(session_id, tool_name, arguments, nonce), nonce, preview, "pending",
                 iso(now), iso(req.expires_at)),
            )
        return req

    def get(self, request_id: str) -> ApprovalRequest | None:
        with self.db.tx() as c:
            r = c.execute("SELECT * FROM tool_requests WHERE id=?", (request_id,)).fetchone()
        if r is None:
            return None
        return ApprovalRequest(r["id"], r["conversation_id"], r["session_id"], r["tool_name"],
                               json.loads(r["arguments"]), r["nonce"], r["preview"], r["status"],
                               datetime.fromisoformat(r["expires_at"]),
                               json.loads(r["result"]) if r["result"] else None)

    def pending_for_session(self, session_id: str) -> list[ApprovalRequest]:
        with self.db.tx() as c:
            ids = [r["id"] for r in c.execute(
                "SELECT id FROM tool_requests WHERE session_id=? AND status='pending' AND expires_at > ?"
                " ORDER BY created_at", (session_id, iso(utcnow()))).fetchall()]
        return [r for i in ids if (r := self.get(i)) is not None]

    def decide(self, *, request_id: str, session_id: str, nonce: str, approve: bool) -> ApprovalRequest:
        """Validate and atomically record a decision. Raises ApprovalError on any violation."""
        with self.db.tx() as c:
            r = c.execute("SELECT * FROM tool_requests WHERE id=?", (request_id,)).fetchone()
            if r is None:
                raise ApprovalError("not_found", "Approval request not found")
            if not hmac.compare_digest(r["session_id"], session_id):
                raise ApprovalError("wrong_session", "This approval belongs to a different session")
            if not hmac.compare_digest(r["nonce"], nonce):
                raise ApprovalError("bad_nonce", "Approval nonce mismatch")
            args = json.loads(r["arguments"])
            if not hmac.compare_digest(r["args_hash"], self._hash(session_id, r["tool_name"], args, nonce)):
                raise ApprovalError("tampered", "Approval request integrity check failed")
            if r["status"] != "pending":
                raise ApprovalError("already_decided", f"Approval already {r['status']}")
            if datetime.fromisoformat(r["expires_at"]) <= utcnow():
                c.execute("UPDATE tool_requests SET status='expired' WHERE id=? AND status='pending'",
                          (request_id,))
                raise ApprovalError("expired", "Approval request expired")
            new_status = "approved" if approve else "denied"
            n = c.execute("UPDATE tool_requests SET status=? WHERE id=? AND status='pending'",
                          (new_status, request_id)).rowcount
            if n != 1:
                raise ApprovalError("already_decided", "Approval already decided")
            c.execute("INSERT INTO tool_approvals (request_id, session_id, decision, decided_at) VALUES (?,?,?,?)",
                      (request_id, session_id, "approve" if approve else "deny", iso(utcnow())))
        req = self.get(request_id)
        assert req is not None
        return req

    def mark_executed(self, request_id: str, ok: bool, result: dict[str, Any]) -> None:
        with self.db.tx() as c:
            c.execute("UPDATE tool_requests SET status=?, result=? WHERE id=? AND status='approved'",
                      ("executed" if ok else "failed", json.dumps(result, ensure_ascii=False), request_id))

    def expire_stale(self) -> int:
        with self.db.tx() as c:
            return c.execute("UPDATE tool_requests SET status='expired' WHERE status='pending' AND expires_at <= ?",
                             (iso(utcnow()),)).rowcount
