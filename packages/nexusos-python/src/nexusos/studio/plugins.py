"""Trusted domain registrations; platform storage never interprets domain payloads."""

from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

from nexusos.prd.schemas_base import StrictModel
from nexusos.studio.domain_payloads import (
    PrdPayload,
    PrototypePayload,
    prd_proposal,
    prototype_proposal,
)
from nexusos.studio.example_notes import NotePayload


@dataclass(frozen=True)
class DomainPlugin:
    id: str
    resource_type: str
    payload_model: type[StrictModel]
    capabilities: tuple[str, ...]
    instruction: str
    generation_capability: str
    version: str = "1.0.0"
    default_enabled: bool = True
    protected_fields: tuple[str, ...] = ()
    prepare_proposal: Callable[[dict, dict], dict] | None = None

    def read_only(self, capability: str) -> bool:
        return capability in {"review", "clarify"}

    def agent_capabilities(self, capability: str) -> tuple[str, ...]:
        return {"review": ("quality_review",), "clarify": ("requirement_analysis",)}.get(
            capability, (self.generation_capability,)
        )

    def proposal(self, value: dict, source: dict) -> dict:
        prepared = self.prepare_proposal(value, source) if self.prepare_proposal else value
        return self.validate(prepared)

    def validate(self, value: dict[str, Any]) -> dict[str, Any]:
        return self.payload_model.model_validate(value).model_dump()

    def validate_manual_write(self, value: dict, previous: dict | None = None):
        for field in self.protected_fields:
            if value.get(field, []) != (previous or {}).get(field, []):
                raise ValueError("PROVENANCE_MANAGED_BY_PLATFORM")


PLUGINS = (
    DomainPlugin(
        "nexus.example-notes",
        "nexus.note",
        NotePayload,
        ("revise",),
        "你是便签整理 Agent。根据用户指令整理便签，保留原始事实。",
        "structured_writing",
        default_enabled=False,
    ),
    DomainPlugin(
        "nexus.prd-writer",
        "nexus.prd",
        PrdPayload,
        ("draft", "revise", "review", "clarify"),
        "你是产品需求文档 Agent。保留已确认要求，不虚构来源。根据用户指令编写或修订 PRD。",
        "prd_generation",
        protected_fields=("provenance",),
        prepare_proposal=prd_proposal,
    ),
    DomainPlugin(
        "nexus.prototype-designer",
        "nexus.prototype",
        PrototypePayload,
        ("design", "revise", "review"),
        "你是原型设计 Agent。创建声明式页面和交互，不生成可执行脚本。保留稳定组件 ID。",
        "user_flow",
        prepare_proposal=prototype_proposal,
    ),
)


def plugin_for(resource_type: str) -> DomainPlugin:
    for plugin in PLUGINS:
        if plugin.resource_type == resource_type:
            return plugin
    raise ValueError(f"Unknown resource type: {resource_type}")
