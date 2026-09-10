"""Optional LangGraph adapter behind the NexusOS AgentRuntime contract."""

from __future__ import annotations

from importlib import import_module
from typing import TypedDict

from nexusos.core.models import AgentContext, AgentResult, Artifact, Task
from nexusos.models import ChatMessage, ModelGateway, ModelRequest, ModelResponse
from nexusos.models.gateway import ModelGatewayRejected


class _RuntimeState(TypedDict, total=False):
    agent_id: str
    task: Task
    context: AgentContext
    response: ModelResponse


class LangGraphRuntime:
    """Execute an agent reasoning graph while preserving NexusOS contracts."""

    def __init__(self, model_gateway: ModelGateway, *, model: str) -> None:
        self._model_gateway = model_gateway
        self._model = model

    async def execute(self, agent_id: str, task: Task, context: AgentContext) -> AgentResult:
        try:
            graph_api = import_module("langgraph.graph")
        except ModuleNotFoundError as exc:
            raise RuntimeError("install nexusos with the 'runtime' extra to use LangGraph") from exc

        async def invoke_model(state: _RuntimeState) -> _RuntimeState:
            request = self._build_request(state["agent_id"], state["task"], state["context"])
            return {"response": await self._model_gateway.complete(request)}

        builder = graph_api.StateGraph(_RuntimeState)
        builder.add_node("invoke_model", invoke_model)
        builder.add_edge(graph_api.START, "invoke_model")
        builder.add_edge("invoke_model", graph_api.END)
        graph = builder.compile()
        outcome = await graph.ainvoke({"agent_id": agent_id, "task": task, "context": context})
        response: ModelResponse = outcome["response"]
        if response.finish_reason not in {"stop", "end_turn"} or not response.content.strip():
            raise ModelGatewayRejected("model output is empty, incomplete, or filtered")
        artifacts: tuple[Artifact, ...] = ()
        if task.id == "write":
            artifacts = (Artifact("PRD.md", "text/markdown", response.content),)
        return AgentResult(
            task_id=task.id,
            agent_id=agent_id,
            content=response.content,
            artifacts=artifacts,
            token_usage=response.usage,
        )

    def _build_request(self, agent_id: str, task: Task, context: AgentContext) -> ModelRequest:
        sections = "\n\n".join(
            f"[{name}]\n" + "\n".join(values) for name, values in context.sections.items()
        )
        return ModelRequest(
            messages=(
                ChatMessage(
                    "system",
                    f"You are NexusOS agent {agent_id}. "
                    "Follow the selected skills and constraints.\n"
                    + str(task.metadata.get("system_prompt", "")),
                ),
                ChatMessage(
                    "user",
                    f"Task: {task.title}\nObjective: {task.objective}\n\n{sections}",
                ),
            ),
            model=self._model,
            maximum_output_tokens=int(
                task.metadata.get("maximum_output_tokens", max(256, context.token_budget // 4))
            ),
            metadata={
                "run_id": context.run_id,
                "task_id": task.id,
                "agent_id": agent_id,
                **{
                    key: str(task.metadata[key])
                    for key in ("trace_id", "span_id")
                    if key in task.metadata
                },
            },
        )
