"""Model contracts that keep provider SDKs outside the runtime core."""

from __future__ import annotations

import asyncio
import json
import re
import urllib.error
import urllib.request
from collections.abc import Callable, Mapping
from dataclasses import dataclass, field, replace
from types import MappingProxyType
from typing import Any, Protocol

from nexusos.core.models import TokenUsage


@dataclass(frozen=True, slots=True)
class ChatMessage:
    """Normalized text message accepted by every model adapter."""

    role: str
    content: str

    def __post_init__(self) -> None:
        if self.role not in {"system", "user", "assistant", "tool"}:
            raise ValueError(f"unsupported message role: {self.role}")
        if not self.content.strip():
            raise ValueError("message content cannot be empty")


@dataclass(frozen=True, slots=True)
class ModelRequest:
    """Provider-neutral inference request."""

    messages: tuple[ChatMessage, ...]
    model: str
    temperature: float = 0.1
    maximum_output_tokens: int = 2048
    data_classification: str = "internal"
    metadata: Mapping[str, str] = field(default_factory=dict)

    def __post_init__(self) -> None:
        if not self.messages or not self.model:
            raise ValueError("model and at least one message are required")
        if not 0 <= self.temperature <= 2 or self.maximum_output_tokens < 1:
            raise ValueError("model sampling configuration is invalid")
        if self.data_classification not in {"public", "internal", "confidential", "restricted"}:
            raise ValueError("unsupported model data classification")
        object.__setattr__(self, "metadata", MappingProxyType(dict(self.metadata)))


@dataclass(frozen=True, slots=True)
class ModelResponse:
    """Normalized text completion and accounting data."""

    content: str
    provider: str
    model: str
    usage: TokenUsage = field(default_factory=TokenUsage)
    finish_reason: str = "stop"
    provider_request_id: str | None = None
    reasoning_content: str = ""


@dataclass(frozen=True, slots=True)
class ModelDelta:
    """One provider stream update, separated into reasoning and final content."""

    content: str = ""
    reasoning_content: str = ""


class ModelGateway(Protocol):
    """Complete one normalized model request."""

    async def complete(self, request: ModelRequest) -> ModelResponse: ...


class ModelGatewayUnavailable(RuntimeError):
    """Signal a transient backend failure that allows a policy-approved failover."""

    def __init__(self, message: str, *, http_status: int | None = None) -> None:
        super().__init__(message)
        self.http_status = http_status


class ModelGatewayRejected(RuntimeError):
    """Signal a permanent request or protocol failure that must fail closed."""

    def __init__(self, message: str, *, http_status: int | None = None) -> None:
        super().__init__(message)
        self.http_status = http_status


@dataclass(frozen=True, slots=True)
class ModelTarget:
    """One ordered model backend and its data-placement boundary."""

    name: str
    gateway: ModelGateway
    model: str
    allowed_data_classifications: tuple[str, ...] = ("public", "internal")

    def __post_init__(self) -> None:
        if not self.name.strip() or not self.model.strip():
            raise ValueError("model target name and model are required")
        if not self.allowed_data_classifications:
            raise ValueError("model target must allow at least one data classification")


class FallbackModelGateway:
    """Fail over transient calls across ordered, data-compatible model targets."""

    def __init__(self, targets: tuple[ModelTarget, ...]) -> None:
        if not targets:
            raise ValueError("at least one model target is required")
        names = [target.name for target in targets]
        if len(names) != len(set(names)):
            raise ValueError("model target names must be unique")
        self._targets = targets

    async def complete(self, request: ModelRequest) -> ModelResponse:
        eligible = tuple(
            target
            for target in self._targets
            if request.data_classification in target.allowed_data_classifications
        )
        if not eligible:
            raise ModelGatewayRejected(
                f"no model target permits {request.data_classification!r} data"
            )

        failures: list[str] = []
        for target in eligible:
            routed_request = replace(request, model=target.model)
            try:
                return await target.gateway.complete(routed_request)
            except ModelGatewayUnavailable as exc:
                failures.append(f"{target.name}: {exc}")
        raise ModelGatewayUnavailable(
            "all eligible model targets unavailable: " + "; ".join(failures)
        )


