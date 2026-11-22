#!/usr/bin/env python3
"""Plain HTTP listener for the vampn app. No TLS."""

import hmac
import json
import os
import subprocess
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HOST = "0.0.0.0"
PORT = 8000
TOKEN_HEADER = "X-Vampn-Token"
TIMEOUT_SECONDS = 60

COMMANDS = {
    "/rotate": "wamp rotate",
    "/force": "wamp force",
}


def token_ok(supplied: str) -> bool:
    expected = os.environ.get("VAMPN_TOKEN", "")
    if not expected or not supplied:
        return False
    return hmac.compare_digest(supplied, expected)


def run_ssh(command: str) -> subprocess.CompletedProcess[str]:
    host = os.environ.get("VAMPN_SSH_HOST", "").strip()
    user = os.environ.get("VAMPN_SSH_USER", "").strip()
    port = os.environ.get("VAMPN_SSH_PORT", "22").strip() or "22"
    key = os.environ.get("VAMPN_SSH_KEY", "").strip()
    if not host or not user:
        raise RuntimeError("Задайте VAMPN_SSH_HOST и VAMPN_SSH_USER")

    argv = [
        "ssh",
        "-p",
        port,
        "-o",
        "BatchMode=yes",
        "-o",
        "StrictHostKeyChecking=accept-new",
    ]
    if key:
        argv.extend(["-i", key])
    argv.append(f"{user}@{host}")
    argv.append(command)
    return subprocess.run(
        argv,
        capture_output=True,
        text=True,
        timeout=TIMEOUT_SECONDS,
        check=False,
    )


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def do_GET(self) -> None:
        self._handle()

    def do_POST(self) -> None:
        self._handle()

    def _handle(self) -> None:
        path = self.path.split("?", 1)[0].rstrip("/") or "/"
        if path not in COMMANDS:
            self._send(404, {"ok": False, "error": "not found"})
            return
        if not token_ok(self.headers.get(TOKEN_HEADER, "")):
            self._send(400, {"ok": False, "error": "invalid token"})
            return

        command = COMMANDS[path]
        try:
            completed = run_ssh(command)
        except subprocess.TimeoutExpired:
            self._send(500, {"ok": False, "error": "timeout", "command": command})
            return
        except RuntimeError as error:
            self._send(500, {"ok": False, "error": str(error)})
            return

        output = ((completed.stdout or "") + (completed.stderr or "")).strip()
        ok = completed.returncode == 0
        self._send(
            200 if ok else 500,
            {
                "ok": ok,
                "command": command,
                "code": completed.returncode,
                "output": output,
            },
        )

    def _send(self, status: int, payload: dict) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt: str, *args) -> None:
        print(f"{self.address_string()} {fmt % args}", flush=True)


def main() -> None:
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f"listening on http://{HOST}:{PORT}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
