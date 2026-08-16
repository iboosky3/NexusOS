"""Safe PostgreSQL tenant context used by row-level security policies."""

from __future__ import annotations

from dataclasses import dataclass
from uuid import UUID


@dataclass(frozen=True, slots=True)
class TenantSession:
    """Validated tenant identifier and parameterized transaction statement."""

    tenant_id: UUID

    @classmethod
    def parse(cls, value: str) -> TenantSession:
        try:
            return cls(UUID(value))
        except ValueError as exc:
            raise ValueError("tenant id must be a valid UUID") from exc

    def set_local_statement(self) -> tuple[str, tuple[str]]:
        """Return SQL and parameters for transaction-local RLS context."""

        return "SELECT set_config('nexus.tenant_id', %s, true)", (str(self.tenant_id),)
