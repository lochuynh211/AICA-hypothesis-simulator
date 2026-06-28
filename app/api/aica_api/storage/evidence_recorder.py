"""Append-only evidence recorder (T017) — persist RunLog after every event.

Design constraints:
  - Persists the full run log to runs/<run_id>.json after EVERY appended event.
  - Prior events are never rewritten (FR-012).
  - Uses file_store.write_json_atomic for atomic on-disk writes.
  - No new dependencies.
"""

from __future__ import annotations

import pathlib

from aica_api.models.log import Event, RunLog
from aica_api.storage.file_store import write_json_atomic


class EvidenceRecorder:
    """Manages the append-only run log for a single run.

    On construction the initial (empty-events) log is persisted to disk.
    Every subsequent call to ``append`` adds one event to the in-memory log
    and immediately writes the full log to disk atomically.

    Attributes:
        run_log: The current in-memory RunLog (read-only reference; do not
                 mutate events directly — use append).
    """

    def __init__(self, run_log: RunLog, runs_dir: pathlib.Path) -> None:
        """Initialise the recorder and write the initial log file.

        Args:
            run_log:  The starting RunLog (typically with an empty events list).
            runs_dir: Directory where ``<run_id>.json`` will be written.
        """
        self._log = run_log
        self._path = str(runs_dir / f"{run_log.run_id}.json")
        self._persist()

    # ── Public API ─────────────────────────────────────────────────────────

    @property
    def run_log(self) -> RunLog:
        """The current in-memory RunLog (append-only; events accumulate here)."""
        return self._log

    def append(self, event: Event) -> None:
        """Append an event and persist the full log atomically.

        Args:
            event: A TickEvent, ActionEvent, AlgorithmError, or FeedbackEvent instance.

        Note:
            Prior events are never mutated.  This method only ever adds to the
            end of the events list, then rewrites the whole log file.
        """
        self._log.events.append(event)
        self._persist()

    # ── Private helpers ────────────────────────────────────────────────────

    def _persist(self) -> None:
        """Write the current log to disk atomically."""
        write_json_atomic(self._path, self._log.model_dump(mode="json"))
