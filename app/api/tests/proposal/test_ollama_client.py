"""Tests for ollama_client (feature 019) — stdlib-urllib local LLM transport.

No live network: the module-level ``_urlopen`` seam is monkeypatched, and the
default implementation refuses to run during pytest.
"""
import json
import urllib.error

import pytest

from aica_api.services import ollama_client


def _chat_response(content: str) -> bytes:
    return json.dumps({"message": {"role": "assistant", "content": content}}).encode()


def test_generate_success_and_request_shape(monkeypatch):
    captured: dict = {}

    def fake_urlopen(url: str, data: bytes, timeout: float) -> bytes:
        captured["url"] = url
        captured["payload"] = json.loads(data)
        captured["timeout"] = timeout
        return _chat_response("JA: 眠気が高い\nEN: high drowsiness")

    monkeypatch.setattr(ollama_client, "_urlopen", fake_urlopen)
    out = ollama_client.generate(
        [{"role": "user", "content": "hi"}],
        model="qwen2.5:3b",
        base_url="http://ollama:11434",
        timeout=7,
    )
    assert "EN: high drowsiness" in out
    # POSTs to /api/chat, non-streaming, temperature forced to 0.
    assert captured["url"] == "http://ollama:11434/api/chat"
    assert captured["payload"]["model"] == "qwen2.5:3b"
    assert captured["payload"]["stream"] is False
    assert captured["payload"]["options"]["temperature"] == 0
    assert captured["timeout"] == 7


def test_base_url_trailing_slash_is_normalized(monkeypatch):
    captured: dict = {}

    def fake_urlopen(url, data, timeout):
        captured["url"] = url
        return _chat_response("x")

    monkeypatch.setattr(ollama_client, "_urlopen", fake_urlopen)
    ollama_client.generate([], model="m", base_url="http://x:11434/", timeout=1)
    assert captured["url"] == "http://x:11434/api/chat"


def test_generate_unreachable_maps_to_typed_error(monkeypatch):
    def boom(url, data, timeout):
        raise urllib.error.URLError("connection refused")

    monkeypatch.setattr(ollama_client, "_urlopen", boom)
    with pytest.raises(ollama_client.OllamaError) as ei:
        ollama_client.generate([], model="m", base_url="http://x", timeout=1)
    assert ei.value.error_type == "unreachable"


def test_generate_http_error_maps_to_typed_error(monkeypatch):
    def boom(url, data, timeout):
        raise urllib.error.HTTPError("http://x", 500, "err", {}, None)

    monkeypatch.setattr(ollama_client, "_urlopen", boom)
    with pytest.raises(ollama_client.OllamaError) as ei:
        ollama_client.generate([], model="m", base_url="http://x", timeout=1)
    assert ei.value.error_type == "http_error"


def test_generate_timeout_maps_to_typed_error(monkeypatch):
    def boom(url, data, timeout):
        raise TimeoutError("timed out")

    monkeypatch.setattr(ollama_client, "_urlopen", boom)
    with pytest.raises(ollama_client.OllamaError):
        ollama_client.generate([], model="m", base_url="http://x", timeout=1)


def test_generate_bad_json_maps_to_typed_error(monkeypatch):
    monkeypatch.setattr(ollama_client, "_urlopen", lambda url, data, timeout: b"not json")
    with pytest.raises(ollama_client.OllamaError) as ei:
        ollama_client.generate([], model="m", base_url="http://x", timeout=1)
    assert ei.value.error_type == "bad_response"


def test_generate_missing_content_maps_to_typed_error(monkeypatch):
    monkeypatch.setattr(
        ollama_client,
        "_urlopen",
        lambda url, data, timeout: json.dumps({"message": {}}).encode(),
    )
    with pytest.raises(ollama_client.OllamaError):
        ollama_client.generate([], model="m", base_url="http://x", timeout=1)


@pytest.mark.parametrize(
    "body",
    [
        {"message": "a plain string"},
        {"message": 42},
        {"message": True},
        {"message": [1, 2, 3]},
        {"message": None},
        {"not_message": {"content": "x"}},
        ["not", "a", "dict"],
    ],
)
def test_generate_non_dict_message_maps_to_typed_error_not_crash(monkeypatch, body):
    """A 200 with an unexpected shape must raise OllamaError (→ template
    fallback), never an uncaught AttributeError/TypeError."""
    monkeypatch.setattr(ollama_client, "_urlopen", lambda url, data, timeout: json.dumps(body).encode())
    with pytest.raises(ollama_client.OllamaError) as ei:
        ollama_client.generate([], model="m", base_url="http://x", timeout=1)
    assert ei.value.error_type == "bad_response"


def test_default_urlopen_refuses_live_network_in_tests():
    with pytest.raises(RuntimeError):
        ollama_client._default_urlopen("http://x/api/chat", b"{}", 1.0)
