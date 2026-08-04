"""Hexestra's authenticated mitmdump bridge.

The addon exposes a loopback-only JSON control channel. Electron owns durable
storage and UI; this process owns live mitmproxy Flow objects and pause/resume.
"""

from __future__ import annotations

import asyncio
import base64
import html
import json
import os
import re
import threading
import time
import uuid
from collections import deque
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any
from urllib.parse import parse_qs, urlparse

from mitmproxy import connection, ctx, http


def _body(data: bytes | None, mime_type: str | None = None) -> dict[str, Any]:
    raw = data or b""
    try:
        text = raw.decode("utf-8")
        if "\x00" in text:
            raise UnicodeDecodeError("utf-8", raw, 0, 1, "NUL")
        encoding, value = "utf8", text
    except UnicodeDecodeError:
        encoding, value = "base64", base64.b64encode(raw).decode("ascii")
    result: dict[str, Any] = {"encoding": encoding, "data": value, "byteLength": len(raw)}
    if mime_type:
        result["mimeType"] = mime_type
    return result


def _headers(message: http.Message) -> list[dict[str, str]]:
    return [
        {"name": name.decode("latin-1"), "value": value.decode("latin-1")}
        for name, value in message.headers.fields
    ]


def _protocol(version: str) -> str:
    normalized = version.upper()
    if "2" in normalized:
        return "h2"
    return "http/1.1"


