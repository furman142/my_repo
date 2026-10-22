"""TEST-ONLY stand-in for Ollama's /api/chat, used by the browser E2E / screenshot script when no real
Ollama is available (e.g. CI). It is never imported by the application. It speaks the documented
NDJSON protocol and emits genuine tool calls so the real backend tool/approval pipeline runs.

Usage:  python tests/e2e/fake_ollama_server.py 11500   then   OLLAMA_BASE_URL=http://127.0.0.1:11500
"""

from __future__ import annotations

import json
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


def plan(messages: list[dict]) -> dict:
    last = messages[-1]
    if last["role"] == "tool":
        data = json.loads(last["content"] or "{}")
        if last.get("tool_name") == "list_tasks":
            titles = [t["title"] for t in data.get("tasks", [])]
            text = ("[E2E MOCK MODEL] You have " + str(len(titles)) + " open task(s): " + ", ".join(titles) + "."
                    if titles else "[E2E MOCK MODEL] Your list is clear today.")
            return {"content": text}
        if data.get("denied"):
            return {"content": "[E2E MOCK MODEL] Understood. I have not done it."}
        return {"content": "[E2E MOCK MODEL] Done: " + json.dumps(data, ensure_ascii=False)[:120]}
    text = last["content"].lower()
    if "today" in text or "היום" in text:
        return {"tool_calls": [{"function": {"name": "list_tasks", "arguments": {"when": "today"}}}]}
    if "remind" in text or "תזכיר" in text:
        return {"tool_calls": [{"function": {"name": "create_task",
                                             "arguments": {"title": "Call Pepper", "due": "2030-01-02T10:00"}}}]}
    return {"content": "[E2E MOCK MODEL] Good evening. This reply comes from the test stand-in, not a real model."}


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):  # noqa: D401
        pass

    def _json(self, obj: dict) -> None:
        body = json.dumps(obj).encode()
        self.send_response(200)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):  # noqa: N802
        if self.path == "/api/version":
            self._json({"version": "e2e-mock"})
        elif self.path == "/api/tags":
            self._json({"models": [{"name": "qwen3:8b", "model": "qwen3:8b"}]})
        else:
            self.send_error(404)

    def do_POST(self):  # noqa: N802
        body = json.loads(self.rfile.read(int(self.headers["content-length"])))
        p = plan(body["messages"])
        lines = []
        if "content" in p:
            for w in p["content"].split(" "):
                lines.append({"message": {"role": "assistant", "content": w + " "}, "done": False})
        else:
            msg = {"role": "assistant", "content": "", "tool_calls": p["tool_calls"]}
            lines.append({"message": msg, "done": False})
        lines.append({"message": {"role": "assistant", "content": ""}, "done": True, "eval_count": 1})
        out = ("\n".join(json.dumps(x) for x in lines) + "\n").encode()
        self.send_response(200)
        self.send_header("content-type", "application/x-ndjson")
        self.send_header("content-length", str(len(out)))
        self.end_headers()
        self.wfile.write(out)


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 11500
    ThreadingHTTPServer(("127.0.0.1", port), Handler).serve_forever()
