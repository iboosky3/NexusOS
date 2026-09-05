import unittest
from pathlib import Path

from nexusos.diagnostics import run_diagnostics

ROOT = Path(__file__).resolve().parents[2]


class DiagnosticsTests(unittest.TestCase):
    def test_reports_degraded_when_only_optional_tools_are_missing(self) -> None:
        report = run_diagnostics(
            ROOT,
            command_lookup=lambda _: None,
            module_lookup=lambda _: None,
        )

        self.assertEqual(report.status, "degraded")
        self.assertEqual(report.exit_code(), 0)
        self.assertEqual(report.exit_code(strict=True), 1)
        self.assertTrue(all(check.available for check in report.checks if check.critical))

    def test_reports_failed_for_wrong_repository_root(self) -> None:
        report = run_diagnostics(
            ROOT / "missing",
            command_lookup=lambda _: "available",
            module_lookup=lambda _: object(),
        )

        self.assertEqual(report.status, "failed")
        self.assertEqual(report.exit_code(), 1)
        self.assertFalse(next(check for check in report.checks if check.name == "agents").available)

    def test_reports_invalid_production_settings_without_exposing_secret(self) -> None:
        report = run_diagnostics(
            ROOT,
            environment={"NEXUS_ENVIRONMENT": "production"},
            command_lookup=lambda _: "available",
            module_lookup=lambda _: object(),
        )

        self.assertEqual(report.status, "failed")
        settings = next(check for check in report.checks if check.name == "settings")
        self.assertEqual(settings.detail, "ValueError")
        self.assertNotIn("nexusos-development-only", str(report.as_dict()))


if __name__ == "__main__":
    unittest.main()
