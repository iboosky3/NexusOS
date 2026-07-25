"""OpenTelemetry-aligned event recording without a mandatory SDK dependency."""

from __future__ import annotations

from collections import Counter
from dataclasses import dataclass
from datetime import UTC, datetime
from types import MappingProxyType
from typing import Any, Mapping

_SENSITIVE_PARTS = ("password", "secret", "api_key", "authorization", "token_value")


@dataclass(frozen=True, slots=True)
class TelemetryEvent:
    """A sanitized event that can be mapped to logs, spans, and metrics."""

    name: str
    occurred_at: datetime
    trace_id: str
    span_id: str | None
    attributes: Mapping[str, Any]

    def __post_init__(self) -> None:
        object.__setattr__(self, "attributes", MappingProxyType(dict(self.attributes)))


class InMemoryTelemetrySink:
    """Collect normalized telemetry for tests and local Studio inspection."""

    def __init__(self) -> None:
        self.events: list[TelemetryEvent] = []
        self._counters: Counter[str] = Counter()

    def emit(self, event_name: str, payload: Mapping[str, Any]) -> None:
        run_id = str(payload.get("run_id", "unknown"))
        task_id = payload.get("task_id")
        attributes = {
            f"nexus.{key}": _sanitize(key, value)
            for key, value in payload.items()
            if key not in {"run_id", "task_id"}
        }
        event = TelemetryEvent(
            name=event_name,
            occurred_at=datetime.now(UTC),
            trace_id=run_id,
            span_id=str(task_id) if task_id is not None else None,
            attributes=attributes,
        )
        self.events.append(event)
        self._counters[event_name] += 1
        token_count = payload.get("tokens")
        if isinstance(token_count, int):
            self._counters["nexus.tokens.total"] += token_count

    def metrics(self) -> Mapping[str, int]:
        """Return an immutable metric snapshot."""

        return MappingProxyType(dict(self._counters))


def _sanitize(key: str, value: Any) -> Any:
    lowered = key.casefold()
    if any(part in lowered for part in _SENSITIVE_PARTS):
        return "[REDACTED]"
    if isinstance(value, str) and len(value) > 512:
        return value[:509] + "..."
    if isinstance(value, (str, int, float, bool)) or value is None:
        return value
    if isinstance(value, (tuple, list)):
        return tuple(_sanitize(key, item) for item in value[:20])
    return str(value)
