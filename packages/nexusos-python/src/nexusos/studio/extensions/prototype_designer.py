"""Prototype generation and component-scoped suggestions."""

from copy import deepcopy

from pydantic import Field

from nexusos.prd.schemas import ComponentSuggestionReply
from nexusos.prd.schemas_base import StrictModel
from nexusos.studio.domain_payloads import PrototypePayload, prototype_proposal
from nexusos.studio.extensions.prototype_artifact import producer
from nexusos.studio.plugin_contract import AgentCapability, AnalysisReply, DomainPlugin


class ComponentInput(StrictModel):
    pageId: str = Field(pattern=r"^[a-zA-Z0-9_-]{1,40}$")
    componentId: str = Field(min_length=1, max_length=100)


def selected_component(source: dict, inputs: dict) -> tuple[dict, dict]:
    pages = (source.get("prototype") or {}).get("pages", [])
    page = next((page for page in pages if page["id"] == inputs["pageId"]), None)
    if page is None or not page.get("design"):
        raise ValueError("COMPONENT_SCOPE_NOT_FOUND")
    matches = []

    def visit(blocks):
        for block in blocks:
            if block["props"]["id"] == inputs["componentId"]:
                matches.append(block)
            visit(block["props"].get("left", []))
            visit(block["props"].get("right", []))

    visit(page["design"]["content"])
    if len(matches) != 1:
        raise ValueError("COMPONENT_SCOPE_NOT_FOUND")
    return page, matches[0]


def component_context(source: dict, inputs: dict) -> dict:
    page, block = selected_component(source, inputs)
    return {
        "goal": source.get("description", ""),
        "page": {"id": page["id"], "title": page["title"]},
        "allowedPageIds": [page["id"] for page in source["prototype"]["pages"]],
        "component": {
            "type": block["type"],
            "props": {
                key: value for key, value in block["props"].items() if key not in {"left", "right"}
            },
        },
    }


def component_proposal(value: dict, source: dict, inputs: dict) -> dict:
    result = deepcopy(source)
    page, block = selected_component(result, inputs)
    patch = ComponentSuggestionReply.model_validate(value).patch.model_dump(exclude_none=True)
    appearance = patch.pop("appearance", None)
    block["props"].update(patch)
    if appearance is not None:
        block["props"]["appearance"] = {**(block["props"].get("appearance") or {}), **appearance}
    page["screenshot"] = ""
    result["prototype"].update(confirmed=False, input_digest="", document="")
    # Full domain validation checks navigation targets and recomputes derived elements/document.
    return result


plugin = DomainPlugin(
    id="nexus.prototype-designer",
    artifact_producer=producer,
    resource_type="nexus.prototype",
    payload_model=PrototypePayload,
    actions=(
        AgentCapability("design", ("user_flow",)),
        AgentCapability("revise", ("user_flow",)),
        AgentCapability("review", ("quality_review",), read_only=True, output_model=AnalysisReply),
        AgentCapability(
            "component",
            ("user_flow",),
            instruction=(
                "组件建议：只建议修改选中组件的文案、样式或跳转；"
                "不可改 ID、类型、子组件或其它页面。"
            ),
            input_model=ComponentInput,
            output_model=ComponentSuggestionReply,
            context=component_context,
            propose=component_proposal,
        ),
    ),
    instruction="你是原型设计 Agent。创建声明式页面和交互，不生成可执行脚本。保留稳定组件 ID。",
    prepare_proposal=prototype_proposal,
)
