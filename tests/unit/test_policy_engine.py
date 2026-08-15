import unittest

from nexusos.policy import (
    DecisionEffect,
    PolicyRequest,
    Principal,
    RuleBasedPolicyEngine,
)


class PolicyEngineTests(unittest.TestCase):
    def setUp(self) -> None:
        self.engine = RuleBasedPolicyEngine()
        self.principal = Principal(
            tenant_id="tenant-a",
            subject_id="agent-1",
            permissions=frozenset({"tool:invoke", "memory:read"}),
            maximum_risk=1,
        )

    def test_allows_explicit_low_risk_permission(self) -> None:
        decision = self.engine.evaluate(
            PolicyRequest(
                self.principal,
                "invoke",
                "tool",
                "web.search",
                "tenant-a",
                risk_level=1,
            )
        )

        self.assertEqual(decision.effect, DecisionEffect.ALLOW)
        self.assertIn("emit_audit_event", decision.obligations)

    def test_denies_cross_tenant_access_before_permissions(self) -> None:
        decision = self.engine.evaluate(
            PolicyRequest(self.principal, "read", "memory", "entry", "tenant-b")
        )

        self.assertEqual(decision.effect, DecisionEffect.DENY)
        self.assertIn("cross-tenant", decision.reason)

    def test_requires_human_approval_only_for_authorized_approver(self) -> None:
        approver = Principal(
            tenant_id="tenant-a",
            subject_id="agent-1",
            permissions=frozenset({"tool:invoke"}),
            roles=frozenset({"approver"}),
            maximum_risk=1,
        )
        decision = self.engine.evaluate(
            PolicyRequest(approver, "invoke", "tool", "database.write", "tenant-a", 3)
        )

        self.assertEqual(decision.effect, DecisionEffect.REQUIRE_APPROVAL)
        self.assertIn("record_approval", decision.obligations)


if __name__ == "__main__":
    unittest.main()
