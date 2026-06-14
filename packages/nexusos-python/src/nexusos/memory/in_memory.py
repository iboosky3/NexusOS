"""Small deterministic memory adapter for tests and local development."""

from __future__ import annotations

import re
from collections import defaultdict
from collections.abc import Sequence

_WORD = re.compile(r"[a-z0-9_]+", re.IGNORECASE)
_CJK_RUN = re.compile(r"[\u3400-\u9fff]+")


class InMemoryMemoryStore:
    """Store episodic values per run and retrieve them by lexical overlap."""

    def __init__(self) -> None:
        self._entries: dict[str, list[str]] = defaultdict(list)

    async def append(self, run_id: str, values: Sequence[str]) -> None:
        self._entries[run_id].extend(value for value in values if value.strip())

    async def search(self, query: str, *, limit: int) -> tuple[str, ...]:
        if limit < 1:
            return ()
        query_tokens = self._tokens(query)
        scored: list[tuple[int, str, str]] = []
        for run_id, entries in self._entries.items():
            for value in entries:
                overlap = len(query_tokens & self._tokens(value))
                if overlap:
                    scored.append((overlap, run_id, value))
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
