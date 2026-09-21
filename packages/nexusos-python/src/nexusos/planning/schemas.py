"""Strict transport contracts for the first text-only planning release."""

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field

PlanningMode = Literal["ai_dynamic", "controlled_dynamic"]
Identifier = Annotated[str, Field(pattern=r"^[a-zA-Z0-9_-]{1,64}$")]
Text = Annotated[str, Field(min_length=1, max_length=4000)]


class PlanningModel(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True, frozen=True)


class PlanRequest(PlanningModel):
    request: str = Field(min_length=1, max_length=12000)
    planning_mode: PlanningMode = "ai_dynamic"
    maximum_output_tokens: int = Field(default=16000, ge=512, le=32000)
    supersedes: str | None = Field(default=None, pattern=r"^[a-f0-9]{32}$")


class IntentDecision(PlanningModel):
    goal: Text
    domain: Identifier
    confidence: float = Field(ge=0, le=1)
    supported: bool
    rationale: Text
    constraints: tuple[Text, ...] = Field(default=(), max_length=12)
    acceptance_criteria: tuple[Text, ...] = Field(min_length=1, max_length=12)
    questions: tuple[Text, ...] = Field(default=(), max_length=8)


class ProposedTask(PlanningModel):
    id: Identifier
    title: str = Field(min_length=1, max_length=200)
    objective: Text
    dependencies: tuple[Identifier, ...] = Field(default=(), max_length=8)
    required_capabilities: tuple[Identifier, ...] = Field(min_length=1, max_length=8)
    required_tools: tuple[Identifier, ...] = Field(default=(), max_length=8)
    expected_output: Text
    acceptance_criteria: tuple[Text, ...] = Field(min_length=1, max_length=8)
    risk: Literal["low", "medium", "high"] = "low"
    output_tokens: int = Field(default=2000, ge=256, le=4000)
    agent_id: Identifier | None = None
    skill_ids: tuple[Identifier, ...] | None = Field(default=None, max_length=8)


class PlanProposal(PlanningModel):
    rationale: Text
    tasks: tuple[ProposedTask, ...] = Field(min_length=1, max_length=12)


class ExecutePlan(PlanningModel):
    digest: str = Field(pattern=r"^[a-f0-9]{64}$")


class RevisePlan(ExecutePlan):
    proposal: PlanProposal
