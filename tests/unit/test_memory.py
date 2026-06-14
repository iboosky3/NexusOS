import asyncio
import unittest

from nexusos.memory import InMemoryMemoryStore


class InMemoryMemoryStoreTests(unittest.TestCase):
    def test_retrieves_relevant_entries_across_runs(self) -> None:
        async def scenario() -> None:
            store = InMemoryMemoryStore()
            await store.append("one", ("The product targets university students",))
            await store.append("two", ("The deployment uses containers",))

            values = await store.search("product university audience", limit=1)

            self.assertEqual(values, ("The product targets university students",))

            await store.append("three", ("目标用户是大学生，核心场景是协作学习",))
            chinese_values = await store.search("大学生学习产品", limit=1)
            self.assertEqual(chinese_values, ("目标用户是大学生，核心场景是协作学习",))

        asyncio.run(scenario())


if __name__ == "__main__":
    unittest.main()
