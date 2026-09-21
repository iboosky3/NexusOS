"""Durable execution evidence and model-boundary tracing for PRD authoring."""

from __future__ import annotations

import asyncio
import hashlib
import json
import sqlite3
import time
from dataclasses import replace
from datetime import UTC, datetime
from typing import TYPE_CHECKING, Any
from uuid import uuid4

from nexusos.models import ModelDelta, ModelGateway, ModelRequest, ModelResponse

if TYPE_CHECKING:
    from nexusos.prd.store import PrdStore

TRACE_SCHEMA = """
CREATE TABLE IF NOT EXISTS prd_trace_objects (
    hash TEXT PRIMARY KEY, body TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS prd_trace_events (
    sequence INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id TEXT NOT NULL UNIQUE, document_id TEXT NOT NULL,
    job_id TEXT, trace_id TEXT NOT NULL, span_id TEXT NOT NULL,
    parent_span_id TEXT, name TEXT NOT NULL, occurred_at TEXT NOT NULL,
    payload_hash TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS prd_trace_document ON prd_trace_events(document_id, sequence);
CREATE INDEX IF NOT EXISTS prd_trace_job ON prd_trace_events(job_id, sequence);
CREATE TRIGGER IF NOT EXISTS prd_trace_events_no_update
BEFORE UPDATE ON prd_trace_events BEGIN SELECT RAISE(ABORT, 'trace events are append-only'); END;
CREATE TRIGGER IF NOT EXISTS prd_trace_events_no_delete
BEFORE DELETE ON prd_trace_events BEGIN SELECT RAISE(ABORT, 'trace events are append-only'); END;
CREATE TRIGGER IF NOT EXISTS prd_trace_objects_no_update
BEFORE UPDATE ON prd_trace_objects BEGIN SELECT RAISE(ABORT, 'trace objects are immutable'); END;
CREATE TRIGGER IF NOT EXISTS prd_trace_objects_no_delete
BEFORE DELETE ON prd_trace_objects BEGIN SELECT RAISE(ABORT, 'trace objects are immutable'); END;
"""


def put_object(db: sqlite3.Connection, payload: Any) -> str:
    body = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    digest = hashlib.sha256(body.encode()).hexdigest()
    db.execute("INSERT OR IGNORE INTO prd_trace_objects VALUES (?,?)", (digest, body))
    return digest


def get_object(db: sqlite3.Connection, digest: str) -> Any:
    row = db.execute("SELECT body FROM prd_trace_objects WHERE hash=?", (digest,)).fetchone()
    if row is None or hashlib.sha256(row[0].encode()).hexdigest() != digest:
        raise ValueError("trace object is missing or its SHA-256 does not match")
    return json.loads(row[0])


def append_event(
    db: sqlite3.Connection,
    document_id: str,
    name: str,
    payload: dict[str, Any],
    *,
    job: dict[str, Any] | None = None,
    span_id: str | None = None,
    parent_span_id: str | None = None,
) -> None:
    db.execute(
        "INSERT INTO prd_trace_events (event_id,document_id,job_id,trace_id,span_id,"
        "parent_span_id,name,occurred_at,payload_hash) VALUES (?,?,?,?,?,?,?,?,?)",
        (
            uuid4().hex,
            document_id,
            job["id"] if job else None,
            job.get("trace_id", job["id"]) if job else document_id,
            span_id or (job.get("span_id") if job else None) or uuid4().hex[:16],
            parent_span_id,
            name,
            datetime.now(UTC).isoformat(),
            put_object(db, payload),
        ),
    )


def read_events(
    db: sqlite3.Connection,
    document_id: str,
    *,
    after: int = 0,
    limit: int = 100,
    job_id: str | None = None,
) -> dict[str, Any]:
    if not 0 <= after <= 2**63 - 1 or not 1 <= limit <= 500:
        raise ValueError("after must fit a non-negative SQLite integer; limit must be 1 to 500")
    where = "document_id=? AND sequence>?"
    params: list[Any] = [document_id, after]
    if job_id:
        where += " AND job_id=?"
        params.append(job_id)
    cursor = db.execute(
        f"SELECT * FROM prd_trace_events WHERE {where} ORDER BY sequence LIMIT ?",
        (*params, limit + 1),
    )
    names = [column[0] for column in cursor.description]
    rows = cursor.fetchall()
    items = []
    for row in rows[:limit]:
        event = dict(zip(names, row, strict=True))
        event["payload"] = get_object(db, event["payload_hash"])
        items.append(event)
    return {"items": items, "next_cursor": items[-1]["sequence"] if len(rows) > limit else None}


