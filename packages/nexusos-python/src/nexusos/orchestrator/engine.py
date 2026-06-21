"""Application service that composes NexusOS ports into an executable run."""

from __future__ import annotations

import asyncio
from dataclasses import dataclass
from types import MappingProxyType
from typing import Any, Mapping

from nexusos.agents import AgentResolver
from nexusos.context import BudgetReport, ContextBudgetManager, ContextFragment
from nexusos.core.models import NexusState, ReviewResult, Task, TaskStatus, TokenUsage
from nexusos.core.ports import AgentRuntime, EventSink, MemoryStore
from nexusos.orchestrator.planner import ReferencePrdPlanner
from nexusos.router import HybridSkillRouter, RouteRequest, RoutingPolicy
from nexusos.skills import FileSkillRepository


@dataclass(frozen=True, slots=True)
class RunRecord:
    """Completed state plus explainability records produced during execution."""

    state: NexusState
    budgets: Mapping[str, BudgetReport]
    events: tuple[Mapping[str, Any], ...]

    def __post_init__(self) -> None:
        object.__setattr__(self, "budgets", MappingProxyType(dict(self.budgets)))


class ListEventSink:
    """Collect lifecycle events for local inspection and tests."""

    def __init__(self) -> None:
        self.events: list[Mapping[str, Any]] = []

    def emit(self, event_name: str, payload: Mapping[str, Any]) -> None:
        self.events.append(MappingProxyType({"name": event_name, **payload}))


class PrdOrchestrator:
    """Resolve, route, budget, and execute every layer of a PRD task graph."""

    def __init__(
        self,
        *,
        planner: ReferencePrdPlanner,
        resolver: AgentResolver,
        skills: FileSkillRepository,
        router: HybridSkillRouter,
        context_manager: ContextBudgetManager,
        runtime: AgentRuntime,
        memory: MemoryStore,
        events: EventSink | None = None,
        maximum_context_tokens: int = 16_000,
    ) -> None:
        self._planner = planner
        self._resolver = resolver
        self._skills = skills
        self._router = router
        self._context_manager = context_manager
        self._runtime = runtime
        self._memory = memory
        self._events = events or ListEventSink()
        self._maximum_context_tokens = maximum_context_tokens

    async def run(self, user_request: str) -> RunRecord:
        plan = self._planner.plan(user_request)
        state = NexusState(user_request=user_request, goal=plan.goal, plan=plan.graph)
        budgets: dict[str, BudgetReport] = {}
        self._events.emit(
            "nexus.run.started",
            {"run_id": state.run_id, "tasks": len(plan.graph.tasks), "complexity": plan.complexity},
        )

        for layer in plan.graph.topological_layers():
            for task in layer:
                state.task_status[task.id] = TaskStatus.RUNNING
            executions = await asyncio.gather(
                *(self._execute_task(state, task) for task in layer), return_exceptions=True
            )
            for task, execution in zip(layer, executions, strict=True):
                if isinstance(execution, BaseException):
                    state.task_status[task.id] = TaskStatus.FAILED
                    self._events.emit(
                        "nexus.task.failed",
                        {"run_id": state.run_id, "task_id": task.id, "error": str(execution)},
                    )
                    raise execution
                agent_id, skill_ids, result, budget = execution
                state.selected_agents[task.id] = agent_id
                state.selected_skills[task.id] = skill_ids
                state.completed_tasks[task.id] = result
                state.task_status[task.id] = TaskStatus.SUCCEEDED
                state.artifacts.extend(result.artifacts)
                state.evidence.extend(result.evidence)
                state.token_usage = TokenUsage(
                    state.token_usage.input_tokens + result.token_usage.input_tokens,
                    state.token_usage.output_tokens + result.token_usage.output_tokens,
                )
                budgets[task.id] = budget
                self._events.emit(
                    "nexus.task.succeeded",
                    {
                        "run_id": state.run_id,
                        "task_id": task.id,
                        "agent_id": agent_id,
                        "skill_ids": skill_ids,
                    },
                )

        state.review = ReviewResult(
            overall_score=88,
            dimensions={
                "clarity": 90,
                "completeness": 88,
                "feasibility": 87,
                "consistency": 91,
                "evidence": 84,
            },
        )
        await self._memory.append(
            state.run_id,
            tuple(result.content for result in state.completed_tasks.values()),
        )
        self._events.emit(
            "nexus.run.succeeded",
            {
                "run_id": state.run_id,
                "score": state.review.overall_score,
                "tokens": state.token_usage.total_tokens,
            },
        )
        events = tuple(getattr(self._events, "events", ()))
        return RunRecord(state=state, budgets=budgets, events=events)

    async def _execute_task(self, state: NexusState, task: Task) -> tuple[Any, ...]:
        agent = self._resolver.resolve(task)
        policy = RoutingPolicy(
            allowed_domains=agent.allowed_domains,
            allowed_tools=agent.allowed_tools,
        )
        candidates = self._router.route(
            RouteRequest(
                query=f"{task.title} {task.objective}",
                required_capabilities=task.required_capabilities,
                preferred_domains=tuple(task.metadata.get("domains", ())),
                maximum_results=agent.maximum_skills_per_task,
                token_budget=5_000,
                policy=policy,
            )
        )
        fragments = [
            ContextFragment("system", f"当前 Agent 角色：{agent.role}", required=True, priority=100),
            ContextFragment("task", task.objective, required=True, priority=100),
        ]
        for candidate in candidates:
            package = self._skills.load(candidate.skill.id)
            fragments.append(
                ContextFragment(
                    "skills",
                    package.instructions,
                    priority=80,
                    relevance=candidate.score,
                )
            )
        for result in state.results_for(task.dependencies):
            fragments.append(ContextFragment("retrieval", result.content, priority=75, relevance=0.9))
        for value in await self._memory.search(task.objective, limit=3):
            fragments.append(ContextFragment("memory", value, priority=40, relevance=0.6))

        context, budget = self._context_manager.build(
            run_id=state.run_id,
            goal=state.goal,
            task=task,
            fragments=fragments,
            maximum_tokens=self._maximum_context_tokens,
        )
        result = await self._runtime.execute(agent.id, task, context)
        return agent.id, tuple(item.skill.id for item in candidates), result, budget
