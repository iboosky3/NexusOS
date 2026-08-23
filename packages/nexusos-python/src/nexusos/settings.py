"""Environment-backed settings with validation and safe rendering."""

from __future__ import annotations

import os
from collections.abc import Mapping
from dataclasses import dataclass, fields


@dataclass(frozen=True, slots=True)
class Settings:
    """Runtime configuration shared by application composition roots."""

    environment: str = "development"
    log_level: str = "INFO"
    database_url: str = "postgresql://nexusos:nexusos@localhost:5432/nexusos"
    redis_url: str = "redis://localhost:6379/0"
    qdrant_url: str = "http://localhost:6333"
    nats_url: str = "nats://localhost:4222"
    object_store_url: str = "http://localhost:9000"
    object_store_access_key: str = "nexusos"
    object_store_secret_key: str = "nexusos-development-only"
    otlp_endpoint: str = "http://localhost:4318"
    model_base_url: str = "http://localhost:11434/v1"
    model_api_key: str = "local-development"

    @classmethod
    def from_environment(cls, values: Mapping[str, str] | None = None) -> Settings:
        source = os.environ if values is None else values
        settings = cls(
            **{
                item.name: source.get(f"NEXUS_{item.name.upper()}", item.default)
                for item in fields(cls)
            }
        )
        settings.validate()
        return settings

    def validate(self) -> None:
        if self.environment not in {"development", "test", "staging", "production"}:
            raise ValueError(f"unsupported environment: {self.environment}")
        if self.log_level.upper() not in {"DEBUG", "INFO", "WARNING", "ERROR"}:
            raise ValueError(f"unsupported log level: {self.log_level}")
        if self.environment == "production" and (
            self.object_store_secret_key == "nexusos-development-only"
            or self.model_api_key == "local-development"
        ):
            raise ValueError("development credentials cannot be used in production")

    def safe_values(self) -> Mapping[str, str]:
        """Return configuration suitable for diagnostics without credentials."""

        sensitive = {"object_store_access_key", "object_store_secret_key", "model_api_key"}
        return {
            item.name: "[REDACTED]" if item.name in sensitive else str(getattr(self, item.name))
            for item in fields(self)
        }
