import unittest

from nexusos.api.workspace_store import (
    InMemoryWorkspaceStore,
    WorkspaceVersionConflictError,
)


class WorkspaceStoreTests(unittest.TestCase):
    def test_versions_resources_and_records_correlated_events(self) -> None:
        store = InMemoryWorkspaceStore()
        created = store.create("project-1", "导入流程", correlation_id="create-1")

        updated = store.update_prd(
            "project-1",
            "# 新 PRD",
            expected_version=1,
            correlation_id="edit-1",
            run_id="run-9",
        )
        prototype = store.update_prototype(
            "project-1",
            "<button>上传</button>",
            expected_version=0,
            correlation_id="edit-1",
        )
        captured = store.add_screenshot(
            "project-1",
            prototype_version=1,
            purpose="展示上传入口",
            node_id="upload-button",
            correlation_id="edit-1",
        )

        self.assertEqual(created["events"][0]["correlation_id"], "create-1")
        self.assertEqual(updated["prd"]["version"], 2)
        self.assertEqual(prototype["prototype"]["version"], 1)
        self.assertEqual(captured["events"][-1]["action"], "screenshot.inserted")
        self.assertEqual(captured["events"][-1]["sequence"], 4)
        self.assertEqual(captured["screenshots"][0]["node_id"], "upload-button")

    def test_rejects_stale_resource_version(self) -> None:
        store = InMemoryWorkspaceStore()
        store.create("project-1", "导入流程")
        store.update_prd("project-1", "first", expected_version=1)

        with self.assertRaises(WorkspaceVersionConflictError):
            store.update_prd("project-1", "stale", expected_version=1)

    def test_professional_mode_uses_orchestrated_assistant_policy(self) -> None:
        store = InMemoryWorkspaceStore()
        store.create("project-1", "导入流程")
        store.set_mode("project-1", "professional")

        workspace, response = store.record_assistant_exchange(
            "project-1", "检查异常场景", correlation_id="review-1"
        )

        self.assertEqual(response["policy"]["workflow"], "orchestrated")
        self.assertEqual(
            workspace["events"][-1]["causation_id"], workspace["events"][-2]["event_id"]
        )
        self.assertEqual(workspace["events"][-1]["correlation_id"], "review-1")


if __name__ == "__main__":
    unittest.main()
