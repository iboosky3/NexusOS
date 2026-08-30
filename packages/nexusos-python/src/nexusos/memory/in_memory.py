"""Small deterministic memory adapter for tests and local development."""

from __future__ import annotations

import re
from collections import defaultdict
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import UTC, datetime
from uuid import uuid4

_WORD = re.compile(r"[a-z0-9_]+", re.IGNORECASE)
_CJK_RUN = re.compile(r"[\u3400-\u9fff]+")
_CLASSIFICATIONS = {"public", "internal", "confidential", "restricted"}


@dataclass(frozen=True, slots=True)
class MemoryEntry:
    """A tenant-scoped memory value with provenance and retention metadata."""

    id: str
    tenant_id: str
    run_id: str
    content: str
    source: str
    classification: str
    created_at: datetime
    expires_at: datetime | None = None

    def __post_init__(self) -> None:
        if any(not value.strip() for value in (self.id, self.tenant_id, self.run_id, self.content)):
            raise ValueError("memory identity, tenant, run, and content are required")
        if self.classification not in _CLASSIFICATIONS:
            raise ValueError("unsupported memory classification")
        if self.created_at.tzinfo is None or (
            self.expires_at is not None and self.expires_at.tzinfo is None
        ):
            raise ValueError("memory timestamps must be timezone-aware")


class InMemoryMemoryStore:
    """Store episodic values per run and retrieve them by lexical overlap."""

    def __init__(self) -> None:
        self._entries: dict[str, list[MemoryEntry]] = defaultdict(list)

    async def append(
        self,
        run_id: str,
        values: Sequence[str],
        *,
        tenant_id: str,
        source: str = "agent",
        classification: str = "internal",
        expires_at: datetime | None = None,
    ) -> None:
        now = datetime.now(UTC)
        entries = (
            MemoryEntry(
                id=str(uuid4()),
                tenant_id=tenant_id,
                run_id=run_id,
                content=value,
                source=source,
                classification=classification,
                created_at=now,
                expires_at=expires_at,
            )
            for value in values
            if value.strip()
        )
        self._entries[tenant_id].extend(entries)

    async def search(
        self,
        query: str,
        *,
        tenant_id: str,
        limit: int,
        allowed_classifications: Sequence[str] = ("public", "internal"),
        now: datetime | None = None,
    ) -> tuple[str, ...]:
        if limit < 1:
            return ()
        invalid = set(allowed_classifications) - _CLASSIFICATIONS
        if invalid:
            raise ValueError(f"unsupported memory classifications: {sorted(invalid)}")
        current_time = now or datetime.now(UTC)
        if current_time.tzinfo is None:
            raise ValueError("memory search time must be timezone-aware")
        query_tokens = self._tokens(query)
        scored: list[tuple[int, str, str]] = []
        for entry in self._entries.get(tenant_id, ()):
            if entry.classification not in allowed_classifications:
                continue
            if entry.expires_at is not None and entry.expires_at <= current_time:
                continue
            overlap = len(query_tokens & self._tokens(entry.content))
            if overlap:
                scored.append((overlap, entry.run_id, entry.content))
        scored.sort(key=lambda item: (-item[0], item[1], item[2]))
        return tuple(item[2] for item in scored[:limit])

    @staticmethod
    def _tokens(value: str) -> set[str]:
        normalized = value.casefold()
        tokens = set(_WORD.findall(normalized))
        for run in _CJK_RUN.findall(normalized):
            tokens.update(run)
            tokens.update(run[index : index + 2] for index in range(max(0, len(run) - 1)))
        return tokens
