"""Domain extension contracts. The host does not interpret capability names or inputs."""

from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

from pydantic import Field

from nexusos.prd.schemas_base import StrictModel


class EmptyInput(StrictModel):
    pass


class AnalysisReply(StrictModel):
    answer: str = Field(min_length=1, max_length=20000)


@dataclass(frozen=True)
class WorkflowStage:
    id: str
    title: str
    objective: str
    required_capabilities: tuple[str, ...]
    system: str
    context: Callable[[dict, dict[str, str]], dict]
    output_tokens: int = 4000
    validate: Callable[[str], Any] | None = None


@dataclass(frozen=True)
class AgentWorkflow:
    version: str
    stages: tuple[WorkflowStage, ...]
    finish: Callable[[dict, dict[str, str]], dict]

    def __post_init__(self):
        ids = [stage.id for stage in self.stages]
        if not self.version or not ids or len(ids) != len(set(ids)) or not all(ids):
            raise ValueError("Invalid workflow declaration")


@dataclass(frozen=True)
class AgentCapability:
    id: str
    required_capabilities: tuple[str, ...]
    instruction: str = ""
    version: str = "1"
    read_only: bool = False
    input_model: type[StrictModel] = EmptyInput
    output_model: type[StrictModel] | None = None
    context: Callable[[dict, dict], dict] | None = None
    propose: Callable[[dict, dict, dict], dict] | None = None
    workflow: AgentWorkflow | None = None

    def validate_input(self, value: dict) -> dict:
        return self.input_model.model_validate(value).model_dump()


@dataclass(frozen=True)
class ArtifactProducer:
    artifact_type: str
    schema_version: int
    prepare: Callable[[dict, Callable[[str], dict]], dict]
    hydrate: Callable[[dict, Callable[[dict], str]], dict]


@dataclass(frozen=True)
class ArtifactConsumer:
    artifact_type: str
    schema_version: int
    propose: Callable[[dict, dict, dict], dict]


@dataclass(frozen=True)
class DomainPlugin:
    id: str
    resource_type: str
    payload_model: type[StrictModel]
    actions: tuple[AgentCapability, ...]
    instruction: str
    version: str = "1.1.0"
    default_enabled: bool = True
    protected_fields: tuple[str, ...] = ()
    prepare_proposal: Callable[[dict, dict], dict] | None = None

    artifact_producer: ArtifactProducer | None = None
    artifact_consumers: tuple[ArtifactConsumer, ...] = ()

    @property
    def capabilities(self) -> tuple[str, ...]:
        return tuple(action.id for action in self.actions)

    def action(self, identifier: str) -> AgentCapability:
        return next(action for action in self.actions if action.id == identifier)

    def proposal(self, value: dict, source: dict) -> dict:
        prepared = self.prepare_proposal(value, source) if self.prepare_proposal else value
        return self.validate(prepared)

    def validate(self, value: dict[str, Any]) -> dict[str, Any]:
        return self.payload_model.model_validate(value).model_dump()

    def validate_manual_write(self, value: dict, previous: dict | None = None):
        for field in self.protected_fields:
            if value.get(field, []) != (previous or {}).get(field, []):
                raise ValueError("PROVENANCE_MANAGED_BY_PLATFORM")
