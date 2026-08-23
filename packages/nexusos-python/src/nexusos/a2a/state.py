"""Deterministic state machine for delegated external agent tasks."""

from __future__ import annotations

from dataclasses import replace
from datetime import UTC, datetime
from threading import RLock

from nexusos.a2a.models import A2AArtifact, A2AMessage, A2ATask, A2ATaskState

_ALLOWED_TRANSITIONS: dict[A2ATaskState, frozenset[A2ATaskState]] = {
    A2ATaskState.SUBMITTED: frozenset(
        {
            A2ATaskState.WORKING,
            A2ATaskState.AUTH_REQUIRED,
            A2ATaskState.REJECTED,
            A2ATaskState.CANCELED,
            A2ATaskState.FAILED,
        }
    ),
    A2ATaskState.WORKING: frozenset(
        {
            A2ATaskState.INPUT_REQUIRED,
            A2ATaskState.AUTH_REQUIRED,
            A2ATaskState.COMPLETED,
            A2ATaskState.CANCELED,
            A2ATaskState.FAILED,
        }
    ),
    A2ATaskState.INPUT_REQUIRED: frozenset(
        {A2ATaskState.WORKING, A2ATaskState.CANCELED, A2ATaskState.FAILED}
    ),
    A2ATaskState.AUTH_REQUIRED: frozenset(
        {
            A2ATaskState.WORKING,
            A2ATaskState.REJECTED,
            A2ATaskState.CANCELED,
            A2ATaskState.FAILED,
        }
    ),
    A2ATaskState.COMPLETED: frozenset(),
    A2ATaskState.FAILED: frozenset(),
    A2ATaskState.CANCELED: frozenset(),
    A2ATaskState.REJECTED: frozenset(),
}


class InvalidTaskTransitionError(ValueError):
    """Raised when a remote event would violate lifecycle monotonicity."""


class A2ATaskMachine:
    """Apply idempotent task updates while preventing terminal-state regression."""

    def __init__(self) -> None:
        self._tasks: dict[str, A2ATask] = {}
        self._lock = RLock()

    def create(self, task: A2ATask) -> A2ATask:
        """Register a new task or accept an identical duplicate submission."""

        with self._lock:
            current = self._tasks.get(task.id)
            if current is not None:
                if current == task:
                    return current
                raise ValueError(f"task already exists with different content: {task.id}")
            self._tasks[task.id] = task
            return task

    def get(self, task_id: str) -> A2ATask:
        """Return the immutable current task projection."""

        with self._lock:
            try:
                return self._tasks[task_id]
            except KeyError as exc:
                raise LookupError(task_id) from exc

    def transition(
        self,
        task_id: str,
        state: A2ATaskState,
        *,
        message: A2AMessage | None = None,
        artifacts: tuple[A2AArtifact, ...] = (),
        failure_code: str | None = None,
    ) -> A2ATask:
        """Apply one validated transition and make duplicate events idempotent."""

        with self._lock:
            current = self.get(task_id)
            if state is current.state:
                return current
            if state not in _ALLOWED_TRANSITIONS[current.state]:
                raise InvalidTaskTransitionError(
                    f"invalid A2A task transition: {current.state.value} -> {state.value}"
                )
            if artifacts and state is not A2ATaskState.COMPLETED:
                raise InvalidTaskTransitionError("artifacts can only be attached on completion")
            if state is A2ATaskState.FAILED and not failure_code:
                raise InvalidTaskTransitionError("failed transition requires a failure code")
            if state is not A2ATaskState.FAILED and failure_code:
                raise InvalidTaskTransitionError("failure code is only valid for failed state")
            updated = replace(
                current,
                state=state,
                updated_at=datetime.now(UTC),
                messages=current.messages + ((message,) if message else ()),
                artifacts=current.artifacts + artifacts,
                failure_code=failure_code,
            )
            self._tasks[task_id] = updated
            return updated
