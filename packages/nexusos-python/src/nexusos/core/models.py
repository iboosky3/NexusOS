"""Framework-neutral domain models used by the orchestration core."""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import StrEnum
from types import MappingProxyType
from typing import Any, Mapping, Sequence
from uuid import uuid4


class TaskStatus(StrEnum):
    """Lifecycle states shared by every runtime adapter."""

    PENDING = "pending"
    READY = "ready"
    RUNNING = "running"
    SUCCEEDED = "succeeded"
    FAILED = "failed"
    BLOCKED = "blocked"


@dataclass(frozen=True, slots=True)
class Goal:
    """Normalized user intent and constraints."""

    statement: str
    constraints: tuple[str, ...] = ()
    acceptance_criteria: tuple[str, ...] = ()

    def __post_init__(self) -> None:
        if not self.statement.strip():
            raise ValueError("goal statement cannot be empty")


@dataclass(frozen=True, slots=True)
class Task:
    """A single schedulable unit in a task graph."""

    id: str
    title: str
    objective: str
    dependencies: tuple[str, ...] = ()
    required_capabilities: tuple[str, ...] = ()
    metadata: Mapping[str, Any] = field(default_factory=dict)

    def __post_init__(self) -> None:
        if not self.id.strip() or not self.title.strip() or not self.objective.strip():
            raise ValueError("task id, title, and objective are required")
        if self.id in self.dependencies:
            raise ValueError(f"task {self.id!r} cannot depend on itself")
        object.__setattr__(self, "metadata", MappingProxyType(dict(self.metadata)))


@dataclass(frozen=True, slots=True)
class TaskGraph:
    """Validated directed acyclic graph of tasks."""

    tasks: tuple[Task, ...]

    def __post_init__(self) -> None:
        task_ids = [task.id for task in self.tasks]
        if len(task_ids) != len(set(task_ids)):
            raise ValueError("task ids must be unique")
        known = set(task_ids)
        for task in self.tasks:
            missing = set(task.dependencies) - known
            if missing:
                raise ValueError(f"task {task.id!r} has unknown dependencies: {sorted(missing)}")
        self.topological_layers()

    def topological_layers(self) -> tuple[tuple[Task, ...], ...]:
        """Return deterministic execution layers and reject dependency cycles."""

        by_id = {task.id: task for task in self.tasks}
        remaining = {task.id: set(task.dependencies) for task in self.tasks}
        layers: list[tuple[Task, ...]] = []
        completed: set[str] = set()

        while remaining:
            ready_ids = sorted(task_id for task_id, deps in remaining.items() if deps <= completed)
            if not ready_ids:
                cycle_nodes = ", ".join(sorted(remaining))
                raise ValueError(f"task graph contains a cycle involving: {cycle_nodes}")
            layers.append(tuple(by_id[task_id] for task_id in ready_ids))
            completed.update(ready_ids)
            for task_id in ready_ids:
                del remaining[task_id]
        return tuple(layers)


@dataclass(frozen=True, slots=True)
class Evidence:
    """A traceable source used by an agent result."""

    source: str
    summary: str
    uri: str | None = None


@dataclass(frozen=True, slots=True)
class Artifact:
    """A named output produced during a run."""

    name: str
    media_type: str
    content: str


@dataclass(frozen=True, slots=True)
class TokenUsage:
    """Normalized model usage independent of any provider."""

    input_tokens: int = 0
    output_tokens: int = 0

    @property
    def total_tokens(self) -> int:
        return self.input_tokens + self.output_tokens


@dataclass(frozen=True, slots=True)
class AgentContext:
    """Budgeted context delivered to one agent execution."""

    run_id: str
    goal: Goal
    task: Task
    sections: Mapping[str, tuple[str, ...]] = field(default_factory=dict)
    token_budget: int = 0

    def __post_init__(self) -> None:
        immutable = {key: tuple(values) for key, values in self.sections.items()}
        object.__setattr__(self, "sections", MappingProxyType(immutable))


@dataclass(frozen=True, slots=True)
class AgentResult:
    """Normalized result returned by every agent runtime."""

    task_id: str
    agent_id: str
    content: str
    evidence: tuple[Evidence, ...] = ()
    artifacts: tuple[Artifact, ...] = ()
    token_usage: TokenUsage = field(default_factory=TokenUsage)


@dataclass(frozen=True, slots=True)
class ReviewResult:
    """Structured quality gate for reflection and replanning."""

    overall_score: float
    dimensions: Mapping[str, float]
    blocking_issues: tuple[str, ...] = ()
    revision_tasks: tuple[str, ...] = ()

    @property
    def passed(self) -> bool:
        return self.overall_score >= 85 and not self.blocking_issues


@dataclass(slots=True)
class NexusState:
    """Mutable run state with framework-neutral field types."""

    user_request: str
    goal: Goal
    plan: TaskGraph
    run_id: str = field(default_factory=lambda: str(uuid4()))
    task_status: dict[str, TaskStatus] = field(default_factory=dict)
    completed_tasks: dict[str, AgentResult] = field(default_factory=dict)
    selected_agents: dict[str, str] = field(default_factory=dict)
    selected_skills: dict[str, tuple[str, ...]] = field(default_factory=dict)
    artifacts: list[Artifact] = field(default_factory=list)
    evidence: list[Evidence] = field(default_factory=list)
    review: ReviewResult | None = None
    token_usage: TokenUsage = field(default_factory=TokenUsage)
    iteration: int = 0

    def __post_init__(self) -> None:
        for task in self.plan.tasks:
            self.task_status.setdefault(task.id, TaskStatus.PENDING)

    def results_for(self, dependencies: Sequence[str]) -> tuple[AgentResult, ...]:
        """Return dependency results in caller-provided order."""

        return tuple(self.completed_tasks[item] for item in dependencies if item in self.completed_tasks)
