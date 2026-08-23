import unittest

from nexusos.a2a import (
    A2AArtifact,
    A2AMessage,
    A2ATask,
    A2ATaskMachine,
    A2ATaskState,
    AgentCard,
    AgentSkill,
    InvalidTaskTransitionError,
    MessageRole,
)


def submitted_task(task_id: str = "external-1") -> A2ATask:
    return A2ATask.submitted(
        task_id=task_id,
        context_id="run-1",
        tenant_id="tenant-1",
        agent_name="Research Partner",
        skill_id="market-research",
        message=A2AMessage("message-1", MessageRole.USER, "Research this market"),
        correlation_id="trace-1",
    )


class A2ATaskMachineTests(unittest.TestCase):
    def test_completes_task_with_traceable_artifact(self) -> None:
        machine = A2ATaskMachine()
        machine.create(submitted_task())
        machine.transition("external-1", A2ATaskState.WORKING)

        completed = machine.transition(
            "external-1",
            A2ATaskState.COMPLETED,
            message=A2AMessage("message-2", MessageRole.AGENT, "Research complete"),
            artifacts=(A2AArtifact("artifact-1", "research.md", "text/markdown", "# Result"),),
        )

        self.assertTrue(completed.state.terminal)
        self.assertEqual(completed.artifacts[0].name, "research.md")
        self.assertEqual(completed.correlation_id, "trace-1")

    def test_supports_input_required_round_trip(self) -> None:
        machine = A2ATaskMachine()
        machine.create(submitted_task())
        machine.transition("external-1", A2ATaskState.WORKING)
        machine.transition(
            "external-1",
            A2ATaskState.INPUT_REQUIRED,
            message=A2AMessage("message-2", MessageRole.AGENT, "Which geography?"),
        )

        resumed = machine.transition(
            "external-1",
            A2ATaskState.WORKING,
            message=A2AMessage("message-3", MessageRole.USER, "Mainland China"),
        )

        self.assertEqual(resumed.state, A2ATaskState.WORKING)
        self.assertEqual(len(resumed.messages), 3)

    def test_rejects_terminal_state_regression(self) -> None:
        machine = A2ATaskMachine()
        machine.create(submitted_task())
        machine.transition("external-1", A2ATaskState.WORKING)
        machine.transition("external-1", A2ATaskState.COMPLETED)

        with self.assertRaisesRegex(InvalidTaskTransitionError, "completed -> working"):
            machine.transition("external-1", A2ATaskState.WORKING)

    def test_treats_duplicate_status_event_as_idempotent(self) -> None:
        machine = A2ATaskMachine()
        task = machine.create(submitted_task())

        duplicate = machine.transition("external-1", A2ATaskState.SUBMITTED)

        self.assertIs(duplicate, task)
        self.assertEqual(len(duplicate.messages), 1)

    def test_requires_failure_code(self) -> None:
        machine = A2ATaskMachine()
        machine.create(submitted_task())

        with self.assertRaisesRegex(InvalidTaskTransitionError, "failure code"):
            machine.transition("external-1", A2ATaskState.FAILED)

    def test_rejects_insecure_non_loopback_agent_card(self) -> None:
        skill = AgentSkill("research", "Research", "Perform market research")

        with self.assertRaisesRegex(ValueError, "HTTPS"):
            AgentCard(
                name="Partner",
                description="External research agent",
                url="http://agent.example.com/a2a",
                protocol_version="0.3",
                skills=(skill,),
            )


if __name__ == "__main__":
    unittest.main()
