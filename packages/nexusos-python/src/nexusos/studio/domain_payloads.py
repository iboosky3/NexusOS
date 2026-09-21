"""Built-in resource schemas and proposal policies, outside the platform host."""

from copy import deepcopy
from typing import Any

from pydantic import Field, model_validator

from nexusos.prd.prototype import Prototype
from nexusos.prd.schemas import DraftBrief
from nexusos.prd.schemas_base import StrictModel


class PrdPayload(StrictModel):
    brief: DraftBrief
    content: str = Field(default="", max_length=200000)
    provenance: list[dict[str, Any]] = Field(default_factory=list, max_length=100)

    @model_validator(mode="after")
    def independent_resource(self):
        if self.brief.prototype:
            raise ValueError("原型应保存为独立资源，通过已确认产物交接")
        return self


class PrototypePayload(StrictModel):
    title: str = Field(default="未命名原型", min_length=1, max_length=200)
    description: str = Field(default="", max_length=12000)
    prototype: Prototype | None = None


def prd_proposal(value: dict, source: dict) -> dict:
    result = deepcopy(value)
    result["provenance"] = deepcopy(source.get("provenance", []))
    return result


def prototype_proposal(value: dict, source: dict) -> dict:
    result = deepcopy(value)
    prototype = result.get("prototype")
    if isinstance(prototype, dict):
        prototype["confirmed"] = False
        prototype.pop("input_digest", None)
        for page in prototype.get("pages", []):
            if isinstance(page, dict):
                page["screenshot"] = ""
    return result
