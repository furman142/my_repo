from __future__ import annotations

from datetime import datetime

import pytest

from app.db import Database
from app.memory.repository import Repository
from app.tools.builtin import parse_due, validate_public_url
from app.tools.registry import ToolError


def test_migrations_and_persistence_across_restart(tmp_path):
    path = tmp_path / "j.sqlite3"
    db = Database(path)
    assert db.migrate() == 1
    repo = Repository(db)
    t = repo.create_task("Buy milk", "Asia/Jerusalem")
    m = repo.add_memory("Owner prefers Earl Grey tea", "preference", "user_ui", "approved")
    cid = repo.create_conversation()
    repo.add_message(cid, "user", "hello")

    db2 = Database(path)  # "restart"
    assert db2.migrate() == 1
    repo2 = Repository(db2)
    assert repo2.get_task(t["id"])["title"] == "Buy milk"
    assert repo2.get_memory(m["id"])["content"] == "Owner prefers Earl Grey tea"
    assert repo2.get_messages(cid)[0]["content"] == "hello"


def test_task_lifecycle(tmp_path):
    repo = Repository(Database(tmp_path / "t.db"))
    repo.db.migrate()
    due, all_day = parse_due("2030-05-01T09:30", "Asia/Jerusalem")
    t = repo.create_task("Dentist", "Asia/Jerusalem", due, all_day, "high")
    assert t["due_at"] == "2030-05-01T09:30:00+03:00"
    assert [x["id"] for x in repo.list_tasks("open")] == [t["id"]]
    assert repo.complete_task(t["id"])["status"] == "done"
    assert repo.list_tasks("open") == []
    assert repo.complete_task(9999) is None
    assert repo.delete_task(t["id"]) and repo.get_task(t["id"]) is None


def test_memory_search_and_hard_delete(tmp_path):
    repo = Repository(Database(tmp_path / "m.db"))
    repo.db.migrate()
    a = repo.add_memory("The owner's sister is called Noa", "person", "user_ui", "approved")
    repo.add_memory("השם של הכלב הוא רקס", "general", "user_ui", "approved")
    repo.add_memory("Proposed thing about sister", "general", "assistant_proposed", "proposed")
    hits = repo.search_memories("what is my sister's name")
    assert [h["id"] for h in hits] == [a["id"]]  # proposals are never retrieved
    assert repo.search_memories("כלב")[0]["content"].startswith("השם")
    assert repo.search_memories('") OR 1=1 --') == []  # no FTS syntax error raised
    assert repo.delete_memory(a["id"])
    assert repo.search_memories("sister") == []
    with repo.db.tx() as c:
        assert c.execute("SELECT COUNT(*) FROM memories WHERE content LIKE '%Noa%'").fetchone()[0] == 0


def test_fts_query_injection_is_safe(tmp_path):
    repo = Repository(Database(tmp_path / "f.db"))
    repo.db.migrate()
    repo.add_memory("alpha beta", "general", "user_ui", "approved")
    for q in ['"', "NEAR(", "alpha AND", "*", "a:b", "(((", "-alpha"]:
        repo.search_memories(q)  # must not raise


@pytest.mark.parametrize("value", ["tomorrow", "5pm", "2030-13-01", "2030-02-30", "2030-01-01 10:00", "evening"])
def test_parse_due_rejects_vague_or_invalid(value):
    with pytest.raises(ToolError):
        parse_due(value, "Asia/Jerusalem")


def test_parse_due_all_day_uses_timezone():
    due, all_day = parse_due("2030-01-15", "America/New_York")
    assert all_day is True
    assert due == datetime.fromisoformat("2030-01-15T23:59:00-05:00")
    assert parse_due(None, "UTC") == (None, False)


@pytest.mark.parametrize("url", [
    "javascript:alert(1)", "file:///C:/Windows/win.ini", "data:text/html,hi", "http://127.0.0.1:11434/api/tags",
    "http://localhost:8787", "http://192.168.1.1/", "https://user:pass@example.com", "https://exa mple.com",
    "ftp://example.com", "http://[::1]/", "http://printer.local/",
])
def test_open_url_rejects_unsafe(url):
    with pytest.raises(ValueError):
        validate_public_url(url)


def test_open_url_accepts_public():
    assert validate_public_url("https://www.example.com/path?q=1") == "https://www.example.com/path?q=1"
