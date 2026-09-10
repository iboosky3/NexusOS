import unittest

from nexusos.prd.review import inspect_traceability
from nexusos.prd.schemas import Brief, Source


class PrdTraceabilityTests(unittest.TestCase):
    def test_rejects_unknown_sources_even_if_model_claims_no_issues(self):
        brief = Brief(title="产品", sources=[Source(name="访谈", content="访谈记录")])
        issues = inspect_traceability("FR-001\nAC-001\n依据 [S1] 与 [S99]", brief)
        self.assertEqual(len(issues), 1)
        self.assertEqual(issues[0].severity, "blocker")
        self.assertIn("S99", issues[0].problem)

    def test_title_outline_is_not_a_traceable_requirement_document(self):
        issues = inspect_traceability("# 产品\n## 功能\n## 验收", Brief(title="产品"))
        self.assertEqual({issue.section for issue in issues}, {"功能需求", "验收条件"})

    def test_identifiers_and_sources_do_not_prove_semantic_quality(self):
        issues = inspect_traceability("FR-001\nAC-001", Brief(title="产品"))
        self.assertEqual(issues, [])
