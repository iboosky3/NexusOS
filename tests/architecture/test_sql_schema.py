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

    def test_row_level_security_covers_every_tenant_table(self) -> None:
        schema = Path("deploy/postgres/migrations/0001_core.sql").read_text(encoding="utf-8")
        policies = Path("deploy/postgres/migrations/0003_row_level_security.sql").read_text(
            encoding="utf-8"
        )
        tenant_tables = re.findall(
            r"CREATE TABLE (\w+) \((?:(?!\n\);).)*tenant_id",
            schema,
            flags=re.DOTALL,
        )

        for table in tenant_tables:
            self.assertIn(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY", policies)
            self.assertIn(f"CREATE POLICY tenant_isolation ON {table}", policies)
            self.assertIn(f"ALTER TABLE {table} FORCE ROW LEVEL SECURITY", policies)

    def test_prd_workspace_schema_is_versioned_tenant_scoped_and_append_only(self) -> None:
        migration = Path("deploy/postgres/migrations/0004_prd_workspace.sql").read_text(
            encoding="utf-8"
        )
        tables = {
            "project_workspaces",
            "prd_document_versions",
            "prototype_versions",
            "screenshot_references",
            "workspace_events",
        }

        for table in tables:
            self.assertIn(f"CREATE TABLE {table}", migration)
            self.assertIn(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY", migration)
            self.assertIn(f"CREATE POLICY tenant_isolation ON {table}", migration)
            self.assertIn(f"ALTER TABLE {table} FORCE ROW LEVEL SECURITY", migration)
        self.assertIn("UNIQUE (project_id, version)", migration)
        self.assertIn("UNIQUE (prototype_id, version)", migration)
        self.assertIn("workspace_events_append_only", migration)


if __name__ == "__main__":
    unittest.main()
