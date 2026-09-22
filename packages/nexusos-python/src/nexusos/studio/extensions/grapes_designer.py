"""An opt-in GrapesJS experiment with its own resource and artifact policy."""

import hashlib
import json
import re
from typing import Any

from pydantic import Field, model_validator

from nexusos.prd.prototype import Prototype
from nexusos.prd.schemas_base import StrictModel
from nexusos.studio.media import screenshot_bytes
from nexusos.studio.plugin_contract import ArtifactProducer, DomainPlugin

_UNSAFE_TEXT = re.compile(
    r"<\s*/?\s*[a-z][^>]*>|"
    r"\bjavascript\s*:|\bdata\s*:\s*text/html|\bon[a-z]+\s*=|@import\b|"
    r"url\s*\(\s*['\"]?\s*(?!data:image/(?:png|jpeg|webp);base64,)",
    re.IGNORECASE,
)
_UNSAFE_KEYS = {"script", "script-props", "scripts", "srcdoc"}


def validate_project(raw: str) -> None:
    try:
        project = json.loads(raw)
    except (json.JSONDecodeError, TypeError) as error:
        raise ValueError("GRAPES_PROJECT_INVALID：项目 JSON 无效") from error
    if not isinstance(project, dict):
        raise ValueError("GRAPES_PROJECT_INVALID：项目必须是对象")
    count = 0

    def visit(value: Any, depth: int = 0) -> None:
        nonlocal count
        count += 1
        if depth > 24 or count > 5000:
            raise ValueError("GRAPES_PROJECT_INVALID：项目过大或嵌套过深")
        if isinstance(value, dict):
            for key, item in value.items():
                if (
                    not isinstance(key, str)
                    or key.lower() in _UNSAFE_KEYS
                    or key.lower().startswith("on")
                ):
                    raise ValueError("GRAPES_PROJECT_UNSAFE：不允许脚本与事件属性")
                if key.lower() in {
                    "src",
                    "href",
                    "srcset",
                    "poster",
                    "xlink:href",
                    "action",
                    "formaction",
                } and (
                    not isinstance(item, str)
                    or (
                        item != ""
                        and not item.startswith(
                            (
                                "#",
                                "data:image/png;base64,",
                                "data:image/jpeg;base64,",
                                "data:image/webp;base64,",
                            )
                        )
                    )
                ):
                    raise ValueError("GRAPES_PROJECT_UNSAFE：不允许外部资源链接")
                visit(item, depth + 1)
        elif isinstance(value, list):
            for item in value:
                visit(item, depth + 1)
        elif isinstance(value, str):
            if _UNSAFE_TEXT.search(value):
                raise ValueError("GRAPES_PROJECT_UNSAFE：不允许脚本、外部资源或活动内容")
        elif value is not None and not isinstance(value, (int, float, bool)):
            raise ValueError("GRAPES_PROJECT_INVALID：项目包含不支持的值")

    visit(project)


class GrapesPageSnapshot(StrictModel):
    id: str = Field(pattern=r"^[a-zA-Z0-9_-]{1,40}$")
    title: str = Field(min_length=1, max_length=80)
    description: str = Field(min_length=1, max_length=2000)
    screenshot: str = Field(min_length=1, max_length=140000)


class GrapesPayload(StrictModel):
    title: str = Field(default="未命名自由原型", min_length=1, max_length=200)
    description: str = Field(default="", max_length=2000)
    projectJson: str = Field(default="{}", max_length=200000)
    screenshot: str = Field(default="", max_length=140000)
    screenshotProjectDigest: str = Field(default="", max_length=64)
    pageSnapshots: list[GrapesPageSnapshot] = Field(default_factory=list, max_length=4)
    confirmed: bool = False

    @model_validator(mode="after")
    def valid_snapshot(self):
        validate_project(self.projectJson)
        if self.screenshot:
            screenshot_bytes(self.screenshot)
        for page in self.pageSnapshots:
            screenshot_bytes(page.screenshot)
        if len({page.id for page in self.pageSnapshots}) != len(self.pageSnapshots):
            raise ValueError("页面编号不能重复")
        if sum(len(page.screenshot) for page in self.pageSnapshots) > 140000:
            raise ValueError("原型截图合计过大，请减少页面或压缩图片")
        expected = hashlib.sha256(self.projectJson.encode()).hexdigest()
        if self.confirmed and (
            not self.description.strip()
            or not (self.pageSnapshots or self.screenshot)
            or self.screenshotProjectDigest != expected
        ):
            raise ValueError("确认前请填写页面说明并为当前项目重新生成截图")
        return self


def prepare(source: dict, put_media) -> dict:
    value = GrapesPayload.model_validate(source)
    if not value.confirmed:
        raise ValueError("发布前必须确认原型设计")
    pages = [page.model_dump() for page in value.pageSnapshots] or [
        {
            "id": "home",
            "title": value.title,
            "description": value.description,
            "screenshot": value.screenshot,
        }
    ]
    snapshot = Prototype.model_validate(
        {"confirmed": True, "pages": [{**page, "elements": []} for page in pages]}
    ).model_dump()
    for page in snapshot["pages"]:
        page["screenshotRef"] = put_media(page.pop("screenshot"))
    return snapshot


def hydrate(payload: dict, get_media) -> dict:
    result = json.loads(json.dumps(payload))
    for page in result["pages"]:
        page["screenshot"] = get_media(page.pop("screenshotRef"))
    return Prototype.model_validate(result).model_dump()


plugin = DomainPlugin(
    id="nexus.grapes-prototype",
    resource_type="nexus.grapes-prototype",
    payload_model=GrapesPayload,
    actions=(),
    instruction="手工 GrapesJS 原型试验；尚无模型执行能力。",
    default_enabled=False,
    artifact_producer=ArtifactProducer("nexus.prototype.snapshot", 1, prepare, hydrate),
)
