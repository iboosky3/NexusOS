"""PRD stage declarations for the proposal-only resource API; no legacy job or writes."""

import re
from copy import deepcopy

from pydantic import Field

from nexusos.prd.media import MediaReferences
from nexusos.prd.review import inspect_traceability
from nexusos.prd.schemas import DraftBrief, clarification_questions
from nexusos.prd.schemas_base import StrictModel
from nexusos.prd.workflow import (
    AUTHORING_RULES,
    REVIEW_TASK,
    WRITING_PARTS,
    WRITING_TASK,
    parse_review,
    validate_merged_prd,
)
from nexusos.studio.domain_payloads import PrdPayload
from nexusos.studio.plugin_contract import AgentWorkflow, WorkflowStage

# Keep adopted source sections byte-for-byte so their provenance digests remain valid.
SOURCE_SECTION = re.compile(
    r"<!-- studio-source:([^:\s]+):start -->[\s\S]*?<!-- studio-source:\1:end -->"
)


class AuthoringReply(StrictModel):
    answer: str = Field(min_length=1, max_length=200000)
    payload: PrdPayload


def source_content(source: dict) -> tuple[str, list[str]]:
    content = source["content"]
    sections = [match.group() for match in SOURCE_SECTION.finditer(content)]
    remainder = SOURCE_SECTION.sub("", content)
    if "<!-- studio-source:" in remainder:
        raise ValueError("SOURCE_SECTION_DAMAGED")
    return remainder, sections


def writing_context(source: dict, outputs: dict[str, str]) -> dict:
    content, sections = source_content(source)
    brief = deepcopy(source["brief"])
    brief["sources"] = [
        {"id": f"S{index}", **entry} for index, entry in enumerate(brief["sources"], 1)
    ]
    return {
        "brief": brief,
        "existingContent": content,
        "adoptedDesigns": sections,
        "previousStages": outputs,
    }


def merged_content(source: dict, outputs: dict[str, str]) -> str:
    content = "\n\n".join(outputs[key] for key, _, _ in WRITING_PARTS)
    if "<!-- studio-source:" in content:
        raise ValueError("GENERATED_SOURCE_SECTION")
    validate_merged_prd(content)
    original, adopted = source_content(source)
    media = MediaReferences()
    media.protect(source["content"])
    content = media.restore(content, original)
    if adopted:
        content += "\n\n" + "\n\n".join(adopted)
    if len(content) > 200000:
        raise ValueError("CONTENT_TOO_LARGE")
    return content


def review_context(source: dict, outputs: dict[str, str]) -> dict:
    return {
        "brief": source["brief"],
        "content": merged_content(source, outputs) if outputs else source["content"],
    }


def review_answer(source: dict, outputs: dict[str, str], content: str) -> str:
    review = parse_review(outputs["review"])
    brief = DraftBrief.model_validate(source["brief"])
    review["issues"].extend(issue.model_dump() for issue in inspect_traceability(content, brief))
    lines = [
        "需要修订，尚未通过人工验收。"
        if review["issues"]
        else "可进入人工评审，尚未通过人工验收。",
        review["summary"],
    ]
    for issue in review["issues"]:
        lines.append(
            f"[{issue['severity']}] {issue['section']}：{issue['problem']}\n"
            f"建议：{issue['suggestion']}"
        )
    lines.extend(f"待确认：{item['question']}" for item in clarification_questions(brief))
    return "\n\n".join(lines)


def finish_authoring(source: dict, outputs: dict[str, str]) -> dict:
    content = merged_content(source, outputs)
    return {
        "payload": {**deepcopy(source), "content": content},
        "answer": review_answer(source, outputs, content),
    }


def finish_review(source: dict, outputs: dict[str, str]) -> dict:
    return {"answer": review_answer(source, outputs, source["content"])}


def authoring_proposal(value: dict, source: dict, inputs: dict) -> dict:
    return value["payload"]


RULES = AUTHORING_RULES + "\n所有阶段只形成待确认提案，禁止宣称已保存。保留用户范围。"
RULES += "已采用设计仅作为需求依据；不要输出 studio-source 标记或复制设计附录，系统会保留。"
ANALYSIS = tuple(
    WorkflowStage(identifier, title, objective, (capability,), RULES, writing_context)
    for identifier, title, objective, capability in (
        (
            "requirements",
            "需求与范围",
            "建立需求清单、首版边界、业务规则和待确认问题；区分事实与建议。",
            "requirement_analysis",
        ),
        ("ux", "流程与异常", "细化主流程、页面、异常状态与恢复，遵守首版范围。", "user_flow"),
        (
            "technical",
            "数据与可行性",
            "检查数据、权限、接口、非功能约束和验收风险。",
            "technical_design",
        ),
    )
)
WRITING = tuple(
    WorkflowStage(
        identifier,
        title,
        f"{WRITING_TASK}\n{objective}",
        ("prd_generation",),
        RULES,
        writing_context,
        output_tokens=8000,
    )
    for identifier, title, objective in WRITING_PARTS
)
REVIEW = WorkflowStage(
    "review",
    "质量评审",
    REVIEW_TASK,
    ("quality_review",),
    RULES,
    review_context,
    output_tokens=6000,
    validate=parse_review,
)
DRAFT = AgentWorkflow("prd-resource-draft/1", (*ANALYSIS, *WRITING, REVIEW), finish_authoring)
REVISE = AgentWorkflow("prd-resource-revise/1", (*WRITING, REVIEW), finish_authoring)
REVIEW_ONLY = AgentWorkflow("prd-resource-review/1", (REVIEW,), finish_review)
