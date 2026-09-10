"""Transactional SQLite persistence for a single-instance authoring workspace."""

from __future__ import annotations

import json
import sqlite3
from collections.abc import Iterator
from contextlib import contextmanager
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from uuid import uuid4


def now() -> str:
    return datetime.now(UTC).isoformat()


class NotFoundError(LookupError):
    """The requested workspace resource does not exist."""


class ConflictError(ValueError):
    """A concurrent edit or active generation prevents the requested mutation."""


class PrdStore:
    def __init__(self, path: str | Path) -> None:
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self.connection() as db:
            db.executescript("""
                PRAGMA journal_mode=WAL;
                CREATE TABLE IF NOT EXISTS prd_documents (id TEXT PRIMARY KEY, body TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS prd_versions (
                    document_id TEXT NOT NULL, version INTEGER NOT NULL, body TEXT NOT NULL,
                    PRIMARY KEY (document_id, version));
                CREATE TABLE IF NOT EXISTS prd_jobs (
                    id TEXT PRIMARY KEY, document_id TEXT NOT NULL, body TEXT NOT NULL);
                CREATE INDEX IF NOT EXISTS prd_jobs_document ON prd_jobs(document_id);
            """)

    @contextmanager
    def connection(self) -> Iterator[sqlite3.Connection]:
        db = sqlite3.connect(self.path, timeout=10)
        try:
            db.execute("BEGIN IMMEDIATE")
            yield db
            db.commit()
        except BaseException:
            db.rollback()
            raise
        finally:
            db.close()

    @staticmethod
    def _get(db: sqlite3.Connection, table: str, key: str) -> dict[str, Any]:
        row = db.execute(f"SELECT body FROM {table} WHERE id=?", (key,)).fetchone()
        if row is None:
            raise NotFoundError(key)
        return json.loads(row[0])  # type: ignore[no-any-return]

    @staticmethod
    def _put(db: sqlite3.Connection, table: str, item: dict[str, Any]) -> None:
        db.execute(f"UPDATE {table} SET body=? WHERE id=?", (json.dumps(item), item["id"]))

    def create(self, brief: dict[str, Any]) -> dict[str, Any]:
        item = {
            "id": uuid4().hex,
            "brief": brief,
            "content": "",
            "revision": 1,
            "version": 0,
            "review": None,
            "active_job_id": None,
            "last_job_id": None,
            "created_at": now(),
            "updated_at": now(),
        }
        with self.connection() as db:
            db.execute("INSERT INTO prd_documents VALUES (?,?)", (item["id"], json.dumps(item)))
        return item

    def get(self, document_id: str) -> dict[str, Any]:
        with self.connection() as db:
            return self._get(db, "prd_documents", document_id)

    def list_documents(self) -> list[dict[str, Any]]:
        with self.connection() as db:
            items = [json.loads(row[0]) for row in db.execute("SELECT body FROM prd_documents")]
        return [
            {key: item[key] for key in ("id", "revision", "version", "updated_at", "active_job_id")}
            | {"title": item["brief"]["title"]}
            for item in sorted(items, key=lambda item: item["updated_at"], reverse=True)
        ]

    @staticmethod
    def _check(item: dict[str, Any], revision: int) -> None:
        if item["revision"] != revision:
            raise ConflictError("文档已在其他页面更新，请重新打开后再保存；当前编辑未被覆盖")
        if item["active_job_id"]:
            raise ConflictError("文档正在生成或评审，请等待完成或停止任务后再编辑")

    @staticmethod
    def _version(db: sqlite3.Connection, item: dict[str, Any], note: str) -> None:
        item["version"] += 1
        snapshot = {
            "version": item["version"],
            "brief": item["brief"],
            "content": item["content"],
            "note": note,
            "created_at": now(),
        }
        db.execute(
            "INSERT INTO prd_versions VALUES (?,?,?)",
            (
                item["id"],
                item["version"],
                json.dumps(snapshot),
            ),
        )

    def save(
        self, document_id: str, revision: int, brief: dict[str, Any], content: str, note: str
    ) -> dict[str, Any]:
        with self.connection() as db:
            item = self._get(db, "prd_documents", document_id)
            self._check(item, revision)
            if item["brief"] == brief and item["content"] == content:
                return item
            item.update(brief=brief, content=content, review=None, updated_at=now())
            item["revision"] += 1
            self._version(db, item, note)
            self._put(db, "prd_documents", item)
            return item

    def versions(self, document_id: str) -> list[dict[str, Any]]:
        with self.connection() as db:
            self._get(db, "prd_documents", document_id)
            return [
                json.loads(row[0])
                for row in db.execute(
                    "SELECT body FROM prd_versions WHERE document_id=? ORDER BY version DESC",
                    (document_id,),
                )
            ]

    def start_job(
        self, document_id: str, revision: int, action: str, instruction: str
    ) -> dict[str, Any]:
        with self.connection() as db:
            item = self._get(db, "prd_documents", document_id)
            self._check(item, revision)
            if action in {"revise", "review"} and not item["content"].strip():
                raise ValueError("请先生成或导入 PRD 文档")
            if action == "revise" and not instruction.strip():
                raise ValueError("请填写修改要求")
            if action == "generate" and item["content"].strip():
                raise ValueError("已有文档请使用修改功能，以保留现有内容")
            job: dict[str, Any] = {
                "id": uuid4().hex,
                "document_id": document_id,
                "action": action,
                "instruction": instruction,
                "status": "queued",
                "stage": "等待执行",
                "steps": [],
                "error": None,
                "created_at": now(),
                "updated_at": now(),
                "input_tokens": 0,
                "output_tokens": 0,
            }
            item["active_job_id"] = job["id"]
            item["last_job_id"] = job["id"]
            self._put(db, "prd_documents", item)
            db.execute(
                "INSERT INTO prd_jobs VALUES (?,?,?)",
                (
                    job["id"],
                    document_id,
                    json.dumps(job),
                ),
            )
            return job

    def job(self, job_id: str) -> dict[str, Any]:
        with self.connection() as db:
            return self._get(db, "prd_jobs", job_id)

    def update_job(self, job_id: str, **changes: Any) -> dict[str, Any]:
        with self.connection() as db:
            job = self._get(db, "prd_jobs", job_id)
            if job["status"] in {"succeeded", "failed", "cancelled"}:
                return job
            job.update(changes, updated_at=now())
            if job["status"] in {"failed", "cancelled"}:
                job["steps"] = [
                    {**step, "status": job["status"]} if step["status"] == "running" else step
                    for step in job["steps"]
                ]
            self._put(db, "prd_jobs", job)
            if job["status"] in {"succeeded", "failed", "cancelled"}:
                item = self._get(db, "prd_documents", job["document_id"])
                item["active_job_id"] = None
                self._put(db, "prd_documents", item)
            return job

    def publish(
        self, job_id: str, *, content: str | None = None, review: dict[str, Any] | None = None
    ) -> None:
        with self.connection() as db:
            job = self._get(db, "prd_jobs", job_id)
            item = self._get(db, "prd_documents", job["document_id"])
            if item["active_job_id"] != job_id or job["status"] != "running":
                raise ConflictError("任务已结束，不能覆盖当前文档")
            item.update(updated_at=now(), review=review)
            item["revision"] += 1
            if content is not None:
                item["content"] = content
                self._version(db, item, "AI 生成" if job["action"] == "generate" else "AI 修订")
            self._put(db, "prd_documents", item)

    def recover(self) -> None:
        """Fail interrupted work explicitly; never replay paid calls on startup."""
        with self.connection() as db:
            for (body,) in db.execute("SELECT body FROM prd_jobs").fetchall():
                job = json.loads(body)
                if job["status"] not in {"queued", "running"}:
                    continue
                job.update(
                    status="failed",
                    stage="任务中断",
                    updated_at=now(),
                    error="服务重启导致任务中断。已保存内容可继续使用，请重新发起任务。",
                )
                self._put(db, "prd_jobs", job)
                item = self._get(db, "prd_documents", job["document_id"])
                item["active_job_id"] = None
                self._put(db, "prd_documents", item)
