import asyncio
import unittest

from nexusos.health import HealthRegistry


class HealthRegistryTests(unittest.TestCase):
    def test_reports_ready_when_critical_checks_pass(self) -> None:
        report = asyncio.run(HealthRegistry({"skills": (lambda: True, True)}).evaluate())

        self.assertTrue(report.ready)
        self.assertEqual(report.status, "ready")

    def test_optional_failure_degrades_without_rejecting_traffic(self) -> None:
        report = asyncio.run(
            HealthRegistry(
                {"skills": (lambda: True, True), "telemetry": (lambda: False, False)}
            ).evaluate()
        )

        self.assertTrue(report.ready)
        self.assertEqual(report.status, "degraded")

    def test_critical_failure_marks_instance_not_ready(self) -> None:
        report = asyncio.run(HealthRegistry({"skills": (lambda: False, True)}).evaluate())

        self.assertFalse(report.ready)
        self.assertEqual(report.status, "not_ready")

    def test_bounds_slow_async_check(self) -> None:
        async def slow() -> bool:
            await asyncio.sleep(0.05)
            return True

        report = asyncio.run(
            HealthRegistry({"database": (slow, True)}, timeout_seconds=0.001).evaluate()
        )

        self.assertFalse(report.ready)
        self.assertEqual(report.components[0].error, "check timed out")

    def test_hides_exception_details_from_external_report(self) -> None:
        def broken() -> bool:
            raise RuntimeError("postgresql://user:secret@database")

        report = asyncio.run(HealthRegistry({"database": (broken, True)}).evaluate())

        self.assertEqual(report.components[0].error, "RuntimeError")
        self.assertNotIn("secret", str(report.as_dict()))


if __name__ == "__main__":
    unittest.main()
