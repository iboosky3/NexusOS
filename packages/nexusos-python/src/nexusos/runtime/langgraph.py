"""Optional LangGraph adapter behind the NexusOS AgentRuntime contract."""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import asdict, replace
from importlib import import_module
from typing import Any, TypedDict

from nexusos.core.models import AgentContext, AgentResult, Artifact, Task, TokenUsage
from nexusos.models import ChatMessage, ModelGateway, ModelRequest, ModelResponse
from nexusos.models.gateway import ModelGatewayRejected


class _RuntimeState(TypedDict, total=False):
    response: dict[str, Any]


class LangGraphRuntime:
    """Execute an agent reasoning graph while preserving NexusOS contracts."""

    def __init__(
        self,
        model_gateway: ModelGateway,
        *,
        model: str,
        checkpointer: Any = None,
        response_validator: Callable[[Task, ModelResponse], Any] | None = None,
    ) -> None:
        self._model_gateway = model_gateway
        self._model = model
        self._checkpointer = checkpointer
        self._response_validator = response_validator
        self.recovered_thread: str | None = None

    async def execute(self, agent_id: str, task: Task, context: AgentContext) -> AgentResult:
        try:
            graph_api = import_module("langgraph.graph")
        except ModuleNotFoundError as exc:
            raise RuntimeError("install nexusos with the 'runtime' extra to use LangGraph") from exc

        request = self._build_request(agent_id, task, context)

        async def invoke_model(state: _RuntimeState) -> _RuntimeState:
            current_request = request
            content_parts: list[str] = []
            usage = TokenUsage()
            maximum_continuations = int(task.metadata.get("maximum_continuations", 0))
            for continuation in range(maximum_continuations + 1):
                complete_stream = getattr(self._model_gateway, "complete_stream", None)
                if callable(complete_stream):
                    response = await complete_stream(current_request, lambda _delta: None)
                else:
                    response = await self._model_gateway.complete(current_request)
                if not response.content:
                    raise ModelGatewayRejected("model output is empty")
                content_parts.append(response.content)
                usage = TokenUsage(
                    usage.input_tokens + response.usage.input_tokens,
                    usage.output_tokens + response.usage.output_tokens,
                )
                if response.finish_reason in {"stop", "end_turn"}:
                    response = replace(response, content="".join(content_parts), usage=usage)
                    break
                if response.finish_reason != "length" or continuation == maximum_continuations:
                    raise ModelGatewayRejected(
                        f"model output is incomplete or filtered "
                        f"(finish_reason={response.finish_reason})"
                    )
                current_request = replace(
                    request,
                    messages=(
                        *request.messages,
                        ChatMessage("assistant", "".join(content_parts)),
                        ChatMessage(
                            "user",
                            "从上一个输出被截断的位置直接继续。不要重复已有内容，不要重新开始，"
                            "完成原任务后立即停止。",
                        ),
                    ),
                    metadata={
                        **request.metadata,
                        "continuation_index": str(continuation + 1),
                    },
                )
            else:  # pragma: no cover - the bounded loop always breaks or raises
                raise ModelGatewayRejected("model continuation loop ended unexpectedly")
            if task.metadata.get("thinking_mode") != "enabled":
                response = replace(response, reasoning_content="")
            if self._response_validator:
                self._response_validator(task, response)
            return {"response": asdict(response)}

        builder = graph_api.StateGraph(_RuntimeState)
        builder.add_node("invoke_model", invoke_model)
        builder.add_edge(graph_api.START, "invoke_model")
        builder.add_edge("invoke_model", graph_api.END)
        graph = builder.compile(checkpointer=self._checkpointer)
        config = {
            "configurable": {
                "thread_id": f"{context.run_id}:{task.metadata.get('stage_id', task.id)}"
            }
        }
        self.recovered_thread = None
        outcome = None
        if self._checkpointer:
            for thread_id in task.metadata.get("recovery_threads", []):
                snapshot = await graph.aget_state({"configurable": {"thread_id": thread_id}})
                if not snapshot.next and snapshot.values.get("response"):
                    outcome = snapshot.values
                    self.recovered_thread = thread_id
                    break
        if outcome is None:
            outcome = await graph.ainvoke({}, config=config)
        data = dict(outcome["response"])
        data["usage"] = TokenUsage(**data["usage"])
        response = ModelResponse(**data)
        artifacts: tuple[Artifact, ...] = ()
        if task.id == "write":
            artifacts = (Artifact("PRD.md", "text/markdown", response.content),)
        return AgentResult(
            task_id=task.id,
            agent_id=agent_id,
            content=response.content,
            artifacts=artifacts,
            token_usage=TokenUsage() if self.recovered_thread else response.usage,
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
                    for key in (
                        "trace_id",
                        "span_id",
                        "stage_id",
                        "thinking_mode",
                        "stream",
                        "maximum_continuations",
                    )
                    if key in task.metadata
                },
            },
        )
