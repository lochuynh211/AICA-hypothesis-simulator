"""ollama_client — stdlib-urllib client for a local Ollama server (feature 019).

Calls the Ollama ``/api/chat`` endpoint to generate the grounded rationale
sentence for the Service/Content proposal panels. Mirrors ``maps_client.py``:
an injectable module-level ``_urlopen`` transport seam (guarded against live
network in tests), a typed ``OllamaError``, and NO third-party dependency
(stdlib ``urllib`` only). ``temperature`` is forced to 0 for reproducible,
review-tool-stable text.

The backend explanation provider is OPT-IN. Callers are expected to catch
``OllamaError`` and fall back to the deterministic template, so an
unreachable/slow/absent Ollama never blocks a decision or fakes a generation
("failures are never disguised", Constitution Principle V).
"""
from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
from typing import Callable

# Forced generation options — greedy/deterministic so re-generating a given
# candidate/item yields stable text (a review-tool requirement).
GENERATION_OPTIONS: dict = {"temperature": 0}


class OllamaError(Exception):
    """Raised for any Ollama transport / HTTP / response-shape failure.

    Attributes
    ----------
    error_type : str
        One of ``"unreachable"``, ``"http_error"``, ``"bad_response"``.
    message : str
        Human-readable description (never contains request internals/secrets).
    """

    def __init__(self, error_type: str, message: str) -> None:
        super().__init__(message)
        self.error_type = error_type
        self.message = message


def _default_urlopen(url: str, data: bytes, timeout: float) -> bytes:
    """POST *data* to *url* and return the response body as bytes.

    Guard: during a pytest run this raises immediately instead of making a live
    network call — tests must monkeypatch ``ollama_client._urlopen``.
    """
    if os.getenv("PYTEST_CURRENT_TEST"):
        raise RuntimeError(
            "_urlopen not mocked — no live network allowed in tests. "
            "Monkeypatch ollama_client._urlopen in your test."
        )
    req = urllib.request.Request(
        url,
        data=data,
        headers={
            "Content-Type": "application/json",
            "User-Agent": "aica-simulator/1.0",
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:  # noqa: S310
        return resp.read()


# Module-level injectable transport. Tests monkeypatch this attribute.
_urlopen: Callable[[str, bytes, float], bytes] = _default_urlopen


def generate(
    messages: list[dict[str, str]],
    *,
    model: str,
    base_url: str,
    timeout: float,
    options: dict | None = None,
) -> str:
    """Run one non-streaming chat completion and return the assistant text.

    Parameters
    ----------
    messages : list of ``{"role", "content"}`` chat messages.
    model    : Ollama model tag (e.g. ``"qwen2.5:3b"``).
    base_url : Ollama base URL (e.g. ``"http://ollama:11434"``).
    timeout  : per-request timeout in seconds.
    options  : generation options override. Defaults to the greedy/deterministic
               ``GENERATION_OPTIONS`` (``temperature=0``). A caller re-rolling an
               unusable greedy result may pass ``{"temperature": t, "seed": n}``
               — a fixed seed keeps each such draw itself deterministic/reproducible.

    Raises
    ------
    OllamaError
        On transport error / timeout (``unreachable``), non-2xx HTTP
        (``http_error``), or malformed / empty response (``bad_response``).
    """
    url = base_url.rstrip("/") + "/api/chat"
    payload = {
        "model": model,
        "messages": messages,
        "stream": False,
        "options": options if options is not None else GENERATION_OPTIONS,
    }
    body = json.dumps(payload).encode("utf-8")

    try:
        raw = _urlopen(url, body, timeout)
    except urllib.error.HTTPError as exc:  # subclass of URLError — catch first
        raise OllamaError("http_error", f"Ollama HTTP {exc.code}") from exc
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        raise OllamaError("unreachable", f"Ollama unreachable: {type(exc).__name__}") from exc

    try:
        data = json.loads(raw)
    except (json.JSONDecodeError, ValueError) as exc:
        raise OllamaError("bad_response", "Invalid JSON in Ollama response") from exc

    # Ollama /api/chat (stream=false) → {"message": {"role","content"}, ...}.
    # Guard EVERY nested level: a 200 body with a non-dict `message` (e.g. a
    # misconfigured OLLAMA_BASE_URL pointing at some other JSON endpoint) must
    # raise OllamaError → template fallback, never an uncaught AttributeError.
    message = data.get("message") if isinstance(data, dict) else None
    content = message.get("content") if isinstance(message, dict) else None
    if not isinstance(content, str) or not content.strip():
        raise OllamaError("bad_response", "Ollama response missing message.content")
    return content
