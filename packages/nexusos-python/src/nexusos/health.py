"""Framework-neutral liveness and readiness aggregation."""

from __future__ import annotations

import asyncio
import inspect
from collections.abc import Awaitable, Callable, Mapping
from dataclasses import dataclass
from time import monotonic

HealthCheck = Callable[[], bool | None | Awaitable[bool | None]]


@dataclass(frozen=True, slots=True)
class ComponentHealth:
    """One bounded dependency check result safe for external diagnostics."""

    name: str
    ready: bool
    critical: bool
    latency_ms: int
    error: str | None = None

    def as_dict(self) -> dict[str, object]:
        """Return a stable JSON-compatible component projection."""

        return {
            "name": self.name,
            "ready": self.ready,
            "critical": self.critical,
            "latency_ms": self.latency_ms,
            "error": self.error,
        }


@dataclass(frozen=True, slots=True)
class HealthReport:
    """Aggregate readiness without making optional dependencies fatal."""

    status: str
    components: tuple[ComponentHealth, ...]

    @property
    def ready(self) -> bool:
        """Return whether every critical dependency is available."""

        return all(item.ready for item in self.components if item.critical)

    def as_dict(self) -> dict[str, object]:
        """Return the stable API projection."""

        return {
            "status": self.status,
            "ready": self.ready,
            "components": [item.as_dict() for item in self.components],
        }


class HealthRegistry:
    """Evaluate independent readiness checks concurrently with one timeout each."""

    def __init__(
        self,
        checks: Mapping[str, tuple[HealthCheck, bool]] | None = None,
        *,
        timeout_seconds: float = 1.0,
    ) -> None:
        if timeout_seconds <= 0:
            raise ValueError("health check timeout must be positive")
        self._checks = dict(checks or {})
        self._timeout_seconds = timeout_seconds

    async def evaluate(self) -> HealthReport:
        """Return ready, degraded, or not_ready from all registered checks."""

        components = tuple(
            await asyncio.gather(
                *(
                    self._evaluate_one(name, check, critical)
                    for name, (check, critical) in sorted(self._checks.items())
                )
            )
        )
        critical_failed = any(not item.ready and item.critical for item in components)
        optional_failed = any(not item.ready and not item.critical for item in components)
        status = "not_ready" if critical_failed else "degraded" if optional_failed else "ready"
        return HealthReport(status=status, components=components)

    async def _evaluate_one(self, name: str, check: HealthCheck, critical: bool) -> ComponentHealth:
        started = monotonic()
        try:
            result = check()
            if inspect.isawaitable(result):
                result = await asyncio.wait_for(result, timeout=self._timeout_seconds)
            ready = result is not False
            error = None if ready else "check returned unavailable"
        except TimeoutError:
            ready = False
            error = "check timed out"
        except Exception as exc:
            ready = False
            error = type(exc).__name__
        return ComponentHealth(
            name=name,
            ready=ready,
            critical=critical,
            latency_ms=max(0, round((monotonic() - started) * 1000)),
            error=error,
        )