class TracedModelGateway:
    """Record normalized requests before network calls and outcomes before runtime validation."""

    def __init__(self, gateway: ModelGateway, store: PrdStore, job_id: str) -> None:
        self.gateway, self.store, self.job_id = gateway, store, job_id

    async def complete(self, request: ModelRequest) -> ModelResponse:
        span_id = uuid4().hex[:16]
        parent = request.metadata.get("span_id")
        job = self.store.job(self.job_id)
        metadata = {**request.metadata, "trace_id": job["trace_id"], "span_id": span_id}
        routed = replace(request, metadata=metadata)
        started = time.monotonic()

        def record(name: str, payload: dict[str, Any]) -> None:
            self.store.record_event(
                self.job_id, name, payload, span_id=span_id, parent_span_id=parent
            )

        record(
            "model.requested",
            {
                "stage_id": metadata.get("stage_id", metadata.get("task_id")),
                "attempt": int(metadata.get("continuation_index", "0")) + 1,
                "model": routed.model,
                "temperature": routed.temperature,
                "maximum_output_tokens": routed.maximum_output_tokens,
                "data_classification": routed.data_classification,
                "messages": [{"role": m.role, "content": m.content} for m in routed.messages],
                "metadata": metadata,
            },
        )
        try:
            response = await self.gateway.complete(routed)
        except asyncio.CancelledError:
            record(
                "model.cancelled",
                {
                    "stage_id": metadata.get("stage_id", metadata.get("task_id")),
                    "duration_ms": round((time.monotonic() - started) * 1000),
                    "provider_outcome": "unknown",
                    "note": "本地等待已取消；供应商可能继续计算，未推断其结果或费用。",
                },
            )
            raise
        except Exception as exc:
            record(
                "model.failed",
                {
                    "stage_id": metadata.get("stage_id", metadata.get("task_id")),
                    "error_type": type(exc).__name__,
                    "http_status": getattr(exc, "http_status", None),
                    "duration_ms": round((time.monotonic() - started) * 1000),
                    "note": "未记录供应商异常原文，避免泄露密钥或 HTTP 头。",
                },
            )
            raise
        record(
            "model.responded",
            {
                "stage_id": metadata.get("stage_id", metadata.get("task_id")),
                "provider": response.provider,
                "model": response.model,
                "finish_reason": response.finish_reason,
                "provider_request_id": response.provider_request_id,
                "content": response.content,
                "input_tokens": response.usage.input_tokens,
                "output_tokens": response.usage.output_tokens,
                "duration_ms": round((time.monotonic() - started) * 1000),
                "note": "供应商已返回；正文是否可接受由后续阶段校验决定。",
            },
        )
        return response

    async def complete_stream(self, request: ModelRequest, on_delta: Any) -> ModelResponse:
        """Trace one streamed call and durably expose throttled live snapshots."""

        stage_id = str(request.metadata.get("stage_id", request.metadata.get("task_id", "")))
        complete_stream = getattr(self.gateway, "complete_stream", None)
        if not callable(complete_stream):
            response = await self.complete(request)
            delta = ModelDelta(
                content=response.content,
                reasoning_content=response.reasoning_content,
            )
            self.store.append_stream_delta(
                self.job_id,
                stage_id,
                delta.content,
                delta.reasoning_content,
            )
            on_delta(delta)
            return response

        span_id = uuid4().hex[:16]
        parent = request.metadata.get("span_id")
        job = self.store.job(self.job_id)
        metadata = {**request.metadata, "trace_id": job["trace_id"], "span_id": span_id}
        routed = replace(request, metadata=metadata)
        started = time.monotonic()
        pending_content: list[str] = []
        pending_reasoning: list[str] = []
        last_flush = started
        stage_id = str(metadata.get("stage_id", metadata.get("task_id", "")))

        def record(name: str, payload: dict[str, Any]) -> None:
            self.store.record_event(
                self.job_id, name, payload, span_id=span_id, parent_span_id=parent
            )

        def flush() -> None:
            nonlocal last_flush
            content = "".join(pending_content)
            reasoning = "".join(pending_reasoning)
            pending_content.clear()
            pending_reasoning.clear()
            if content or reasoning:
                self.store.append_stream_delta(self.job_id, stage_id, content, reasoning)
            last_flush = time.monotonic()

        def streamed(delta: ModelDelta) -> None:
            pending_content.append(delta.content)
            pending_reasoning.append(delta.reasoning_content)
            on_delta(delta)
            if time.monotonic() - last_flush >= 0.08 or "\n" in delta.content:
                flush()

        record(
            "model.requested",
            {
                "stage_id": stage_id,
                "attempt": int(metadata.get("continuation_index", "0")) + 1,
                "model": routed.model,
                "temperature": routed.temperature,
                "maximum_output_tokens": routed.maximum_output_tokens,
                "data_classification": routed.data_classification,
                "stream": True,
                "messages": [{"role": m.role, "content": m.content} for m in routed.messages],
                "metadata": metadata,
            },
        )
        try:
            response = await complete_stream(routed, streamed)
            flush()
        except asyncio.CancelledError:
            flush()
            record(
                "model.cancelled",
                {
                    "stage_id": stage_id,
                    "duration_ms": round((time.monotonic() - started) * 1000),
                    "provider_outcome": "unknown",
                    "note": "本地等待已取消；供应商可能继续计算，未推断其结果或费用。",
                },
            )
            raise
        except Exception as exc:
            flush()
            record(
                "model.failed",
                {
                    "stage_id": stage_id,
                    "error_type": type(exc).__name__,
                    "http_status": getattr(exc, "http_status", None),
                    "duration_ms": round((time.monotonic() - started) * 1000),
                    "note": "未记录供应商异常原文，避免泄露密钥或 HTTP 头。",
                },
            )
            raise
        record(
            "model.responded",
            {
                "stage_id": stage_id,
                "provider": response.provider,
                "model": response.model,
                "finish_reason": response.finish_reason,
                "provider_request_id": response.provider_request_id,
                "content": response.content,
                "input_tokens": response.usage.input_tokens,
                "output_tokens": response.usage.output_tokens,
                "duration_ms": round((time.monotonic() - started) * 1000),
                "streamed": True,
                "note": "供应商已返回；正文是否可接受由后续阶段校验决定。",
            },
        )
        return response
