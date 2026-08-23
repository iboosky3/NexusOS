"""Bounded read-model storage for embedded and development deployments."""

from __future__ import annotations

from collections import OrderedDict
from collections.abc import Mapping
from copy import deepcopy
from threading import RLock
from typing import Any


class RunNotFoundError(LookupError):
    """Raised when a requested run projection does not exist."""


class InMemoryRunReadStore:
    """Keep immutable JSON-compatible run projections with bounded retention."""

    def __init__(self, maximum_entries: int = 100) -> None:
        if maximum_entries < 1:
            raise ValueError("maximum entries must be positive")
        self._maximum_entries = maximum_entries
        self._runs: OrderedDict[str, dict[str, Any]] = OrderedDict()
        self._lock = RLock()

    def save(self, projection: Mapping[str, Any]) -> None:
        """Insert or replace a projection and evict the oldest entry when full."""

        run_id = projection.get("run_id")
        if not isinstance(run_id, str) or not run_id:
            raise ValueError("run projection requires a non-empty run_id")
        snapshot = deepcopy(dict(projection))
        with self._lock:
            self._runs.pop(run_id, None)
            self._runs[run_id] = snapshot
            while len(self._runs) > self._maximum_entries:
                self._runs.popitem(last=False)

    def get(self, run_id: str) -> dict[str, Any]:
        """Return a defensive copy of one run projection."""

        with self._lock:
            try:
                return deepcopy(self._runs[run_id])
            except KeyError as exc:
                raise RunNotFoundError(run_id) from exc

    def list_summaries(self, limit: int = 20) -> tuple[dict[str, Any], ...]:
        """Return newest-first summaries without large artifact bodies."""

        if limit < 1 or limit > 100:
            raise ValueError("summary limit must be between 1 and 100")
        with self._lock:
            projections = list(reversed(self._runs.values()))[:limit]
            return tuple(_summary(projection) for projection in projections)


def _summary(projection: Mapping[str, Any]) -> dict[str, Any]:
    review = projection.get("review", {})
    usage = projection.get("usage", {})
    return {
        "run_id": projection["run_id"],
        "status": projection["status"],
        "request": projection["request"],
        "started_at": projection["started_at"],
        "completed_at": projection["completed_at"],
        "duration_ms": projection["duration_ms"],
        "iteration": projection["iteration"],
        "quality_score": review.get("overall_score"),
        "usage": deepcopy(usage),
        "task_count": len(projection.get("tasks", ())),
        "artifact_count": len(projection.get("artifacts", ())),
    }
