"""Transactional resource versions and workspace configuration for trusted plugins."""

from __future__ import annotations

import hashlib
import json
from collections.abc import Sequence
from typing import Any
from uuid import uuid4

from nexusos.prd.store import ConflictError, NotFoundError, PrdStore, now
from nexusos.studio.plugins import PLUGINS, plugin_for


def canonical(value: Any) -> str:
    return json.dumps(
        value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False
    )


def digest(value: Any) -> str:
    return hashlib.sha256(canonical(value).encode()).hexdigest()


class StudioStore:
    def __init__(self, documents: PrdStore):
        self.documents = documents
        with documents.connection() as db:
            db.executescript("""
                CREATE TABLE IF NOT EXISTS studio_objects (
                    id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL,
                    kind TEXT NOT NULL, body TEXT NOT NULL);
                CREATE INDEX IF NOT EXISTS studio_workspace ON studio_objects(workspace_id, kind);
                CREATE TABLE IF NOT EXISTS studio_resource_versions (
                    resource_id TEXT NOT NULL, revision INTEGER NOT NULL, body TEXT NOT NULL,
                    PRIMARY KEY(resource_id, revision));
                CREATE TABLE IF NOT EXISTS studio_requests (
                    workspace_id TEXT NOT NULL, operation TEXT NOT NULL, request_id TEXT NOT NULL,
                    digest TEXT NOT NULL, result TEXT NOT NULL,
                    PRIMARY KEY(workspace_id, operation, request_id));
                CREATE TABLE IF NOT EXISTS studio_events (
                    invocation_id TEXT NOT NULL, sequence INTEGER NOT NULL, body TEXT NOT NULL,
                    PRIMARY KEY(invocation_id, sequence));
            """)

    @staticmethod
    def get_in(db, workspace_id: str, object_id: str, kind: str) -> dict[str, Any]:
        row = db.execute(
            "SELECT body FROM studio_objects WHERE id=? AND workspace_id=? AND kind=?",
            (object_id, workspace_id, kind),
        ).fetchone()
        if not row:
            raise NotFoundError(object_id)
        return json.loads(row[0])

    @staticmethod
    def put_in(db, item: dict[str, Any], kind: str) -> None:
        db.execute(
            "INSERT INTO studio_objects VALUES(?,?,?,?) "
            "ON CONFLICT(id) DO UPDATE SET body=excluded.body",
            (item["id"], item["workspaceId"], kind, canonical(item)),
        )

    def get(self, workspace_id: str, object_id: str, kind: str) -> dict[str, Any]:
        with self.documents.connection() as db:
            return self.get_in(db, workspace_id, object_id, kind)

    def list(self, workspace_id: str, kind: str) -> list[dict[str, Any]]:
        with self.documents.connection() as db:
            self.get_in(db, workspace_id, workspace_id, "workspace")
            return [
                json.loads(row[0])
                for row in db.execute(
                    "SELECT body FROM studio_objects WHERE workspace_id=? AND kind=? "
                    "ORDER BY rowid",
                    (workspace_id, kind),
                )
            ]

    @staticmethod
    def request_in(db, workspace: str, operation: str, key: str, payload: Any):
        if not key or len(key) > 200:
            raise ValueError("clientRequestId is required (maximum 200 characters)")
        row = db.execute(
            "SELECT digest,result FROM studio_requests "
            "WHERE workspace_id=? AND operation=? AND request_id=?",
            (workspace, operation, key),
        ).fetchone()
        if row:
            if row[0] != digest(payload):
                raise ConflictError("IDEMPOTENCY_CONFLICT")
            return json.loads(row[1])
        return None

    @staticmethod
    def receipt_in(db, workspace: str, operation: str, key: str, payload: Any, result: Any):
        db.execute(
            "INSERT INTO studio_requests VALUES(?,?,?,?,?)",
            (workspace, operation, key, digest(payload), canonical(result)),
        )

    def create_workspace(self, title: str, request_id: str) -> dict[str, Any]:
        if not title.strip() or len(title) > 200:
            raise ValueError("工作区名称不能为空或超过 200 字符")
        with self.documents.connection() as db:
            previous = self.request_in(db, "local_user", "workspace.create", request_id, title)
            if previous:
                return previous
            identifier = uuid4().hex
            item = {
                "id": identifier,
                "workspaceId": identifier,
                "title": title,
                "revision": 1,
                "plugins": [plugin.id for plugin in PLUGINS if plugin.default_enabled],
                "layouts": {},
                "createdAt": now(),
            }
            self.put_in(db, item, "workspace")
            self.receipt_in(db, "local_user", "workspace.create", request_id, title, item)
            return item

    def configure(self, workspace: str, revision: int, plugins: Sequence[str], layouts: dict):
        if len(plugins) != len(set(plugins)) or set(plugins) - {p.id for p in PLUGINS}:
            raise ValueError("Unknown or duplicate plugin")
        if len(canonical(layouts)) > 100000:
            raise ValueError("Layout too large")
        with self.documents.connection() as db:
            item = self.get_in(db, workspace, workspace, "workspace")
            self.check_revision(item, revision)
            item.update(revision=revision + 1, plugins=list(plugins), layouts=layouts)
            self.put_in(db, item, "workspace")
            return item

    @staticmethod
    def check_revision(item: dict, expected: int):
        if item["revision"] != expected:
            raise ConflictError("REVISION_CONFLICT：数据已更新，请对比后重新保存")

    def require_plugin(self, db, workspace: str, plugin_id: str):
        config = self.get_in(db, workspace, workspace, "workspace")
        if plugin_id not in config["plugins"]:
            raise PermissionError("PLUGIN_DISABLED")

    def create_resource(self, workspace: str, resource_type: str, payload: dict, request_id: str):
        plugin = plugin_for(resource_type)
        value = plugin.validate(payload)
        if value.get("provenance"):
            raise ValueError("PROVENANCE_MANAGED_BY_PLATFORM")
        request = {"type": resource_type, "payload": value}
        with self.documents.connection() as db:
            self.require_plugin(db, workspace, plugin.id)
            previous = self.request_in(db, workspace, "resource.create", request_id, request)
            if previous:
                return previous
            item = {
                "id": uuid4().hex,
                "workspaceId": workspace,
                "resourceType": resource_type,
                "schemaVersion": 1,
                "revision": 1,
                "payload": value,
                "createdAt": now(),
                "updatedAt": now(),
                "deleted": False,
            }
            self.put_resource_in(db, item)
            self.receipt_in(db, workspace, "resource.create", request_id, request, item)
            return item

    def put_resource_in(self, db, item: dict):
        self.put_in(db, item, "resource")
        db.execute(
            "INSERT INTO studio_resource_versions VALUES(?,?,?)",
            (item["id"], item["revision"], canonical(item)),
        )

    def save_in(self, db, workspace: str, identifier: str, revision: int, payload: dict):
        item = self.get_in(db, workspace, identifier, "resource")
        plugin = plugin_for(item["resourceType"])
        self.require_plugin(db, workspace, plugin.id)
        self.check_revision(item, revision)
        if item["deleted"]:
            raise ConflictError("RESOURCE_DELETED")
        item.update(payload=plugin.validate(payload), revision=revision + 1, updatedAt=now())
        self.put_resource_in(db, item)
        return item

    def save(
        self,
        workspace: str,
        identifier: str,
        revision: int,
        payload: dict,
        request_id: str | None = None,
    ):
        request = {"resourceId": identifier, "expectedRevision": revision, "payload": payload}
        with self.documents.connection() as db:
            current = self.get_in(db, workspace, identifier, "resource")
            self.require_plugin(db, workspace, plugin_for(current["resourceType"]).id)
            if request_id:
                previous = self.request_in(db, workspace, "resource.save", request_id, request)
                if previous:
                    return previous
            if current["resourceType"] == "nexus.prd" and (
                payload.get("provenance", []) != current["payload"].get("provenance", [])
            ):
                raise ValueError("PROVENANCE_MANAGED_BY_PLATFORM")
            result = self.save_in(db, workspace, identifier, revision, payload)
            if request_id:
                self.receipt_in(db, workspace, "resource.save", request_id, request, result)
            return result

    def version(self, workspace: str, identifier: str, revision: int):
        with self.documents.connection() as db:
            self.get_in(db, workspace, identifier, "resource")
            row = db.execute(
                "SELECT body FROM studio_resource_versions WHERE resource_id=? AND revision=?",
                (identifier, revision),
            ).fetchone()
            if not row:
                raise NotFoundError(f"{identifier}@{revision}")
            return json.loads(row[0])