class DeterministicModelGateway:
    """Return stable responses for tests without network or credentials."""

    async def complete(self, request: ModelRequest) -> ModelResponse:
        user_message = next(
            (message.content for message in reversed(request.messages) if message.role == "user"),
            request.messages[-1].content,
        )
        return ModelResponse(
            content=f"Deterministic response: {user_message}",
            provider="local",
            model=request.model,
            usage=TokenUsage(input_tokens=len(user_message) // 4 + 1, output_tokens=8),
        )


class OpenAICompatibleGateway:
    """Call any OpenAI-compatible chat completions endpoint with stdlib HTTP."""

    def __init__(self, *, base_url: str, api_key: str, timeout_seconds: float = 60) -> None:
        self._endpoint = f"{base_url.rstrip('/')}/chat/completions"
        self._api_key = api_key
        self._timeout_seconds = timeout_seconds

    async def complete(self, request: ModelRequest) -> ModelResponse:
        return await asyncio.to_thread(self._complete_blocking, request)

    async def complete_stream(
        self, request: ModelRequest, on_delta: Callable[[ModelDelta], None]
    ) -> ModelResponse:
        """Consume provider SSE while forwarding text deltas as they arrive."""

        return await asyncio.to_thread(self._complete_stream_blocking, request, on_delta)

    @staticmethod
    def _apply_provider_options(request: ModelRequest, payload: dict[str, Any]) -> None:
        thinking_mode = request.metadata.get("thinking_mode")
        if thinking_mode in {"enabled", "disabled"}:
            payload["thinking"] = {"type": thinking_mode}

    def _http_request(self, request: ModelRequest, *, stream: bool) -> urllib.request.Request:
        request_payload: dict[str, Any] = {
            "model": request.model,
            "messages": [
                {"role": message.role, "content": message.content} for message in request.messages
            ],
            "temperature": request.temperature,
            "max_tokens": request.maximum_output_tokens,
        }
        if stream:
            request_payload.update(stream=True, stream_options={"include_usage": True})
        self._apply_provider_options(request, request_payload)
        http_request = urllib.request.Request(
            self._endpoint,
            data=json.dumps(request_payload).encode("utf-8"),
            headers={
                "Authorization": f"Bearer {self._api_key}",
                "Content-Type": "application/json",
                "Accept": "text/event-stream" if stream else "application/json",
                "User-Agent": "NexusOS/0.1",
            },
            method="POST",
        )
        trace_id = request.metadata.get("trace_id", "")
        span_id = request.metadata.get("span_id", "")
        if (
            re.fullmatch(r"[a-f0-9]{32}", trace_id)
            and re.fullmatch(r"[a-f0-9]{16}", span_id)
            and int(trace_id, 16)
            and int(span_id, 16)
        ):
            http_request.add_header("traceparent", f"00-{trace_id}-{span_id}-01")
        return http_request

    def _complete_blocking(self, request: ModelRequest) -> ModelResponse:
        http_request = self._http_request(request, stream=False)
        try:
            with urllib.request.urlopen(http_request, timeout=self._timeout_seconds) as response:
                payload: Mapping[str, Any] = json.loads(response.read().decode("utf-8"))
                request_id = getattr(response, "headers", {}).get("x-request-id")
            usage = payload.get("usage", {})
            choice = payload["choices"][0]
            content = choice["message"]["content"]
            reasoning_content = choice["message"].get("reasoning_content") or ""
            if not isinstance(content, str) or not content.strip():
                raise ValueError("completion content must be non-empty text")
            if not isinstance(reasoning_content, str):
                raise ValueError("reasoning content must be text")
            input_tokens = int(usage.get("prompt_tokens", 0))
            output_tokens = int(usage.get("completion_tokens", 0))
            if input_tokens < 0 or output_tokens < 0:
                raise ValueError("completion usage cannot be negative")
            completion = ModelResponse(
                content=content,
                provider="openai-compatible",
                model=str(payload.get("model", request.model)),
                usage=TokenUsage(input_tokens=input_tokens, output_tokens=output_tokens),
                finish_reason=str(choice.get("finish_reason", "stop")),
                provider_request_id=str(request_id)[:200] if request_id else None,
                reasoning_content=reasoning_content,
            )
        except urllib.error.HTTPError as exc:
            if exc.code == 429 or exc.code >= 500:
                raise ModelGatewayUnavailable(
                    f"provider returned HTTP {exc.code}", http_status=exc.code
                ) from exc
            raise ModelGatewayRejected(
                f"provider rejected request with HTTP {exc.code}", http_status=exc.code
            ) from exc
        except (TimeoutError, urllib.error.URLError) as exc:
            raise ModelGatewayUnavailable("provider connection failed or timed out") from exc
        except (
            json.JSONDecodeError,
            KeyError,
            IndexError,
            TypeError,
            ValueError,
            AttributeError,
        ) as exc:
            raise ModelGatewayRejected("provider returned an invalid completion response") from exc
        return completion

    def _complete_stream_blocking(
        self, request: ModelRequest, on_delta: Callable[[ModelDelta], None]
    ) -> ModelResponse:
        http_request = self._http_request(request, stream=True)
        try:
            content_parts: list[str] = []
            reasoning_parts: list[str] = []
            usage: Mapping[str, Any] = {}
            finish_reason: str | None = None
            response_model = request.model
            saw_event = False
            with urllib.request.urlopen(http_request, timeout=self._timeout_seconds) as response:
                request_id = getattr(response, "headers", {}).get("x-request-id")
                for raw_line in response:
                    line = raw_line.decode("utf-8").strip()
                    if not line or line.startswith(":") or not line.startswith("data:"):
                        continue
                    data = line[5:].strip()
                    if data == "[DONE]":
                        break
                    payload: Mapping[str, Any] = json.loads(data)
                    saw_event = True
                    response_model = str(payload.get("model", response_model))
                    if isinstance(payload.get("usage"), Mapping):
                        usage = payload["usage"]
                    choices = payload.get("choices", [])
                    if not choices:
                        continue
                    choice = choices[0]
                    delta = choice.get("delta", {})
                    content = delta.get("content") or ""
                    reasoning = delta.get("reasoning_content") or ""
                    if not isinstance(content, str) or not isinstance(reasoning, str):
                        raise ValueError("stream delta must contain text")
                    if content or reasoning:
                        content_parts.append(content)
                        reasoning_parts.append(reasoning)
                        on_delta(ModelDelta(content=content, reasoning_content=reasoning))
                    if choice.get("finish_reason") is not None:
                        finish_reason = str(choice["finish_reason"])
            content_text = "".join(content_parts)
            reasoning_text = "".join(reasoning_parts)
            if not saw_event or not content_text.strip() or finish_reason is None:
                raise ValueError("stream ended without a complete text response")
            input_tokens = int(usage.get("prompt_tokens", 0))
            output_tokens = int(usage.get("completion_tokens", 0))
            if input_tokens < 0 or output_tokens < 0:
                raise ValueError("completion usage cannot be negative")
            return ModelResponse(
                content=content_text,
                provider="openai-compatible",
                model=response_model,
                usage=TokenUsage(input_tokens=input_tokens, output_tokens=output_tokens),
                finish_reason=finish_reason,
                provider_request_id=str(request_id)[:200] if request_id else None,
                reasoning_content=reasoning_text,
            )
        except urllib.error.HTTPError as exc:
            if exc.code == 429 or exc.code >= 500:
                raise ModelGatewayUnavailable(
                    f"provider returned HTTP {exc.code}", http_status=exc.code
                ) from exc
            raise ModelGatewayRejected(
                f"provider rejected request with HTTP {exc.code}", http_status=exc.code
            ) from exc
        except (TimeoutError, urllib.error.URLError) as exc:
            raise ModelGatewayUnavailable("provider connection failed or timed out") from exc
        except (
            json.JSONDecodeError,
            UnicodeDecodeError,
            KeyError,
            IndexError,
            TypeError,
            ValueError,
            AttributeError,
        ) as exc:
            raise ModelGatewayRejected("provider returned an invalid completion stream") from exc
