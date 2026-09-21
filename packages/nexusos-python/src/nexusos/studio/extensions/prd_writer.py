"""PRD capabilities adapted from the existing authoring contracts."""

from copy import deepcopy

from nexusos.prd.schemas import AssistantReply
from nexusos.studio.domain_payloads import PrdPayload, prd_proposal
from nexusos.studio.plugin_contract import AgentCapability, AnalysisReply, DomainPlugin


def clarify_context(source: dict, inputs: dict) -> dict:
    return {"brief": source["brief"]}


def clarify_proposal(value: dict, source: dict, inputs: dict) -> dict:
    result = deepcopy(source)
    result["brief"].update(value["updates"])
    return result


plugin = DomainPlugin(
    id="nexus.prd-writer",
    resource_type="nexus.prd",
    payload_model=PrdPayload,
    actions=(
        AgentCapability("draft", ("prd_generation",)),
        AgentCapability("revise", ("prd_generation",)),
        AgentCapability("review", ("quality_review",), read_only=True, output_model=AnalysisReply),
        AgentCapability(
            "clarify",
            ("requirement_analysis",),
            instruction="澄清需求：回答用户并仅通过 updates 建议修改简报字段；不改正文或来源。",
            output_model=AssistantReply,
            context=clarify_context,
            propose=clarify_proposal,
        ),
    ),
    instruction="你是产品需求文档 Agent。保留已确认要求，不虚构来源。根据用户指令编写或修订 PRD。",
    protected_fields=("provenance",),
    prepare_proposal=prd_proposal,
)
