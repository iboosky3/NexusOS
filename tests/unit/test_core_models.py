import unittest

from nexusos.core.models import Goal, NexusState, Task, TaskGraph, TaskStatus


class TaskGraphTests(unittest.TestCase):
    def test_builds_deterministic_parallel_layers(self) -> None:
        graph = TaskGraph(
            (
                Task("write", "Write", "Create the document", ("research", "design")),
                Task("design", "Design", "Describe the experience", ("intake",)),
                Task("intake", "Intake", "Normalize the request"),
                Task("research", "Research", "Collect evidence", ("intake",)),
            )
        )

        self.assertEqual(
            tuple(tuple(task.id for task in layer) for layer in graph.topological_layers()),
            (("intake",), ("design", "research"), ("write",)),
        )

    def test_rejects_unknown_dependency(self) -> None:
        with self.assertRaisesRegex(ValueError, "unknown dependencies"):
            TaskGraph((Task("write", "Write", "Create the document", ("missing",)),))

    def test_rejects_dependency_cycle(self) -> None:
        with self.assertRaisesRegex(ValueError, "contains a cycle"):
            TaskGraph(
                (
                    Task("a", "A", "First", ("b",)),
                    Task("b", "B", "Break the cycle", ("a",)),
                )
            )

    def test_initializes_state_for_every_task(self) -> None:
        graph = TaskGraph((Task("intake", "Intake", "Normalize", ()),))
        state = NexusState("Build a product", Goal("Generate a PRD"), graph)

        self.assertEqual(state.task_status, {"intake": TaskStatus.PENDING})


if __name__ == "__main__":
    unittest.main()
