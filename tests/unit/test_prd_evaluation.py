import unittest

from nexusos.evaluation import evaluate_prd


class PrdEvaluationTests(unittest.TestCase):
    def test_passes_structured_prd_with_explicit_assumptions(self) -> None:
        content = """# 产品需求文档
## 需求与范围
### MVP
完成核心闭环。
## 用户流程
输入到输出。
## 技术方案
使用契约边界。
## 成功指标
任务完成率。
## 风险
市场结论是待验证假设。
"""

        review = evaluate_prd(content)

        self.assertTrue(review.passed)
        self.assertGreaterEqual(review.dimensions["evidence"], 85)
        self.assertEqual(review.blocking_issues, ())

    def test_blocks_document_with_missing_core_sections(self) -> None:
        review = evaluate_prd("# 产品需求文档\n\n只有背景。")

        self.assertFalse(review.passed)
        self.assertTrue(review.blocking_issues)
        self.assertTrue(review.revision_tasks)


if __name__ == "__main__":
    unittest.main()
