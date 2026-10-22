"""HTTP-level protections: Host allowlist, Origin checks, CSRF, security headers, auth dependency."""

from __future__ import annotations

import hmac
from urllib.parse import urlsplit

from fastapi import HTTPException, Request
from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.responses import JSONResponse, Response

from ..config import Settings
from .auth import CSRF_HEADER, SESSION_COOKIE, SessionInfo

UNSAFE = {"POST", "PUT", "PATCH", "DELETE"}
LOCAL_HOSTS = {"127.0.0.1", "localhost", "[::1]", "::1"}

CSP = (
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; "
    "media-src 'self' blob:; connect-src 'self'; font-src 'self' data:; object-src 'none'; "
    "base-uri 'none'; frame-ancestors 'none'; form-action 'self'; worker-src 'self'; manifest-src 'self'"
)


def _host_only(host_header: str) -> str:
    host = host_header.strip().lower()
    if host.startswith("["):
        return host.split("]")[0] + "]"
    return host.rsplit(":", 1)[0] if ":" in host else host


class SecurityMiddleware(BaseHTTPMiddleware):
    def __init__(self, app, settings: Settings, extra_test_hosts: set[str] | None = None):
        super().__init__(app)
        self.allowed = LOCAL_HOSTS | set(settings.extra_hosts) | (extra_test_hosts or set())
        self.extra = set(settings.extra_hosts)

    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        host_header = request.headers.get("host", "")
        if _host_only(host_header) not in self.allowed:
            return JSONResponse({"detail": "Host not allowed"}, status_code=421)
        if request.method in UNSAFE and request.url.path.startswith("/api/"):
            origin = request.headers.get("origin")
            if origin is not None:
                o = urlsplit(origin)
                same = bool(o.netloc) and o.netloc.lower() == host_header.lower()
                # Tailscale Serve may rewrite Host; accept an explicitly configured HTTPS tailnet origin.
                configured = o.scheme == "https" and (o.hostname or "") in self.extra
                if not (same or configured):
                    return JSONResponse({"detail": "Cross-origin request rejected"}, status_code=403)
            fetch_site = request.headers.get("sec-fetch-site")
            if fetch_site and fetch_site not in ("same-origin", "none"):
                return JSONResponse({"detail": "Cross-site request rejected"}, status_code=403)
        response = await call_next(request)
        h = response.headers
        h.setdefault("Content-Security-Policy", CSP)
        h.setdefault("X-Content-Type-Options", "nosniff")
        h.setdefault("Referrer-Policy", "no-referrer")
        h.setdefault("X-Frame-Options", "DENY")
        h.setdefault("Cross-Origin-Opener-Policy", "same-origin")
        h.setdefault("Permissions-Policy", "microphone=(self), camera=(), geolocation=(), display-capture=()")
        if request.url.path.startswith("/api/"):
            h.setdefault("Cache-Control", "no-store")
        return response


def is_https(request: Request, settings: Settings) -> bool:
    if settings.app_cookie_secure or request.url.scheme == "https":
        return True
    client = request.client.host if request.client else ""
    if settings.app_trust_proxy_headers and client in ("127.0.0.1", "::1"):
        if request.headers.get("x-forwarded-proto", "").lower() == "https":
            return True
    return _host_only(request.headers.get("host", "")).endswith(".ts.net")


def client_key(request: Request) -> str:
    return request.client.host if request.client else "unknown"


def require_session(request: Request) -> SessionInfo:
    svc = request.app.state.services
    session = svc.auth.resolve(request.cookies.get(SESSION_COOKIE))
    if session is None:
        raise HTTPException(status_code=401, detail="Not authenticated")
    if request.method in UNSAFE:
        token = request.headers.get(CSRF_HEADER, "")
        if not token or not hmac.compare_digest(token, session.csrf_token):
            raise HTTPException(status_code=403, detail="CSRF token missing or invalid")
    return session
