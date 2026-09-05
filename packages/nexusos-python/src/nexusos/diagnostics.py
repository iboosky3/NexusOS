"""Preflight diagnostics for local development and embedded deployments."""

from __future__ import annotations

import importlib.util
import shutil
import sys
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from pathlib import Path

from nexusos.agents import FileAgentRegistry
from nexusos.settings import Settings
from nexusos.skills import FileSkillRepository


@dataclass(frozen=True, slots=True)
class DiagnosticCheck:
    """One preflight result with explicit criticality and remediation."""

    name: str
    available: bool
    critical: bool
    detail: str
    remediation: str | None = None

    def as_dict(self) -> dict[str, object]:
        """Return a JSON-compatible representation without secret values."""

        return {
            "name": self.name,
            "available": self.available,
            "critical": self.critical,
            "detail": self.detail,
            "remediation": self.remediation,
        }


@dataclass(frozen=True, slots=True)
class DiagnosticReport:
    """Aggregate local prerequisites into ready, degraded, or failed."""

    checks: tuple[DiagnosticCheck, ...]

    @property
    def status(self) -> str:
        """Return failed for critical gaps and degraded for optional gaps."""

        if any(not check.available and check.critical for check in self.checks):
            return "failed"
        if any(not check.available for check in self.checks):
            return "degraded"
        return "ready"

    def exit_code(self, *, strict: bool = False) -> int:
        """Return nonzero for critical failure or any gap in strict mode."""

        return int(self.status == "failed" or (strict and self.status != "ready"))

    def as_dict(self) -> dict[str, object]:
        """Return the complete machine-readable report."""

        return {"status": self.status, "checks": [check.as_dict() for check in self.checks]}


def run_diagnostics(
    root: str | Path = ".",
    *,
    environment: Mapping[str, str] | None = None,
    command_lookup: Callable[[str], str | None] = shutil.which,
    module_lookup: Callable[[str], object | None] = importlib.util.find_spec,
) -> DiagnosticReport:
    """Inspect prerequisites without opening network or database connections."""

    repository_root = Path(root).resolve()
    checks = [
        DiagnosticCheck(
            "python",
            sys.version_info >= (3, 12),
            True,
            f"{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}",
            "安装 Python 3.12 或更高版本",
        ),
        _load_manifests(
            "agents",
            lambda: len(FileAgentRegistry(repository_root / "agents").list()),
            "确认 --root 指向包含 agents 目录的 NexusOS 仓库",
        ),
        _load_manifests(
            "skills",
            lambda: len(FileSkillRepository(repository_root / "skills").list_summaries()),
            "确认 --root 指向包含 skills 目录的 NexusOS 仓库",
        ),
        _settings_check(environment),
    ]
    for module, installation in (
        ("fastapi", "pip install -e '.[api]'"),
        ("langgraph", "pip install -e '.[runtime]'"),
    ):
        available = module_lookup(module) is not None
        checks.append(
            DiagnosticCheck(
                f"python:{module}",
                available,
                False,
                "已安装" if available else "未安装（核心 CLI 不受影响）",
                None if available else installation,
            )
        )
    for command, purpose in (
        ("go", "Go Runtime 与 MCP Gateway"),
        ("cargo", "Rust Skill Router"),
        ("node", "NexusOS Studio"),
        ("docker", "Compose 集成环境"),
    ):
        path = command_lookup(command)
        checks.append(
            DiagnosticCheck(
                f"command:{command}",
                path is not None,
                False,
                f"{purpose}：{path or '命令不可用'}",
                None if path else f"安装 {command} 并加入 PATH",
            )
        )
    return DiagnosticReport(tuple(checks))


def _load_manifests(name: str, loader: Callable[[], int], remediation: str) -> DiagnosticCheck:
    try:
        count = loader()
        if count < 1:
            raise ValueError("no manifests found")
        return DiagnosticCheck(name, True, True, f"已加载 {count} 个清单")
    except (OSError, ValueError, TypeError, KeyError) as exc:
        return DiagnosticCheck(name, False, True, type(exc).__name__, remediation)


def _settings_check(environment: Mapping[str, str] | None) -> DiagnosticCheck:
    try:
        settings = Settings.from_environment(environment)
        return DiagnosticCheck("settings", True, True, settings.environment)
    except ValueError as exc:
        return DiagnosticCheck(
            "settings",
            False,
            True,
            type(exc).__name__,
            "修正 NEXUS_* 配置；生产环境禁止使用示例凭据",
        )
