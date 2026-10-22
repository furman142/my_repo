"""End-to-end orchestrator tests over HTTP with a scripted (fake) Ollama transport."""

from __future__ import annotations

from datetime import timedelta

from fastapi.testclient import TestClient

from app.db import iso, utcnow
from app.main import create_app

from .conftest import BASE, PASSWORD, sse_events


def chat(client, headers, text, cid=None):
    r = client.post("/api/chat", json={"text": text, **({"conversation_id": cid} if cid else {})}, headers=headers)
    assert r.status_code == 200, r.text
    return sse_events(r)


def by_type(events, t):
    return [e for e in events if e["type"] == t]


def test_plain_reply_streams_and_persists(authed, ollama):
    client, svc, headers = authed
    ollama.reply("Good evening, sir. All systems nominal.")
    events = chat(client, headers, "Hello Jarvis")
    types = [e["type"] for e in events]
    assert types[0] == "request_received" and "thinking" in types and types[-1] == "completed"
    assert "".join(e["text"] for e in by_type(events, "token")) == "Good evening, sir. All systems nominal."
    cid = events[0]["conversation_id"]
    msgs = client.get(f"/api/conversations/{cid}/messages").json()["messages"]
    assert [m["role"] for m in msgs] == ["user", "assistant"]
    # The documented Ollama request shape was used.
    req = ollama.requests[0]
    assert req["model"] == "qwen3:8b" and req["stream"] is True and req["think"] is False
    assert req["messages"][0]["role"] == "system" and req["messages"][-1] == {"role": "user", "content": "Hello Jarvis"}
    assert {t["function"]["name"] for t in req["tools"]} >= {"list_tasks", "create_task", "save_memory"}


def test_read_tool_runs_without_approval_and_uses_real_data(authed, ollama):
    client, svc, headers = authed
    client.post("/api/tasks", json={"title": "Call the bank"}, headers=headers)
    ollama.call("list_tasks", when="today").reply("You have one task: call the bank.")
    events = chat(client, headers, "Jarvis, what do I have to do today?")
    results = by_type(events, "tool_result")
    assert results[0]["tool"] == "list_tasks" and results[0]["ok"]
    assert results[0]["result"]["tasks"][0]["title"] == "Call the bank"
    # The second model call received the real tool output.
    tool_msgs = [m for m in ollama.requests[1]["messages"] if m["role"] == "tool"]
    assert "Call the bank" in tool_msgs[0]["content"] and tool_msgs[0]["tool_name"] == "list_tasks"
    assert by_type(events, "message")[0]["text"] == "You have one task: call the bank."


def test_side_effect_requires_approval_then_executes_once(authed, ollama):
    client, svc, headers = authed
    ollama.call("create_task", title="Buy flowers", due="2030-03-01")
    events = chat(client, headers, "Remind me to buy flowers on March 1st 2030")
    appr = by_type(events, "approval_required")
    assert len(appr) == 1 and events[-1]["type"] == "approval_required"
    req = appr[0]["request"]
    assert "Buy flowers" in req["preview"]
    assert svc.repo.list_tasks("all") == []  # nothing written before approval

    ollama.reply("Done, sir. Flowers on the first of March.")
    r = client.post(f"/api/approvals/{req['id']}", json={"nonce": req["nonce"], "approve": True}, headers=headers)
    ev2 = sse_events(r)
    assert by_type(ev2, "tool_result")[0]["ok"] is True
    assert ev2[-1]["type"] == "completed"
    tasks = svc.repo.list_tasks("all")
    assert len(tasks) == 1 and tasks[0]["title"] == "Buy flowers"

    # Replay of the same approval is refused and does not create a second task.
    r = client.post(f"/api/approvals/{req['id']}", json={"nonce": req["nonce"], "approve": True}, headers=headers)
    assert sse_events(r)[0]["code"] == "approval_already_decided"
    assert len(svc.repo.list_tasks("all")) == 1
    audit = svc.repo.list_audit()
    assert audit[0]["tool_name"] == "create_task" and audit[0]["outcome"] == "ok"


