from __future__ import annotations

from datetime import timedelta

from app.db import iso, utcnow

from .conftest import BASE, PASSWORD, setup_owner


def test_health_reports_states_without_secrets(make_app):
    client, _ = make_app(fish_api_key="sk-super-secret-value", fish_reference_id="b" * 32)
    r = client.get("/api/health")
    assert r.status_code == 200
    body = r.json()
    assert body["setup_required"] is True
    assert set(body["components"]) == {"llm", "stt", "tts", "database"}
    for comp in body["components"].values():
        assert comp["state"] in ("ready", "not_configured", "unavailable")
    assert "sk-super-secret-value" not in r.text
    assert "b" * 32 not in r.text


def test_security_headers(make_app):
    client, _ = make_app()
    r = client.get("/api/health")
    assert "default-src 'self'" in r.headers["content-security-policy"]
    assert r.headers["x-frame-options"] == "DENY"
    assert r.headers["cache-control"] == "no-store"


def test_setup_requires_valid_code_and_runs_once(make_app):
    client, svc = make_app()
    bad = client.post("/api/auth/setup", json={"username": "tony", "password": PASSWORD, "setup_code": "0000-0000"})
    assert bad.status_code == 403
    setup_owner(client, svc)
    again = client.post("/api/auth/setup", json={"username": "xavier", "password": PASSWORD, "setup_code": "AAAA-BBBB"})
    assert again.status_code == 403


def test_weak_password_rejected(make_app):
    client, svc = make_app()
    code = svc.auth.ensure_setup_code()
    r = client.post("/api/auth/setup", json={"username": "tony", "password": "short", "setup_code": code})
    assert r.status_code == 422


def test_private_endpoints_require_auth(make_app):
    client, _ = make_app()
    for path in ("/api/tasks", "/api/memories", "/api/diagnostics", "/api/settings", "/api/conversations"):
        assert client.get(path).status_code == 401, path
    assert client.post("/api/chat", json={"text": "hi"}).status_code == 401


def test_csrf_required_for_writes(authed):
    client, _, headers = authed
    assert client.post("/api/tasks", json={"title": "x"}).status_code == 403
    assert client.post("/api/tasks", json={"title": "x"}, headers={"x-csrf-token": "wrong"}).status_code == 403
    assert client.post("/api/tasks", json={"title": "x"}, headers=headers).status_code == 200


def test_cross_origin_rejected(authed):
    client, _, headers = authed
    r = client.post("/api/tasks", json={"title": "x"}, headers={**headers, "origin": "https://evil.example"})
    assert r.status_code == 403
    r = client.post("/api/tasks", json={"title": "x"}, headers={**headers, "sec-fetch-site": "cross-site"})
    assert r.status_code == 403
    ok = client.post("/api/tasks", json={"title": "x"}, headers={**headers, "origin": BASE})
    assert ok.status_code == 200


def test_unknown_host_rejected(make_app):
    client, _ = make_app()
    assert client.get("/api/health", headers={"host": "attacker.example"}).status_code == 421


def test_tailnet_host_allowed_when_configured(make_app):
    client, _ = make_app(app_allowed_hosts="jarvis-pc.tail1234.ts.net")
    assert client.get("/api/health", headers={"host": "jarvis-pc.tail1234.ts.net"}).status_code == 200


def test_logout_invalidates_session_server_side(authed):
    client, _, headers = authed
    cookie = client.cookies.get("jarvis_session")
    assert client.post("/api/auth/logout", headers=headers).status_code == 200
    client.cookies.set("jarvis_session", cookie)
    assert client.get("/api/tasks").status_code == 401


def test_expired_session_rejected(authed):
    client, svc, _ = authed
    with svc.db.tx() as c:
        c.execute("UPDATE sessions SET expires_at=?", (iso(utcnow() - timedelta(seconds=1)),))
    assert client.get("/api/tasks").status_code == 401


def test_login_and_rate_limit(make_app):
    client, svc = make_app()
    setup_owner(client, svc)
    client.cookies.clear()
    svc.login_limiter.reset()
    assert client.post("/api/auth/login", json={"username": "tony", "password": "wrong-password"}).status_code == 401
    ok = client.post("/api/auth/login", json={"username": "tony", "password": PASSWORD})
    assert ok.status_code == 200 and ok.json()["csrf_token"]
    cookie_header = ok.headers["set-cookie"].lower()
    assert "httponly" in cookie_header and "samesite=strict" in cookie_header
    codes = [client.post("/api/auth/login", json={"username": "tony", "password": "nope-nope"}).status_code
             for _ in range(10)]
    assert 429 in codes


def test_secure_cookie_over_https_forwarded(make_app):
    client, svc = make_app(app_allowed_hosts="jarvis-pc.tail1234.ts.net")
    code = svc.auth.ensure_setup_code()
    r = client.post("/api/auth/setup", json={"username": "tony", "password": PASSWORD, "setup_code": code},
                    headers={"host": "jarvis-pc.tail1234.ts.net", "origin": "https://jarvis-pc.tail1234.ts.net"})
    assert r.status_code == 200
    assert "secure" in r.headers["set-cookie"].lower()


def test_password_change_revokes_sessions(authed):
    client, _, headers = authed
    r = client.post("/api/auth/password", json={"old_password": PASSWORD, "new_password": "another long pass"},
                    headers=headers)
    assert r.status_code == 200
    assert client.get("/api/tasks").status_code == 401


def test_frontend_secrets_not_in_settings_payload(make_app):
    client, svc = make_app(fish_api_key="sk-live-123456", groq_api_key="gsk-abcdef")
    headers = setup_owner(client, svc)
    for path in ("/api/settings", "/api/diagnostics", "/api/auth/state"):
        r = client.get(path, headers=headers)
        assert r.status_code == 200
        assert "sk-live-123456" not in r.text and "gsk-abcdef" not in r.text
