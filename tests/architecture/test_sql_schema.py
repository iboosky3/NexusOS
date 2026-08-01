import re
import unittest
from pathlib import Path


class SqlSchemaTests(unittest.TestCase):
    def test_operational_tables_are_tenant_scoped(self) -> None:
        schema = Path("deploy/postgres/migrations/0001_core.sql").read_text(encoding="utf-8")
        tables = {
            name: body
            for name, body in re.findall(
                r"CREATE TABLE (\w+) \((.*?)\n\);", schema, flags=re.DOTALL
            )
        }
        required = {
            "runs",
            "tasks",
            "agent_runs",
            "routing_results",
            "skill_invocations",
            "tool_invocations",
            "artifacts",
            "memories",
            "model_usage",
            "audit_logs",
        }

        self.assertTrue(required <= set(tables))
        for name in required:
            self.assertIn("tenant_id", tables[name], f"{name} is not tenant-scoped")

    def test_tool_invocations_have_an_idempotency_constraint(self) -> None:
        schema = Path("deploy/postgres/migrations/0001_core.sql").read_text(encoding="utf-8")

        self.assertIn("UNIQUE (tenant_id, idempotency_key)", schema)


if __name__ == "__main__":
    unittest.main()
