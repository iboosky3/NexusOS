"""Deterministic text responses for the resource PRD workflow."""

import json


def stage_content(identifier: str) -> str:
    if identifier == "review":
        return json.dumps({"summary": "请人工核验范围与验收要求", "issues": []})
    return {
        "requirements": "FR-001 提交需求，保留首版范围，指标待确认。",
        "ux": "提交失败时保留输入，允许用户修正后重试。",
        "technical": "数据与权限需由用户确认；不得丢失已保存的版本。",
        "write-1": "# Agent 草稿\n\n## 背景与范围\n"
        "面向产品团队整理需求，只覆盖用户明确的首版范围。",
        "write-2": "## 功能需求\n### FR-001 提交需求\n有效输入保存版本；失败时保留草稿。",
        "write-3": "## 数据与验收\n### AC-001 保存反馈\n"
        "对应 FR-001：保存后可重新读取；失败可恢复草稿。",
    }[identifier]
