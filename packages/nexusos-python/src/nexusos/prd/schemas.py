"""Validated authoring inputs and review outputs."""

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


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


class StartJob(StrictModel):
    expected_revision: int = Field(ge=1)
    action: Literal["generate", "revise", "review"] = "generate"
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
