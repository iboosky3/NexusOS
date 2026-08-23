"""Normalized A2A value objects kept independent from HTTP and SDK types."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import UTC, datetime
from enum import StrEnum
from types import MappingProxyType
from typing import Any, Mapping


class A2ATaskState(StrEnum):
    """Lifecycle states accepted at the NexusOS interoperability boundary."""

    SUBMITTED = "submitted"
    WORKING = "working"
    INPUT_REQUIRED = "input_required"
    AUTH_REQUIRED = "auth_required"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELED = "canceled"
    REJECTED = "rejected"

    @property
    def terminal(self) -> bool:
        """Return whether no further remote state transition is valid."""

        return self in {
            A2ATaskState.COMPLETED,
            A2ATaskState.FAILED,
            A2ATaskState.CANCELED,
            A2ATaskState.REJECTED,
        }


class MessageRole(StrEnum):
    """Roles used by normalized cross-agent messages."""

    USER = "user"
    AGENT = "agent"


@dataclass(frozen=True, slots=True)
class AgentSkill:
    """A discoverable capability advertised by an external agent."""

    id: str
    name: str
    description: str
    input_modes: tuple[str, ...] = ("text/plain",)
    output_modes: tuple[str, ...] = ("text/plain",)

    def __post_init__(self) -> None:
        if not self.id.strip() or not self.name.strip() or not self.description.strip():
            raise ValueError("agent skill id, name, and description are required")


@dataclass(frozen=True, slots=True)
class AgentCard:
    """Versioned discovery metadata for one trusted external agent endpoint."""

    name: str
    description: str
    url: str
    protocol_version: str
    skills: tuple[AgentSkill, ...]
    security_schemes: tuple[str, ...] = ()

    def __post_init__(self) -> None:
        if not self.name.strip() or not self.description.strip():
            raise ValueError("agent name and description are required")
        if not self.url.startswith(("https://", "http://localhost", "http://127.0.0.1")):
            raise ValueError("agent card URL must use HTTPS except for loopback development")
        skill_ids = [skill.id for skill in self.skills]
        if not skill_ids or len(skill_ids) != len(set(skill_ids)):
            raise ValueError("agent card requires unique skills")


@dataclass(frozen=True, slots=True)
class A2AMessage:
    """One immutable message exchanged within an external task context."""

    id: str
    role: MessageRole
    text: str
    metadata: Mapping[str, Any] = field(default_factory=dict)

    def __post_init__(self) -> None:
        if not self.id.strip() or not self.text.strip():
            raise ValueError("message id and text are required")
        object.__setattr__(self, "metadata", MappingProxyType(dict(self.metadata)))


@dataclass(frozen=True, slots=True)
class A2AArtifact:
    """A named result produced by an external agent task."""

    id: str
    name: str
    media_type: str
    content: str

    def __post_init__(self) -> None:
        if not self.id.strip() or not self.name.strip() or not self.media_type.strip():
            raise ValueError("artifact id, name, and media type are required")


@dataclass(frozen=True, slots=True)
class A2ATask:
    """Auditable local projection of one delegated external agent task."""

    id: str
    context_id: str
    tenant_id: str
    agent_name: str
    skill_id: str
    state: A2ATaskState
    created_at: datetime
    updated_at: datetime
    messages: tuple[A2AMessage, ...] = ()
    artifacts: tuple[A2AArtifact, ...] = ()
    correlation_id: str | None = None
    failure_code: str | None = None

    def __post_init__(self) -> None:
        required = (self.id, self.context_id, self.tenant_id, self.agent_name, self.skill_id)
        if any(not value.strip() for value in required):
            raise ValueError("task identity, tenant, agent, and skill are required")
        if self.created_at.tzinfo is None or self.updated_at.tzinfo is None:
            raise ValueError("task timestamps must be timezone-aware")
        if self.state is A2ATaskState.FAILED and not self.failure_code:
            raise ValueError("failed task requires a failure code")
        if self.state is not A2ATaskState.FAILED and self.failure_code:
            raise ValueError("failure code is only valid for failed tasks")

    @classmethod
    def submitted(
        cls,
        *,
        task_id: str,
        context_id: str,
        tenant_id: str,
        agent_name: str,
        skill_id: str,
        message: A2AMessage,
        correlation_id: str | None = None,
    ) -> A2ATask:
        """Create a submitted task with its initiating user message."""

        now = datetime.now(UTC)
        return cls(
            id=task_id,
            context_id=context_id,
            tenant_id=tenant_id,
            agent_name=agent_name,
            skill_id=skill_id,
            state=A2ATaskState.SUBMITTED,
            created_at=now,
            updated_at=now,
            messages=(message,),
            correlation_id=correlation_id,
        )