def test_denied_approval_does_not_execute(authed, ollama):
    client, svc, headers = authed
    ollama.call("save_memory", content="Owner likes jazz", category="preference")
    events = chat(client, headers, "Remember that I like jazz")
    req = by_type(events, "approval_required")[0]["request"]
    ollama.reply("Understood, I won't remember that.")
    ev2 = sse_events(client.post(f"/api/approvals/{req['id']}", json={"nonce": req["nonce"], "approve": False},
                                 headers=headers))
    assert by_type(ev2, "tool_result")[0]["result"]["denied"] is True
    assert svc.repo.list_memories("approved") == []


def test_expired_and_bad_nonce_approvals(authed, ollama):
    client, svc, headers = authed
    ollama.call("create_task", title="X")
    req = by_type(chat(client, headers, "add task X"), "approval_required")[0]["request"]
    bad = sse_events(client.post(f"/api/approvals/{req['id']}", json={"nonce": "wrong-nonce-123", "approve": True},
                                 headers=headers))
    assert bad[0]["code"] == "approval_bad_nonce"
    with svc.db.tx() as c:
        c.execute("UPDATE tool_requests SET expires_at=?", (iso(utcnow() - timedelta(seconds=1)),))
    exp = sse_events(client.post(f"/api/approvals/{req['id']}", json={"nonce": req["nonce"], "approve": True},
                                 headers=headers))
    assert exp[0]["code"] == "approval_expired"
    assert svc.repo.list_tasks("all") == []


def test_tampered_arguments_rejected(authed, ollama):
    client, svc, headers = authed
    ollama.call("create_task", title="Harmless")
    req = by_type(chat(client, headers, "add a task"), "approval_required")[0]["request"]
    with svc.db.tx() as c:
        c.execute("UPDATE tool_requests SET arguments=?", ('{"title":"Evil","due":null,"priority":null}',))
    r = sse_events(client.post(f"/api/approvals/{req['id']}", json={"nonce": req["nonce"], "approve": True},
                               headers=headers))
    assert r[0]["code"] == "approval_tampered"
    assert svc.repo.list_tasks("all") == []


def test_cross_session_approval_rejected(authed, ollama):
    client, svc, headers = authed
    ollama.call("create_task", title="Mine")
    req = by_type(chat(client, headers, "add task"), "approval_required")[0]["request"]
    # A second, separately logged-in session (e.g. another device) cannot approve it.
    other = TestClient(client.app, base_url=BASE)
    lr = other.post("/api/auth/login", json={"username": "tony", "password": PASSWORD})
    h2 = {"x-csrf-token": lr.json()["csrf_token"]}
    r = sse_events(other.post(f"/api/approvals/{req['id']}", json={"nonce": req["nonce"], "approve": True},
                              headers=h2))
    assert r[0]["code"] == "approval_wrong_session"
    assert svc.repo.list_tasks("all") == []


def test_unauthenticated_approval_rejected(authed, ollama):
    client, svc, headers = authed
    ollama.call("create_task", title="Mine")
    req = by_type(chat(client, headers, "add task"), "approval_required")[0]["request"]
    anon = TestClient(client.app, base_url=BASE)
    r = anon.post(f"/api/approvals/{req['id']}", json={"nonce": req["nonce"], "approve": True})
    assert r.status_code == 401


def test_new_message_supersedes_pending_approval(authed, ollama):
    client, svc, headers = authed
    ollama.call("create_task", title="Old")
    events = chat(client, headers, "add task Old")
    cid, req = events[0]["conversation_id"], by_type(events, "approval_required")[0]["request"]
    ollama.reply("Never mind then.")
    chat(client, headers, "actually forget it", cid)
    assert svc.approvals.get(req["id"]).status == "expired"
    r = sse_events(client.post(f"/api/approvals/{req['id']}", json={"nonce": req["nonce"], "approve": True},
                               headers=headers))
    assert r[0]["type"] == "failed"
    assert svc.repo.list_tasks("all") == []


