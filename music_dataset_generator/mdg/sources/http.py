"""Shared HTTP session helper for the source clients.

Each client accepts an injected ``session`` (anything exposing
``get(url, *, params, headers, timeout) -> Response``) so deterministic tests feed
recorded responses without any network. A real session is created lazily via
``default_session()`` — importing a client never imports or requires ``httpx``, keeping
the deterministic transform path network-free.
"""
from __future__ import annotations

from typing import Any, Protocol


class Response(Protocol):
    status_code: int

    def json(self) -> Any: ...


class Session(Protocol):
    def get(self, url: str, *, params: Any = None, headers: Any = None,
            timeout: Any = None) -> Response: ...

    def post(self, url: str, *, data: Any = None, headers: Any = None,
             timeout: Any = None) -> Response: ...


def default_session() -> Session:
    """Create a real httpx-backed session (imported lazily; live use only)."""
    import httpx

    return httpx.Client(follow_redirects=True)  # type: ignore[return-value]
