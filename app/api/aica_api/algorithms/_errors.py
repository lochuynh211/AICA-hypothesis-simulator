"""Algorithm adapter error type — extracted to break the adapter ↔ python_module circular import.

``AlgorithmAdapterError`` is re-exported from ``adapter.py`` for backward compatibility;
external callers should import it from there.  This module exists solely so that
``python_module.py`` can import the error without creating a circular dependency.
"""

from __future__ import annotations


class AlgorithmAdapterError(Exception):
    """Raised when an algorithm fails to produce a valid DecisionResult.

    Callers (the tick engine) should convert this to an ``AlgorithmError``
    log event (with the appropriate tick_index), never to a DecisionResult.

    Attributes:
        error_type: Machine-readable category ("algorithm_exception",
                    "invalid_result_shape", "missing_evaluate", "context_error",
                    or "unsupported_algorithm_type").
        message:    Human-readable description including the original error.
    """

    def __init__(self, error_type: str, message: str) -> None:
        self.error_type = error_type
        self.message = message
        super().__init__(f"{error_type}: {message}")
