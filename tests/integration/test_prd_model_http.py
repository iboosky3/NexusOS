"""Verify the production model adapter and workflow against a local HTTP provider."""

import json
import tempfile
import threading
import time
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from fastapi.testclient import TestClient
from nexusos.api import create_app
from nexusos.models import OpenAICompatibleGateway
from nexusos.prd.store import PrdStore

ROOT = Path(__file__).resolve().parents[2]


class PrdHttpModelTests(unittest.TestCase):
    def test_complete_workflow_uses_real_http_and_preserves_provider_usage(self):
        calls = []

        class Provider(BaseHTTPRequestHandler):
            def log_message(self, format, *args):
                pass

            def do_POST(self):
                body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
                calls.append(
                    {
                        "path": self.path,
                        "authorization": self.headers.get("Authorization"),
                        "body": body,
                    }
                )
                text = body["messages"][-1]["content"]
                if "Task: 检查需求与验收质量" in text:
                    content = json.dumps({"summary": "待人工评审", "issues": []})
                elif "Task: 撰写完整 PRD" in text:
                    content = "# 排班 PRD\n\n## FR-001 冲突检测\nAC-001 重复排班被阻止。"
                else:
                    content = "排班分析：禁止重复排班，规则来自用户简报。"
                response = json.dumps(
                    {
                        "model": body["model"],
                        "choices": [{"message": {"content": content}, "finish_reason": "stop"}],
                        "usage": {"prompt_tokens": 107, "completion_tokens": 53},
                    }
                ).encode()
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(response)))
                self.end_headers()
                self.wfile.write(response)

        server = ThreadingHTTPServer(("127.0.0.1", 0), Provider)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            with tempfile.TemporaryDirectory() as directory:
                gateway = OpenAICompatibleGateway(
                    base_url=f"http://127.0.0.1:{server.server_port}/v1",
                    api_key="fixture-key",
                )
                with TestClient(
                    create_app(
                        root=ROOT,
                        prd_store=PrdStore(Path(directory) / "prd.sqlite3"),
                        model_gateway=gateway,
                        model_name="fixture-model",
                    )
                ) as client:
                    document = client.post(
                        "/v1/prd/documents",
                        json={
                            "title": "排班系统",
                            "description": "禁止重复排班",
                        },
                    ).json()
                    response = client.post(
                        f"/v1/prd/documents/{document['id']}/jobs", json={"expected_revision": 1}
                    )
                    self.assertEqual(response.status_code, 202)
                    job_id = response.json()["id"]
                    deadline = time.monotonic() + 10
                    while time.monotonic() < deadline:
                        job = client.get(f"/v1/prd/jobs/{job_id}").json()
                        if job["status"] in {"succeeded", "failed"}:
                            break
                        time.sleep(0.02)
                    self.assertEqual(job["status"], "succeeded", job)
                    self.assertEqual(job["input_tokens"], 535)
                    self.assertEqual(job["output_tokens"], 265)
                    document = client.get(f"/v1/prd/documents/{document['id']}").json()
                    self.assertEqual(document["review"]["status"], "ready_for_human_review")
                    self.assertIn("AC-001", document["content"])
                    self.assertEqual(len(calls), 5)
                    self.assertEqual({call["path"] for call in calls}, {"/v1/chat/completions"})
                    self.assertTrue(
                        all(call["authorization"] == "Bearer fixture-key" for call in calls)
                    )
                    self.assertEqual(calls[3]["body"]["max_tokens"], 14000)
                    for call in calls:
                        self.assertIn("禁止重复排班", call["body"]["messages"][-1]["content"])
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=2)
