"""Application service that composes NexusOS ports into an executable run."""

from __future__ import annotations

import asyncio
from dataclasses import dataclass
from datetime import UTC, datetime
from types import MappingProxyType
from typing import Any, Mapping

from nexusos.agents import AgentResolver
from nexusos.context import BudgetReport, ContextBudgetManager, ContextFragment
from nexusos.core.models import NexusState, Task, TaskStatus, TokenUsage
from nexusos.core.ports import AgentRuntime, EventSink, MemoryStore
from nexusos.evaluation import evaluate_prd
from nexusos.orchestrator.planner import ReferencePrdPlanner
from nexusos.orchestrator.replanner import RevisionPlanner
from nexusos.router import HybridSkillRouter, RouteCandidate, RouteRequest, RoutingPolicy
from nexusos.skills import FileSkillRepository


@dataclass(frozen=True, slots=True)
class RunRecord:
    """Completed state plus explainability records produced during execution."""

    state: NexusState
    tasks: Mapping[str, Task]
    routes: Mapping[str, tuple[RouteCandidate, ...]]
    budgets: Mapping[str, BudgetReport]
    events: tuple[Mapping[str, Any], ...]
    started_at: datetime
    completed_at: datetime

    def __post_init__(self) -> None:
        object.__setattr__(self, "tasks", MappingProxyType(dict(self.tasks)))
        object.__setattr__(self, "routes", MappingProxyType(dict(self.routes)))
        object.__setattr__(self, "budgets", MappingProxyType(dict(self.budgets)))

    @property
    def duration_ms(self) -> int:
        """Return elapsed wall-clock duration rounded to milliseconds."""

        return max(0, round((self.completed_at - self.started_at).total_seconds() * 1000))


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
        maximum_iterations: int = 2,
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
        self._maximum_iterations = maximum_iterations
        self._replanner = RevisionPlanner()

    async def run(self, user_request: str) -> RunRecord:
        started_at = datetime.now(UTC)
        plan = self._planner.plan(user_request)
        state = NexusState(user_request=user_request, goal=plan.goal, plan=plan.graph)
        tasks = {task.id: task for task in plan.graph.tasks}
        routes: dict[str, tuple[RouteCandidate, ...]] = {}
        budgets: dict[str, BudgetReport] = {}
        self._events.emit(
            "nexus.run.started",
            {"run_id": state.run_id, "tasks": len(plan.graph.tasks), "complexity": plan.complexity},
        )

        await self._execute_graph(state, plan.graph, tasks, routes, budgets)
        self._review_latest_artifact(state)
        while state.review and not state.review.passed and state.iteration < self._maximum_iterations:
            state.iteration += 1
            self._events.emit(
                "nexus.run.revision.started",
                {
                    "run_id": state.run_id,
                    "iteration": state.iteration,
                    "revision_tasks": state.review.revision_tasks,
                },
            )
            revision_graph = self._replanner.plan(state.review, state.iteration)
            await self._execute_graph(state, revision_graph, tasks, routes, budgets)
            self._review_latest_artifact(state)

        await self._memory.append(
            state.run_id,
            tuple(result.content for result in state.completed_tasks.values()),
        )
        event_name = "nexus.run.succeeded" if state.review and state.review.passed else "nexus.run.blocked"
        self._events.emit(
            event_name,
            {
                "run_id": state.run_id,
                "score": state.review.overall_score if state.review else 0,
                "tokens": state.token_usage.total_tokens,
                "iterations": state.iteration,
            },
        )
        events = tuple(getattr(self._events, "events", ()))
        return RunRecord(
            state=state,
            tasks=tasks,
            routes=routes,
            budgets=budgets,
            events=events,
            started_at=started_at,
            completed_at=datetime.now(UTC),
        )

    async def _execute_graph(
        self,
        state: NexusState,
        graph: Any,
        tasks: dict[str, Task],
        routes: dict[str, tuple[RouteCandidate, ...]],
        budgets: dict[str, BudgetReport],
    ) -> None:
        tasks.update((task.id, task) for task in graph.tasks)
        for layer in graph.topological_layers():
            for task in layer:
                state.task_status[task.id] = TaskStatus.RUNNING
                self._events.emit(
                    "nexus.task.started",
                    {"run_id": state.run_id, "task_id": task.id},
                )
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
                agent_id, candidates, result, budget = execution
                skill_ids = tuple(candidate.skill.id for candidate in candidates)
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
                routes[task.id] = candidates
                self._events.emit(
                    "nexus.task.succeeded",
                    {
                        "run_id": state.run_id,
                        "task_id": task.id,
                        "agent_id": agent_id,
                        "skill_ids": skill_ids,
                    },
                )

    @staticmethod
    def _review_latest_artifact(state: NexusState) -> None:
        prd_artifact = next(
            (artifact for artifact in reversed(state.artifacts) if artifact.name == "PRD.md"), None
        )
        state.review = evaluate_prd(
            prd_artifact.content if prd_artifact else "",
            evidence_count=len(state.evidence),
        )

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
        return agent.id, candidates, result, budget
