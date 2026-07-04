"""Application composition roots for local and embedded NexusOS deployments."""

from __future__ import annotations

from pathlib import Path

from nexusos.agents import AgentResolver, FileAgentRegistry
from nexusos.context import ContextBudgetManager
from nexusos.memory import InMemoryMemoryStore
from nexusos.orchestrator import ListEventSink, PrdOrchestrator, ReferencePrdPlanner
from nexusos.router import HybridSkillRouter
from nexusos.runtime import LocalAgentRuntime
from nexusos.skills import FileSkillRepository


def build_reference_orchestrator(root: str | Path = ".") -> PrdOrchestrator:
    """Build the dependency-free reference stack from repository manifests."""

    repository_root = Path(root)
    skills = FileSkillRepository(repository_root / "skills")
    agents = FileAgentRegistry(repository_root / "agents")
    return PrdOrchestrator(
        planner=ReferencePrdPlanner(),
        resolver=AgentResolver(agents.list()),
        skills=skills,
        router=HybridSkillRouter(skills.list_summaries()),
        context_manager=ContextBudgetManager(),
        runtime=LocalAgentRuntime(),
        memory=InMemoryMemoryStore(),
        events=ListEventSink(),
    )
