import json

from starlette.datastructures import MutableHeaders
from starlette.types import ASGIApp, Message, Receive, Scope, Send

# Those pages load a script and a stylesheet, which the policy below would block.
_DOCUMENTATION_PATHS = frozenset({"/docs", "/docs/oauth2-redirect", "/redoc"})

# JSON only: a response has no reason to load anything or render in a frame.
_CONTENT_SECURITY_POLICY = "default-src 'none'; frame-ancestors 'none'"


def add_security_headers(
    headers: MutableHeaders, *, documentation: bool = False
) -> None:
    headers["X-Content-Type-Options"] = "nosniff"
    headers["Referrer-Policy"] = "no-referrer"
    if not documentation:
        headers["Content-Security-Policy"] = _CONTENT_SECURITY_POLICY
    # Errors raised before a route answers don't set this themselves.
    if "Cache-Control" not in headers:
        headers["Cache-Control"] = "no-store"


class SecurityHeadersMiddleware:
    """HSTS belongs to whatever terminates TLS, the page policy to the frontend."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        is_documentation = scope["path"] in _DOCUMENTATION_PATHS

        async def send_with_headers(message: Message) -> None:
            if message["type"] == "http.response.start":
                add_security_headers(
                    MutableHeaders(scope=message), documentation=is_documentation
                )
            await send(message)

        await self.app(scope, receive, send_with_headers)


class RequestBodyLimitMiddleware:
    """413 for large bodies; with Transfer-Encoding a declared size binds nothing."""

    def __init__(
        self,
        app: ASGIApp,
        max_bytes: int,
        larger: dict[tuple[str, str], int] | None = None,
    ) -> None:
        self.app = app
        self.max_bytes = max_bytes
        self.larger = larger or {}

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        max_bytes = self.larger.get((scope["method"], scope["path"]), self.max_bytes)
        declared = self._declared_length(scope)
        if declared is not None:
            if declared > max_bytes:
                await self._refuse(send)
            else:
                await self.app(scope, receive, send)
            return

        # No usable Content-Length; the limit is small, so hold the body to measure it.
        chunks: list[bytes] = []
        size = 0
        # E.g. the client going away; passed on as it came.
        interruption: Message | None = None
        while True:
            message = await receive()
            if message["type"] != "http.request":
                interruption = message
                break
            chunk = message.get("body", b"")
            size += len(chunk)
            if size > max_bytes:
                await self._refuse(send)
                return
            chunks.append(chunk)
            if not message.get("more_body", False):
                break

        replayed = False

        async def replay() -> Message:
            nonlocal replayed
            if not replayed:
                replayed = True
                if interruption is not None:
                    return interruption
                return {
                    "type": "http.request",
                    "body": b"".join(chunks),
                    "more_body": False,
                }
            return await receive()

        await self.app(scope, replay, send)

    @staticmethod
    def _declared_length(scope: Scope) -> int | None:
        declared: bytes | None = None
        for name, value in scope["headers"]:
            if name == b"transfer-encoding":
                # With Transfer-Encoding, chunks frame the body, not Content-Length.
                return None
            if name == b"content-length" and declared is None:
                declared = value
        if declared is None:
            return None
        try:
            return int(declared)
        except ValueError:
            # Not a number: measure it instead.
            return None

    @staticmethod
    async def _refuse(send: Send) -> None:
        body = json.dumps({"detail": "Request body too large."}).encode("utf-8")
        await send(
            {
                "type": "http.response.start",
                "status": 413,
                "headers": [
                    (b"content-type", b"application/json"),
                    (b"content-length", str(len(body)).encode("ascii")),
                ],
            }
        )
        await send({"type": "http.response.body", "body": body})
