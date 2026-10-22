"""`python -m app` — run the JARVIS server on the configured loopback address."""

from __future__ import annotations

import logging
import sys

import uvicorn

from .config import get_settings


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    s = get_settings()
    if s.app_host not in ("127.0.0.1", "localhost", "::1"):
        print(f"WARNING: APP_HOST={s.app_host} exposes JARVIS beyond loopback. "  # noqa: T201
              "Prefer 127.0.0.1 + Tailscale Serve.", file=sys.stderr)
    from .main import create_app

    uvicorn.run(create_app(s), host=s.app_host, port=s.app_port, log_level="info",
                proxy_headers=s.app_trust_proxy_headers, forwarded_allow_ips="127.0.0.1")


if __name__ == "__main__":
    main()
