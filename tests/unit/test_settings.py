import unittest

from nexusos.settings import Settings


class SettingsTests(unittest.TestCase):
    def test_loads_prefixed_environment_and_redacts_credentials(self) -> None:
        settings = Settings.from_environment(
            {
                "NEXUS_ENVIRONMENT": "staging",
                "NEXUS_REDIS_URL": "redis://cache:6379/1",
                "NEXUS_MODEL_API_KEY": "secret",
            }
        )

        self.assertEqual(settings.environment, "staging")
        self.assertEqual(settings.redis_url, "redis://cache:6379/1")
        self.assertEqual(settings.safe_values()["model_api_key"], "[REDACTED]")

    def test_rejects_development_credentials_in_production(self) -> None:
        with self.assertRaisesRegex(ValueError, "development credentials"):
            Settings.from_environment({"NEXUS_ENVIRONMENT": "production"})


if __name__ == "__main__":
    unittest.main()
