"""Isolated real API for browser tests; never uses user data or a paid model."""

import json
import tempfile
from pathlib import Path

import uvicorn
from nexusos.api import create_app
from nexusos.core.models import TokenUsage
from nexusos.models import ModelResponse
from nexusos.prd.store import PrdStore


class BrowserGateway:
    async def complete(self, request):
        system = request.messages[0].content
        if "便签整理 Agent" in system:
            payload = {"title": "Agent 便签", "content": "整理后的便签"}
        elif "澄清需求：" in system:
            payload = {"answer": "建议明确用户群", "updates": {"audience": "设计师与产品经理"}}
        elif "组件建议：" in system:
            payload = {"answer": "仅修改所选组件", "patch": {"label": "Agent 修改的标题"}}
        else:
            payload = {
                "brief": {"title": "浏览器验收 PRD"},
                "content": "# Agent 草稿\n等待人工确认。",
            }
        return ModelResponse(
            json.dumps(payload),
            "test",
            request.model,
            TokenUsage(1, 1),
            "stop",
        )


if __name__ == "__main__":
    with tempfile.TemporaryDirectory(prefix="nexus-studio-browser-") as directory:
        app = create_app(
            root=Path(__file__).resolve().parents[1],
            prd_store=PrdStore(Path(directory) / "test.sqlite"),
            model_gateway=BrowserGateway(),
            model_name="browser-test",
        )
        uvicorn.run(app, host="127.0.0.1", port=18123)
