"""Immutable prototype snapshots and explicitly approved PRD handoffs."""

import hashlib
from copy import deepcopy
from uuid import uuid4

from nexusos.prd.prototype import Prototype, prototype_appendix
from nexusos.prd.store import ConflictError, now
from nexusos.studio.media import screenshot_bytes
from nexusos.studio.store import StudioStore, digest


class HandoffService:
    def __init__(self, store: StudioStore):
        self.store = store

    @staticmethod
    def verify_artifact(artifact: dict):
        value = {key: item for key, item in artifact.items() if key != "digest"}
        if artifact.get("digest") != digest(value):
            raise ConflictError("ARTIFACT_INTEGRITY_ERROR：产物摘要不匹配，请检查存储备份")

    def verify_media(self, db, workspace: str, artifact: dict):
        payload = deepcopy(artifact["payload"])
        for page in payload["pages"]:
            reference = page.pop("screenshotRef")
            blob = self.store.get_in(db, workspace, reference["blobId"], "blob")
            mime, binary = screenshot_bytes(blob["data"])
            actual = hashlib.sha256(binary).hexdigest()
            if (
                actual != reference["digest"]
                or actual != blob["digest"]
                or mime != blob["mimeType"]
                or blob["id"] != digest([workspace, actual])
            ):
                raise ConflictError("MEDIA_INTEGRITY_ERROR：截图内容摘要不匹配")
            page["screenshot"] = blob["data"]
        return payload

    def publish(self, workspace: str, resource_id: str, revision: int, request_id: str):
        request = {"resourceId": resource_id, "revision": revision}
        with self.store.documents.connection() as db:
            self.store.require_plugin(db, workspace, "nexus.prototype-designer")
            old = self.store.request_in(db, workspace, "artifact.publish", request_id, request)
            if old:
                return old
            source = self.store.get_in(db, workspace, resource_id, "resource")
            self.store.check_revision(source, revision)
            if source["resourceType"] != "nexus.prototype" or source["deleted"]:
                raise ValueError("必须选择可用的原型资源")
            prototype = Prototype.model_validate(source["payload"]["prototype"])
            if (
                not prototype.confirmed
                or not prototype.pages
                or any(not page.screenshot for page in prototype.pages)
            ):
                raise ValueError("发布前必须确认设计并完成所有页面截图")
            payload = prototype.model_dump()
            for page in payload["pages"]:
                screenshot = page.pop("screenshot")
                content_type, binary = screenshot_bytes(screenshot)
                blob_id = hashlib.sha256(binary).hexdigest()
                # Workspace-scoped IDs prevent one workspace from replacing another's blob.
                blob = {
                    "id": digest([workspace, blob_id]),
                    "workspaceId": workspace,
                    "digest": blob_id,
                    "data": screenshot,
                    "mimeType": content_type,
                }
                self.store.put_in(db, blob, "blob")
                page["screenshotRef"] = {"blobId": blob["id"], "digest": blob_id}
            item = {
                "id": uuid4().hex,
                "workspaceId": workspace,
                "artifactType": "nexus.prototype.snapshot",
                "schemaVersion": 1,
                "producerPluginId": "nexus.prototype-designer",
                "producerPluginVersion": "1.0.0",
                "sourceResourceId": resource_id,
                "sourceRevision": revision,
                "createdAt": now(),
                "confirmedBy": "local_user",
                "payload": payload,
            }
            item["digest"] = digest(item)
            self.store.put_in(db, item, "artifact")
            self.store.receipt_in(db, workspace, "artifact.publish", request_id, request, item)
            return item

    def create(self, workspace: str, artifact_id: str, target_id: str, request_id: str):
        request = {"artifactId": artifact_id, "targetId": target_id}
        with self.store.documents.connection() as db:
            self.store.require_plugin(db, workspace, "nexus.prd-writer")
            previous = self.store.request_in(db, workspace, "handoff.create", request_id, request)
            if previous:
                return self.store.get_in(db, workspace, previous["id"], "handoff")
            artifact = self.store.get_in(db, workspace, artifact_id, "artifact")
            if (
                artifact["artifactType"] != "nexus.prototype.snapshot"
                or artifact["schemaVersion"] != 1
            ):
                raise ValueError("SCHEMA_INCOMPATIBLE")
            target = self.store.get_in(db, workspace, target_id, "resource")
            if target["resourceType"] != "nexus.prd" or target["deleted"]:
                raise ValueError("必须选择 PRD 文档")
            self.verify_artifact(artifact)
            payload = self.verify_media(db, workspace, artifact)
            appendix = prototype_appendix(Prototype.model_validate(payload))
            source_id = artifact["sourceResourceId"]
            start, end = (
                f"<!-- studio-source:{source_id}:start -->",
                f"<!-- studio-source:{source_id}:end -->",
            )
            section = f"{start}\n{appendix}\n{end}"
            content = target["payload"]["content"]
            provenance = next(
                (
                    entry
                    for entry in target["payload"].get("provenance", [])
                    if entry.get("sourceResourceId") == source_id
                ),
                None,
            )
            if start in content or end in content or provenance:
                if (
                    content.count(start) != 1
                    or content.count(end) != 1
                    or content.index(start) >= content.index(end)
                ):
                    raise ConflictError(
                        "SOURCE_MARKERS_INVALID：来源区块标记异常，请保留正文并修复标记后重试"
                    )
                left, right = content.index(start), content.index(end) + len(end)
                if not provenance or provenance.get("sectionDigest") != digest(content[left:right]):
                    raise ConflictError(
                        "SOURCE_SECTION_EDITED：已交接区块有人工修改，请先备份并对比，不能自动替换"
                    )
                if provenance.get("artifactId") == artifact_id:
                    raise ConflictError(
                        "ARTIFACT_ALREADY_APPLIED：当前文档已采用此产物，无需重复交接"
                    )
                content = content[:left] + section + content[right:]
            else:
                content = f"{content}\n\n{section}".strip()
            proposed = deepcopy(target["payload"])
            proposed["content"] = content
            proposed["provenance"] = [
                p for p in proposed.get("provenance", []) if p.get("sourceResourceId") != source_id
            ]
            proposed["provenance"].append(
                {
                    "artifactId": artifact_id,
                    "digest": artifact["digest"],
                    "sourceResourceId": source_id,
                    "sourceRevision": artifact["sourceRevision"],
                    "sectionDigest": digest(section),
                }
            )
            item = {
                "id": uuid4().hex,
                "workspaceId": workspace,
                "status": "waiting_confirmation",
                "artifactId": artifact_id,
                "artifactDigest": artifact["digest"],
                "targetId": target_id,
                "expectedRevision": target["revision"],
                "proposal": proposed,
                "proposalDigest": digest(proposed),
                "createdAt": now(),
                "appliedRevision": None,
            }
            self.store.put_in(db, item, "handoff")
            self.store.receipt_in(db, workspace, "handoff.create", request_id, request, item)
            return item

    def apply(self, workspace: str, identifier: str, proposal_digest: str, artifact_digest: str):
        with self.store.documents.connection() as db:
            self.store.require_plugin(db, workspace, "nexus.prd-writer")
            item = self.store.get_in(db, workspace, identifier, "handoff")
            if (
                item["proposalDigest"] != proposal_digest
                or item["artifactDigest"] != artifact_digest
            ):
                raise ConflictError("APPROVAL_STALE")
            if item["status"] == "succeeded":
                return item
            if item["status"] != "waiting_confirmation":
                raise ConflictError("HANDOFF_NOT_APPLICABLE")
            artifact = self.store.get_in(db, workspace, item["artifactId"], "artifact")
            self.verify_artifact(artifact)
            self.verify_media(db, workspace, artifact)
            if (
                artifact["digest"] != item["artifactDigest"]
                or digest(item["proposal"]) != item["proposalDigest"]
            ):
                raise ConflictError("APPROVAL_STALE")
            saved = self.store.save_in(
                db, workspace, item["targetId"], item["expectedRevision"], item["proposal"]
            )
            item.update(status="succeeded", appliedRevision=saved["revision"], appliedAt=now())
            self.store.put_in(db, item, "handoff")
            return item
