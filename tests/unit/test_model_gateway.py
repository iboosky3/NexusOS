import asyncio
import unittest

from nexusos.models import (
    ChatMessage,
    DeterministicModelGateway,
    FallbackModelGateway,
    ModelGatewayRejected,
    ModelGatewayUnavailable,
    ModelRequest,
    ModelResponse,
    ModelTarget,
)


class RecordingGateway:
    def __init__(self, outcome: ModelResponse | Exception) -> None:
        self.outcome = outcome
        self.requests: list[ModelRequest] = []

    async def complete(self, request: ModelRequest) -> ModelResponse:
        self.requests.append(request)
        if isinstance(self.outcome, Exception):
            raise self.outcome
        return self.outcome


class ModelGatewayTests(unittest.TestCase):
    def test_deterministic_gateway_preserves_normalized_accounting(self) -> None:
        response = asyncio.run(
            DeterministicModelGateway().complete(
                ModelRequest(
                    messages=(ChatMessage("user", "Create a concise product brief"),),
                    model="test-model",
                )
            )
        )

        self.assertEqual(response.provider, "local")
        self.assertEqual(response.model, "test-model")
        self.assertIn("product brief", response.content)
        self.assertGreater(response.usage.total_tokens, 0)

    def test_rejects_provider_specific_message_roles(self) -> None:
        with self.assertRaisesRegex(ValueError, "unsupported message role"):
            ChatMessage("developer", "Do the work")

    def test_fails_over_transient_failure_to_next_eligible_target(self) -> None:
        primary = RecordingGateway(ModelGatewayUnavailable("rate limited"))
        secondary = RecordingGateway(ModelResponse("ok", "secondary", "model-b"))
        gateway = FallbackModelGateway(
            (
                ModelTarget("primary", primary, "model-a"),
                ModelTarget("secondary", secondary, "model-b"),
            )
        )

        response = asyncio.run(
            gateway.complete(
                ModelRequest(messages=(ChatMessage("user", "Create a PRD"),), model="logical")
            )
        )

        self.assertEqual(response.provider, "secondary")
        self.assertEqual(primary.requests[0].model, "model-a")
        self.assertEqual(secondary.requests[0].model, "model-b")

    def test_does_not_fail_over_permanent_rejection(self) -> None:
        primary = RecordingGateway(ModelGatewayRejected("invalid request"))
        secondary = RecordingGateway(ModelResponse("ok", "secondary", "model-b"))
        gateway = FallbackModelGateway(
            (
                ModelTarget("primary", primary, "model-a"),
                ModelTarget("secondary", secondary, "model-b"),
            )
        )

        with self.assertRaisesRegex(ModelGatewayRejected, "invalid request"):
            asyncio.run(
                gateway.complete(
                    ModelRequest(messages=(ChatMessage("user", "Create a PRD"),), model="logical")
                )
            )
        self.assertEqual(secondary.requests, [])

    def test_routes_restricted_data_only_to_permitted_target(self) -> None:
        cloud = RecordingGateway(ModelResponse("cloud", "cloud", "cloud-model"))
        private = RecordingGateway(ModelResponse("private", "private", "private-model"))
        gateway = FallbackModelGateway(
            (
                ModelTarget("cloud", cloud, "cloud-model"),
                ModelTarget(
                    "private",
                    private,
                    "private-model",
                    ("public", "internal", "confidential", "restricted"),
                ),
            )
        )

        response = asyncio.run(
            gateway.complete(
                ModelRequest(
                    messages=(ChatMessage("user", "Review private records"),),
                    model="logical",
                    data_classification="restricted",
                )
            )
        )

        self.assertEqual(response.provider, "private")
        self.assertEqual(cloud.requests, [])

    def test_reports_all_transient_failures_without_unbounded_retry(self) -> None:
        first = RecordingGateway(ModelGatewayUnavailable("timeout"))
        second = RecordingGateway(ModelGatewayUnavailable("overloaded"))
        gateway = FallbackModelGateway(
            (ModelTarget("first", first, "a"), ModelTarget("second", second, "b"))
        )

        with self.assertRaisesRegex(ModelGatewayUnavailable, "first: timeout; second: overloaded"):
            asyncio.run(
                gateway.complete(
                    ModelRequest(messages=(ChatMessage("user", "Create a PRD"),), model="logical")
                )
            )
        self.assertEqual(len(first.requests), 1)
        self.assertEqual(len(second.requests), 1)


if __name__ == "__main__":
    unittest.main()
