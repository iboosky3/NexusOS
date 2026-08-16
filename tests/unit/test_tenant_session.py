import unittest

from nexusos.storage import TenantSession


class TenantSessionTests(unittest.TestCase):
    def test_produces_parameterized_transaction_local_context(self) -> None:
        session = TenantSession.parse("d9a3c0e4-c4ce-4b9c-96d1-c573f348e5f8")

        statement, parameters = session.set_local_statement()

        self.assertIn("set_config", statement)
        self.assertIn("true", statement)
        self.assertEqual(parameters, ("d9a3c0e4-c4ce-4b9c-96d1-c573f348e5f8",))

    def test_rejects_unvalidated_tenant_text(self) -> None:
        with self.assertRaisesRegex(ValueError, "valid UUID"):
            TenantSession.parse("tenant-a'; DROP TABLE runs; --")


if __name__ == "__main__":
    unittest.main()
