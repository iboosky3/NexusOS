"""Deterministic reference policy engine used before remote policy adapters."""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum


class DecisionEffect(StrEnum):
    """Effects supported by the NexusOS authorization boundary."""

    ALLOW = "allow"
    DENY = "deny"
    REQUIRE_APPROVAL = "require_approval"


@dataclass(frozen=True, slots=True)
class Principal:
    """Authenticated subject and its server-derived authorization context."""

    tenant_id: str
    subject_id: str
    permissions: frozenset[str]
    roles: frozenset[str] = frozenset()
    maximum_risk: int = 1


@dataclass(frozen=True, slots=True)
class PolicyRequest:
    """Normalized resource action evaluated by the policy engine."""

    principal: Principal
    action: str
    resource_kind: str
    resource_name: str
    resource_tenant_id: str
    risk_level: int = 0
    data_classification: str = "internal"


@dataclass(frozen=True, slots=True)
class PolicyDecision:
    """Auditable decision with obligations for downstream gateways."""

    effect: DecisionEffect
    reason: str
    obligations: tuple[str, ...] = ()


class RuleBasedPolicyEngine:
    """Apply deny-first tenant, permission, classification, and risk rules."""

    def evaluate(self, request: PolicyRequest) -> PolicyDecision:
        principal = request.principal
        if not principal.tenant_id or not principal.subject_id:
            return PolicyDecision(DecisionEffect.DENY, "missing authenticated principal")
        if principal.tenant_id != request.resource_tenant_id:
            return PolicyDecision(DecisionEffect.DENY, "cross-tenant access is forbidden")
        permission = f"{request.resource_kind}:{request.action}"
        wildcard = f"{request.resource_kind}:*"
        if permission not in principal.permissions and wildcard not in principal.permissions:
            return PolicyDecision(DecisionEffect.DENY, f"missing permission: {permission}")
        if request.data_classification == "restricted" and "restricted-data" not in principal.roles:
            return PolicyDecision(DecisionEffect.DENY, "restricted data role is required")
        if request.risk_level > principal.maximum_risk:
            if "approver" in principal.roles:
                return PolicyDecision(
                    DecisionEffect.REQUIRE_APPROVAL,
                    "resource risk exceeds automatic execution limit",
                    obligations=("record_approval", "preserve_idempotency_key"),
                )
            return PolicyDecision(DecisionEffect.DENY, "resource risk exceeds principal limit")
        return PolicyDecision(
            DecisionEffect.ALLOW,
            "policy constraints satisfied",
            obligations=("emit_audit_event",),
        )
