"""Model contracts that keep provider SDKs outside the runtime core."""

from __future__ import annotations

import asyncio
import json
import urllib.error
import urllib.request
from collections.abc import Mapping
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


class ModelGateway(Protocol):
    """Complete one normalized model request."""

    async def complete(self, request: ModelRequest) -> ModelResponse: ...


class ModelGatewayUnavailable(RuntimeError):
    """Signal a transient backend failure that allows a policy-approved failover."""


class ModelGatewayRejected(RuntimeError):
    """Signal a permanent request or protocol failure that must fail closed."""


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

    def _complete_blocking(self, request: ModelRequest) -> ModelResponse:
        body = json.dumps(
            {
                "model": request.model,
                "messages": [
                    {"role": message.role, "content": message.content}
                    for message in request.messages
                ],
                "temperature": request.temperature,
                "max_tokens": request.maximum_output_tokens,
            }
        ).encode("utf-8")
        http_request = urllib.request.Request(
            self._endpoint,
            data=body,
            headers={
                "Authorization": f"Bearer {self._api_key}",
                "Content-Type": "application/json",
                "User-Agent": "NexusOS/0.1",
            },
            method="POST",
        )
        try:
            with urllib.request.urlopen(http_request, timeout=self._timeout_seconds) as response:
                payload: Mapping[str, Any] = json.loads(response.read().decode("utf-8"))
            usage = payload.get("usage", {})
            choice = payload["choices"][0]
        except urllib.error.HTTPError as exc:
            if exc.code == 429 or exc.code >= 500:
                raise ModelGatewayUnavailable(f"provider returned HTTP {exc.code}") from exc
            raise ModelGatewayRejected(f"provider rejected request with HTTP {exc.code}") from exc
        except (TimeoutError, urllib.error.URLError) as exc:
            raise ModelGatewayUnavailable("provider connection failed or timed out") from exc
        except (json.JSONDecodeError, KeyError, IndexError, TypeError, ValueError) as exc:
            raise ModelGatewayRejected("provider returned an invalid completion response") from exc
        return ModelResponse(
            content=str(choice["message"]["content"]),
            provider="openai-compatible",
            model=str(payload.get("model", request.model)),
            usage=TokenUsage(
                input_tokens=int(usage.get("prompt_tokens", 0)),
                output_tokens=int(usage.get("completion_tokens", 0)),
            ),
            finish_reason=str(choice.get("finish_reason", "stop")),
        )
