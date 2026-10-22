"""FastAPI application factory. Serves `/api` and the built SPA from one loopback origin."""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, JSONResponse

from .api.routes import router
from .config import Settings, get_settings
from .security.web import SecurityMiddleware
from .services import Services, build_services

log = logging.getLogger("jarvis")


def create_app(settings: Settings | None = None, *, services: Services | None = None,
               test_hosts: set[str] | None = None) -> FastAPI:
    settings = settings or get_settings()
    svc = services or build_services(settings)

    @asynccontextmanager
    async def lifespan(_: FastAPI):
        code = svc.auth.ensure_setup_code()
        if code:
            print(f"\n  >>> JARVIS first-run setup code: {code}\n", flush=True)  # noqa: T201
        svc.approvals.expire_stale()
        yield

    app = FastAPI(title="J.A.R.V.I.S.", version="0.1.0", lifespan=lifespan,
                  docs_url="/api/docs" if settings.app_env == "development" else None,
                  redoc_url=None, openapi_url="/api/openapi.json" if settings.app_env == "development" else None)
    app.state.services = svc
    app.add_middleware(SecurityMiddleware, settings=settings, extra_test_hosts=test_hosts)
    app.include_router(router)

    @app.exception_handler(RequestValidationError)
    async def _validation(_: Request, exc: RequestValidationError) -> JSONResponse:
        errors = [{"loc": e.get("loc"), "msg": e.get("msg")} for e in exc.errors()[:6]]
        return JSONResponse({"detail": "Invalid request", "errors": errors}, status_code=422)

    _mount_frontend(app, settings.app_frontend_dist)
    return app


def _mount_frontend(app: FastAPI, dist: Path) -> None:
    dist = dist.resolve()
    index = dist / "index.html"

    @app.get("/{path:path}", include_in_schema=False)
    async def spa(path: str) -> Any:
        if path.startswith("api/"):
            return JSONResponse({"detail": "Not found"}, status_code=404)
        if not index.exists():
            return JSONResponse({"detail": "Frontend not built. Run: npm run build (in jarvis/frontend)"},
                                status_code=503)
        candidate = (dist / path).resolve()
        if path and candidate.is_file() and candidate.is_relative_to(dist):
            headers = {}
            if path.startswith("assets/"):
                headers["Cache-Control"] = "public, max-age=31536000, immutable"
            elif path in ("sw.js", "manifest.webmanifest"):
                headers["Cache-Control"] = "no-cache"
            return FileResponse(candidate, headers=headers)
        return FileResponse(index, headers={"Cache-Control": "no-cache"})
