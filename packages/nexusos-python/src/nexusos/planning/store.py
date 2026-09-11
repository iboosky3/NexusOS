"""SQLite plan snapshots and single-consumption execution claims."""

import json
import sqlite3
from contextlib import contextmanager
from datetime import UTC, datetime
from pathlib import Path


def now():
    return datetime.now(UTC).isoformat()


class PlanningStore:
    def __init__(self, path: Path):
        self.path = path
        path.parent.mkdir(parents=True, exist_ok=True)
        with self.connection() as db:
            db.executescript("""
                CREATE TABLE IF NOT EXISTS nexus_plans (
                    id TEXT PRIMARY KEY, body TEXT NOT NULL);
                CREATE TRIGGER IF NOT EXISTS nexus_plans_immutable
                    BEFORE UPDATE ON nexus_plans BEGIN
                    SELECT RAISE(ABORT, 'plan snapshots are immutable'); END;
                CREATE TABLE IF NOT EXISTS nexus_plan_runs (
                    plan_id TEXT PRIMARY KEY, body TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS nexus_plan_confirmations (
                    plan_id TEXT PRIMARY KEY, digest TEXT NOT NULL, confirmed_at TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS nexus_planning_events (
                    sequence INTEGER PRIMARY KEY AUTOINCREMENT,
                    plan_id TEXT NOT NULL, body TEXT NOT NULL);
                CREATE INDEX IF NOT EXISTS nexus_planning_events_plan
                    ON nexus_planning_events(plan_id, sequence);
                CREATE TRIGGER IF NOT EXISTS nexus_planning_events_immutable
                    BEFORE UPDATE ON nexus_planning_events BEGIN
                    SELECT RAISE(ABORT, 'planning events are immutable'); END;
            """)

    @contextmanager
    def connection(self):
        db = sqlite3.connect(self.path, timeout=10)
        try:
            with db:
                yield db
        finally:
            db.close()

    def save(self, plan):
        with self.connection() as db:
            db.execute(
                "INSERT INTO nexus_plans VALUES (?, ?)",
                (plan["id"], json.dumps(plan, ensure_ascii=False)),
            )

    def record(self, plan_id, name, payload):
        with self.connection() as db:
            db.execute(
                "INSERT INTO nexus_planning_events(plan_id, body) VALUES (?, ?)",
                (
                    plan_id,
                    json.dumps({"name": name, "at": now(), "payload": payload}, ensure_ascii=False),
                ),
            )

    def events(self, plan_id):
        with self.connection() as db:
            rows = db.execute(
                "SELECT sequence, body FROM nexus_planning_events "
                "WHERE plan_id=? ORDER BY sequence",
                (plan_id,),
            ).fetchall()
        return [{"sequence": sequence, **json.loads(body)} for sequence, body in rows]

    def get(self, plan_id):
        with self.connection() as db:
            row = db.execute("SELECT body FROM nexus_plans WHERE id=?", (plan_id,)).fetchone()
        if row is None:
            raise LookupError("计划不存在")
        return json.loads(row[0])

    def confirm(self, plan_id, digest):
        plan = self.get(plan_id)
        if plan["status"] != "frozen" or plan.get("digest") != digest:
            raise ValueError("计划未通过校验或已变化")
        with self.connection() as db:
            db.execute(
                "INSERT OR IGNORE INTO nexus_plan_confirmations VALUES (?, ?, ?)",
                (plan_id, digest, now()),
            )
        return self.confirmation(plan_id)

    def confirmation(self, plan_id):
        with self.connection() as db:
            row = db.execute(
                "SELECT digest, confirmed_at FROM nexus_plan_confirmations WHERE plan_id=?",
                (plan_id,),
            ).fetchone()
        if row is None:
            raise LookupError("请先确认编排方案")
        return {"plan_id": plan_id, "digest": row[0], "confirmed_at": row[1]}

    def claim(self, plan_id, digest):
        with self.connection() as db:
            db.execute("BEGIN IMMEDIATE")
            plan = self.get(plan_id)
            if plan["status"] != "frozen" or plan.get("digest") != digest:
                raise ValueError("计划未通过校验或摘要不匹配")
            row = db.execute(
                "SELECT body FROM nexus_plan_runs WHERE plan_id=?", (plan_id,)
            ).fetchone()
            if row:
                return json.loads(row[0]), False
            run = {
                "plan_id": plan_id,
                "status": "queued",
                "tasks": {},
                "events": [],
                "input_tokens": 0,
                "output_tokens": 0,
                "created_at": now(),
            }
            db.execute("INSERT INTO nexus_plan_runs VALUES (?, ?)", (plan_id, json.dumps(run)))
        return run, True

    def run(self, plan_id):
        with self.connection() as db:
            row = db.execute(
                "SELECT body FROM nexus_plan_runs WHERE plan_id=?", (plan_id,)
            ).fetchone()
        if row is None:
            raise LookupError("计划尚未执行")
        return json.loads(row[0])

    def update_run(self, run):
        run["updated_at"] = now()
        with self.connection() as db:
            db.execute(
                "UPDATE nexus_plan_runs SET body=? WHERE plan_id=?",
                (json.dumps(run, ensure_ascii=False), run["plan_id"]),
            )

    def recover(self):
        with self.connection() as db:
            rows = db.execute("SELECT body FROM nexus_plan_runs").fetchall()
            for (body,) in rows:
                run = json.loads(body)
                if run["status"] in {"queued", "running"}:
                    run.update(status="interrupted", error="服务中断；请重新规划后显式执行")
                    db.execute(
                        "UPDATE nexus_plan_runs SET body=? WHERE plan_id=?",
                        (json.dumps(run), run["plan_id"]),
                    )
