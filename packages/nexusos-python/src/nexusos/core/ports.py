"""Ports that isolate the domain layer from infrastructure frameworks."""

from __future__ import annotations

from typing import Any, Mapping, Protocol, Sequence, runtime_checkable

from nexusos.core.models import AgentContext, AgentResult, NexusState, Task


@runtime_checkable
class AgentRuntime(Protocol):
    """Execute an agent without exposing a framework-specific graph type."""

    async def execute(self, agent_id: str, task: Task, context: AgentContext) -> AgentResult: ...


@runtime_checkable
class SkillRepository(Protocol):
    """Read lightweight summaries separately from complete skill packages."""

    def list_summaries(self) -> Sequence[Any]: ...

    def load(self, skill_id: str) -> Any: ...


@runtime_checkable
class MemoryStore(Protocol):
    """Retrieve and persist context without exposing a storage product."""

    async def search(self, query: str, *, limit: int) -> Sequence[str]: ...

    async def append(self, run_id: str, values: Sequence[str]) -> None: ...


@runtime_checkable
class ToolGateway(Protocol):
    """Invoke a named external capability after policy evaluation."""

    async def invoke(
        self, tool_name: str, arguments: Mapping[str, Any], *, principal: str
    ) -> Mapping[str, Any]: ...


@runtime_checkable
class EventSink(Protocol):
    """Publish an immutable lifecycle event."""

    def emit(self, event_name: str, payload: Mapping[str, Any]) -> None: ...


@runtime_checkable
class RunRepository(Protocol):
    """Persist framework-neutral snapshots for recovery and inspection."""

    async def save(self, state: NexusState) -> None: ...

    async def get(self, run_id: str) -> NexusState | None: ...