class HexestraBridge:
    def __init__(self) -> None:
        self.server: ThreadingHTTPServer | None = None
        self.server_thread: threading.Thread | None = None
        self.loop: asyncio.AbstractEventLoop | None = None
        self.token = ""
        self.project_id = ""
        self.intercept_requests = False
        self.intercept_responses = False
        self.burp_enabled = False
        self.flows: dict[str, http.HTTPFlow] = {}
        self.states: dict[str, tuple[str, int]] = {}
        self.events: deque[dict[str, Any]] = deque(maxlen=20_000)
        self.sequence = 0
        self.condition = threading.Condition()

    def load(self, loader: Any) -> None:
        loader.add_option("hexestra_control_port", int, 0, "Hexestra loopback control port")
        loader.add_option("hexestra_token", str, "", "Hexestra control token")
        loader.add_option("hexestra_project_id", str, "", "Hexestra project identity")
        loader.add_option("hexestra_intercept_requests", bool, False, "Pause requests")
        loader.add_option("hexestra_intercept_responses", bool, False, "Pause responses")
        loader.add_option("hexestra_burp_enabled", bool, False, "Traffic is chained through Burp")

    def running(self) -> None:
        self.loop = asyncio.get_running_loop()
        self.token = ctx.options.hexestra_token
        self.project_id = ctx.options.hexestra_project_id
        self.intercept_requests = ctx.options.hexestra_intercept_requests
        self.intercept_responses = ctx.options.hexestra_intercept_responses
        self.burp_enabled = ctx.options.hexestra_burp_enabled
        if not self.token or not self.project_id or not ctx.options.hexestra_control_port:
            raise RuntimeError("Hexestra control configuration is incomplete")
        addon = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, _format: str, *_args: Any) -> None:
                return

            def _authorized(self) -> bool:
                return self.headers.get("Authorization") == f"Bearer {addon.token}"

            def _json(self, status: int, payload: Any) -> None:
                encoded = json.dumps(payload, ensure_ascii=False).encode("utf-8")
                self.send_response(status)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.send_header("Content-Length", str(len(encoded)))
                self.end_headers()
                self.wfile.write(encoded)

            def do_GET(self) -> None:  # noqa: N802
                if not self._authorized():
                    self._json(401, {"error": "unauthorized"})
                    return
                parsed = urlparse(self.path)
                if parsed.path == "/health":
                    self._json(200, {"ready": True, "version": "1", "projectId": addon.project_id})
                    return
                if parsed.path == "/events":
                    query = parse_qs(parsed.query)
                    after = int(query.get("after", ["0"])[0])
                    timeout = min(15.0, max(0.0, float(query.get("timeout", ["10"])[0])))
                    events = addon.events_after(after, timeout)
                    self._json(200, {"events": events, "lastSeq": addon.sequence})
                    return
                self._json(404, {"error": "not_found"})

            def do_POST(self) -> None:  # noqa: N802
                if not self._authorized():
                    self._json(401, {"error": "unauthorized"})
                    return
                try:
                    length = int(self.headers.get("Content-Length", "0"))
                    if length > 32 * 1024 * 1024:
                        raise ValueError("payload_too_large")
                    payload = json.loads(self.rfile.read(length) or b"{}")
                    if self.path == "/decision":
                        addon.schedule_decision(payload)
                        self._json(202, {"accepted": True})
                        return
                    if self.path == "/intercept":
                        addon.schedule_intercept_update(payload)
                        self._json(202, {"accepted": True})
                        return
                    if self.path == "/replay":
                        replay_id = addon.schedule_replay(payload)
                        self._json(202, {"accepted": True, "flowId": replay_id})
                        return
                    self._json(404, {"error": "not_found"})
                except Exception as error:  # pylint: disable=broad-exception-caught
                    self._json(400, {"error": str(error)})

        self.server = ThreadingHTTPServer(("127.0.0.1", ctx.options.hexestra_control_port), Handler)
        self.server_thread = threading.Thread(target=self.server.serve_forever, name="hexestra-control", daemon=True)
        self.server_thread.start()

    def done(self) -> None:
        if self.server:
            self.server.shutdown()
            self.server.server_close()
        self.server = None

    def request(self, flow: http.HTTPFlow) -> None:
        flow_id = flow.id
        self.flows[flow_id] = flow
        replay = bool(flow.metadata.get("hexestra_parent_flow_id"))
        state = "request_paused" if self.intercept_requests and not replay else "forwarding"
        self.states[flow_id] = (state, 0)
        if self.intercept_requests and not replay:
            flow.intercept()
        self.emit(flow, state, 0)

    def response(self, flow: http.HTTPFlow) -> None:
        _, revision = self.states.get(flow.id, ("forwarding", 0))
        burp_error = _burp_proxy_error(flow.response) if self.burp_enabled else None
        replay = bool(flow.metadata.get("hexestra_parent_flow_id"))
        state = "failed" if burp_error else ("response_paused" if self.intercept_responses and not replay else "completed")
        revision += 1
        self.states[flow.id] = (state, revision)
        if self.intercept_responses and not burp_error and not replay:
            flow.intercept()
        self.emit(flow, state, revision, burp_error)

    def error(self, flow: http.HTTPFlow) -> None:
        _, revision = self.states.get(flow.id, ("forwarding", 0))
        self.states[flow.id] = ("failed", revision + 1)
        self.emit(flow, "failed", revision + 1, str(flow.error or "Proxy request failed"))

    def emit(self, flow: http.HTTPFlow, state: str, revision: int, error: str | None = None) -> None:
        request = flow.request
        response = flow.response
        started = request.timestamp_start or time.time()
        payload: dict[str, Any] = {
            "id": flow.id,
            "projectId": self.project_id,
            "revision": revision,
            "state": state,
            "scopeState": "out_of_scope",
            "source": "replay" if flow.metadata.get("hexestra_parent_flow_id") else "browser",
            "request": {
                "method": request.method,
                "url": request.pretty_url,
                "httpVersion": _protocol(request.http_version),
                "headers": _headers(request),
                "body": _body(request.raw_content, request.headers.get("content-type")),
            },
            "timing": {"startedAt": _iso(started)},
            "route": {"burpEnabled": self.burp_enabled, "burpRouted": self.burp_enabled},
        }
        parent = flow.metadata.get("hexestra_parent_flow_id")
        if parent:
            payload["parentFlowId"] = parent
        if response:
            payload["response"] = {
                "statusCode": response.status_code,
                "reason": response.reason,
                "httpVersion": _protocol(response.http_version),
                "headers": _headers(response),
                "body": _body(response.raw_content, response.headers.get("content-type")),
            }
            payload["timing"]["responseReceivedAt"] = _iso(response.timestamp_start or time.time())
        if state in ("completed", "failed"):
            completed = (response.timestamp_end if response else None) or time.time()
            payload["timing"]["completedAt"] = _iso(completed)
            payload["timing"]["durationMs"] = max(0, round((completed - started) * 1000))
        if error:
            payload["error"] = error
        with self.condition:
            self.sequence += 1
            self.events.append({"seq": self.sequence, "flow": payload})
            self.condition.notify_all()

    def events_after(self, after: int, timeout: float) -> list[dict[str, Any]]:
        deadline = time.monotonic() + timeout
        with self.condition:
            while self.sequence <= after and time.monotonic() < deadline:
                self.condition.wait(deadline - time.monotonic())
            return [event for event in self.events if event["seq"] > after][:200]

    def schedule_decision(self, payload: dict[str, Any]) -> None:
        flow_id = str(payload.get("flowId", ""))
        expected = int(payload.get("expectedRevision", -1))
        action = payload.get("action")
        state, revision = self.states.get(flow_id, ("missing", -1))
        if state not in ("request_paused", "response_paused"):
            raise ValueError(f"flow_not_paused:{state}")
        if revision != expected:
            raise ValueError("stale_revision")
        if action not in ("forward", "drop"):
            raise ValueError("invalid_action")
        if not self.loop:
            raise ValueError("bridge_not_ready")

        def apply() -> None:
            current_state, current_revision = self.states.get(flow_id, ("missing", -1))
            if current_state != state or current_revision != revision:
                return
            flow = self.flows.get(flow_id)
            if not flow:
                return
            message = payload.get("message")
            if isinstance(message, dict):
                self._apply_patch(flow, state, message)
            next_state = "dropped" if action == "drop" else ("forwarding" if state == "request_paused" else "completed")
            next_revision = revision + 1
            self.states[flow_id] = (next_state, next_revision)
            if action == "drop":
                flow.kill()
            else:
                flow.resume()
            self.emit(flow, next_state, next_revision)

        self.loop.call_soon_threadsafe(apply)

    def schedule_intercept_update(self, payload: dict[str, Any]) -> None:
        intercept_requests = payload.get("interceptRequests")
        intercept_responses = payload.get("interceptResponses")
        if not isinstance(intercept_requests, bool) or not isinstance(intercept_responses, bool):
            raise ValueError("invalid_intercept_profile")
        if not self.loop:
            raise ValueError("bridge_not_ready")

        def apply() -> None:
            self.intercept_requests = intercept_requests
            self.intercept_responses = intercept_responses
            for flow_id, (state, revision) in list(self.states.items()):
                release_request = state == "request_paused" and not intercept_requests
                release_response = state == "response_paused" and not intercept_responses
                if not release_request and not release_response:
                    continue
                flow = self.flows.get(flow_id)
                if not flow:
                    continue
                next_state = "forwarding" if release_request else "completed"
                next_revision = revision + 1
                self.states[flow_id] = (next_state, next_revision)
                flow.resume()
                self.emit(flow, next_state, next_revision)

        self.loop.call_soon_threadsafe(apply)

    def schedule_replay(self, payload: dict[str, Any]) -> str:
        parent_id = str(payload.get("parentFlowId", ""))
        request_payload = payload.get("request")
        if not parent_id or not isinstance(request_payload, dict):
            raise ValueError("invalid_replay_request")
        if not self.loop:
            raise ValueError("bridge_not_ready")

        method = str(request_payload.get("method", ""))
        url = str(request_payload.get("url", ""))
        parsed = urlparse(url)
        if parsed.scheme not in ("http", "https") or not parsed.hostname or not method:
            raise ValueError("invalid_replay_url")
        headers_payload = request_payload.get("headers")
        if not isinstance(headers_payload, list):
            raise ValueError("invalid_replay_headers")
        header_fields: list[tuple[bytes, bytes]] = []
        for header in headers_payload:
            if not isinstance(header, dict):
                raise ValueError("invalid_replay_header")
            header_fields.append((
                str(header.get("name", "")).encode("latin-1"),
                str(header.get("value", "")).encode("latin-1"),
            ))
        body = request_payload.get("body")
        if not isinstance(body, dict):
            raise ValueError("invalid_replay_body")
        if body.get("encoding") == "base64":
            content = base64.b64decode(str(body.get("data", "")), validate=True)
        elif body.get("encoding") == "utf8":
            content = str(body.get("data", "")).encode("utf-8")
        else:
            raise ValueError("invalid_replay_body_encoding")

        client = connection.Client(peername=("127.0.0.1", 0), sockname=("127.0.0.1", 0))
        port = parsed.port or (443 if parsed.scheme == "https" else 80)
        server = connection.Server(address=(parsed.hostname, port))
        replay = http.HTTPFlow(client, server)
        replay.request = http.Request.make(method, url, content, header_fields)
        # Request.make creates origin-form requests. Plain HTTP requests sent
        # through an upstream proxy must retain an authority so mitmproxy emits
        # absolute-form (Burp rejects origin-form unless invisible proxy mode is enabled).
        if parsed.scheme == "http":
            replay.request.authority = parsed.netloc
        replay.id = uuid.uuid4().hex
        replay.metadata["hexestra_parent_flow_id"] = parent_id

        def apply() -> None:
            ctx.master.commands.call("replay.client", [replay])

        self.loop.call_soon_threadsafe(apply)
        return replay.id

    @staticmethod
    def _apply_patch(flow: http.HTTPFlow, state: str, patch: dict[str, Any]) -> None:
        message: Any = flow.request if state == "request_paused" else flow.response
        if message is None:
            raise ValueError("message_missing")
        if state == "request_paused":
            if "method" in patch:
                flow.request.method = str(patch["method"])
            if "url" in patch:
                flow.request.url = str(patch["url"])
        else:
            if "statusCode" in patch:
                flow.response.status_code = int(patch["statusCode"])
            if "reason" in patch:
                flow.response.reason = str(patch["reason"])
        if isinstance(patch.get("headers"), list):
            message.headers.clear()
            for header in patch["headers"]:
                message.headers.add(str(header["name"]), str(header["value"]))
        if state == "request_paused" and "host" not in flow.request.headers:
            flow.request.headers["host"] = urlparse(flow.request.url).netloc
        body = patch.get("body")
        if isinstance(body, dict):
            if body.get("encoding") == "base64":
                message.content = base64.b64decode(str(body.get("data", "")), validate=True)
            else:
                message.content = str(body.get("data", "")).encode("utf-8")
        if "transfer-encoding" not in message.headers:
            message.headers["content-length"] = str(len(message.raw_content or b""))


def _iso(timestamp: float) -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime(timestamp)) + f".{int(timestamp % 1 * 1000):03d}Z"


def _burp_proxy_error(response: http.Response | None) -> str | None:
    """Recognize Burp's own upstream failure page without classifying target errors."""
    if response is None or "text/html" not in response.headers.get("content-type", "").lower():
        return None
    body = (response.raw_content or b"")[: 64 * 1024].decode("utf-8", errors="ignore")
    if not re.search(r"<title>\s*Burp Suite\s*</title>", body, re.IGNORECASE):
        return None
    match = re.search(r"<h1>\s*Error\s*</h1>\s*<p>(.*?)</p>", body, re.IGNORECASE | re.DOTALL)
    if not match:
        return None
    detail = html.unescape(re.sub(r"<[^>]+>", " ", match.group(1)))
    detail = re.sub(r"\s+", " ", detail).strip()
    return f"Burp Proxy error: {detail[:500] or 'upstream request failed'}"


addons = [HexestraBridge()]