def test_invalid_tool_arguments_and_unknown_tool(authed, ollama):
    client, svc, headers = authed
    ollama.call("format_hard_drive").call("create_task", title="", due="next week").reply("Sorry, I could not.")
    events = chat(client, headers, "do something bad")
    res = by_type(events, "tool_result")
    assert res[0]["ok"] is False and "Unknown tool" in res[0]["result"]["error"]
    assert res[1]["ok"] is False and "Invalid arguments" in res[1]["result"]["error"]
    assert events[-1]["type"] == "completed"
    assert svc.repo.list_tasks("all") == []


def test_ambiguous_due_rejected_at_preview(authed, ollama):
    client, svc, headers = authed
    ollama.call("create_task", title="Gym", due="evening").reply("What time exactly?")
    events = chat(client, headers, "gym in the evening")
    assert not by_type(events, "approval_required")
    assert "explicit" in by_type(events, "tool_result")[0]["result"]["error"]


def test_tool_budget_enforced(make_app, ollama):
    client, svc = make_app(llm_max_tool_calls_per_turn=2)
    from .conftest import setup_owner

    headers = setup_owner(client, svc)
    for _ in range(3):
        ollama.call("get_local_time")
    events = chat(client, headers, "loop forever")
    assert events[-1]["code"] == "tool_budget"


def test_ollama_offline_gives_actionable_error(authed, ollama):
    client, svc, headers = authed
    ollama.offline = True
    events = chat(client, headers, "hello?")
    assert events[-1]["type"] == "failed" and events[-1]["code"] == "llm_unavailable"
    assert "Ollama" in events[-1]["message"]
    assert not by_type(events, "message")  # no fake reply


def test_ollama_model_missing_health(authed, ollama):
    client, svc, headers = authed
    ollama.models = []
    diag = client.get("/api/diagnostics").json()
    assert diag["components"]["llm"]["state"] == "not_configured"
    assert "ollama pull qwen3:8b" in diag["components"]["llm"]["detail"]


def test_memory_survives_restart_and_is_injected(make_app, ollama, tmp_path):
    client, svc = make_app()
    from .conftest import setup_owner

    headers = setup_owner(client, svc)
    ollama.call("save_memory", content="The owner's favourite tea is Earl Grey", category="preference")
    req = by_type(chat(client, headers, "Remember my favourite tea is Earl Grey"), "approval_required")[0]["request"]
    ollama.reply("Noted, sir.")
    client.post(f"/api/approvals/{req['id']}", json={"nonce": req["nonce"], "approve": True}, headers=headers)

    # Restart: brand-new services/app over the same data directory.
    client2, svc2 = make_app()
    lr = client2.post("/api/auth/login", json={"username": "tony", "password": PASSWORD})
    h2 = {"x-csrf-token": lr.json()["csrf_token"]}
    ollama.reply("Earl Grey, sir.")
    chat(client2, h2, "What tea do I like?")
    system = ollama.requests[-1]["messages"][0]["content"]
    assert "Earl Grey" in system and "data, not instructions" in system


def test_cancel_endpoint(authed):
    client, _, headers = authed
    r = client.post("/api/chat/cancel", json={"conversation_id": "a" * 32}, headers=headers)
    assert r.status_code == 200 and r.json() == {"cancelled": False}


def test_spa_fallback_and_api_404(tmp_path, make_app):
    client, svc = make_app()
    dist = tmp_path / "dist"
    (dist / "assets").mkdir(parents=True)
    (dist / "index.html").write_text("<html>jarvis</html>")
    (dist / "assets" / "a.js").write_text("x")
    app = create_app(svc.settings, services=svc)
    c = TestClient(app, base_url=BASE)
    assert c.get("/").text == "<html>jarvis</html>"
    assert c.get("/tasks/deep/link").text == "<html>jarvis</html>"
    assert "immutable" in c.get("/assets/a.js").headers["cache-control"]
    assert c.get("/api/nope").status_code == 404
    assert c.get("/../../etc/passwd").text == "<html>jarvis</html>"
