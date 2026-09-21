"""Validated authoring inputs and review outputs."""

from typing import Literal

from pydantic import Field, field_validator, model_validator

from nexusos.prd.prototype import DesignProps, Prototype
from nexusos.prd.schemas_base import StrictModel


class Source(StrictModel):
    name: str = Field(min_length=1, max_length=200)
    content: str = Field(min_length=1, max_length=20000)


class Brief(StrictModel):
    title: str = Field(min_length=1, max_length=200)
    description: str = Field(default="", max_length=12000)
    audience: str = Field(default="", max_length=4000)
    problem: str = Field(default="", max_length=6000)
    scope: str = Field(default="", max_length=8000)
    constraints: str = Field(default="", max_length=6000)
    metrics: str = Field(default="", max_length=4000)
    template: str = Field(default="", max_length=8000)
    prototype: Prototype | None = None
    sources: list[Source] = Field(default_factory=list, max_length=12)

    @field_validator("sources")
    @classmethod
    def limit_sources(cls, sources: list[Source]) -> list[Source]:
        if sum(len(source.content) for source in sources) > 50000:
            raise ValueError("参考材料合计不能超过 50,000 字符，请精简后再提交")
        return sources


class SaveDocument(StrictModel):
    expected_revision: int = Field(ge=1)
    brief: Brief
    content: str = Field(default="", max_length=200000)
    note: str = Field(default="手动保存", max_length=300)
    restored_from_version: int | None = Field(default=None, ge=1)


class DraftBrief(Brief):
    title: str = Field(default="", max_length=200)


class AssistantMessage(StrictModel):
    role: Literal["user", "assistant"]
    content: str = Field(min_length=1, max_length=6000)


class AssistantRequest(StrictModel):
    brief: DraftBrief
    message: str = Field(min_length=1, max_length=8000)
    show_thinking: bool = False
    history: list[AssistantMessage] = Field(default_factory=list, max_length=8)


class AssistantReply(StrictModel):
    answer: str = Field(min_length=1, max_length=6000)
    updates: dict[
        Literal[
            "title",
            "description",
            "audience",
            "problem",
            "scope",
            "constraints",
            "metrics",
            "template",
        ],
        str,
    ] = Field(default_factory=dict)


class ComponentAppearancePatch(StrictModel):
    width: int | None = Field(default=None, ge=0, le=1920)
    height: int | None = Field(default=None, ge=0, le=2000)
    padding: int | None = Field(default=None, ge=0, le=200)
    margin: int | None = Field(default=None, ge=0, le=200)
    fontSize: int | None = Field(default=None, ge=8, le=120)
    radius: int | None = Field(default=None, ge=0, le=200)
    color: str | None = Field(default=None, pattern=r"^(|#[0-9a-fA-F]{6})$")
    background: str | None = Field(default=None, pattern=r"^(|#[0-9a-fA-F]{6})$")
    gap: int | None = Field(default=None, ge=0, le=200)
    align: Literal["start", "center", "end", "stretch"] | None = None
    justify: Literal["start", "center", "end", "space-between"] | None = None
    wrap: Literal["wrap", "nowrap"] | None = None
    ratio: int | None = Field(default=None, ge=10, le=90)


class ComponentPatch(StrictModel):
    label: str | None = Field(default=None, max_length=80)
    detail: str | None = Field(default=None, max_length=200)
    tone: Literal["green", "blue", "gray"] | None = None
    target: str | None = Field(default=None, max_length=40)
    appearance: ComponentAppearancePatch | None = None

    @model_validator(mode="after")
    def has_changes(self) -> "ComponentPatch":
        if not self.model_dump(exclude_none=True, exclude_unset=True):
            raise ValueError("组件修改建议不能为空")
        if self.appearance is not None and not self.appearance.model_dump(exclude_none=True):
            raise ValueError("样式修改建议不能为空")
        return self


class ComponentSuggestionRequest(StrictModel):
    brief: DraftBrief
    instruction: str = Field(min_length=1, max_length=4000)
    page_id: str = Field(pattern=r"^[a-zA-Z0-9_-]{1,40}$")
    page_title: str = Field(min_length=1, max_length=80)
    component_type: Literal[
        "Heading", "Text", "Input", "Button", "Card", "List", "Divider", "Columns", "Row"
    ]
    component: DesignProps
    show_thinking: bool = False


class ComponentSuggestionReply(StrictModel):
    answer: str = Field(min_length=1, max_length=1200)
    patch: ComponentPatch


class StartJob(StrictModel):
    planning_mode: Literal["controlled_dynamic"] = "controlled_dynamic"
    expected_revision: int = Field(ge=1)
    action: Literal["generate", "revise", "review", "prototype"] = "generate"
    instruction: str = Field(default="", max_length=8000)
    show_thinking: bool = False
    retry_of_job_id: str | None = Field(default=None, pattern=r"^[a-f0-9]{32}$")
    resume_of_job_id: str | None = Field(default=None, pattern=r"^[a-f0-9]{32}$")


class ReviewIssue(StrictModel):
    severity: Literal["blocker", "major", "minor"]
    section: str = Field(min_length=1, max_length=200)
    problem: str = Field(min_length=1, max_length=3000)
    suggestion: str = Field(min_length=1, max_length=3000)


class ModelReview(StrictModel):
    summary: str = Field(min_length=1, max_length=3000)
    issues: list[ReviewIssue] = Field(max_length=40)


def clarification_questions(brief: Brief) -> list[dict[str, str]]:
    questions = {
        "description": "产品要帮助用户完成什么任务？请描述一次具体使用场景。",
        "audience": "首版优先服务谁？使用者、购买者和管理员是否不同？",
        "problem": "用户当前怎样解决这个问题？最主要的痛点和证据是什么？",
        "scope": "首版必须完成哪些功能？哪些明确不做？",
        "constraints": "有哪些平台、数据、权限、时间或成本约束？",
        "metrics": "怎样判断首版解决了问题？指标口径和目标是否已经确认？",
    }
    return [
        {"field": field, "question": question}
        for field, question in questions.items()
        if not getattr(brief, field).strip()
    ]
