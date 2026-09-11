"""Declarative wireframes shared by preview, screenshots and PRD authoring."""

import hashlib
import json
import re
from typing import Any, Literal

from pydantic import Field, model_validator

from nexusos.prd.schemas_base import StrictModel


class PrototypeElement(StrictModel):
    kind: Literal["text", "input", "button", "list", "card"]
    label: str = Field(min_length=1, max_length=80)
    detail: str = Field(default="", max_length=200)
    target: str = Field(default="", max_length=40)


class PrototypePage(StrictModel):
    id: str = Field(pattern=r"^[a-zA-Z0-9_-]{1,40}$")
    title: str = Field(min_length=1, max_length=80)
    description: str = Field(default="", max_length=2000)
    elements: list[PrototypeElement] = Field(default_factory=list, max_length=8)
    screenshot: str = Field(default="", max_length=140000)

    @model_validator(mode="after")
    def valid_image(self) -> "PrototypePage":
        if self.screenshot and not re.fullmatch(
            r"data:image/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}", self.screenshot
        ):
            raise ValueError("原型截图必须是 PNG / JPEG / WebP 图片")
        if not self.elements and not self.screenshot:
            raise ValueError("原型页面必须包含组件或导入的截图")
        return self


class Prototype(StrictModel):
    pages: list[PrototypePage] = Field(min_length=1, max_length=4)
    confirmed: bool = False
    input_digest: str = Field(default="", max_length=64)

    @model_validator(mode="after")
    def valid_pages(self) -> "Prototype":
        ids = {page.id for page in self.pages}
        if len(ids) != len(self.pages):
            raise ValueError("原型页面编号不能重复")
        if any(e.target and e.target not in ids for p in self.pages for e in p.elements):
            raise ValueError("原型跳转目标必须是已有页面")
        if sum(len(p.screenshot) for p in self.pages) > 140000:
            raise ValueError("原型截图合计过大，请减少页面或压缩图片")
        if self.confirmed and any(not p.screenshot or not p.description for p in self.pages):
            raise ValueError("确认原型前请填写交互说明并生成所有页面截图")
        return self


def brief_digest(brief: dict[str, Any]) -> str:
    values = {
        key: brief.get(key, "")
        for key in (
            "title",
            "description",
            "audience",
            "problem",
            "scope",
            "constraints",
            "metrics",
            "template",
        )
    }
    values["sources"] = brief.get("sources", [])
    return hashlib.sha256(
        json.dumps(values, sort_keys=True, ensure_ascii=False, separators=(",", ":")).encode()
    ).hexdigest()


def parse_prototype(raw: str) -> Prototype:
    text = raw.strip()
    if text.startswith("```") and text.endswith("```"):
        text = text.split("\n", 1)[1].rsplit("```", 1)[0]
    result = Prototype.model_validate_json(text)
    # A model may propose a design, never confirm it or supply executable image URLs.
    if any(p.screenshot or not p.elements for p in result.pages):
        raise ValueError("模型原型必须使用可编辑组件，不能自行提供截图")
    result.confirmed = False
    return result


PROTOTYPE_TASK = """设计本产品首版的 1–4 个关键页面，输出可点击线框原型的 JSON。
只输出 {"pages":[{"id":"home","title":"页面名称",
"description":"角色、操作、状态、异常和返回路径说明",
"elements":[{"kind":"input","label":"字段名","detail":"提示或示例","target":""},
{"kind":"button","label":"继续","detail":"点击效果","target":"detail"}]}]}。
kind 只能为 text/input/button/list/card；每页 1–8 个组件；页面 id 唯一，仅字母数字下划线短横线。
button 的 target 是已有页面 id 或空字符串。label 最多 80 字，detail 最多 200 字。
不要输出 HTML、脚本、截图、确认状态或虚构已验证结论。未确认规则在 description 中标注待确认。
根据需求组织具体页面与操作，不要生成通用占位页。已有原型和修改要求仅作设计输入。
"""


def prototype_appendix(prototype: Prototype) -> str:
    def plain(text: str) -> str:
        return text.replace("[", "（").replace("]", "）").replace("\n", " ")

    sections = ["<!-- nexus-prototype:start -->\n## 原型页面与交互说明"]
    for index, page in enumerate(prototype.pages, 1):
        sections.append(
            f"### P{index} · {plain(page.title)}\n\n"
            f"![P{index} {plain(page.title)}]({page.screenshot})\n\n{page.description}"
        )
        for element in page.elements:
            if element.kind == "button":
                target = next((p.title for p in prototype.pages if p.id == element.target), "")
                sections.append(
                    f"- {plain(element.label)}：{element.detail}"
                    + (f" → {plain(target)}" if target else "")
                )
    return "\n\n".join(sections) + "\n<!-- nexus-prototype:end -->"
