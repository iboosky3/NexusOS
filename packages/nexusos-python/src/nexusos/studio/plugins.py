"""Trusted domain registrations; platform storage never interprets domain payloads."""

from dataclasses import dataclass
from typing import Any

from pydantic import Field

from nexusos.prd.prototype import Prototype
from nexusos.prd.schemas import DraftBrief
from nexusos.prd.schemas_base import StrictModel


class PrdPayload(StrictModel):
    brief: DraftBrief
    content: str = Field(default="", max_length=200000)
    provenance: list[dict[str, Any]] = Field(default_factory=list, max_length=100)


class PrototypePayload(StrictModel):
    title: str = Field(default="未命名原型", min_length=1, max_length=200)
    description: str = Field(default="", max_length=12000)
    prototype: Prototype | None = None


@dataclass(frozen=True)
class DomainPlugin:
    id: str
    resource_type: str
    payload_model: type[StrictModel]
    capabilities: tuple[str, ...]
    instruction: str

    def validate(self, value: dict[str, Any]) -> dict[str, Any]:
        payload = self.payload_model.model_validate(value).model_dump()
        if self.resource_type == "nexus.prd" and payload["brief"].get("prototype"):
            raise ValueError("原型应保存为独立资源，通过已确认产物交接")
        return payload


PLUGINS = (
    DomainPlugin(
        "nexus.prd-writer",
        "nexus.prd",
        PrdPayload,
        ("draft", "revise", "review", "clarify"),
        "你是产品需求文档 Agent。保留已确认要求，不虚构来源。根据用户指令编写或修订 PRD。",
    ),
    DomainPlugin(
        "nexus.prototype-designer",
        "nexus.prototype",
        PrototypePayload,
        ("design", "revise", "review"),
        "你是原型设计 Agent。创建声明式页面和交互，不生成可执行脚本。保留稳定组件 ID。",
    ),
)


def plugin_for(resource_type: str) -> DomainPlugin:
    for plugin in PLUGINS:
        if plugin.resource_type == resource_type:
            return plugin
    raise ValueError(f"Unknown resource type: {resource_type}")
