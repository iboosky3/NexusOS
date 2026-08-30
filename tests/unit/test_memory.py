import asyncio
import unittest
from datetime import UTC, datetime, timedelta

from nexusos.memory import InMemoryMemoryStore


class InMemoryMemoryStoreTests(unittest.TestCase):
    def test_retrieves_relevant_entries_across_runs(self) -> None:
        async def scenario() -> None:
            store = InMemoryMemoryStore()
            await store.append(
                "one", ("The product targets university students",), tenant_id="tenant-a"
            )
            await store.append("two", ("The deployment uses containers",), tenant_id="tenant-a")

            values = await store.search(
                "product university audience", tenant_id="tenant-a", limit=1
            )

            self.assertEqual(values, ("The product targets university students",))

            await store.append(
                "three", ("目标用户是大学生，核心场景是协作学习",), tenant_id="tenant-a"
            )
            chinese_values = await store.search("大学生学习产品", tenant_id="tenant-a", limit=1)
            self.assertEqual(chinese_values, ("目标用户是大学生，核心场景是协作学习",))

        asyncio.run(scenario())

    def test_isolates_tenants_and_filters_classification_and_expiry(self) -> None:
        async def scenario() -> None:
            store = InMemoryMemoryStore()
            now = datetime(2026, 8, 30, tzinfo=UTC)
            await store.append("a", ("shared product secret",), tenant_id="tenant-a")
            await store.append("b", ("shared product public",), tenant_id="tenant-b")
            await store.append(
                "c",
                ("shared product restricted",),
                tenant_id="tenant-b",
                classification="restricted",
            )
            await store.append(
                "d",
                ("shared product expired",),
                tenant_id="tenant-b",
                expires_at=now - timedelta(seconds=1),
            )

            default_values = await store.search(
                "shared product", tenant_id="tenant-b", limit=10, now=now
            )
            privileged_values = await store.search(
                "shared product",
                tenant_id="tenant-b",
                limit=10,
                allowed_classifications=("public", "internal", "restricted"),
                now=now,
            )

            self.assertEqual(default_values, ("shared product public",))
            self.assertEqual(
                privileged_values,
                ("shared product public", "shared product restricted"),
            )
            self.assertNotIn("shared product secret", privileged_values)

        asyncio.run(scenario())


if __name__ == "__main__":
    unittest.main()
