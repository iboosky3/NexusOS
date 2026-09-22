"""Prototype-owned publication and decoding of immutable design snapshots."""

from collections.abc import Callable
from copy import deepcopy

from nexusos.prd.prototype import Prototype
from nexusos.studio.plugin_contract import ArtifactProducer


def prepare(source: dict, put_media: Callable[[str], dict]) -> dict:
    prototype = Prototype.model_validate(source["prototype"])
    if (
        not prototype.confirmed
        or not prototype.pages
        or any(not p.screenshot for p in prototype.pages)
    ):
        raise ValueError("发布前必须确认设计并完成所有页面截图")
    payload = prototype.model_dump()
    for page in payload["pages"]:
        page["screenshotRef"] = put_media(page.pop("screenshot"))
    return payload


def hydrate(payload: dict, get_media: Callable[[dict], str]) -> dict:
    result = deepcopy(payload)
    for page in result["pages"]:
        page["screenshot"] = get_media(page.pop("screenshotRef"))
    return Prototype.model_validate(result).model_dump()


producer = ArtifactProducer("nexus.prototype.snapshot", 1, prepare, hydrate)
