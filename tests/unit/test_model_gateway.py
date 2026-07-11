import asyncio
import unittest

from nexusos.models import ChatMessage, DeterministicModelGateway, ModelRequest


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


if __name__ == "__main__":
    unittest.main()
