"""Transactional, versioned artifacts and approved plugin-to-plugin handoffs."""

import hashlib
from copy import deepcopy
from uuid import uuid4

from nexusos.prd.store import ConflictError, now
from nexusos.studio import plugins
from nexusos.studio.media import screenshot_bytes
from nexusos.studio.plugin_contract import ArtifactConsumer, ArtifactProducer, DomainPlugin
from nexusos.studio.store import StudioStore, digest


class HandoffService:
    def __init__(self, store: StudioStore):
        self.store = store

    @staticmethod
    def verify_artifact(artifact: dict):
        value = {key: item for key, item in artifact.items() if key != "digest"}
        if artifact.get("digest") != digest(value):
            raise ConflictError("ARTIFACT_INTEGRITY_ERROR：产物摘要不匹配，请检查存储备份")

    @staticmethod
    def producer_for(artifact: dict) -> ArtifactProducer:
        plugin = next((p for p in plugins.PLUGINS if p.id == artifact["producerPluginId"]), None)
        producer = plugin.artifact_producer if plugin else None
        if (
            producer is None
            or producer.artifact_type != artifact["artifactType"]
            or producer.schema_version != artifact["schemaVersion"]
        ):
            raise ValueError("SCHEMA_INCOMPATIBLE")
        return producer

    @staticmethod
    def consumer_for(plugin: DomainPlugin, artifact: dict) -> ArtifactConsumer:
        consumer = next(
            (
                c
                for c in plugin.artifact_consumers
                if c.artifact_type == artifact["artifactType"]
                and c.schema_version == artifact["schemaVersion"]
            ),
            None,
        )
        if consumer is None:
            raise ValueError("SCHEMA_INCOMPATIBLE")
        return consumer

    def put_media(self, db, workspace: str, data: str) -> dict:
        mime, binary = screenshot_bytes(data)
        content_digest = hashlib.sha256(binary).hexdigest()
        blob = {
            "id": digest([workspace, content_digest]),
            "workspaceId": workspace,
            "digest": content_digest,
            "data": data,
            "mimeType": mime,
        }
        self.store.put_in(db, blob, "blob")
        return {"blobId": blob["id"], "digest": content_digest}

    def get_media(self, db, workspace: str, reference: dict) -> str:
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
        return blob["data"]

    def verify_media(self, db, workspace: str, artifact: dict):
        return self.producer_for(artifact).hydrate(
            deepcopy(artifact["payload"]), lambda ref: self.get_media(db, workspace, ref)
        )

    def publish(self, workspace: str, resource_id: str, revision: int, request_id: str):
        request = {"resourceId": resource_id, "revision": revision}
        with self.store.documents.connection() as db:
            source = self.store.get_in(db, workspace, resource_id, "resource")
            plugin = plugins.plugin_for(source["resourceType"])
            self.store.require_plugin(db, workspace, plugin.id)
            producer = plugin.artifact_producer
            if producer is None:
                raise ValueError("ARTIFACT_PRODUCER_UNAVAILABLE")
            old = self.store.request_in(db, workspace, "artifact.publish", request_id, request)
            if old:
                return old
            source = self.store.get_in(db, workspace, resource_id, "resource")
            self.store.check_revision(source, revision)
            if source["deleted"]:
                raise ValueError("RESOURCE_DELETED")
            payload = producer.prepare(
                deepcopy(source["payload"]), lambda data: self.put_media(db, workspace, data)
            )
            item = {
                "id": uuid4().hex,
                "workspaceId": workspace,
                "artifactType": producer.artifact_type,
                "schemaVersion": producer.schema_version,
                "producerPluginId": plugin.id,
                "producerPluginVersion": plugin.version,
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
            target = self.store.get_in(db, workspace, target_id, "resource")
            plugin = plugins.plugin_for(target["resourceType"])
            self.store.require_plugin(db, workspace, plugin.id)
            previous = self.store.request_in(db, workspace, "handoff.create", request_id, request)
            if previous:
                return self.store.get_in(db, workspace, previous["id"], "handoff")
            artifact = self.store.get_in(db, workspace, artifact_id, "artifact")
            if target["deleted"]:
                raise ValueError("RESOURCE_DELETED")
            consumer = self.consumer_for(plugin, artifact)
            self.verify_artifact(artifact)
            payload = self.verify_media(db, workspace, artifact)
            proposed = plugin.validate(
                consumer.propose(deepcopy(artifact), payload, deepcopy(target["payload"]))
            )
            item = {
                "id": uuid4().hex,
                "workspaceId": workspace,
                "status": "waiting_confirmation",
                "consumerPluginId": plugin.id,
                "consumerPluginVersion": plugin.version,
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
            item = self.store.get_in(db, workspace, identifier, "handoff")
            target = self.store.get_in(db, workspace, item["targetId"], "resource")
            plugin = plugins.plugin_for(target["resourceType"])
            self.store.require_plugin(db, workspace, plugin.id)
            if (
                item["proposalDigest"] != proposal_digest
                or item["artifactDigest"] != artifact_digest
            ):
                raise ConflictError("APPROVAL_STALE")
            if item["status"] == "succeeded":
                return item
            if item["status"] != "waiting_confirmation":
                raise ConflictError("HANDOFF_NOT_APPLICABLE")
            if (
                item["consumerPluginId"] != plugin.id
                or item["consumerPluginVersion"] != plugin.version
            ):
                raise ConflictError("CONSUMER_CHANGED：接收插件已更新，请重新预览并确认")
            artifact = self.store.get_in(db, workspace, item["artifactId"], "artifact")
            self.verify_artifact(artifact)
            self.consumer_for(plugin, artifact)
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
