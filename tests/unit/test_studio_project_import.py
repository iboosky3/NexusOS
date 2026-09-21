"""Project import creates a complete new workspace or leaves nothing behind."""

import pytest
from nexusos.prd.store import ConflictError, PrdStore
from nexusos.studio.store import StudioStore


def test_project_import_is_atomic_and_idempotent(tmp_path):
    store = StudioStore(PrdStore(tmp_path / "import.sqlite"))
    resources = [
        {
            "resourceType": "nexus.prd",
            "schemaVersion": 1,
            "payload": {"brief": {"title": "导入 PRD"}, "content": "# 原始正文"},
        },
        {
            "resourceType": "nexus.note",
            "schemaVersion": 1,
            "payload": {"title": "导入便签", "content": "原始内容"},
        },
    ]
    imported = store.import_workspace("导入项目", resources, "import-1")
    assert store.import_workspace("导入项目", resources, "import-1") == imported
    saved = store.list(imported["id"], "resource")
    assert len(saved) == 2
    assert all(item["revision"] == 1 for item in saved)
    assert "nexus.example-notes" in imported["plugins"]
    with pytest.raises(ConflictError, match="IDEMPOTENCY_CONFLICT"):
        store.import_workspace("另一个项目", resources, "import-1")
    with pytest.raises(ValueError):
        store.import_workspace(
            "错误项目",
            [
                *resources,
                {
                    "resourceType": "nexus.prd",
                    "payload": {"brief": {"title": "伪造"}, "provenance": [{"artifactId": "fake"}]},
                },
            ],
            "bad",
        )
    assert len(store.list(imported["id"], "resource")) == 2
    with store.documents.connection() as db:
        count = db.execute("SELECT COUNT(*) FROM studio_objects WHERE kind='workspace'").fetchone()[
            0
        ]
    assert count == 1
