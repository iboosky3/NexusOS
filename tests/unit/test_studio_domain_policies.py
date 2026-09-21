"""Declared domain policies protect metadata without platform type branches."""

from copy import deepcopy

import pytest
from nexusos.studio.plugins import plugin_for


def test_prototype_proposal_cannot_confirm_or_supply_screenshot():
    value = {
        "title": "设计",
        "prototype": {
            "confirmed": True,
            "input_digest": "forged",
            "pages": [
                {
                    "id": "home",
                    "title": "首页",
                    "description": "说明",
                    "elements": [{"kind": "text", "label": "标题"}],
                    "screenshot": "forged screenshot",
                }
            ],
        },
    }
    original = deepcopy(value)
    result = plugin_for("nexus.prototype").proposal(value, {})
    assert result["prototype"]["confirmed"] is False
    assert result["prototype"]["pages"][0]["screenshot"] == ""
    assert value == original


def test_prd_proposal_preserves_platform_provenance_and_rejects_embedded_prototype():
    plugin = plugin_for("nexus.prd")
    source = {"provenance": [{"artifactId": "real"}]}
    result = plugin.proposal(
        {"brief": {"title": "需求"}, "provenance": [{"artifactId": "fake"}]}, source
    )
    assert result["provenance"] == source["provenance"]
    result["provenance"][0]["artifactId"] = "changed"
    assert source["provenance"][0]["artifactId"] == "real"
    with pytest.raises(ValueError):
        plugin.validate(
            {
                "brief": {
                    "title": "需求",
                    "prototype": {
                        "pages": [
                            {
                                "id": "home",
                                "title": "首页",
                                "elements": [{"kind": "text", "label": "标题"}],
                            }
                        ]
                    },
                }
            }
        )


def test_note_schema_has_no_implicit_prd_fields():
    plugin = plugin_for("nexus.note")
    assert plugin.protected_fields == ()
    assert plugin.proposal({"title": "便签", "content": "内容"}, {}) == {
        "title": "便签",
        "content": "内容",
    }
    with pytest.raises(ValueError):
        plugin.validate({"title": "便签", "provenance": []})
